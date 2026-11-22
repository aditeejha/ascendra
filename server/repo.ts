import type {
  AlertStatus,
  AuditEntry,
  CivicCategory,
  CivicEvent,
  CivicReport,
  CivicStatus,
  Dispatch,
  OverspeedAlert,
  RegisteredVehicle,
  RegistrationStatus,
  Role,
  Severity,
  VehicleClass,
} from '../shared/types';
import type { Db } from './db';

type Row = Record<string, unknown>;

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toVehicle(r: Row): RegisteredVehicle {
  return {
    id: Number(r.id),
    plate: String(r.plate),
    vehicleClass: r.vehicle_class as VehicleClass,
    ownerName: String(r.owner_name),
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    address: (r.address as string) ?? null,
    licenceNo: (r.licence_no as string) ?? null,
    hasPhoto: Boolean(r.has_photo ?? r.owner_photo),
    weightT: num(r.weight_t),
    agency: (r.agency as string) ?? null,
    status: r.status as RegistrationStatus,
    createdAt: iso(r.created_at),
  };
}

function toCivic(r: Row): CivicReport {
  return {
    id: Number(r.id),
    category: r.category as CivicCategory,
    description: String(r.description),
    linkId: num(r.link_id),
    nodeId: num(r.node_id),
    severity: r.severity as Severity,
    reporterName: String(r.reporter_name),
    reporterPhone: (r.reporter_phone as string) ?? null,
    status: r.status as CivicStatus,
    impactApplied: Boolean(r.impact_applied),
    hasPhoto: Boolean(r.has_photo ?? r.photo),
    assignedTo: (r.assigned_to as string) ?? null,
    dueAt: r.due_at ? iso(r.due_at) : null,
    late: Boolean(r.due_at) && !['resolved', 'closed', 'rejected'].includes(String(r.status)) && new Date(iso(r.due_at)).getTime() < Date.now(),
    resolutionNote: (r.resolution_note as string) ?? null,
    hasResolutionPhoto: Boolean(r.has_resolution_photo ?? r.resolution_photo),
    rating: num(r.rating),
    reopenCount: Number(r.reopen_count ?? 0),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

function toAlert(r: Row): OverspeedAlert {
  return {
    id: Number(r.id),
    plate: String(r.plate),
    vehicleClass: r.vehicle_class as VehicleClass,
    speedKmh: Number(r.speed_kmh),
    limitKmh: Number(r.limit_kmh),
    linkId: Number(r.link_id),
    simClock: String(r.sim_clock),
    status: r.status as AlertStatus,
    fineAmount: num(r.fine_amount),
    createdAt: iso(r.created_at),
  };
}

function toDispatch(r: Row): Dispatch {
  return {
    id: Number(r.id),
    vehicleId: Number(r.vehicle_id),
    plate: String(r.plate),
    label: String(r.label),
    originNode: Number(r.origin_node),
    destNode: Number(r.dest_node),
    status: r.status as Dispatch['status'],
    etaInitialS: Number(r.eta_initial_s),
    estNoPriorityS: Number(r.est_no_priority_s),
    actualS: num(r.actual_s),
    preempted: Number(r.preempted),
    startedClock: String(r.started_clock),
    createdAt: iso(r.created_at),
  };
}

function toAudit(r: Row): AuditEntry {
  const details = r.details;
  return {
    id: Number(r.id),
    actorRole: r.actor_role as Role,
    action: String(r.action),
    entity: String(r.entity),
    entityId: (r.entity_id as string) ?? null,
    details: typeof details === 'string' ? JSON.parse(details) : ((details as Record<string, unknown>) ?? null),
    createdAt: iso(r.created_at),
  };
}

const VEHICLE_COLS = 'id, plate, vehicle_class, owner_name, phone, email, address, licence_no, weight_t, agency, status, created_at, (owner_photo IS NOT NULL) AS has_photo';
const CIVIC_COLS =
  'id, category, description, link_id, node_id, severity, reporter_name, reporter_phone, status, impact_applied, assigned_to, due_at, resolution_note, rating, reopen_count, created_at, updated_at, (photo IS NOT NULL) AS has_photo, (resolution_photo IS NOT NULL) AS has_resolution_photo';
const DUE_HOURS: Record<Severity, number> = { high: 24, medium: 72, low: 168 };

function toEvent(r: Row): CivicEvent {
  return {
    id: Number(r.id),
    reportId: Number(r.report_id),
    status: r.status as CivicStatus,
    actorRole: r.actor_role as Role,
    actorName: (r.actor_name as string) ?? null,
    note: (r.note as string) ?? null,
    hasPhoto: Boolean(r.has_photo),
    createdAt: iso(r.created_at),
  };
}

export interface CivicUpdate {
  status: CivicStatus;
  impactApplied: boolean;
  assignedTo?: string | null;
  resolutionNote?: string | null;
  resolutionPhoto?: string | null;
  rating?: number | null;
  reopened?: boolean;
}

export interface NewVehicle {
  plate: string;
  vehicleClass: VehicleClass;
  ownerName: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  licenceNo?: string | null;
  ownerPhoto?: string | null;
  weightT?: number | null;
  agency?: string | null;
}

export interface NewCivic {
  category: CivicCategory;
  description: string;
  linkId: number | null;
  nodeId: number | null;
  severity: Severity;
  reporterName: string;
  reporterPhone?: string | null;
  photo?: string | null;
}

export class Repo {
  constructor(private db: Db) {}

  get mode() {
    return this.db.mode;
  }

  async listVehicles(): Promise<RegisteredVehicle[]> {
    return (await this.db.query<Row>(`SELECT ${VEHICLE_COLS} FROM vehicles ORDER BY id DESC`)).map(toVehicle);
  }

  async getVehicle(id: number): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE id = $1`, [id]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async vehiclePhoto(id: number): Promise<string | null> {
    const rows = await this.db.query<Row>('SELECT owner_photo FROM vehicles WHERE id = $1', [id]);
    return (rows[0]?.owner_photo as string) ?? null;
  }

  async findPlate(plate: string): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>(`SELECT ${VEHICLE_COLS} FROM vehicles WHERE plate = $1`, [plate]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async createVehicle(v: NewVehicle, status?: RegistrationStatus): Promise<RegisteredVehicle> {
    const initial = status ?? (v.vehicleClass === 'emergency' ? 'pending_verification' : 'active');
    const rows = await this.db.query<Row>(
      `INSERT INTO vehicles (plate, vehicle_class, owner_name, phone, email, address, licence_no, owner_photo, weight_t, agency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${VEHICLE_COLS}`,
      [v.plate, v.vehicleClass, v.ownerName, v.phone ?? null, v.email ?? null, v.address ?? null, v.licenceNo ?? null, v.ownerPhoto ?? null, v.weightT ?? null, v.agency ?? null, initial],
    );
    return toVehicle(rows[0]);
  }

  async setVehicleStatus(id: number, status: RegistrationStatus): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>(`UPDATE vehicles SET status = $2 WHERE id = $1 RETURNING ${VEHICLE_COLS}`, [id, status]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async listCivic(): Promise<CivicReport[]> {
    return (await this.db.query<Row>(`SELECT ${CIVIC_COLS} FROM civic_reports ORDER BY id DESC`)).map(toCivic);
  }

  async getCivic(id: number): Promise<CivicReport | null> {
    const rows = await this.db.query<Row>(`SELECT ${CIVIC_COLS} FROM civic_reports WHERE id = $1`, [id]);
    return rows[0] ? toCivic(rows[0]) : null;
  }

  async createCivic(c: NewCivic, status: CivicStatus = 'reported'): Promise<CivicReport> {
    const due = new Date(Date.now() + DUE_HOURS[c.severity] * 3600_000).toISOString();
    const rows = await this.db.query<Row>(
      `INSERT INTO civic_reports (category, description, link_id, node_id, severity, reporter_name, reporter_phone, photo, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${CIVIC_COLS}`,
      [c.category, c.description, c.linkId, c.nodeId, c.severity, c.reporterName, c.reporterPhone ?? null, c.photo ?? null, due, status],
    );
    const report = toCivic(rows[0]);
    await this.addCivicEvent(report.id, 'reported', 'citizen', c.reporterName, c.description, null);
    if (status !== 'reported') await this.addCivicEvent(report.id, status, 'authority', null, null, null);
    return report;
  }

  async updateCivic(id: number, u: CivicUpdate): Promise<CivicReport | null> {
    const sets = ['status = $2', 'impact_applied = $3', 'updated_at = now()'];
    const params: unknown[] = [id, u.status, u.impactApplied];
    const add = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (u.assignedTo !== undefined) add('assigned_to', u.assignedTo);
    if (u.resolutionNote !== undefined) add('resolution_note', u.resolutionNote);
    if (u.resolutionPhoto !== undefined) add('resolution_photo', u.resolutionPhoto);
    if (u.rating !== undefined) add('rating', u.rating);
    if (u.reopened) sets.push('reopen_count = reopen_count + 1');
    const rows = await this.db.query<Row>(`UPDATE civic_reports SET ${sets.join(', ')} WHERE id = $1 RETURNING ${CIVIC_COLS}`, params);
    return rows[0] ? toCivic(rows[0]) : null;
  }

  async civicPhoto(id: number, kind: 'report' | 'resolution'): Promise<string | null> {
    const col = kind === 'report' ? 'photo' : 'resolution_photo';
    const rows = await this.db.query<Row>(`SELECT ${col} AS p FROM civic_reports WHERE id = $1`, [id]);
    return (rows[0]?.p as string) ?? null;
  }

  async addCivicEvent(reportId: number, status: CivicStatus, role: Role, name: string | null, note: string | null, photo: string | null): Promise<void> {
    await this.db.query('INSERT INTO civic_events (report_id, status, actor_role, actor_name, note, photo) VALUES ($1, $2, $3, $4, $5, $6)', [
      reportId,
      status,
      role,
      name,
      note,
      photo,
    ]);
  }

  async listCivicEvents(reportId: number): Promise<CivicEvent[]> {
    const rows = await this.db.query<Row>(
      'SELECT id, report_id, status, actor_role, actor_name, note, created_at, (photo IS NOT NULL) AS has_photo FROM civic_events WHERE report_id = $1 ORDER BY id ASC',
      [reportId],
    );
    return rows.map(toEvent);
  }

  async civicEventPhoto(eventId: number): Promise<string | null> {
    const rows = await this.db.query<Row>('SELECT photo FROM civic_events WHERE id = $1', [eventId]);
    return (rows[0]?.photo as string) ?? null;
  }

  async listAlerts(limit = 200): Promise<OverspeedAlert[]> {
    const n = Math.max(1, Math.min(1000, Math.floor(limit)));
    return (await this.db.query<Row>(`SELECT * FROM overspeed_alerts ORDER BY id DESC LIMIT ${n}`)).map(toAlert);
  }

  async createAlert(a: Omit<OverspeedAlert, 'id' | 'status' | 'fineAmount' | 'createdAt'>): Promise<OverspeedAlert> {
    const rows = await this.db.query<Row>(
      `INSERT INTO overspeed_alerts (plate, vehicle_class, speed_kmh, limit_kmh, link_id, sim_clock)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [a.plate, a.vehicleClass, a.speedKmh, a.limitKmh, a.linkId, a.simClock],
    );
    return toAlert(rows[0]);
  }

  async getAlert(id: number): Promise<OverspeedAlert | null> {
    const rows = await this.db.query<Row>('SELECT * FROM overspeed_alerts WHERE id = $1', [id]);
    return rows[0] ? toAlert(rows[0]) : null;
  }

  async updateAlert(id: number, status: AlertStatus, fineAmount: number | null): Promise<OverspeedAlert | null> {
    const rows = await this.db.query<Row>(
      'UPDATE overspeed_alerts SET status = $2, fine_amount = $3 WHERE id = $1 RETURNING *',
      [id, status, fineAmount],
    );
    return rows[0] ? toAlert(rows[0]) : null;
  }

  async listDispatches(limit = 50): Promise<Dispatch[]> {
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    return (await this.db.query<Row>(`SELECT * FROM emergency_dispatches ORDER BY id DESC LIMIT ${n}`)).map(toDispatch);
  }

  async createDispatch(d: { vehicleId: number; plate: string; label: string; originNode: number; destNode: number; startedClock: string }): Promise<Dispatch> {
    const rows = await this.db.query<Row>(
      `INSERT INTO emergency_dispatches (vehicle_id, plate, label, origin_node, dest_node, started_clock)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [d.vehicleId, d.plate, d.label, d.originNode, d.destNode, d.startedClock],
    );
    return toDispatch(rows[0]);
  }

  async updateDispatchPlan(id: number, etaInitialS: number, estNoPriorityS: number): Promise<Dispatch | null> {
    const rows = await this.db.query<Row>(
      'UPDATE emergency_dispatches SET eta_initial_s = $2, est_no_priority_s = $3 WHERE id = $1 RETURNING *',
      [id, etaInitialS, estNoPriorityS],
    );
    return rows[0] ? toDispatch(rows[0]) : null;
  }

  async finishDispatch(id: number, status: Dispatch['status'], actualS: number | null, preempted: number): Promise<void> {
    await this.db.query(
      'UPDATE emergency_dispatches SET status = $2, actual_s = $3, preempted = $4 WHERE id = $1',
      [id, status, actualS, preempted],
    );
  }

  async logSignalChange(nodeId: number, mode: string, greenNS: number, greenEW: number, role: Role): Promise<void> {
    await this.db.query(
      'INSERT INTO signal_plan_changes (node_id, mode, green_ns, green_ew, changed_by) VALUES ($1, $2, $3, $4, $5)',
      [nodeId, mode, greenNS, greenEW, role],
    );
  }

  async audit(role: Role, action: string, entity: string, entityId: string | number | null, details: Record<string, unknown> | null = null): Promise<void> {
    await this.db.query(
      'INSERT INTO audit_log (actor_role, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [role, action, entity, entityId === null ? null : String(entityId), details ? JSON.stringify(details) : null],
    );
  }

  async listAudit(limit = 100): Promise<AuditEntry[]> {
    const n = Math.max(1, Math.min(500, Math.floor(limit)));
    return (await this.db.query<Row>(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ${n}`)).map(toAudit);
  }

  async counters(): Promise<{ openCivic: number; openAlerts: number; pendingVerification: number }> {
    const [civic] = await this.db.query<Row>(
      "SELECT COUNT(*) AS n FROM civic_reports WHERE status IN ('reported', 'verified', 'assigned', 'in_progress', 'reopened')",
    );
    const [alerts] = await this.db.query<Row>("SELECT COUNT(*) AS n FROM overspeed_alerts WHERE status = 'open'");
    const [pending] = await this.db.query<Row>("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'pending_verification'");
    return { openCivic: Number(civic.n), openAlerts: Number(alerts.n), pendingVerification: Number(pending.n) };
  }

  async seed(ctx: { city: string; platePrefix: string; outOfStatePlate: string; hospitals: string[]; reportLinks: number[] }): Promise<void> {
    const [{ n }] = await this.db.query<Row>('SELECT COUNT(*) AS n FROM vehicles');
    if (Number(n) > 0) return;
    const p = ctx.platePrefix;
    const [h1, h2, h3] = [ctx.hospitals[0] ?? `${ctx.city} Hospital`, ctx.hospitals[1] ?? ctx.hospitals[0] ?? `${ctx.city} Hospital`, ctx.hospitals[2] ?? 'Private clinic'];
    const vehicles: [NewVehicle, RegistrationStatus][] = [
      [{ plate: `${p} AM 1081`, vehicleClass: 'emergency', ownerName: h1, agency: 'Ambulance - 108', phone: '108' }, 'verified'],
      [{ plate: `${p} AM 2210`, vehicleClass: 'emergency', ownerName: h2, agency: 'Ambulance - ALS', phone: '108' }, 'verified'],
      [{ plate: `${p} FR 0101`, vehicleClass: 'emergency', ownerName: `Fire Brigade, ${ctx.city}`, agency: 'Fire tender', phone: '101' }, 'verified'],
      [{ plate: `${p} PL 0100`, vehicleClass: 'emergency', ownerName: `Police Control Room, ${ctx.city}`, agency: 'Police PCR', phone: '112' }, 'verified'],
      [{ plate: `${p} AM 3302`, vehicleClass: 'emergency', ownerName: h3, agency: 'Private ambulance', phone: '9431000000' }, 'pending_verification'],
      [{ plate: `${p} CT 4521`, vehicleClass: 'cargo', ownerName: 'Santhal Logistics', weightT: 18, phone: '9835000000' }, 'active'],
      [{ plate: `${ctx.outOfStatePlate} CT 7710`, vehicleClass: 'cargo', ownerName: 'Eastern Freight Lines', weightT: 9, phone: '9830000000' }, 'active'],
      [{ plate: `${p} BK 2290`, vehicleClass: 'private', ownerName: 'R. Kumar', phone: '9934000000' }, 'active'],
      [{ plate: `${p} TW 8812`, vehicleClass: 'two_wheeler', ownerName: 'P. Singh', phone: '9709000000' }, 'active'],
    ];
    for (const [v, status] of vehicles) await this.createVehicle(v, status);
    const samples: [Omit<NewCivic, 'linkId' | 'nodeId'>, CivicStatus][] = [
      [{ category: 'pothole', description: 'Deep pothole in the left lane near the bus stop.', severity: 'medium', reporterName: 'Anita' }, 'reported'],
      [{ category: 'streetlight', description: 'Three streetlights out after the railway crossing.', severity: 'low', reporterName: 'Vikash' }, 'in_progress'],
      [{ category: 'illegal_parking', description: 'Trucks parked on both sides during school hours.', severity: 'medium', reporterName: 'Meera' }, 'resolved'],
    ];
    for (const [i, [c, status]] of samples.entries()) {
      if (ctx.reportLinks[i] === undefined) break;
      await this.createCivic({ ...c, linkId: ctx.reportLinks[i], nodeId: null }, status);
    }
  }
}
