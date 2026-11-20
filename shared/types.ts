export type VehicleClass = 'private' | 'two_wheeler' | 'cargo' | 'emergency';
export type LinkKind = 'ring' | 'arterial' | 'street' | 'lane';
export type Phase = 'NS' | 'EW';
export type SignalState = 'green' | 'yellow' | 'allred';
export type SignalMode = 'adaptive' | 'fixed';
export type Weather = 'clear' | 'rain' | 'heavy_rain' | 'fog';
export type Role = 'controller' | 'authority' | 'citizen' | 'driver' | 'emergency';
export type CongestionLevel = 'free' | 'moderate' | 'heavy' | 'congested';
export type Dir = 'N' | 'S' | 'E' | 'W';
export type PoiKind = 'hospital' | 'fire' | 'police' | 'depot' | 'station' | 'market';

export const VEHICLE_CLASSES: VehicleClass[] = ['private', 'two_wheeler', 'cargo', 'emergency'];

export interface Poi {
  kind: PoiKind;
  name: string;
}

export interface NetNode {
  id: number;
  key: string;
  r: number;
  c: number;
  x: number;
  y: number;
  name: string;
  poi?: Poi;
  exit?: string;
}

export interface NetLink {
  id: number;
  from: number;
  to: number;
  dir: Dir;
  phase: Phase;
  road: string;
  kind: LinkKind;
  lanes: number;
  length: number;
  speedLimit: number;
  maxWeight: number | null;
  core: boolean;
  camera: boolean;
  reverse: number;
}

export interface NetworkInfo {
  nodes: NetNode[];
  links: NetLink[];
  width: number;
  height: number;
  exits: number[];
}

export interface Kpis {
  activeVehicles: number;
  tripsCompleted: number;
  congestedSegments: number;
  avgTravelMin: number;
  avgDelayMin: number;
  avgSpeedKmh: number;
  emergencyEnRoute: number;
  throughputPerHour: number;
  openIncidents: number;
}

export type VehicleTuple = [id: number, linkId: number, pos: number, cls: number, flags: number];
export type SignalTuple = [nodeId: number, phase: number, state: number, flags: number];

export const VEHICLE_FLAG = { queued: 1, priority: 2, evacuating: 4 } as const;
export const SIGNAL_FLAG = { adaptive: 1, preempted: 2, fault: 4, evacuation: 8 } as const;
export const LINK_FLAG = { incident: 1, closed: 2, contraflow: 4, greenWave: 8 } as const;

export interface ActiveEmergency {
  vehicleId: number;
  plate: string;
  label: string;
  route: number[];
  step: number;
  etaS: number;
  preempted: number;
  dispatchId: number | null;
  destName: string;
}

export interface EvacuationStatus {
  center: number;
  radius: number;
  zoneNodes: number[];
  closedLinks: number[];
  contraflowLinks: number[];
  exits: number[];
  startedAt: number;
  startedClock: string;
  inZone: number;
  evacuated: number;
  clearanceEtaMin: number | null;
}

export interface Snapshot {
  t: number;
  clock: string;
  day: string;
  weather: Weather;
  speed: number;
  paused: boolean;
  adaptive: boolean;
  kpis: Kpis;
  linkScore: number[];
  linkQueue: number[];
  linkFlags: number[];
  vehicles: VehicleTuple[];
  signals: SignalTuple[];
  emergencies: ActiveEmergency[];
  evacuation: EvacuationStatus | null;
  counters?: Counters;
}

export interface Counters {
  openCivic: number;
  openAlerts: number;
  pendingVerification: number;
}

export interface SignalPlan {
  greenNS: number;
  greenEW: number;
}

export interface SignalDetail {
  nodeId: number;
  name: string;
  mode: SignalMode;
  phase: Phase;
  state: SignalState;
  timer: number;
  greenElapsed: number;
  plan: SignalPlan;
  queueNS: number;
  queueEW: number;
  preempted: boolean;
  fault: boolean;
  evacuation: boolean;
  policy: 'rl' | 'max-pressure' | 'fixed' | 'preemption' | 'evacuation';
  lastAction: string;
  switches: number;
}

export interface LinkForecast {
  linkId: number;
  now: number;
  h15: number;
  h30: number;
  conf15: number;
  conf30: number;
}

export interface Hotspot {
  linkId: number;
  road: string;
  fromName: string;
  toName: string;
  now: number;
  h15: number;
  h30: number;
  conf: number;
  level: CongestionLevel;
}

export interface Intervention {
  id: number;
  t: number;
  clock: string;
  kind: 'signal_bias' | 'reroute';
  linkId: number;
  nodeId: number;
  text: string;
}

export interface ModelInfo {
  available: boolean;
  name: string;
  trainedAt: string | null;
  trees: number;
  metrics: Record<string, number> | null;
}

export interface ForecastResponse {
  t: number;
  clock: string;
  model: ModelInfo;
  links: LinkForecast[];
  hotspots: Hotspot[];
  interventions: Intervention[];
}

export interface RoutePlan {
  vehicleClass: VehicleClass;
  feasible: boolean;
  links: number[];
  nodes: number[];
  distanceKm: number;
  etaMin: number;
  freeFlowMin: number;
  signals: number;
  notes: string[];
}

export interface RouteComparison {
  from: number;
  to: number;
  plans: RoutePlan[];
}

export type RegistrationStatus = 'active' | 'pending_verification' | 'verified' | 'rejected';

export interface RegisteredVehicle {
  id: number;
  plate: string;
  vehicleClass: VehicleClass;
  ownerName: string;
  phone: string | null;
  weightT: number | null;
  agency: string | null;
  status: RegistrationStatus;
  createdAt: string;
}

export type CivicCategory =
  | 'pothole'
  | 'waterlogging'
  | 'accident'
  | 'broken_signal'
  | 'road_blockage'
  | 'illegal_parking'
  | 'streetlight';

export type CivicStatus = 'reported' | 'verified' | 'in_progress' | 'resolved' | 'rejected';
export type Severity = 'low' | 'medium' | 'high';

export interface CivicReport {
  id: number;
  category: CivicCategory;
  description: string;
  linkId: number | null;
  nodeId: number | null;
  severity: Severity;
  reporterName: string;
  status: CivicStatus;
  impactApplied: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AlertStatus = 'open' | 'fined' | 'dismissed';

export interface OverspeedAlert {
  id: number;
  plate: string;
  vehicleClass: VehicleClass;
  speedKmh: number;
  limitKmh: number;
  linkId: number;
  simClock: string;
  status: AlertStatus;
  fineAmount: number | null;
  createdAt: string;
}

export interface FeedEvent {
  id: number;
  t: number;
  clock: string;
  kind: 'ambulance' | 'accident' | 'overspeed' | 'civic' | 'forecast' | 'evacuation' | 'signal' | 'system';
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}

export type DispatchStatus = 'en_route' | 'arrived' | 'cancelled';

export interface Dispatch {
  id: number;
  vehicleId: number;
  plate: string;
  label: string;
  originNode: number;
  destNode: number;
  status: DispatchStatus;
  etaInitialS: number;
  estNoPriorityS: number;
  actualS: number | null;
  preempted: number;
  startedClock: string;
  createdAt: string;
}

export interface SeriesPoint {
  t: number;
  clock: string;
  activeVehicles: number;
  avgSpeedKmh: number;
  congestedSegments: number;
  throughputPerHour: number;
  avgTravelMin: number;
  avgDelayMin: number;
}

export interface PredictionAccuracy {
  mae15: number | null;
  mae30: number | null;
  baselineMae15: number | null;
  baselineMae30: number | null;
  levelAcc15: number | null;
  levelAcc30: number | null;
  samples15: number;
  samples30: number;
}

export interface AnalyticsLive {
  series: SeriesPoint[];
  prediction: PredictionAccuracy;
  classMix: Record<VehicleClass, number>;
  tripsByClass: Record<VehicleClass, { trips: number; avgTravelMin: number }>;
  emergency: { dispatched: number; arrived: number; avgSavedMin: number | null };
}

export interface EvalMetrics {
  avgTravelMin: number;
  avgDelayMin: number;
  avgQueue: number;
  tripsCompleted: number;
  stopsPerTrip: number;
  emergencyEtaMin: number | null;
}

export interface EvalScenario {
  key: string;
  label: string;
  description: string;
  fixed: EvalMetrics;
  adaptive: EvalMetrics;
}

export interface EvaluationResult {
  generatedAt: string;
  durationMin: number;
  seeds: number;
  scenarios: EvalScenario[];
  emergency: { withPriorityMin: number; withoutPriorityMin: number; trips: number };
  forecaster: Record<string, number> | null;
  policy: { name: string; states: number; episodes: number } | null;
}

export interface SimSettings {
  speed: number;
  paused: boolean;
  weather: Weather;
  demand: number;
  randomIncidents: boolean;
  emergencyPriority: boolean;
  adaptive: boolean;
  forecastRouting: boolean;
}

export interface AuditEntry {
  id: number;
  actorRole: Role;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export function congestionLevel(score: number): CongestionLevel {
  if (score >= 0.8) return 'congested';
  if (score >= 0.6) return 'heavy';
  if (score >= 0.35) return 'moderate';
  return 'free';
}

export const CLASS_LABEL: Record<VehicleClass, string> = {
  private: 'Private car',
  two_wheeler: 'Two-wheeler',
  cargo: 'Cargo / freight',
  emergency: 'Emergency',
};

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: 'Clear',
  rain: 'Rain',
  heavy_rain: 'Heavy rain',
  fog: 'Fog',
};

export const CIVIC_LABEL: Record<CivicCategory, string> = {
  pothole: 'Pothole',
  waterlogging: 'Waterlogging',
  accident: 'Accident',
  broken_signal: 'Broken signal',
  road_blockage: 'Road blockage',
  illegal_parking: 'Illegal parking',
  streetlight: 'Streetlight out',
};
