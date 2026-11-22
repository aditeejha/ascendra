export type VehicleClass = 'private' | 'two_wheeler' | 'cargo' | 'bus' | 'emergency';
export type LinkKind = 'highway' | 'arterial' | 'street' | 'lane';
export type Phase = 'NS' | 'EW';
export type SignalState = 'green' | 'yellow' | 'allred';
export type SignalMode = 'adaptive' | 'fixed';
export type Weather = 'clear' | 'rain' | 'heavy_rain' | 'fog';
export type Role = 'controller' | 'authority' | 'citizen' | 'driver' | 'emergency';
export type CongestionLevel = 'free' | 'moderate' | 'heavy' | 'congested';
export type Dir = 'N' | 'S' | 'E' | 'W';
export type JunctionSituation = 'low' | 'normal' | 'high' | 'heavy';
export type DisasterKind = 'earthquake' | 'flood' | 'fire' | 'other';
export type PoiKind = 'hospital' | 'fire' | 'police' | 'station' | 'bus' | 'market' | 'college' | 'attraction';

export const VEHICLE_CLASSES: VehicleClass[] = ['private', 'two_wheeler', 'cargo', 'bus', 'emergency'];

export interface Poi {
  kind: PoiKind;
  name: string;
}

export interface NetNode {
  id: number;
  key: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
  name: string;
  signal: 'osm' | 'inferred' | null;
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
  oneway: boolean;
  bridge: boolean;
  geometry: number[];
}

export interface NetworkMeta {
  city: string;
  region: string;
  country: string;
  displayName: string;
  source: string;
  via: string;
  fetchedAt: string;
  centre: { lat: number; lon: number; x: number; y: number };
  zoom: number;
  tileOrigin: { x: number; y: number };
  metersPerPixel: number;
  restrictedZoneKm: number;
  segmentCount: number;
  signalCount: number;
  evacuationRadiiKm: number[];
  rules: { weeklyOff: string[]; freightBanHours: [number, number][]; timezone: string };
  bbox: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
}

export interface NetworkInfo {
  nodes: NetNode[];
  links: NetLink[];
  width: number;
  height: number;
  exits: number[];
  meta: NetworkMeta;
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
export const LINK_FLAG = { incident: 1, closed: 2, contraflow: 4, greenWave: 8, measured: 16, liveIncident: 32 } as const;

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
  radiusKm: number;
  kind: DisasterKind;
  bridgesClosed: number[];
  slowedLinks: number;
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
  liveClock: boolean;
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

export interface JunctionOutlook {
  nodeId: number;
  name: string;
  approachLinkId: number;
  approachRoad: string;
  clock: string;
  counts: { car: number; bike: number; heavy: number; total: number };
  situationNow: JunctionSituation;
  situation15: JunctionSituation;
  situation30: JunctionSituation;
  probs15: number[];
  probs30: number[];
  count15: number;
  count30: number;
}

export interface JunctionModelInfo {
  available: boolean;
  name: string;
  dataset: { name: string; url: string; rows: number; days: number; intervalMin: number } | null;
  trainedAt: string | null;
  metrics: Record<string, number | null> | null;
}

export interface ForecastResponse {
  t: number;
  clock: string;
  model: ModelInfo;
  links: LinkForecast[];
  hotspots: Hotspot[];
  interventions: Intervention[];
  junctionModel: JunctionModelInfo;
  junctions: JunctionOutlook[];
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
  email: string | null;
  address: string | null;
  licenceNo: string | null;
  hasPhoto: boolean;
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

export type CivicStatus = 'reported' | 'verified' | 'assigned' | 'in_progress' | 'resolved' | 'closed' | 'reopened' | 'rejected';
export type CivicAction = 'verify' | 'reject' | 'assign' | 'start' | 'resolve' | 'close' | 'reopen';
export type Severity = 'low' | 'medium' | 'high';

export interface CivicReport {
  id: number;
  category: CivicCategory;
  description: string;
  linkId: number | null;
  nodeId: number | null;
  severity: Severity;
  reporterName: string;
  reporterPhone: string | null;
  status: CivicStatus;
  impactApplied: boolean;
  hasPhoto: boolean;
  assignedTo: string | null;
  dueAt: string | null;
  late: boolean;
  resolutionNote: string | null;
  hasResolutionPhoto: boolean;
  rating: number | null;
  reopenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CivicEvent {
  id: number;
  reportId: number;
  status: CivicStatus;
  actorRole: Role;
  actorName: string | null;
  note: string | null;
  hasPhoto: boolean;
  createdAt: string;
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
  liveClock: boolean;
  liveWeather: boolean;
  speed: number;
  paused: boolean;
  weather: Weather;
  demand: number;
  randomIncidents: boolean;
  emergencyPriority: boolean;
  adaptive: boolean;
  forecastRouting: boolean;
}

export interface ReplaySummary {
  name: string;
  rows: number;
  days: number;
  meanTotal: number;
  maxTotal: number;
  shares: { car: number; bike: number; bus: number; truck: number };
  hasLabels: boolean;
  warnings: string[];
  uploadedAt: string;
}

export interface ReplayPoint {
  index: number;
  clock: string;
  day: string;
  actual: number;
  car: number;
  bike: number;
  heavy: number;
  situation: JunctionSituation | null;
  modelSituation: JunctionSituation | null;
  pred15: number | null;
  pred30: number | null;
  predSituation15: JunctionSituation | null;
}

export interface ReplayStatus {
  dataset: ReplaySummary | null;
  running: boolean;
  index: number;
  speed: number;
  current: ReplayPoint | null;
  next: { count15: number; count30: number; situation15: JunctionSituation; situation30: JunctionSituation } | null;
  history: ReplayPoint[];
  accuracy: { n: number; mae15: number | null; maePersistence15: number | null; situationAcc15: number | null };
}

export interface DatasetPredictionRow {
  row: number;
  dayNumber: number;
  weekday: string;
  clock: string;
  car: number;
  bike: number;
  heavy: number;
  total: number;
  label: JunctionSituation | null;
  situationNow: JunctionSituation;
  count15: number;
  actual15: number | null;
  situation15: JunctionSituation;
  label15: JunctionSituation | null;
  count30: number;
  actual30: number | null;
  situation30: JunctionSituation;
  label30: JunctionSituation | null;
}

export interface CountScore {
  n: number;
  mae: number;
  maePersistence: number;
}

export interface SituationScore {
  n: number;
  accuracy: number;
  accuracyPersistence: number | null;
}

export interface DatasetPredictions {
  dataset: string;
  rows: number;
  count15: CountScore | null;
  count30: CountScore | null;
  situationNow: SituationScore | null;
  situation15: SituationScore | null;
  situation30: SituationScore | null;
  chart: { row: number; label: string; actual: number; predicted: number | null }[];
  page: { offset: number; limit: number; rows: DatasetPredictionRow[] };
}

export interface WeatherReading {
  temperatureC: number;
  precipitationMm: number;
  visibilityM: number | null;
  weatherCode: number;
  windKmh: number;
  condition: Weather;
  description: string;
  observedAt: string;
  fetchedAt: string;
}

export interface TrafficSample {
  linkId: number;
  road: string;
  currentKmh: number;
  freeFlowKmh: number;
  ratio: number;
  measuredScore: number;
  simScore: number;
  confidence: number;
  closed: boolean;
  at: string;
}

export interface LiveIncident {
  id: string;
  category: string;
  description: string;
  delaySec: number | null;
  linkIds: number[];
  from: string | null;
  to: string | null;
}

export interface LiveStatus {
  city: { name: string; region: string; country: string; timezone: string; localTime: string; localDay: string };
  clock: { mode: 'live' | 'fast' | 'replay'; simClock: string; simDay: string };
  network: { source: string; via: string; fetchedAt: string; nodes: number; links: number; signalsOsm: number; signalsInferred: number };
  weather: { source: string; mode: 'live' | 'manual'; reading: WeatherReading | null; error: string | null };
  traffic: {
    provider: string;
    configured: boolean;
    status: 'ok' | 'no_key' | 'error' | 'budget' | 'starting';
    error: string | null;
    requestsToday: number;
    dailyBudget: number;
    lastFlowAt: string | null;
    lastIncidentsAt: string | null;
    samples: TrafficSample[];
    incidents: LiveIncident[];
    calibration: number;
    accuracy: { mae: number | null; baselineMae: number | null; n: number };
  };
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
  bus: 'Bus / public transport',
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
