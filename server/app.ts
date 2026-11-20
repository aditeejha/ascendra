import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type {
  CivicCategory,
  CivicStatus,
  Counters,
  EvaluationResult,
  Role,
  Severity,
  VehicleClass,
} from '../shared/types';
import type { Repo } from './repo';
import type { Simulation } from './sim/engine';
import { runEvaluation } from './sim/evaluation';
import type { Forecaster } from './sim/forecaster';
import { saveJson } from './sim/models';
import { publicNetwork, type Network } from './sim/network';
import type { QPolicy } from './sim/rl';

export interface EvaluationState {
  result: EvaluationResult | null;
  running: boolean;
  done: number;
  total: number;
}

export interface AppContext {
  net: Network;
  sim: Simulation;
  repo: Repo;
  policy: QPolicy | null;
  forecaster: Forecaster | null;
  evaluation: EvaluationState;
  civicIncidents: Map<number, string>;
  counters: Counters;
  refreshCounters: () => Promise<void>;
  clients: Set<Response>;
}

const ROLES: Role[] = ['controller', 'authority', 'citizen', 'driver', 'emergency'];
const CLASSES = ['private', 'two_wheeler', 'cargo', 'emergency'] as const;
const CATEGORIES = [
  'pothole',
  'waterlogging',
  'accident',
  'broken_signal',
  'road_blockage',
  'illegal_parking',
  'streetlight',
] as const;
const CIVIC_STATUSES = ['reported', 'verified', 'in_progress', 'resolved', 'rejected'] as const;

function roleOf(req: Request): Role {
  const header = req.header('x-role') as Role | undefined;
  return header && ROLES.includes(header) ? header : 'citizen';
}

function allow(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (roles.includes(roleOf(req))) return next();
    res.status(403).json({ error: `This action is limited to: ${roles.join(', ')}.` });
  };
}

const idParam = (req: Request) => z.coerce.number().int().nonnegative().parse(req.params.id);

function civicImpact(category: CivicCategory, severity: Severity) {
  const high = severity === 'high';
  switch (category) {
    case 'accident':
      return { lanesLost: 1, speedFactor: 0.55, closes: false, both: false };
    case 'waterlogging':
      return { lanesLost: high ? 1 : 0, speedFactor: high ? 0.35 : 0.5, closes: false, both: true };
    case 'pothole':
      return { lanesLost: 0, speedFactor: high ? 0.6 : 0.8, closes: false, both: true };
    case 'road_blockage':
      return high
        ? { lanesLost: 0, speedFactor: 1, closes: true, both: true }
        : { lanesLost: 1, speedFactor: 0.6, closes: false, both: true };
    case 'illegal_parking':
      return { lanesLost: 0, speedFactor: 0.75, closes: false, both: false };
    default:
      return null;
  }
}

function fineFor(cls: VehicleClass, speed: number, limit: number): number {
  const excess = speed / limit - 1;
  const base = excess > 0.2 ? 2000 : 1000;
  return cls === 'cargo' ? base * 2 : base;
}

function emergencyLabel(agency: string | null): string {
  const a = (agency ?? '').toLowerCase();
  if (a.includes('fire')) return 'Fire tender';
  if (a.includes('police')) return 'Police';
  if (a.includes('ambulance')) return 'Ambulance';
  return 'Emergency vehicle';
}

export function createApp(ctx: AppContext) {
  const { net, sim, repo } = ctx;
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const nodeIdSchema = z.number().int().min(0).max(net.nodes.length - 1);
  const linkIdSchema = z.number().int().min(0).max(net.links.length - 1);

  const audit = (req: Request, action: string, entity: string, id: string | number | null, details?: Record<string, unknown>) =>
    repo.audit(roleOf(req), action, entity, id, details ?? null);

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      database: repo.mode,
      forecaster: Boolean(ctx.forecaster),
      signalPolicy: Boolean(ctx.policy),
      simClock: sim.clock,
    });
  });

  app.get('/api/network', (req, res) => {
    res.json(publicNetwork(net));
  });

  app.get('/api/state', (req, res) => {
    res.json({ ...sim.snapshot(), counters: ctx.counters });
  });

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ ...sim.snapshot(), counters: ctx.counters })}\n\n`);
    ctx.clients.add(res);
    req.on('close', () => ctx.clients.delete(res));
  });

  app.get('/api/events', (req, res) => {
    res.json(sim.recentEvents(40));
  });

  app.get('/api/settings', (req, res) => {
    res.json(sim.settings);
  });

  const settingsSchema = z
    .object({
      speed: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
      paused: z.boolean(),
      weather: z.enum(['clear', 'rain', 'heavy_rain', 'fog']),
      demand: z.number().min(0.5).max(1.5),
      randomIncidents: z.boolean(),
      emergencyPriority: z.boolean(),
      adaptive: z.boolean(),
      forecastRouting: z.boolean(),
    })
    .partial();

  app.patch('/api/settings', allow('controller'), async (req, res) => {
    const update = settingsSchema.parse(req.body);
    const { weather, ...rest } = update;
    Object.assign(sim.settings, rest);
    if (weather && weather !== sim.settings.weather) {
      sim.setWeather(weather);
      sim.pushEvent('system', 'Weather updated', `Conditions set to ${weather.replace('_', ' ')}`, 'info');
    }
    if (update.adaptive !== undefined) {
      sim.pushEvent(
        'signal',
        update.adaptive ? 'Adaptive control enabled' : 'Adaptive control disabled',
        update.adaptive ? 'RL agent and forecasts drive signal timing' : 'All signals run their fixed-time plans',
        update.adaptive ? 'info' : 'warning',
      );
    }
    await audit(req, 'update_settings', 'settings', null, update);
    res.json(sim.settings);
  });

  app.get('/api/signals', (req, res) => {
    res.json(sim.signalDetails());
  });

  const signalSchema = z.object({
    mode: z.enum(['adaptive', 'fixed']).optional(),
    greenNS: z.number().int().min(10).max(120).optional(),
    greenEW: z.number().int().min(10).max(120).optional(),
  });

  app.patch('/api/signals/:id', allow('controller'), async (req, res) => {
    const id = nodeIdSchema.parse(idParam(req));
    const body = signalSchema.parse(req.body);
    const detail = sim.configureSignal(id, { mode: body.mode, plan: { greenNS: body.greenNS, greenEW: body.greenEW } });
    await repo.logSignalChange(id, detail.mode, detail.plan.greenNS, detail.plan.greenEW, roleOf(req));
    await audit(req, 'update_signal', 'signal', id, body);
    sim.pushEvent('signal', 'Signal plan updated', `${detail.name}: ${detail.mode}, NS ${detail.plan.greenNS}s / EW ${detail.plan.greenEW}s`, 'info');
    res.json(detail);
  });

  app.get('/api/forecast', (req, res) => {
    res.json(sim.forecast());
  });

  const routeSchema = z.object({
    from: nodeIdSchema,
    to: nodeIdSchema,
    vehicleClass: z.enum(CLASSES).optional(),
    weightT: z.number().min(0.1).max(60).optional(),
  });

  app.post('/api/routes/plan', (req, res) => {
    const body = routeSchema.parse(req.body);
    if (body.from === body.to) {
      res.status(400).json({ error: 'Origin and destination must be different junctions.' });
      return;
    }
    const classes: VehicleClass[] = body.vehicleClass ? [body.vehicleClass] : [...CLASSES];
    res.json({ from: body.from, to: body.to, plans: classes.map((c) => sim.planRoute(body.from, body.to, c, body.weightT)) });
  });

  app.get('/api/vehicles', async (req, res) => {
    res.json(await repo.listVehicles());
  });

  const vehicleSchema = z.object({
    plate: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{1,4}$/, 'Use an Indian registration format, e.g. JH 15 AB 1234'),
    vehicleClass: z.enum(CLASSES),
    ownerName: z.string().trim().min(2).max(80),
    phone: z.string().trim().max(20).optional().nullable(),
    weightT: z.number().min(0.1).max(60).optional().nullable(),
    agency: z.string().trim().max(80).optional().nullable(),
  });

  app.post('/api/vehicles', allow('driver', 'controller', 'authority', 'emergency'), async (req, res) => {
    const body = vehicleSchema.parse(req.body);
    const plate = body.plate.replace(/\s+/g, ' ');
    if (await repo.findPlate(plate)) {
      res.status(409).json({ error: `${plate} is already registered.` });
      return;
    }
    if (body.vehicleClass === 'cargo' && !body.weightT) {
      res.status(400).json({ error: 'Cargo vehicles need a gross weight for route restrictions.' });
      return;
    }
    const vehicle = await repo.createVehicle({ ...body, plate });
    await audit(req, 'register_vehicle', 'vehicle', vehicle.id, { plate, vehicleClass: body.vehicleClass });
    await ctx.refreshCounters();
    res.status(201).json(vehicle);
  });

  app.patch('/api/vehicles/:id', allow('authority', 'controller'), async (req, res) => {
    const id = idParam(req);
    const { status } = z.object({ status: z.enum(['active', 'verified', 'rejected']) }).parse(req.body);
    const vehicle = await repo.setVehicleStatus(id, status);
    if (!vehicle) {
      res.status(404).json({ error: 'Vehicle not found.' });
      return;
    }
    await audit(req, `vehicle_${status}`, 'vehicle', id, { plate: vehicle.plate });
    await ctx.refreshCounters();
    res.json(vehicle);
  });

  app.get('/api/emergency', async (req, res) => {
    res.json({ active: sim.snapshot().emergencies, dispatches: await repo.listDispatches(40) });
  });

  const dispatchSchema = z.object({ vehicleId: z.number().int().positive(), from: nodeIdSchema, to: nodeIdSchema });

  app.post('/api/emergency/dispatch', allow('controller', 'emergency'), async (req, res) => {
    const body = dispatchSchema.parse(req.body);
    if (body.from === body.to) {
      res.status(400).json({ error: 'Pick a destination different from the start junction.' });
      return;
    }
    const vehicle = await repo.getVehicle(body.vehicleId);
    if (!vehicle || vehicle.vehicleClass !== 'emergency') {
      res.status(404).json({ error: 'Registered emergency vehicle not found.' });
      return;
    }
    if (vehicle.status !== 'verified') {
      res.status(403).json({ error: `${vehicle.plate} has not been verified by the traffic authority yet.` });
      return;
    }
    const busy = (await repo.listDispatches(100)).some((d) => d.vehicleId === vehicle.id && d.status === 'en_route');
    if (busy) {
      res.status(409).json({ error: `${vehicle.plate} is already on a dispatch.` });
      return;
    }
    const label = emergencyLabel(vehicle.agency);
    const dispatch = await repo.createDispatch({
      vehicleId: vehicle.id,
      plate: vehicle.plate,
      label,
      originNode: body.from,
      destNode: body.to,
      startedClock: sim.clock,
    });
    const result = sim.dispatchEmergency({ plate: vehicle.plate, label, from: body.from, to: body.to, dispatchId: dispatch.id });
    if (!result) {
      await repo.finishDispatch(dispatch.id, 'cancelled', null, 0);
      res.status(422).json({ error: 'No route available for this dispatch.' });
      return;
    }
    const updated = await repo.updateDispatchPlan(dispatch.id, Math.round(result.plan.etaMin * 60), result.estNoPriorityS);
    await audit(req, 'dispatch_emergency', 'dispatch', dispatch.id, { plate: vehicle.plate, from: body.from, to: body.to });
    res.status(201).json({ dispatch: updated, plan: result.plan });
  });

  app.get('/api/civic', async (req, res) => {
    res.json(await repo.listCivic());
  });

  const civicSchema = z
    .object({
      category: z.enum(CATEGORIES),
      description: z.string().trim().min(5).max(500),
      linkId: linkIdSchema.nullable().optional(),
      nodeId: nodeIdSchema.nullable().optional(),
      severity: z.enum(['low', 'medium', 'high']),
      reporterName: z.string().trim().min(2).max(60),
    })
    .refine((c) => c.linkId != null || c.nodeId != null, { message: 'Pick a road segment or junction on the map.' });

  app.post('/api/civic', async (req, res) => {
    const body = civicSchema.parse(req.body);
    const report = await repo.createCivic({ ...body, linkId: body.linkId ?? null, nodeId: body.nodeId ?? null });
    const where = report.linkId !== null ? net.links[report.linkId].road : net.nodes[report.nodeId!].name;
    sim.pushEvent('civic', 'Civic issue reported', `${report.category.replace('_', ' ')} on ${where}`, 'info');
    await audit(req, 'create_civic', 'civic_report', report.id, { category: report.category });
    await ctx.refreshCounters();
    res.status(201).json(report);
  });

  app.patch('/api/civic/:id', allow('controller', 'authority'), async (req, res) => {
    const id = idParam(req);
    const { status } = z.object({ status: z.enum(CIVIC_STATUSES) }).parse(req.body);
    const report = await repo.getCivic(id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    let impactApplied = report.impactApplied;
    const active = (s: CivicStatus) => s === 'verified' || s === 'in_progress';
    const node = report.nodeId ?? (report.linkId !== null ? net.links[report.linkId].to : null);
    if (active(status) && !impactApplied) {
      if (report.category === 'broken_signal' && node !== null) {
        sim.setSignalFault(node, true);
        impactApplied = true;
      } else if (report.linkId !== null) {
        const impact = civicImpact(report.category, report.severity);
        if (impact) {
          const link = net.links[report.linkId];
          const incidentId = sim.addIncident({
            linkIds: impact.both ? [link.id, link.reverse] : [link.id],
            source: 'civic',
            durationS: null,
            lanesLost: impact.lanesLost,
            speedFactor: impact.speedFactor,
            closes: impact.closes,
            label: `${report.category.replace('_', ' ')} on ${link.road}`,
          });
          ctx.civicIncidents.set(report.id, incidentId);
          impactApplied = true;
        }
      }
      if (impactApplied) {
        sim.pushEvent('civic', 'Citizen report applied to traffic control', `Report #${report.id}: ${report.category.replace('_', ' ')} now affects routing and signals`, 'warning');
      }
    }
    if (!active(status) && impactApplied) {
      const incidentId = ctx.civicIncidents.get(report.id);
      if (incidentId) {
        sim.clearIncident(incidentId);
        ctx.civicIncidents.delete(report.id);
      }
      if (report.category === 'broken_signal' && node !== null) sim.setSignalFault(node, false);
      impactApplied = false;
    }
    const updated = await repo.updateCivic(id, status, impactApplied);
    await audit(req, 'update_civic', 'civic_report', id, { status });
    await ctx.refreshCounters();
    res.json(updated);
  });

  app.get('/api/alerts', async (req, res) => {
    res.json(await repo.listAlerts(200));
  });

  app.patch('/api/alerts/:id', allow('authority', 'controller'), async (req, res) => {
    const id = idParam(req);
    const { action } = z.object({ action: z.enum(['fine', 'dismiss']) }).parse(req.body);
    const alert = await repo.getAlert(id);
    if (!alert) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    const updated =
      action === 'fine'
        ? await repo.updateAlert(id, 'fined', fineFor(alert.vehicleClass, alert.speedKmh, alert.limitKmh))
        : await repo.updateAlert(id, 'dismissed', null);
    await audit(req, action === 'fine' ? 'issue_challan' : 'dismiss_alert', 'overspeed_alert', id, { plate: alert.plate });
    await ctx.refreshCounters();
    res.json(updated);
  });

  const evacSchema = z.object({ center: nodeIdSchema, radius: z.number().int().min(1).max(2) });

  app.post('/api/evacuation', allow('controller'), async (req, res) => {
    const body = evacSchema.parse(req.body);
    const status = sim.activateEvacuation(body.center, body.radius);
    await audit(req, 'activate_evacuation', 'evacuation', body.center, body);
    res.status(201).json(status);
  });

  app.delete('/api/evacuation', allow('controller'), async (req, res) => {
    sim.deactivateEvacuation();
    await audit(req, 'end_evacuation', 'evacuation', null);
    res.json({ ok: true });
  });

  app.get('/api/analytics', (req, res) => {
    res.json(sim.analytics());
  });

  app.get('/api/evaluation', (req, res) => {
    const e = ctx.evaluation;
    res.json({ result: e.result, running: e.running, done: e.done, total: e.total });
  });

  app.post('/api/evaluation', allow('controller', 'authority'), async (req, res) => {
    const e = ctx.evaluation;
    if (e.running) {
      res.status(409).json({ error: 'An evaluation is already running.' });
      return;
    }
    e.running = true;
    e.done = 0;
    e.total = 0;
    await audit(req, 'run_evaluation', 'evaluation', null);
    runEvaluation(net, ctx.policy, ctx.forecaster, {
      seeds: 2,
      durationMin: 60,
      onProgress: (done, total) => {
        e.done = done;
        e.total = total;
      },
    })
      .then((result) => {
        e.result = result;
        saveJson('evaluation.json', result);
        sim.pushEvent('system', 'Evaluation finished', 'Adaptive vs fixed-time comparison updated', 'info');
      })
      .catch((err) => console.error('Evaluation failed', err))
      .finally(() => {
        e.running = false;
      });
    res.status(202).json({ running: true });
  });

  app.get('/api/audit', allow('controller', 'authority'), async (req, res) => {
    res.json(await repo.listAudit(150));
  });

  const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/client');
  if (existsSync(path.join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid request.', issues: err.issues });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
