import type {
  AlertStatus,
  AuditEntry,
  CivicCategory,
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
    status: r.status as CivicStatus,
    impactApplied: Boolean(r.impact_applied),
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

export interface NewVehicle {
  plate: string;
  vehicleClass: VehicleClass;
  ownerName: string;
  phone?: string | null;
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
}

export class Repo {
  constructor(private db: Db) {}

  get mode() {
    return this.db.mode;
  }

  async listVehicles(): Promise<RegisteredVehicle[]> {
    return (await this.db.query<Row>('SELECT * FROM vehicles ORDER BY id DESC')).map(toVehicle);
  }

  async getVehicle(id: number): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>('SELECT * FROM vehicles WHERE id = $1', [id]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async findPlate(plate: string): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>('SELECT * FROM vehicles WHERE plate = $1', [plate]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async createVehicle(v: NewVehicle, status?: RegistrationStatus): Promise<RegisteredVehicle> {
    const initial = status ?? (v.vehicleClass === 'emergency' ? 'pending_verification' : 'active');
    const rows = await this.db.query<Row>(
      `INSERT INTO vehicles (plate, vehicle_class, owner_name, phone, weight_t, agency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [v.plate, v.vehicleClass, v.ownerName, v.phone ?? null, v.weightT ?? null, v.agency ?? null, initial],
    );
    return toVehicle(rows[0]);
  }

  async setVehicleStatus(id: number, status: RegistrationStatus): Promise<RegisteredVehicle | null> {
    const rows = await this.db.query<Row>('UPDATE vehicles SET status = $2 WHERE id = $1 RETURNING *', [id, status]);
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async listCivic(): Promise<CivicReport[]> {
    return (await this.db.query<Row>('SELECT * FROM civic_reports ORDER BY id DESC')).map(toCivic);
  }

  async getCivic(id: number): Promise<CivicReport | null> {
    const rows = await this.db.query<Row>('SELECT * FROM civic_reports WHERE id = $1', [id]);
    return rows[0] ? toCivic(rows[0]) : null;
  }

  async createCivic(c: NewCivic, status: CivicStatus = 'reported'): Promise<CivicReport> {
    const rows = await this.db.query<Row>(
      `INSERT INTO civic_reports (category, description, link_id, node_id, severity, reporter_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [c.category, c.description, c.linkId, c.nodeId, c.severity, c.reporterName, status],
    );
    return toCivic(rows[0]);
  }

  async updateCivic(id: number, status: CivicStatus, impactApplied: boolean): Promise<CivicReport | null> {
    const rows = await this.db.query<Row>(
      'UPDATE civic_reports SET status = $2, impact_applied = $3, updated_at = now() WHERE id = $1 RETURNING *',
      [id, status, impactApplied],
    );
    return rows[0] ? toCivic(rows[0]) : null;
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
      "SELECT COUNT(*) AS n FROM civic_reports WHERE status IN ('reported', 'verified', 'in_progress')",
    );
    const [alerts] = await this.db.query<Row>("SELECT COUNT(*) AS n FROM overspeed_alerts WHERE status = 'open'");
    const [pending] = await this.db.query<Row>("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'pending_verification'");
    return { openCivic: Number(civic.n), openAlerts: Number(alerts.n), pendingVerification: Number(pending.n) };
  }

  async seed(): Promise<void> {
    const [{ n }] = await this.db.query<Row>('SELECT COUNT(*) AS n FROM vehicles');
    if (Number(n) > 0) return;
    const vehicles: [NewVehicle, RegistrationStatus][] = [
      [{ plate: 'JH 15 AM 1081', vehicleClass: 'emergency', ownerName: 'Sadar Hospital', agency: 'Ambulance - 108', phone: '108' }, 'verified'],
      [{ plate: 'JH 15 AM 2210', vehicleClass: 'emergency', ownerName: 'Medical College Hospital', agency: 'Ambulance - ALS', phone: '108' }, 'verified'],
      [{ plate: 'JH 15 FR 0101', vehicleClass: 'emergency', ownerName: 'City Fire Station', agency: 'Fire tender', phone: '101' }, 'verified'],
      [{ plate: 'JH 15 PL 0100', vehicleClass: 'emergency', ownerName: 'Police Control Room', agency: 'Police PCR', phone: '112' }, 'verified'],
      [{ plate: 'JH 15 AM 3302', vehicleClass: 'emergency', ownerName: 'Life Care Clinic', agency: 'Private ambulance', phone: '9431000000' }, 'pending_verification'],
      [{ plate: 'JH 15 CT 4521', vehicleClass: 'cargo', ownerName: 'Santhal Logistics', weightT: 18, phone: '9835000000' }, 'active'],
      [{ plate: 'WB 23 CT 7710', vehicleClass: 'cargo', ownerName: 'Eastern Freight Lines', weightT: 9, phone: '9830000000' }, 'active'],
      [{ plate: 'JH 15 BK 2290', vehicleClass: 'private', ownerName: 'R. Kumar', phone: '9934000000' }, 'active'],
      [{ plate: 'JH 15 TW 8812', vehicleClass: 'two_wheeler', ownerName: 'P. Singh', phone: '9709000000' }, 'active'],
    ];
    for (const [v, status] of vehicles) await this.createVehicle(v, status);
    const reports: [NewCivic, CivicStatus][] = [
      [{ category: 'pothole', description: 'Deep pothole in the left lane near the bus stop.', linkId: 30, nodeId: null, severity: 'medium', reporterName: 'Anita' }, 'reported'],
      [{ category: 'streetlight', description: 'Three streetlights out after the railway crossing.', linkId: 12, nodeId: null, severity: 'low', reporterName: 'Vikash' }, 'in_progress'],
      [{ category: 'illegal_parking', description: 'Trucks parked on both sides during school hours.', linkId: 58, nodeId: null, severity: 'medium', reporterName: 'Meera' }, 'resolved'],
    ];
    for (const [c, status] of reports) await this.createCivic(c, status);
  }
}
