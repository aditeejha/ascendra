import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import type {
  CivicAction,
  CivicCategory,
  CivicReport,
  CivicStatus,
  Counters,
  EvaluationResult,
  LiveStatus,
  RegisteredVehicle,
  Role,
  Severity,
  Snapshot,
  VehicleClass,
} from '../shared/types';
import { cityConfig } from './config';
import type { Repo } from './repo';
import type { Simulation } from './sim/engine';
import { runEvaluation } from './sim/evaluation';
import type { Forecaster } from './sim/forecaster';
import type { Replay } from './live/replay';
import type { JunctionForecaster } from './sim/junction';
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
  junctionModel: JunctionForecaster | null;
  evaluation: EvaluationState;
  civicIncidents: Map<number, string>;
  counters: Counters;
  refreshCounters: () => Promise<void>;
  clients: Set<Response>;
  frame: () => Snapshot;
  liveStatus: () => LiveStatus;
  resync: () => Promise<void>;
  applyLiveWeather: () => void;
  replay: Replay;
  startReplay: (speed: number) => Promise<void>;
  stopReplay: () => Promise<void>;
}

const ROLES: Role[] = ['controller', 'authority', 'citizen', 'driver', 'emergency'];
const CLASSES = ['private', 'two_wheeler', 'cargo', 'bus', 'emergency'] as const;
const CATEGORIES = [
  'pothole',
  'waterlogging',
  'accident',
  'broken_signal',
  'road_blockage',
  'illegal_parking',
  'streetlight',
] as const;
const CIVIC_STATUSES = ['reported', 'verified', 'assigned', 'in_progress', 'resolved', 'closed', 'reopened', 'rejected'] as const;
const CIVIC_ACTIONS = ['verify', 'reject', 'assign', 'start', 'resolve', 'close', 'reopen'] as const;
const ACTION_STATUS: Record<CivicAction, CivicStatus> = {
  verify: 'verified',
  reject: 'rejected',
  assign: 'assigned',
  start: 'in_progress',
  resolve: 'resolved',
  close: 'closed',
  reopen: 'reopened',
};
const STATUS_ACTION: Partial<Record<CivicStatus, CivicAction>> = Object.fromEntries(Object.entries(ACTION_STATUS).map(([a, st]) => [st, a])) as Partial<Record<CivicStatus, CivicAction>>;
const ACTION_FROM: Record<CivicAction, CivicStatus[]> = {
  verify: ['reported', 'reopened'],
  reject: ['reported', 'verified', 'reopened'],
  assign: ['verified', 'assigned', 'reopened'],
  start: ['verified', 'assigned', 'reopened'],
  resolve: ['verified', 'assigned', 'in_progress', 'reopened'],
  close: ['resolved'],
  reopen: ['resolved', 'closed'],
};
const STAFF_ACTIONS: CivicAction[] = ['verify', 'reject', 'assign', 'start', 'resolve'];
const ACTIVE_CIVIC: CivicStatus[] = ['verified', 'assigned', 'in_progress', 'reopened'];
const PHOTO = z
  .string()
  .max(2_500_000, 'The photo is too large; use an image under about 1.5 MB.')
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a JPEG, PNG or WebP photo.');
const PHONE = z
  .string()
  .trim()
  .regex(/^[+]?[0-9 -]{7,15}$/, 'Enter a valid phone number.');

function isStaff(role: Role): boolean {
  return role === 'controller' || role === 'authority';
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '••••' : `${digits.slice(0, 2)}${'•'.repeat(Math.max(2, digits.length - 5))}${digits.slice(-3)}`;
}

function redactVehicle(v: RegisteredVehicle, role: Role): RegisteredVehicle {
  if (isStaff(role) || ['108', '101', '112'].includes(v.phone ?? '')) return v;
  return { ...v, phone: maskPhone(v.phone), email: null, address: null, licenceNo: null };
}

function sendDataUrl(res: Response, dataUrl: string | null): void {
  const m = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) {
    res.status(404).json({ error: 'No photo.' });
    return;
  }
  res.setHeader('Content-Type', m[1]);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(Buffer.from(m[2], 'base64'));
}

function roleOf(req: Request): Role {
  const header = (req.header('x-role') ?? (req.method === 'GET' && typeof req.query.role === 'string' ? req.query.role : undefined)) as Role | undefined;
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

export function applyCivicImpact(ctx: AppContext, report: CivicReport): boolean {
  const node = report.nodeId ?? (report.linkId !== null ? ctx.net.links[report.linkId].to : null);
  if (report.category === 'broken_signal' && node !== null) {
    ctx.sim.setSignalFault(node, true);
    return true;
  }
  if (report.linkId === null) return false;
  const impact = civicImpact(report.category, report.severity);
  if (!impact) return false;
  const link = ctx.net.links[report.linkId];
  const incidentId = ctx.sim.addIncident({
    linkIds: impact.both && link.reverse >= 0 ? [link.id, link.reverse] : [link.id],
    source: 'civic',
    durationS: null,
    lanesLost: impact.lanesLost,
    speedFactor: impact.speedFactor,
    closes: impact.closes,
    label: `${report.category.replace('_', ' ')} on ${link.road}`,
  });
  ctx.civicIncidents.set(report.id, incidentId);
  return true;
}

function fineFor(cls: VehicleClass, speed: number, limit: number): number {
  const excess = speed / limit - 1;
  const base = excess > 0.2 ? 2000 : 1000;
  return cls === 'cargo' || cls === 'bus' ? base * 2 : base;
}

function emergencyLabel(agency: string | null): string {
  const a = (agency ?? '').toLowerCase();
  if (a.includes('fire')) return 'Fire tender';
  if (a.includes('police')) return 'Police';
  if (a.includes('ambulance')) return 'Ambulance';
  return 'Emergency vehicle';
}

export function createApp(ctx: AppContext) {
  const { net, repo } = ctx;
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  const nodeIdSchema = z.number().int().min(0).max(net.nodes.length - 1);
  const linkIdSchema = z.number().int().min(0).max(net.links.length - 1);

  const audit = (req: Request, action: string, entity: string, id: string | number | null, details?: Record<string, unknown>) =>
    repo.audit(roleOf(req), action, entity, id, details ?? null);

  app.get('/api/health', (req, res) => {
    const live = ctx.liveStatus();
    res.json({
      ok: true,
      database: repo.mode,
      forecaster: Boolean(ctx.forecaster),
      signalPolicy: Boolean(ctx.policy),
      junctionModel: Boolean(ctx.junctionModel),
      simClock: ctx.sim.clock,
      city: live.city.name,
      liveClock: ctx.sim.settings.liveClock,
      weather: live.weather.mode,
      traffic: live.traffic.status,
    });
  });

  app.get('/api/live', (req, res) => {
    res.json(ctx.liveStatus());
  });

  app.get('/api/network', (req, res) => {
    res.json(publicNetwork(net));
  });

  app.get('/api/state', (req, res) => {
    res.json(ctx.frame());
  });

  app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(ctx.frame())}\n\n`);
    ctx.clients.add(res);
    req.on('close', () => ctx.clients.delete(res));
  });

  app.get('/api/events', (req, res) => {
    res.json(ctx.sim.recentEvents(40));
  });

  app.get('/api/settings', (req, res) => {
    res.json(ctx.sim.settings);
  });

  const settingsSchema = z
    .object({
      liveClock: z.boolean(),
      liveWeather: z.boolean(),
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
    const { weather, liveClock, liveWeather, ...rest } = update;
    const resync = liveClock === true && !ctx.sim.settings.liveClock;
    Object.assign(ctx.sim.settings, rest);
    if (liveClock !== undefined) ctx.sim.settings.liveClock = liveClock;
    if (weather && liveWeather !== true) {
      ctx.sim.settings.liveWeather = false;
      if (weather !== ctx.sim.settings.weather) {
        ctx.sim.setWeather(weather);
        ctx.sim.pushEvent('system', 'Weather set manually', `Conditions set to ${weather.replace('_', ' ')}`, 'info');
      }
    }
    if (liveWeather !== undefined) {
      ctx.sim.settings.liveWeather = liveWeather;
      if (liveWeather) ctx.applyLiveWeather();
    }
    if (resync) {
      if (ctx.replay.running || ctx.sim.demandOverridden) await ctx.stopReplay();
      else await ctx.resync();
    }
    if (update.adaptive !== undefined) {
      ctx.sim.pushEvent(
        'signal',
        update.adaptive ? 'Adaptive control enabled' : 'Adaptive control disabled',
        update.adaptive ? 'RL agent and forecasts drive signal timing' : 'All signals run their fixed-time plans',
        update.adaptive ? 'info' : 'warning',
      );
    }
    await audit(req, 'update_settings', 'settings', null, update);
    res.json(ctx.sim.settings);
  });

  app.get('/api/signals', (req, res) => {
    res.json(ctx.sim.signalDetails());
  });

  const signalSchema = z.object({
    mode: z.enum(['adaptive', 'fixed']).optional(),
    greenNS: z.number().int().min(10).max(120).optional(),
    greenEW: z.number().int().min(10).max(120).optional(),
  });

  app.patch('/api/signals/:id', allow('controller'), async (req, res) => {
    const id = nodeIdSchema.parse(idParam(req));
    const body = signalSchema.parse(req.body);
    const detail = ctx.sim.configureSignal(id, { mode: body.mode, plan: { greenNS: body.greenNS, greenEW: body.greenEW } });
    await repo.logSignalChange(id, detail.mode, detail.plan.greenNS, detail.plan.greenEW, roleOf(req));
    await audit(req, 'update_signal', 'signal', id, body);
    ctx.sim.pushEvent('signal', 'Signal plan updated', `${detail.name}: ${detail.mode}, NS ${detail.plan.greenNS}s / EW ${detail.plan.greenEW}s`, 'info');
    res.json(detail);
  });

  app.get('/api/forecast', (req, res) => {
    res.json(ctx.sim.forecast());
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
    res.json({ from: body.from, to: body.to, plans: classes.map((c) => ctx.sim.planRoute(body.from, body.to, c, body.weightT)) });
  });

  app.get('/api/vehicles', async (req, res) => {
    const role = roleOf(req);
    res.json((await repo.listVehicles()).map((v) => redactVehicle(v, role)));
  });

  app.get('/api/vehicles/:id/photo', allow('authority', 'controller'), async (req, res) => {
    sendDataUrl(res, await repo.vehiclePhoto(idParam(req)));
  });

  const vehicleSchema = z.object({
    plate: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{1,4}$/, 'Use an Indian registration format, e.g. JH 15 AB 1234'),
    vehicleClass: z.enum(CLASSES),
    ownerName: z.string().trim().min(2).max(80),
    phone: PHONE.optional().nullable().or(z.literal('')),
    email: z.string().trim().email('Enter a valid email address.').max(120).optional().nullable().or(z.literal('')),
    address: z.string().trim().max(200).optional().nullable(),
    licenceNo: z.string().trim().toUpperCase().max(30).optional().nullable(),
    ownerPhoto: PHOTO.optional().nullable(),
    weightT: z.number().min(0.1).max(60).optional().nullable(),
    agency: z.string().trim().max(80).optional().nullable(),
  });

  app.post('/api/vehicles', allow('driver', 'citizen', 'controller', 'authority', 'emergency'), async (req, res) => {
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
    const vehicle = await repo.createVehicle({ ...body, plate, phone: body.phone || null, email: body.email || null, address: body.address || null, licenceNo: body.licenceNo || null });
    await audit(req, 'register_vehicle', 'vehicle', vehicle.id, { plate, vehicleClass: body.vehicleClass, owner: body.ownerName, photo: Boolean(body.ownerPhoto) });
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
    res.json({ active: ctx.sim.snapshot().emergencies, dispatches: await repo.listDispatches(40) });
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
      startedClock: ctx.sim.clock,
    });
    const result = ctx.sim.dispatchEmergency({ plate: vehicle.plate, label, from: body.from, to: body.to, dispatchId: dispatch.id });
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
    const staff = isStaff(roleOf(req));
    res.json((await repo.listCivic()).map((r) => (staff ? r : { ...r, reporterPhone: null })));
  });

  app.get('/api/civic/:id/events', async (req, res) => {
    res.json(await repo.listCivicEvents(idParam(req)));
  });

  app.get('/api/civic/:id/photo', async (req, res) => {
    const kind = req.query.kind === 'resolution' ? 'resolution' : 'report';
    sendDataUrl(res, await repo.civicPhoto(idParam(req), kind));
  });

  app.get('/api/civic-events/:id/photo', async (req, res) => {
    sendDataUrl(res, await repo.civicEventPhoto(idParam(req)));
  });

  const civicSchema = z
    .object({
      category: z.enum(CATEGORIES),
      description: z.string().trim().min(5).max(500),
      linkId: linkIdSchema.nullable().optional(),
      nodeId: nodeIdSchema.nullable().optional(),
      severity: z.enum(['low', 'medium', 'high']),
      reporterName: z.string().trim().min(2).max(60),
      reporterPhone: PHONE.optional().nullable().or(z.literal('')),
      photo: PHOTO.optional().nullable(),
    })
    .refine((c) => c.linkId != null || c.nodeId != null, { message: 'Pick a road segment or junction on the map.' });

  app.post('/api/civic', async (req, res) => {
    const body = civicSchema.parse(req.body);
    const report = await repo.createCivic({ ...body, linkId: body.linkId ?? null, nodeId: body.nodeId ?? null, reporterPhone: body.reporterPhone || null, photo: body.photo ?? null });
    const where = report.linkId !== null ? net.links[report.linkId].road : net.nodes[report.nodeId!].name;
    ctx.sim.pushEvent('civic', 'Civic issue reported', `${report.category.replace('_', ' ')} on ${where}${report.hasPhoto ? ' (with photo)' : ''}`, 'info');
    await audit(req, 'create_civic', 'civic_report', report.id, { category: report.category, reporter: body.reporterName, photo: report.hasPhoto });
    await ctx.refreshCounters();
    res.status(201).json(report);
  });

  const civicActionSchema = z
    .object({
      action: z.enum(CIVIC_ACTIONS).optional(),
      status: z.enum(CIVIC_STATUSES).optional(),
      note: z.string().trim().max(500).optional(),
      assignee: z.string().trim().min(2).max(80).optional(),
      photo: PHOTO.optional().nullable(),
      rating: z.number().int().min(1).max(5).optional(),
      actorName: z.string().trim().max(80).optional(),
    })
    .refine((b) => b.action || (b.status && STATUS_ACTION[b.status]), { message: 'Choose an action.' });

  app.patch('/api/civic/:id', async (req, res) => {
    const id = idParam(req);
    const body = civicActionSchema.parse(req.body);
    const action = (body.action ?? STATUS_ACTION[body.status!]) as CivicAction;
    const role = roleOf(req);
    if (STAFF_ACTIONS.includes(action) && !isStaff(role)) {
      res.status(403).json({ error: 'Only the traffic authority or controller can do this.' });
      return;
    }
    const report = await repo.getCivic(id);
    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }
    if (!ACTION_FROM[action].includes(report.status)) {
      res.status(409).json({ error: `A ${report.status.replace('_', ' ')} report cannot be moved with "${action}".` });
      return;
    }
    if (action === 'assign' && !body.assignee) {
      res.status(400).json({ error: 'Name the crew or officer to assign.' });
      return;
    }
    if (action === 'reopen' && !body.note) {
      res.status(400).json({ error: 'Say what is still wrong so the crew can fix it.' });
      return;
    }
    const status = ACTION_STATUS[action];
    let impactApplied = report.impactApplied;
    const node = report.nodeId ?? (report.linkId !== null ? net.links[report.linkId].to : null);
    if (ACTIVE_CIVIC.includes(status) && !impactApplied) {
      impactApplied = applyCivicImpact(ctx, report);
      if (impactApplied) {
        ctx.sim.pushEvent('civic', 'Citizen report applied to traffic control', `Report #${report.id}: ${report.category.replace('_', ' ')} now affects routing and signals`, 'warning');
      }
    }
    if (!ACTIVE_CIVIC.includes(status) && impactApplied) {
      const incidentId = ctx.civicIncidents.get(report.id);
      if (incidentId) {
        ctx.sim.clearIncident(incidentId);
        ctx.civicIncidents.delete(report.id);
      }
      if (report.category === 'broken_signal' && node !== null) ctx.sim.setSignalFault(node, false);
      impactApplied = false;
    }
    const updated = await repo.updateCivic(id, {
      status,
      impactApplied,
      assignedTo: action === 'assign' ? body.assignee! : undefined,
      resolutionNote: action === 'resolve' ? (body.note ?? null) : undefined,
      resolutionPhoto: action === 'resolve' ? (body.photo ?? null) : undefined,
      rating: action === 'close' ? (body.rating ?? null) : undefined,
      reopened: action === 'reopen',
    });
    const note = action === 'assign' ? `Assigned to ${body.assignee}${body.note ? `: ${body.note}` : ''}` : (body.note ?? (action === 'close' && body.rating ? `Rated ${body.rating}/5` : null));
    await repo.addCivicEvent(id, status, role, body.actorName ?? null, note, body.photo ?? null);
    if (action === 'resolve') ctx.sim.pushEvent('civic', 'Civic issue fixed', `Report #${report.id} on ${report.linkId !== null ? net.links[report.linkId].road : net.nodes[report.nodeId!].name} marked fixed`, 'info');
    await audit(req, `civic_${action}`, 'civic_report', id, { status, assignee: body.assignee, rating: body.rating });
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

  const radii = cityConfig().evacuation.radiiKm;
  const evacSchema = z.object({
    center: nodeIdSchema,
    radiusKm: z.number().refine((v) => radii.includes(v), { message: `Radius must be one of ${radii.join(', ')} km.` }),
    kind: z.enum(['earthquake', 'flood', 'fire', 'other']).default('other'),
  });

  app.post('/api/evacuation', allow('controller'), async (req, res) => {
    const body = evacSchema.parse(req.body);
    const status = ctx.sim.activateEvacuation(body.center, body.radiusKm, body.kind);
    await audit(req, 'activate_evacuation', 'evacuation', body.center, body);
    res.status(201).json(status);
  });

  app.delete('/api/evacuation', allow('controller'), async (req, res) => {
    ctx.sim.deactivateEvacuation();
    await audit(req, 'end_evacuation', 'evacuation', null);
    res.json({ ok: true });
  });

  app.get('/api/replay', (req, res) => {
    res.json(ctx.replay.status());
  });

  const datasetSchema = z.object({ name: z.string().trim().min(1).max(120), csv: z.string().min(10).max(6_000_000) });

  app.post('/api/replay/dataset', allow('controller', 'authority'), async (req, res) => {
    const body = datasetSchema.parse(req.body);
    const wasActive = ctx.replay.running || ctx.sim.demandOverridden;
    let summary;
    try {
      summary = ctx.replay.load(body.name, body.csv);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not read the file.' });
      return;
    }
    if (wasActive) await ctx.stopReplay();
    await audit(req, 'upload_dataset', 'dataset', null, { name: body.name, rows: summary.rows });
    res.status(201).json(ctx.replay.status());
  });

  app.post('/api/replay/sample', allow('controller', 'authority'), async (req, res) => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ml/data/kaggle-traffic/TrafficTwoMonth.csv');
    if (!existsSync(file)) {
      res.status(404).json({ error: 'The Kaggle sample is not downloaded yet. Run npm run train:junction once, or upload the CSV yourself.' });
      return;
    }
    const wasActive = ctx.replay.running || ctx.sim.demandOverridden;
    ctx.replay.load('Kaggle Traffic Prediction Dataset (TrafficTwoMonth.csv)', readFileSync(file, 'utf8'));
    if (wasActive) await ctx.stopReplay();
    await audit(req, 'upload_dataset', 'dataset', null, { name: 'kaggle-sample' });
    res.status(201).json(ctx.replay.status());
  });

  app.post('/api/replay/start', allow('controller', 'authority'), async (req, res) => {
    const { speed } = z.object({ speed: z.union([z.literal(16), z.literal(32), z.literal(64), z.literal(128)]) }).parse(req.body);
    if (!ctx.replay.rows.length) {
      res.status(400).json({ error: 'Upload a dataset first.' });
      return;
    }
    await ctx.startReplay(speed);
    await audit(req, 'start_replay', 'dataset', null, { speed });
    res.json(ctx.replay.status());
  });

  app.post('/api/replay/stop', allow('controller', 'authority'), async (req, res) => {
    await ctx.stopReplay();
    await audit(req, 'stop_replay', 'dataset', null);
    res.json(ctx.replay.status());
  });

  app.get('/api/analytics', (req, res) => {
    res.json(ctx.sim.analytics());
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
      junctionModel: ctx.junctionModel,
      onProgress: (done, total) => {
        e.done = done;
        e.total = total;
      },
    })
      .then((result) => {
        e.result = result;
        saveJson('evaluation.json', result);
        ctx.sim.pushEvent('system', 'Evaluation finished', 'Adaptive vs fixed-time comparison updated', 'info');
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
