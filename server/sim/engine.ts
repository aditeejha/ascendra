import {
  LINK_FLAG,
  SIGNAL_FLAG,
  VEHICLE_FLAG,
  congestionLevel,
  type ActiveEmergency,
  type AnalyticsLive,
  type EvacuationStatus,
  type FeedEvent,
  type ForecastResponse,
  type Hotspot,
  type Intervention,
  type Kpis,
  type LinkForecast,
  type NetLink,
  type Phase,
  type PredictionAccuracy,
  type RoutePlan,
  type SeriesPoint,
  type SignalDetail,
  type SignalMode,
  type SignalPlan,
  type SignalState,
  type SimSettings,
  type Snapshot,
  type VehicleClass,
  type VehicleTuple,
  type Weather,
} from '../../shared/types';
import {
  CLASS_CODE,
  CLASS_SPEED,
  DAY_NAMES,
  DAY_SECONDS,
  PCU,
  classMix,
  clockOf,
  dayIndex,
  demandProfile,
  hourOfDay,
  isCargoRestricted,
  isWeekend,
  makePlate,
} from './demand';
import { FEATURES, type Forecaster } from './forecaster';
import { hopDistances, type Network } from './network';
import { mulberry32, pick, pickWeighted, poisson, randInt, randRange, type Rng } from './random';
import { ACTION_KEEP, ACTION_SWITCH, encodeState, type QPolicy } from './rl';
import { routeNodes, shortestPath, type LinkTime, type RouteContext, type RouteOptions } from './routing';

const YELLOW = 3;
const ALL_RED = 2;
export const MIN_GREEN = 10;
export const MAX_GREEN = 70;
const DECISION_EVERY = 5;
const EMERGENCY_MIN_GREEN = 5;
const EVAC_MAX_GREEN = 90;
const SAT_FLOW = 0.42;
const JAM_SPACING = 7.5;
const SCORE_ALPHA = 0.05;
const SCORE_DENSITY = 0.3;
const HISTORY_MINUTES = 31;
const APPROACH_WINDOW = 120;
const BASE_RATE = 4.6;

const WEATHER_EFFECT: Record<Weather, { speed: number; sat: number; demand: number; code: number }> = {
  clear: { speed: 1, sat: 1, demand: 1, code: 0 },
  rain: { speed: 0.85, sat: 0.9, demand: 0.95, code: 1 },
  heavy_rain: { speed: 0.7, sat: 0.8, demand: 0.88, code: 2 },
  fog: { speed: 0.75, sat: 0.88, demand: 0.97, code: 3 },
};

const KIND_CODE = { ring: 0, arterial: 1, street: 2, lane: 3 } as const;

export const DEFAULT_SETTINGS: SimSettings = {
  speed: 4,
  paused: false,
  weather: 'clear',
  demand: 1,
  randomIncidents: true,
  emergencyPriority: true,
  adaptive: true,
  forecastRouting: true,
};

interface Vehicle {
  id: number;
  plate: string;
  cls: VehicleClass;
  link: number;
  pos: number;
  speed: number;
  queued: boolean;
  route: number[];
  step: number;
  origin: number;
  dest: number;
  spawnT: number;
  freeFlowS: number;
  waitS: number;
  stops: number;
  drv: number;
  weightT: number;
  connected: boolean;
  evacuating: boolean;
  movedAt: number;
  cameraChecked: boolean;
  label: string;
  dispatchId: number | null;
  preemptedNodes: Set<number> | null;
}

interface Incident {
  id: string;
  linkIds: number[];
  source: 'random' | 'civic';
  until: number | null;
  lanesLost: number;
  speedFactor: number;
  closes: boolean;
  label: string;
}

interface LinkState {
  def: NetLink;
  vehicles: Vehicle[];
  lanes: number;
  speedFactor: number;
  closed: boolean;
  contraflow: boolean;
  evacBias: number;
  incidents: Set<string>;
  occPcu: number;
  queue: number;
  approaching: number;
  score: number;
  discharge: number;
  entered: number;
  enteredMark: number;
  hist: number[];
  enteredHist: number[];
  cargoShare: number;
  twShare: number;
  bias: number;
  biasUntil: number;
  greenWave: number;
  fc15: number;
  fc30: number;
  conf15: number;
  conf30: number;
}

interface SignalRt {
  node: number;
  phase: Phase;
  state: SignalState;
  timer: number;
  greenElapsed: number;
  nextPhase: Phase;
  mode: SignalMode;
  plan: SignalPlan;
  preempt: { phase: Phase; until: number; vehicleId: number } | null;
  fault: boolean;
  evacuation: boolean;
  lastAction: string;
  policyUsed: SignalDetail['policy'];
  switches: number;
  rlState: number;
  rlAction: number;
  rlReward: number;
}

interface Trip {
  t: number;
  cls: VehicleClass;
  travelS: number;
  delayS: number;
}

interface Evacuation {
  center: number;
  radius: number;
  zone: Set<number>;
  hop: number[];
  nearestExit: number[];
  closedLinks: number[];
  contraflowLinks: number[];
  exits: number[];
  startedAt: number;
  evacuated: number;
  exitRate: number;
  exitedThisMinute: number;
}

export interface EmergencyArrival {
  dispatchId: number;
  vehicleId: number;
  actualS: number;
  preempted: number;
}

export interface OverspeedEvent {
  plate: string;
  vehicleClass: VehicleClass;
  speedKmh: number;
  limitKmh: number;
  linkId: number;
  clock: string;
}

export interface LearningConfig {
  epsilon: number;
  alpha: number;
  gamma: number;
}

export interface EngineOptions {
  seed?: number;
  startT?: number;
  settings?: Partial<SimSettings>;
  policy?: QPolicy | null;
  learning?: LearningConfig | null;
  forecaster?: Forecaster | null;
  randomEmergencies?: boolean;
  overspeed?: boolean;
  baseRate?: number;
  keepSeries?: boolean;
}

export interface EvalStats {
  trips: number;
  travelSum: number;
  delaySum: number;
  stopsSum: number;
  queueSum: number;
  ticks: number;
  emergencyTrips: number;
  emergencyTravelSum: number;
}

type Listener<T> = (value: T) => void;

function flip(phase: Phase): Phase {
  return phase === 'NS' ? 'EW' : 'NS';
}

function jamCapacity(link: LinkState): number {
  return (Math.max(1, link.lanes) * link.def.length) / JAM_SPACING;
}

const DIR_LABEL = { N: 'northbound', S: 'southbound', E: 'eastbound', W: 'westbound' } as const;

export class Simulation {
  readonly net: Network;
  readonly settings: SimSettings;
  t: number;
  private startT: number;
  private rng: Rng;
  private links: LinkState[];
  private signals: SignalRt[];
  private vehicles = new Map<number, Vehicle>();
  private emergencyIds = new Set<number>();
  private nextVehicleId = 1;
  private incidents = new Map<string, Incident>();
  private nextIncidentId = 1;
  private trips: Trip[] = [];
  private arrivalLog: { minute: number; count: number }[] = [];
  private tripsCompleted = 0;
  private series: SeriesPoint[] = [];
  private feed: FeedEvent[] = [];
  private nextEventId = 1;
  private evac: Evacuation | null = null;
  private originWeights: Record<VehicleClass, number[]>;
  private homeWeights: number[] = [];
  private workWeights: number[] = [];
  private policy: QPolicy | null;
  private learning: LearningConfig | null;
  private forecaster: Forecaster | null;
  private randomEmergencies: boolean;
  private overspeed: boolean;
  private baseRate: number;
  private keepSeries: boolean;
  private forecastT = -1;
  private hotspots: Hotspot[] = [];
  private interventions: Intervention[] = [];
  private nextInterventionId = 1;
  private predLog = new Map<number, { p15: Float32Array; p30: Float32Array; base: Float32Array }>();
  private accuracy: { h: 15 | 30; err: number; base: number; hit: number; n: number }[] = [];
  private dispatchStats = { dispatched: 0, arrived: 0, savedSum: 0, savedN: 0 };
  private dispatchEstimates = new Map<number, number>();
  private costCache: Float64Array;
  private costWait: Float64Array;
  stats: EvalStats = this.emptyStats();
  private feedListeners: Listener<FeedEvent>[] = [];
  private overspeedListeners: Listener<OverspeedEvent>[] = [];
  private arrivalListeners: Listener<EmergencyArrival>[] = [];

  constructor(net: Network, options: EngineOptions = {}) {
    this.net = net;
    this.settings = { ...DEFAULT_SETTINGS, ...options.settings };
    this.t = options.startT ?? 8 * 3600;
    this.startT = this.t;
    this.rng = mulberry32(options.seed ?? 20260401);
    this.policy = options.policy ?? null;
    this.learning = options.learning ?? null;
    this.forecaster = options.forecaster ?? null;
    this.randomEmergencies = options.randomEmergencies ?? true;
    this.overspeed = options.overspeed ?? true;
    this.baseRate = options.baseRate ?? BASE_RATE;
    this.keepSeries = options.keepSeries ?? true;
    this.links = net.links.map((def) => ({
      def,
      vehicles: [],
      lanes: def.lanes,
      speedFactor: 1,
      closed: false,
      contraflow: false,
      evacBias: 1,
      incidents: new Set(),
      occPcu: 0,
      queue: 0,
      approaching: 0,
      score: 0,
      discharge: 0,
      entered: 0,
      enteredMark: 0,
      hist: [],
      enteredHist: [],
      cargoShare: 0,
      twShare: 0,
      bias: 1,
      biasUntil: 0,
      greenWave: 0,
      fc15: 0,
      fc30: 0,
      conf15: 0,
      conf30: 0,
    }));
    this.signals = net.nodes.map((node) => {
      const plan = this.defaultPlan(node.id);
      return {
        node: node.id,
        phase: node.id % 2 === 0 ? 'NS' : 'EW',
        state: 'green',
        timer: 0,
        greenElapsed: Math.floor(this.rng() * 20),
        nextPhase: 'EW',
        mode: 'adaptive',
        plan,
        preempt: null,
        fault: false,
        evacuation: false,
        lastAction: 'Start',
        policyUsed: 'fixed',
        switches: 0,
        rlState: -1,
        rlAction: ACTION_KEEP,
        rlReward: 0,
      };
    });
    this.originWeights = this.buildOriginWeights();
    this.costCache = new Float64Array(net.links.length);
    this.costWait = new Float64Array(net.links.length);
    this.refreshCosts();
  }

  private emptyStats(): EvalStats {
    return {
      trips: 0,
      travelSum: 0,
      delaySum: 0,
      stopsSum: 0,
      queueSum: 0,
      ticks: 0,
      emergencyTrips: 0,
      emergencyTravelSum: 0,
    };
  }

  resetStats(): void {
    this.stats = this.emptyStats();
  }

  onFeed(fn: Listener<FeedEvent>): void {
    this.feedListeners.push(fn);
  }

  onOverspeed(fn: Listener<OverspeedEvent>): void {
    this.overspeedListeners.push(fn);
  }

  onEmergencyArrival(fn: Listener<EmergencyArrival>): void {
    this.arrivalListeners.push(fn);
  }

  setForecaster(forecaster: Forecaster | null): void {
    this.forecaster = forecaster;
  }

  setPolicy(policy: QPolicy | null): void {
    this.policy = policy;
  }

  get hasPolicy(): boolean {
    return this.policy !== null;
  }

  get clock(): string {
    return clockOf(this.t);
  }

  private defaultPlan(node: number): SignalPlan {
    const weight = (phase: Phase) => {
      let w = 0;
      for (const l of this.net.inLinks[node]) {
        const def = this.net.links[l];
        if (def.phase !== phase) continue;
        w = Math.max(w, def.kind === 'arterial' ? 3 : def.kind === 'ring' ? 2.5 : def.kind === 'street' ? 2 : 1);
      }
      return w;
    };
    const ns = weight('NS');
    const ew = weight('EW');
    const cycleGreen = 60;
    const greenNS = Math.round((cycleGreen * ns) / (ns + ew));
    return { greenNS: Math.max(15, greenNS), greenEW: Math.max(15, cycleGreen - greenNS) };
  }

  private buildOriginWeights(): Record<VehicleClass, number[]> {
    const general = this.net.nodes.map((n) => {
      const core = n.r >= 1 && n.r <= 3 && n.c >= 2 && n.c <= 4;
      const ring = n.r === 0 || n.c === 0 || n.r === 4 || n.c === 6;
      if (n.poi) return n.poi.kind === 'depot' ? 1.2 : 2.6;
      if (core) return 3;
      if (ring) return 1.5;
      return 1.2;
    });
    const cargo = this.net.nodes.map((n) => {
      if (n.poi?.kind === 'depot') return 9;
      if (n.poi?.kind === 'market') return 2.5;
      if (n.exit) return 3;
      const ring = n.r === 0 || n.c === 0 || n.r === 4 || n.c === 6;
      return ring ? 1.2 : 0.5;
    });
    this.homeWeights = this.net.nodes.map((n) => {
      const core = n.r >= 1 && n.r <= 3 && n.c >= 2 && n.c <= 4;
      if (core) return 0.4;
      return n.r === 0 || n.c === 0 || n.r === 4 || n.c === 6 ? 2.2 : 1.6;
    });
    this.workWeights = this.net.nodes.map((n) => {
      const core = n.r >= 1 && n.r <= 3 && n.c >= 2 && n.c <= 4;
      if (n.poi && n.poi.kind !== 'depot') return 5;
      return core ? 6 : 0.5;
    });
    return { private: general, two_wheeler: general, cargo, emergency: general };
  }

  private weather() {
    return WEATHER_EFFECT[this.settings.weather];
  }

  private freeSpeed(link: LinkState): number {
    return (link.def.speedLimit / 3.6) * this.weather().speed * link.speedFactor;
  }

  private routeContext(): RouteContext {
    return {
      net: this.net,
      linkTime: (lid, offset) => this.linkTime(lid, offset),
      closed: (lid) => this.links[lid].closed,
      cargoRestricted: isCargoRestricted(this.t),
    };
  }

  private linkTime(lid: number, offsetS: number): LinkTime {
    const L = this.links[lid];
    if (this.settings.forecastRouting && this.forecastT >= 0 && offsetS > 300) {
      const fc = offsetS > 1200 ? L.fc30 : L.fc15;
      if (fc > L.score) {
        const speed = this.freeSpeed(L) * Math.max(0.2, 1 - 0.75 * fc);
        const wait = this.costWait[lid] * (1 + fc);
        return { run: L.def.length / speed, wait };
      }
    }
    return { run: this.costCache[lid], wait: this.costWait[lid] };
  }

  private refreshCosts(): void {
    for (let i = 0; i < this.links.length; i++) {
      const L = this.links[i];
      const speed = this.freeSpeed(L) * Math.max(0.2, 1 - 0.75 * L.score);
      this.costCache[i] = L.def.length / speed;
      this.costWait[i] = 10 + (L.queue * 2.2) / Math.max(1, L.lanes) + (L.incidents.size ? 25 : 0);
    }
  }

  private findRoute(from: number, to: number, opts: RouteOptions): number[] | null {
    const res = shortestPath(this.routeContext(), from, to, opts);
    return res ? res.links : null;
  }

  private freeFlowTime(route: number[], cls: VehicleClass): number {
    let s = 0;
    for (const l of route) {
      const def = this.net.links[l];
      s += def.length / ((def.speedLimit / 3.6) * CLASS_SPEED[cls]);
    }
    return s;
  }

  private canEnter(L: LinkState, pcu: number): boolean {
    if (L.occPcu + pcu > jamCapacity(L)) return false;
    const last = L.vehicles[L.vehicles.length - 1];
    if (last && last.pos < (JAM_SPACING * PCU[last.cls]) / Math.max(1, L.lanes)) return false;
    return true;
  }

  private placeOnLink(v: Vehicle, lid: number, pos: number): void {
    const L = this.links[lid];
    const last = L.vehicles[L.vehicles.length - 1];
    let p = Math.max(0, pos);
    if (last && v.cls !== 'emergency') p = Math.min(p, last.pos - (JAM_SPACING * PCU[last.cls]) / Math.max(1, L.lanes));
    v.link = lid;
    v.pos = Math.max(0, p);
    v.cameraChecked = false;
    L.vehicles.push(v);
    if (v.cls === 'emergency') L.vehicles.sort((a, b) => b.pos - a.pos);
    L.occPcu += PCU[v.cls];
    L.entered++;
  }

  private spawn(
    cls: VehicleClass,
    origin: number,
    dest: number,
    extra: Partial<Pick<Vehicle, 'label' | 'dispatchId' | 'evacuating' | 'plate' | 'weightT'>> = {},
  ): Vehicle | null {
    const weightT = extra.weightT ?? (cls === 'cargo' ? Math.round(randRange(this.rng, 6, 26)) : 1.5);
    const priority = cls === 'emergency';
    const route = this.findRoute(origin, dest, { cls, weightT, priority: priority && this.settings.emergencyPriority });
    if (!route || !route.length) return null;
    const first = this.links[route[0]];
    if (!priority && (first.closed || !this.canEnter(first, PCU[cls]))) return null;
    const aggressive = (cls === 'private' || cls === 'two_wheeler') && this.rng() < 0.045;
    const v: Vehicle = {
      id: this.nextVehicleId++,
      plate: extra.plate ?? makePlate(this.rng, cls),
      cls,
      link: route[0],
      pos: 0,
      speed: 0,
      queued: false,
      route,
      step: 0,
      origin,
      dest,
      spawnT: this.t,
      freeFlowS: this.freeFlowTime(route, cls),
      waitS: 0,
      stops: 0,
      drv: aggressive ? randRange(this.rng, 1.2, 1.45) : randRange(this.rng, 0.86, 1.02),
      weightT,
      connected: this.rng() < 0.3,
      evacuating: extra.evacuating ?? false,
      movedAt: this.t,
      cameraChecked: false,
      label: extra.label ?? '',
      dispatchId: extra.dispatchId ?? null,
      preemptedNodes: priority ? new Set() : null,
    };
    this.placeOnLink(v, route[0], 0);
    this.vehicles.set(v.id, v);
    if (priority) this.emergencyIds.add(v.id);
    return v;
  }

  private commuteWeights(): [number[], number[]] | null {
    if (isWeekend(this.t) || this.rng() > 0.7) return null;
    const h = hourOfDay(this.t);
    if (h >= 6.5 && h < 11) return [this.homeWeights, this.workWeights];
    if (h >= 16 && h < 20.5) return [this.workWeights, this.homeWeights];
    return null;
  }

  private sampleOd(cls: VehicleClass): [number, number] | null {
    const nodes = this.net.nodes.map((n) => n.id);
    const weights = this.originWeights[cls];
    const commute = cls === 'cargo' ? null : this.commuteWeights();
    for (let attempt = 0; attempt < 6; attempt++) {
      let origin = pickWeighted(this.rng, nodes, commute ? commute[0] : weights);
      let dest = pickWeighted(this.rng, nodes, commute ? commute[1] : weights);
      const a = this.net.nodes[origin];
      const b = this.net.nodes[dest];
      if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) < 2) continue;
      if (this.evac) {
        if (this.evac.zone.has(origin)) dest = this.evac.nearestExit[origin];
        else if (this.evac.zone.has(dest)) continue;
        if (origin === dest) continue;
      }
      return [origin, dest];
    }
    return null;
  }

  private spawnDemand(): void {
    const rate = this.baseRate * demandProfile(this.t) * this.settings.demand * this.weather().demand;
    const n = poisson(this.rng, rate);
    const mix = classMix(this.t);
    for (let i = 0; i < n; i++) {
      const cls = pickWeighted(this.rng, mix.cls, mix.weights);
      const od = this.sampleOd(cls);
      if (!od) continue;
      const evacuating = this.evac?.zone.has(od[0]) ?? false;
      this.spawn(cls, od[0], od[1], { evacuating });
    }
    if (this.evac && this.t - this.evac.startedAt < 1200) {
      const extra = poisson(this.rng, 0.25);
      const zoneNodes = [...this.evac.zone];
      for (let i = 0; i < extra; i++) {
        const origin = pick(this.rng, zoneNodes);
        const dest = this.evac.nearestExit[origin];
        if (origin !== dest) this.spawn(this.rng() < 0.6 ? 'private' : 'two_wheeler', origin, dest, { evacuating: true });
      }
    }
    if (this.randomEmergencies && this.rng() < (4 / 3600) * (0.4 + demandProfile(this.t))) this.spawnRandomEmergency();
  }

  private spawnRandomEmergency(): void {
    const stations = this.net.nodes.filter((n) => n.poi && ['hospital', 'fire', 'police'].includes(n.poi.kind));
    const station = pick(this.rng, stations);
    const hop = hopDistances(this.net, station.id);
    const targets = this.net.nodes.filter((n) => hop[n.id] >= 3);
    const target = pick(this.rng, targets);
    const kind = station.poi!.kind;
    const label = kind === 'hospital' ? 'Ambulance' : kind === 'fire' ? 'Fire tender' : 'Police patrol';
    const v = this.spawn('emergency', station.id, target.id, { label, plate: makePlate(this.rng, 'emergency') });
    if (v) {
      this.emit('ambulance', `${label} dispatched`, `${v.plate} from ${station.poi!.name} to ${target.name}`, 'info');
    }
  }

  private requestPreemption(): void {
    for (const sig of this.signals) {
      if (sig.preempt && sig.preempt.until < this.t) sig.preempt = null;
    }
    for (const L of this.links) L.greenWave = 0;
    for (const id of this.emergencyIds) {
      const v = this.vehicles.get(id);
      if (!v) continue;
      const speed = Math.max(6, this.freeSpeed(this.links[v.link]) * CLASS_SPEED.emergency);
      let eta = (this.links[v.link].def.length - v.pos) / speed;
      for (let k = v.step; k < v.route.length; k++) {
        const lid = v.route[k];
        this.links[lid].greenWave = 1;
        if (k > v.step) eta += this.links[lid].def.length / speed;
        if (k === v.route.length - 1) break;
        if (!this.settings.emergencyPriority || eta > 35) continue;
        const def = this.net.links[lid];
        const sig = this.signals[def.to];
        if (!sig.preempt || sig.preempt.vehicleId === v.id) {
          sig.preempt = { phase: def.phase, until: this.t + Math.ceil(eta) + 6, vehicleId: v.id };
          if (!v.preemptedNodes!.has(def.to)) v.preemptedNodes!.add(def.to);
        }
      }
    }
  }

  private startSwitch(sig: SignalRt, reason: string): void {
    sig.state = 'yellow';
    sig.timer = 0;
    sig.nextPhase = flip(sig.phase);
    sig.lastAction = reason;
  }

  private observe(sig: SignalRt) {
    let queueGreen = 0;
    let queueRed = 0;
    let arrivingGreen = 0;
    for (const lid of this.net.inLinks[sig.node]) {
      const L = this.links[lid];
      const w = L.bias * L.evacBias;
      if (L.def.phase === sig.phase) {
        queueGreen += L.queue * w;
        arrivingGreen += L.approaching;
      } else {
        queueRed += L.queue * w;
      }
    }
    let occ = 0;
    let n = 0;
    for (const lid of this.net.outLinks[sig.node]) {
      const L = this.links[lid];
      if (L.def.phase !== sig.phase) continue;
      occ += L.occPcu / jamCapacity(L);
      n++;
    }
    return { queueGreen, queueRed, arrivingGreen, greenElapsed: sig.greenElapsed, downstreamOcc: n ? occ / n : 0 };
  }

  private maxPressureSwitch(obs: ReturnType<Simulation['observe']>): boolean {
    return obs.queueRed > (obs.queueGreen + obs.arrivingGreen) * 1.3 + 2;
  }

  private stepSignal(sig: SignalRt): void {
    sig.timer++;
    if (sig.state === 'yellow') {
      if (sig.timer >= YELLOW) {
        sig.state = 'allred';
        sig.timer = 0;
      }
      return;
    }
    if (sig.state === 'allred') {
      if (sig.timer >= ALL_RED) {
        sig.phase = sig.nextPhase;
        sig.state = 'green';
        sig.timer = 0;
        sig.greenElapsed = 0;
        sig.switches++;
      }
      return;
    }
    sig.greenElapsed++;
    if (sig.preempt) {
      sig.policyUsed = 'preemption';
      if (sig.preempt.phase !== sig.phase && sig.greenElapsed >= EMERGENCY_MIN_GREEN) {
        this.startSwitch(sig, 'Emergency green wave');
      }
      return;
    }
    if (sig.evacuation) {
      sig.policyUsed = 'evacuation';
      if (sig.greenElapsed < MIN_GREEN) return;
      const obs = this.observe(sig);
      if (sig.greenElapsed >= EVAC_MAX_GREEN || this.maxPressureSwitch(obs)) this.startSwitch(sig, 'Evacuation flow');
      return;
    }
    if (sig.fault || sig.mode === 'fixed' || !this.settings.adaptive) {
      sig.policyUsed = 'fixed';
      sig.rlState = -1;
      const green = sig.phase === 'NS' ? sig.plan.greenNS : sig.plan.greenEW;
      if (sig.greenElapsed >= green) this.startSwitch(sig, sig.fault ? 'Fault fallback plan' : 'Fixed plan');
      return;
    }
    if (sig.greenElapsed < MIN_GREEN || (sig.greenElapsed - MIN_GREEN) % DECISION_EVERY !== 0) return;
    const obs = this.observe(sig);
    const state = encodeState(obs);
    let action: number;
    if (this.learning && this.policy) {
      if (sig.rlState >= 0) {
        this.policy.update(sig.rlState, sig.rlAction, sig.rlReward, state, this.learning.alpha, this.learning.gamma);
      }
      action =
        this.rng() < this.learning.epsilon
          ? this.rng() < 0.5
            ? ACTION_SWITCH
            : ACTION_KEEP
          : this.policy.greedy(state);
      sig.policyUsed = 'rl';
    } else if (this.policy && this.policy.known(state)) {
      action = this.policy.greedy(state);
      sig.policyUsed = 'rl';
    } else {
      action = this.maxPressureSwitch(obs) ? ACTION_SWITCH : ACTION_KEEP;
      sig.policyUsed = 'max-pressure';
    }
    if (sig.greenElapsed >= MAX_GREEN) action = ACTION_SWITCH;
    sig.rlState = state;
    sig.rlAction = action;
    sig.rlReward = 0;
    if (action === ACTION_SWITCH) {
      this.startSwitch(sig, sig.greenElapsed >= MAX_GREEN ? 'Max green reached' : sig.policyUsed === 'rl' ? 'RL agent' : 'Queue pressure');
    }
  }

  private nextRoute(v: Vehicle, node: number): number[] | null {
    if (node === v.dest) return [];
    return this.findRoute(node, v.dest, {
      cls: v.cls,
      weightT: v.weightT,
      priority: v.cls === 'emergency' && this.settings.emergencyPriority,
    });
  }

  private arrive(v: Vehicle): void {
    this.vehicles.delete(v.id);
    const travelS = this.t - v.spawnT;
    if (v.cls === 'emergency') {
      this.emergencyIds.delete(v.id);
      this.stats.emergencyTrips++;
      this.stats.emergencyTravelSum += travelS;
      if (v.dispatchId !== null) {
        const preempted = v.preemptedNodes?.size ?? 0;
        this.dispatchStats.arrived++;
        const est = this.dispatchEstimates.get(v.dispatchId);
        if (est !== undefined) {
          this.dispatchStats.savedSum += Math.max(0, est - travelS);
          this.dispatchStats.savedN++;
          this.dispatchEstimates.delete(v.dispatchId);
        }
        for (const fn of this.arrivalListeners) fn({ dispatchId: v.dispatchId, vehicleId: v.id, actualS: travelS, preempted });
        this.emit(
          'ambulance',
          `${v.label || 'Emergency vehicle'} arrived`,
          `${v.plate} reached ${this.net.nodes[v.dest].name} in ${(travelS / 60).toFixed(1)} min`,
          'info',
        );
      }
    }
    if (v.evacuating && this.evac) {
      this.evac.evacuated++;
      this.evac.exitedThisMinute++;
    }
    this.tripsCompleted++;
    this.stats.trips++;
    this.stats.travelSum += travelS;
    this.stats.delaySum += Math.max(0, travelS - v.freeFlowS);
    this.stats.stopsSum += v.stops;
    this.trips.push({ t: this.t, cls: v.cls, travelS, delayS: Math.max(0, travelS - v.freeFlowS) });
    if (this.trips.length > 800) this.trips.splice(0, this.trips.length - 800);
    const minute = Math.floor(this.t / 60);
    const lastLog = this.arrivalLog[this.arrivalLog.length - 1];
    if (lastLog && lastLog.minute === minute) lastLog.count++;
    else this.arrivalLog.push({ minute, count: 1 });
    while (this.arrivalLog.length && this.arrivalLog[0].minute <= minute - 60) this.arrivalLog.shift();
  }

  private moveVehicles(): void {
    const w = this.weather();
    for (const L of this.links) {
      const vs = L.vehicles;
      L.queue = 0;
      L.approaching = 0;
      if (!vs.length) {
        L.occPcu = 0;
        L.discharge = 0;
        continue;
      }
      const len = L.def.length;
      const sig = this.signals[L.def.to];
      const green = sig.state === 'green' && sig.phase === L.def.phase;
      L.discharge = green ? Math.min(L.discharge + SAT_FLOW * L.lanes * w.sat, L.lanes * 0.5 + 2.5) : 0;
      const vFree = this.freeSpeed(L);
      const flowFactor = Math.max(0.12, 1 - L.occPcu / jamCapacity(L));
      const spacingUnit = JAM_SPACING / Math.max(1, L.lanes);
      let limit = len;
      let occ = 0;
      let write = 0;
      let reorder = false;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        const pcu = PCU[v.cls];
        if (v.movedAt === this.t) {
          vs[write++] = v;
          occ += pcu;
          if (v.cls !== 'emergency') limit = Math.min(limit, v.pos - spacingUnit * pcu);
          continue;
        }
        v.movedAt = this.t;
        const isEmergency = v.cls === 'emergency';
        const desired = vFree * v.drv * CLASS_SPEED[v.cls] * (isEmergency ? Math.max(0.6, flowFactor) : flowFactor);
        let target = v.pos + desired;
        const myLimit = isEmergency ? len : limit;
        if (target >= len && myLimit >= len - 0.01) {
          const last = v.step >= v.route.length - 1;
          if (last) {
            this.arrive(v);
            continue;
          }
          if (green && L.discharge >= pcu) {
            const node = L.def.to;
            let nextLid = v.route[v.step + 1];
            let next = this.links[nextLid];
            if ((next.closed && !isEmergency) || (v.connected && !isEmergency)) {
              const fresh = this.nextRoute(v, node);
              if (fresh === null) {
                if (next.closed) {
                  this.arrive(v);
                  continue;
                }
              } else if (fresh.length) {
                v.route = [...v.route.slice(0, v.step + 1), ...fresh];
                nextLid = v.route[v.step + 1];
                next = this.links[nextLid];
              }
            }
            if ((isEmergency || !next.closed) && (isEmergency || this.canEnter(next, pcu))) {
              L.discharge -= pcu;
              v.step++;
              v.queued = false;
              v.speed = desired;
              this.placeOnLink(v, nextLid, target - len);
              continue;
            }
          }
          target = len;
        }
        target = Math.min(target, myLimit);
        const moved = Math.max(0, target - v.pos);
        if (this.overspeed && L.def.camera && !v.cameraChecked && v.pos < len / 2 && target >= len / 2) {
          v.cameraChecked = true;
          const kmh = moved * 3.6;
          if (v.cls !== 'emergency' && kmh > L.def.speedLimit * 1.1) {
            const event: OverspeedEvent = {
              plate: v.plate,
              vehicleClass: v.cls,
              speedKmh: Math.round(kmh),
              limitKmh: L.def.speedLimit,
              linkId: L.def.id,
              clock: this.clock,
            };
            for (const fn of this.overspeedListeners) fn(event);
          }
        }
        v.speed = moved;
        if (moved < 1) {
          if (!v.queued) v.stops++;
          v.queued = true;
          v.waitS++;
          L.queue++;
        } else {
          v.queued = false;
          if (target > len - APPROACH_WINDOW) L.approaching++;
        }
        v.pos = Math.max(v.pos, target);
        vs[write++] = v;
        occ += pcu;
        if (isEmergency) {
          if (write > 1 && vs[write - 2].pos < v.pos) reorder = true;
        } else {
          limit = v.pos - spacingUnit * pcu;
        }
      }
      vs.length = write;
      if (reorder) vs.sort((a, b) => b.pos - a.pos);
      L.occPcu = occ;
    }
  }

  private updateLinks(): void {
    let totalQueue = 0;
    for (const L of this.links) {
      const raw = Math.min(1, L.occPcu / (SCORE_DENSITY * jamCapacity(L)));
      L.score += SCORE_ALPHA * (raw - L.score);
      totalQueue += L.queue;
      if (L.bias !== 1 && L.biasUntil < this.t) L.bias = 1;
    }
    this.stats.queueSum += totalQueue;
    this.stats.ticks++;
    if (this.learning) {
      for (const sig of this.signals) {
        let local = 0;
        let down = 0;
        for (const lid of this.net.inLinks[sig.node]) local += this.links[lid].queue;
        for (const lid of this.net.outLinks[sig.node]) down += this.links[lid].queue;
        sig.rlReward -= (local + 0.5 * down) / 20;
      }
    }
  }

  private recomputeLink(lid: number): void {
    const L = this.links[lid];
    let lanes = L.def.lanes;
    let speedFactor = 1;
    let closed = false;
    for (const id of L.incidents) {
      const inc = this.incidents.get(id);
      if (!inc) continue;
      lanes -= inc.lanesLost;
      speedFactor = Math.min(speedFactor, inc.speedFactor);
      if (inc.closes) closed = true;
    }
    L.contraflow = false;
    L.evacBias = 1;
    if (this.evac) {
      if (this.evac.closedLinks.includes(lid)) closed = true;
      if (this.evac.contraflowLinks.includes(lid)) {
        lanes += this.net.links[L.def.reverse].lanes;
        L.contraflow = true;
        L.evacBias = 2;
      }
    }
    if (lanes < 1) {
      speedFactor = Math.min(speedFactor, 0.35);
      lanes = 1;
    }
    L.lanes = lanes;
    L.speedFactor = speedFactor;
    L.closed = closed;
  }

  addIncident(spec: {
    linkIds: number[];
    source: 'random' | 'civic';
    durationS: number | null;
    lanesLost: number;
    speedFactor: number;
    closes: boolean;
    label: string;
  }): string {
    const id = `inc-${this.nextIncidentId++}`;
    this.incidents.set(id, {
      id,
      linkIds: spec.linkIds,
      source: spec.source,
      until: spec.durationS === null ? null : this.t + spec.durationS,
      lanesLost: spec.lanesLost,
      speedFactor: spec.speedFactor,
      closes: spec.closes,
      label: spec.label,
    });
    for (const lid of spec.linkIds) {
      this.links[lid].incidents.add(id);
      this.recomputeLink(lid);
    }
    return id;
  }

  clearIncident(id: string): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    this.incidents.delete(id);
    for (const lid of inc.linkIds) {
      this.links[lid].incidents.delete(id);
      this.recomputeLink(lid);
    }
  }

  private updateIncidents(): void {
    for (const inc of [...this.incidents.values()]) {
      if (inc.until !== null && inc.until <= this.t) {
        this.clearIncident(inc.id);
        if (inc.source === 'random') this.emit('accident', 'Incident cleared', inc.label, 'info');
      }
    }
    if (!this.settings.randomIncidents) return;
    if (this.rng() >= 0.45 / 3600) return;
    const candidates = this.links.filter((L) => L.def.kind !== 'lane' && !L.incidents.size && !L.closed);
    const L = pickWeighted(
      this.rng,
      candidates,
      candidates.map((c) => (c.def.kind === 'arterial' ? 3 : c.def.kind === 'ring' ? 1.5 : 2)),
    );
    const label = `${L.def.road} ${DIR_LABEL[L.def.dir]} near ${this.net.nodes[L.def.to].name}`;
    this.addIncident({
      linkIds: [L.def.id],
      source: 'random',
      durationS: randInt(this.rng, 15, 40) * 60,
      lanesLost: 1,
      speedFactor: 0.55,
      closes: false,
      label,
    });
    this.emit('accident', 'Accident reported', label, 'warning');
  }

  setSignalFault(node: number, fault: boolean): void {
    this.signals[node].fault = fault;
    this.signals[node].lastAction = fault ? 'Fault reported' : 'Fault cleared';
  }

  private emit(kind: FeedEvent['kind'], title: string, detail: string, severity: FeedEvent['severity']): void {
    const event: FeedEvent = { id: this.nextEventId++, t: this.t, clock: this.clock, kind, title, detail, severity };
    this.feed.push(event);
    if (this.feed.length > 120) this.feed.splice(0, this.feed.length - 120);
    for (const fn of this.feedListeners) fn(event);
  }

  pushEvent(kind: FeedEvent['kind'], title: string, detail: string, severity: FeedEvent['severity']): void {
    this.emit(kind, title, detail, severity);
  }

  recentEvents(limit = 30): FeedEvent[] {
    return this.feed.slice(-limit).reverse();
  }

  private minuteTick(): void {
    for (const L of this.links) {
      L.hist.push(L.score);
      if (L.hist.length > HISTORY_MINUTES) L.hist.shift();
      L.enteredHist.push(L.entered - L.enteredMark);
      L.enteredMark = L.entered;
      if (L.enteredHist.length > 5) L.enteredHist.shift();
      let cargo = 0;
      let tw = 0;
      for (const v of L.vehicles) {
        if (v.cls === 'cargo') cargo++;
        else if (v.cls === 'two_wheeler') tw++;
      }
      const n = L.vehicles.length;
      L.cargoShare = n ? cargo / n : 0;
      L.twShare = n ? tw / n : 0;
    }
    if (this.evac) {
      this.evac.exitRate = this.evac.exitRate * 0.7 + this.evac.exitedThisMinute * 0.3;
      this.evac.exitedThisMinute = 0;
    }
    if (this.keepSeries) {
      const k = this.kpis();
      this.series.push({
        t: this.t,
        clock: this.clock,
        activeVehicles: k.activeVehicles,
        avgSpeedKmh: k.avgSpeedKmh,
        congestedSegments: k.congestedSegments,
        throughputPerHour: k.throughputPerHour,
        avgTravelMin: k.avgTravelMin,
        avgDelayMin: k.avgDelayMin,
      });
      if (this.series.length > 720) this.series.shift();
    }
    if (this.forecaster) this.runForecast();
  }

  linkFeatures(lid: number): number[] {
    const L = this.links[lid];
    const h = L.hist;
    const lag = (k: number) => (h.length ? h[Math.max(0, h.length - 1 - k)] : L.score);
    const meanScore = (ids: number[]) => {
      let s = 0;
      let n = 0;
      for (const id of ids) {
        if (id === L.def.reverse) continue;
        s += this.links[id].score;
        n++;
      }
      return n ? s / n : 0;
    };
    const entered5 = L.enteredHist.reduce((a, b) => a + b, 0);
    const tod = ((this.t % DAY_SECONDS) / DAY_SECONDS) * Math.PI * 2;
    let incidentNear = 0;
    for (const id of [...this.net.inLinks[L.def.from], ...this.net.outLinks[L.def.to]]) {
      if (id !== lid && this.links[id].incidents.size) incidentNear = 1;
    }
    const values: Record<(typeof FEATURES)[number], number> = {
      score: L.score,
      score_lag5: lag(5),
      score_lag10: lag(10),
      score_lag15: lag(15),
      trend5: L.score - lag(5),
      inflow5: entered5 / (L.def.lanes * 150),
      queue: L.queue / ((L.def.lanes * L.def.length) / JAM_SPACING),
      upstream: meanScore(this.net.inLinks[L.def.from]),
      downstream: meanScore(this.net.outLinks[L.def.to]),
      tod_sin: Math.sin(tod),
      tod_cos: Math.cos(tod),
      weekend: isWeekend(this.t) ? 1 : 0,
      weather: this.weather().code,
      incident: L.incidents.size || L.closed ? 1 : 0,
      incident_near: incidentNear,
      kind: KIND_CODE[L.def.kind],
      lanes: L.def.lanes,
      cargo_share: L.cargoShare,
      tw_share: L.twShare,
      network_load: this.vehicles.size / 1000,
    };
    return FEATURES.map((f) => values[f]);
  }

  linkScores(): number[] {
    return this.links.map((L) => L.score);
  }

  private runForecast(): void {
    const fc = this.forecaster!;
    const n = this.links.length;
    const p15 = new Float32Array(n);
    const p30 = new Float32Array(n);
    const base = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const L = this.links[i];
      const x = this.linkFeatures(i);
      L.fc15 = fc.predict(15, x);
      L.fc30 = fc.predict(30, x);
      L.conf15 = fc.confidence(15, L.fc15) * (this.settings.weather === 'clear' ? 1 : 0.95);
      L.conf30 = fc.confidence(30, L.fc30) * (this.settings.weather === 'clear' ? 1 : 0.95);
      p15[i] = L.fc15;
      p30[i] = L.fc30;
      base[i] = L.score;
    }
    this.forecastT = this.t;
    const minute = Math.floor(this.t / 60);
    this.predLog.set(minute, { p15, p30, base });
    for (const h of [15, 30] as const) {
      const past = this.predLog.get(minute - h);
      if (!past) continue;
      let err = 0;
      let baseErr = 0;
      let hit = 0;
      for (let i = 0; i < n; i++) {
        const actual = this.links[i].score;
        const pred = h === 15 ? past.p15[i] : past.p30[i];
        err += Math.abs(pred - actual);
        baseErr += Math.abs(past.base[i] - actual);
        if (congestionLevel(pred) === congestionLevel(actual)) hit++;
      }
      this.accuracy.push({ h, err, base: baseErr, hit, n });
    }
    if (this.accuracy.length > 240) this.accuracy.splice(0, this.accuracy.length - 240);
    this.predLog.delete(minute - 31);
    this.hotspots = this.links
      .filter((L) => Math.max(L.fc15, L.fc30) >= 0.35)
      .sort((a, b) => Math.max(b.fc15, b.fc30) - Math.max(a.fc15, a.fc30))
      .slice(0, 8)
      .map((L) => ({
        linkId: L.def.id,
        road: L.def.road,
        fromName: this.net.nodes[L.def.from].name,
        toName: this.net.nodes[L.def.to].name,
        now: L.score,
        h15: L.fc15,
        h30: L.fc30,
        conf: L.conf15,
        level: congestionLevel(Math.max(L.fc15, L.fc30)),
      }));
    if (minute % 5 === 0 && this.settings.adaptive) this.planInterventions();
  }

  private planInterventions(): void {
    const emerging = this.links
      .filter((L) => L.fc15 >= 0.6 && L.score < 0.6 && L.bias === 1)
      .sort((a, b) => b.fc15 - a.fc15)
      .slice(0, 3);
    for (const L of emerging) {
      L.bias = 1.35;
      L.biasUntil = this.t + 15 * 60;
      const node = this.net.nodes[L.def.to];
      const level = congestionLevel(L.fc15);
      const text = `${L.def.road} ${DIR_LABEL[L.def.dir]} predicted ${level} in 15 min (${Math.round(
        L.conf15 * 100,
      )}% confidence). Green priority raised at ${node.name}${this.settings.forecastRouting ? '; connected vehicles rerouted' : ''}.`;
      this.interventions.unshift({
        id: this.nextInterventionId++,
        t: this.t,
        clock: this.clock,
        kind: 'signal_bias',
        linkId: L.def.id,
        nodeId: node.id,
        text,
      });
      this.emit('forecast', `Congestion predicted: ${L.def.road}`, text, 'warning');
    }
    if (this.interventions.length > 30) this.interventions.length = 30;
  }

  step(): void {
    this.t++;
    this.spawnDemand();
    this.requestPreemption();
    for (const sig of this.signals) this.stepSignal(sig);
    this.moveVehicles();
    this.updateLinks();
    this.updateIncidents();
    if (this.t % 10 === 0) this.refreshCosts();
    if (this.t % 60 === 0) this.minuteTick();
  }

  run(seconds: number): void {
    for (let i = 0; i < seconds; i++) this.step();
  }

  kpis(): Kpis {
    const recent = this.trips.filter((tr) => tr.t > this.t - 900);
    const minuteNow = Math.floor(this.t / 60);
    const hour = this.arrivalLog.reduce((a, e) => (e.minute > minuteNow - 60 ? a + e.count : a), 0);
    let speedSum = 0;
    for (const v of this.vehicles.values()) speedSum += v.speed;
    const seen = new Set<number>();
    let congested = 0;
    for (const L of this.links) {
      const seg = Math.min(L.def.id, L.def.reverse);
      if (seen.has(seg)) continue;
      const rev = this.links[L.def.reverse];
      if (Math.max(L.score, rev.score) >= 0.6) {
        congested++;
        seen.add(seg);
      }
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      activeVehicles: this.vehicles.size,
      tripsCompleted: this.tripsCompleted,
      congestedSegments: congested,
      avgTravelMin: round(avg(recent.map((r) => r.travelS)) / 60, 1),
      avgDelayMin: round(avg(recent.map((r) => r.delayS)) / 60, 1),
      avgSpeedKmh: round(this.vehicles.size ? (speedSum / this.vehicles.size) * 3.6 : 0, 1),
      emergencyEnRoute: this.emergencyIds.size,
      throughputPerHour:
        this.t - this.startT < 3600 ? Math.round((hour * 3600) / Math.max(300, this.t - this.startT)) : hour,
      openIncidents: this.incidents.size,
    };
  }

  private emergencyList(): ActiveEmergency[] {
    const out: ActiveEmergency[] = [];
    for (const id of this.emergencyIds) {
      const v = this.vehicles.get(id);
      if (!v) continue;
      const speed = Math.max(6, this.freeSpeed(this.links[v.link]) * CLASS_SPEED.emergency);
      let remaining = this.links[v.link].def.length - v.pos;
      for (let k = v.step + 1; k < v.route.length; k++) remaining += this.net.links[v.route[k]].length;
      out.push({
        vehicleId: v.id,
        plate: v.plate,
        label: v.label || 'Emergency vehicle',
        route: v.route,
        step: v.step,
        etaS: Math.round(remaining / speed),
        preempted: v.preemptedNodes?.size ?? 0,
        dispatchId: v.dispatchId,
        destName: this.net.nodes[v.dest].poi?.name ?? this.net.nodes[v.dest].name,
      });
    }
    return out;
  }

  evacuationStatus(): EvacuationStatus | null {
    const e = this.evac;
    if (!e) return null;
    let inZone = 0;
    for (const v of this.vehicles.values()) {
      const def = this.net.links[v.link];
      if (e.zone.has(def.from) && e.zone.has(def.to)) inZone++;
      else if (v.evacuating && e.zone.has(def.from)) inZone++;
    }
    return {
      center: e.center,
      radius: e.radius,
      zoneNodes: [...e.zone],
      closedLinks: e.closedLinks,
      contraflowLinks: e.contraflowLinks,
      exits: e.exits,
      startedAt: e.startedAt,
      startedClock: clockOf(e.startedAt),
      inZone,
      evacuated: e.evacuated,
      clearanceEtaMin: e.exitRate > 0.2 ? Math.round(inZone / e.exitRate) : null,
    };
  }

  snapshot(): Snapshot {
    const vehicles: VehicleTuple[] = [];
    for (const v of this.vehicles.values()) {
      const len = this.net.links[v.link].length;
      let flags = 0;
      if (v.queued) flags |= VEHICLE_FLAG.queued;
      if (v.cls === 'emergency') flags |= VEHICLE_FLAG.priority;
      if (v.evacuating) flags |= VEHICLE_FLAG.evacuating;
      vehicles.push([v.id, v.link, Math.round((v.pos / len) * 1000) / 1000, CLASS_CODE[v.cls], flags]);
    }
    return {
      t: this.t,
      clock: this.clock,
      day: DAY_NAMES[dayIndex(this.t)],
      weather: this.settings.weather,
      speed: this.settings.speed,
      paused: this.settings.paused,
      adaptive: this.settings.adaptive,
      kpis: this.kpis(),
      linkScore: this.links.map((L) => round(L.score, 2)),
      linkQueue: this.links.map((L) => L.queue),
      linkFlags: this.links.map((L) => {
        let f = 0;
        if (L.incidents.size) f |= LINK_FLAG.incident;
        if (L.closed) f |= LINK_FLAG.closed;
        if (L.contraflow) f |= LINK_FLAG.contraflow;
        if (L.greenWave) f |= LINK_FLAG.greenWave;
        return f;
      }),
      vehicles,
      signals: this.signals.map((s) => {
        let f = 0;
        if (s.mode === 'adaptive' && this.settings.adaptive) f |= SIGNAL_FLAG.adaptive;
        if (s.preempt) f |= SIGNAL_FLAG.preempted;
        if (s.fault) f |= SIGNAL_FLAG.fault;
        if (s.evacuation) f |= SIGNAL_FLAG.evacuation;
        return [s.node, s.phase === 'NS' ? 0 : 1, s.state === 'green' ? 0 : s.state === 'yellow' ? 1 : 2, f];
      }),
      emergencies: this.emergencyList(),
      evacuation: this.evacuationStatus(),
    };
  }

  signalDetails(): SignalDetail[] {
    return this.signals.map((s) => {
      let queueNS = 0;
      let queueEW = 0;
      for (const lid of this.net.inLinks[s.node]) {
        const L = this.links[lid];
        if (L.def.phase === 'NS') queueNS += L.queue;
        else queueEW += L.queue;
      }
      const effectiveMode: SignalMode = this.settings.adaptive ? s.mode : 'fixed';
      return {
        nodeId: s.node,
        name: this.net.nodes[s.node].name,
        mode: effectiveMode,
        phase: s.phase,
        state: s.state,
        timer: s.timer,
        greenElapsed: s.greenElapsed,
        plan: { ...s.plan },
        queueNS,
        queueEW,
        preempted: s.preempt !== null,
        fault: s.fault,
        evacuation: s.evacuation,
        policy: s.policyUsed,
        lastAction: s.lastAction,
        switches: s.switches,
      };
    });
  }

  configureSignal(node: number, update: { mode?: SignalMode; plan?: Partial<SignalPlan> }): SignalDetail {
    const sig = this.signals[node];
    if (update.mode) sig.mode = update.mode;
    if (update.plan) {
      sig.plan = {
        greenNS: clamp(update.plan.greenNS ?? sig.plan.greenNS, MIN_GREEN, 120),
        greenEW: clamp(update.plan.greenEW ?? sig.plan.greenEW, MIN_GREEN, 120),
      };
    }
    sig.lastAction = 'Plan updated by controller';
    return this.signalDetails()[node];
  }

  planRoute(from: number, to: number, cls: VehicleClass, weightT?: number): RoutePlan {
    const priority = cls === 'emergency' && this.settings.emergencyPriority;
    const weight = weightT ?? (cls === 'cargo' ? 18 : 1.5);
    const ctx = this.routeContext();
    const res = shortestPath(ctx, from, to, { cls, weightT: weight, priority });
    const notes: string[] = [];
    if (!res) {
      if (cls === 'cargo' && ctx.cargoRestricted) notes.push('Commuter core is closed to freight during peak hours.');
      return {
        vehicleClass: cls,
        feasible: false,
        links: [],
        nodes: [],
        distanceKm: 0,
        etaMin: 0,
        freeFlowMin: 0,
        signals: 0,
        notes: notes.length ? notes : ['No permitted route between these junctions.'],
      };
    }
    let distance = 0;
    let eta = 0;
    let offset = 0;
    let ringM = 0;
    let laneM = 0;
    let incidents = 0;
    for (const lid of res.links) {
      const def = this.net.links[lid];
      const time = this.linkTime(lid, offset);
      const waitFactor = priority ? 0.15 : cls === 'two_wheeler' ? 0.55 : 1;
      const runFactor = cls === 'cargo' ? 1 / 0.85 : cls === 'emergency' ? 1 / 1.3 : 1;
      const seconds = time.run * runFactor + time.wait * waitFactor;
      eta += seconds;
      offset += seconds;
      distance += def.length;
      if (def.kind === 'ring') ringM += def.length;
      if (def.kind === 'lane') laneM += def.length;
      if (this.links[lid].incidents.size) incidents++;
    }
    const signals = Math.max(0, res.links.length - 1);
    if (cls === 'cargo') {
      if (ctx.cargoRestricted) notes.push('Peak-hour freight restriction: avoids the commuter core (08–11, 17–20).');
      if (ringM > 0) notes.push(`Uses the Ring Road freight corridor for ${(ringM / 1000).toFixed(1)} km.`);
      notes.push(`Skips narrow lanes and links under its ${weight} t weight.`);
    }
    if (cls === 'two_wheeler') {
      if (laneM > 0) notes.push(`Cuts through old-town lanes (${(laneM / 1000).toFixed(1)} km).`);
      notes.push('Lane filtering shortens waits at signals.');
    }
    if (cls === 'emergency') {
      notes.push(
        priority
          ? `Green-wave priority requested at ${signals} signals.`
          : 'Signal priority is switched off; route uses normal signal timing.',
      );
    }
    if (cls === 'private' && laneM === 0) notes.push('Sticks to arterials and streets; avoids narrow lanes.');
    if (incidents) notes.push(`Passes ${incidents} segment(s) with an active incident.`);
    if (this.settings.forecastRouting && this.forecastT >= 0) notes.push('Costs include the 15–30 min congestion forecast.');
    return {
      vehicleClass: cls,
      feasible: true,
      links: res.links,
      nodes: routeNodes(this.net, res.links),
      distanceKm: round(distance / 1000, 2),
      etaMin: round(eta / 60, 1),
      freeFlowMin: round(this.freeFlowTime(res.links, cls) / 60, 1),
      signals,
      notes,
    };
  }

  dispatchEmergency(input: {
    plate: string;
    label: string;
    from: number;
    to: number;
    dispatchId: number;
  }): { vehicleId: number; plan: RoutePlan; estNoPriorityS: number } | null {
    const plan = this.planRoute(input.from, input.to, 'emergency');
    if (!plan.feasible) return null;
    let noPriority = 0;
    let offset = 0;
    for (const lid of plan.links) {
      const time = this.linkTime(lid, offset);
      const s = time.run / 1.3 + time.wait;
      noPriority += s;
      offset += s;
    }
    const v = this.spawn('emergency', input.from, input.to, {
      label: input.label,
      plate: input.plate,
      dispatchId: input.dispatchId,
    });
    if (!v) return null;
    this.dispatchStats.dispatched++;
    this.dispatchEstimates.set(input.dispatchId, Math.round(noPriority));
    this.emit(
      'ambulance',
      `${input.label} en route`,
      `${input.plate} to ${this.net.nodes[input.to].poi?.name ?? this.net.nodes[input.to].name} · ETA ${plan.etaMin} min`,
      'critical',
    );
    return { vehicleId: v.id, plan, estNoPriorityS: Math.round(noPriority) };
  }

  activateEvacuation(center: number, radius: number): EvacuationStatus {
    if (this.evac) this.deactivateEvacuation(false);
    const hop = hopDistances(this.net, center);
    const zone = new Set(this.net.nodes.filter((n) => hop[n.id] <= radius).map((n) => n.id));
    let exits = this.net.exits.filter((id) => !zone.has(id));
    if (!exits.length) exits = this.net.nodes.filter((n) => !zone.has(n.id) && (n.r === 0 || n.r === 4)).map((n) => n.id);
    const exitHops = exits.map((e) => hopDistances(this.net, e));
    const nearestExit = this.net.nodes.map((n) => {
      let best = exits[0];
      let bestHop = Infinity;
      exits.forEach((e, i) => {
        if (exitHops[i][n.id] < bestHop) {
          bestHop = exitHops[i][n.id];
          best = e;
        }
      });
      return best;
    });
    const closedLinks: number[] = [];
    const contraflowLinks: number[] = [];
    for (const def of this.net.links) {
      if (zone.has(def.to) && hop[def.to] < hop[def.from]) closedLinks.push(def.id);
      else if (zone.has(def.from) && hop[def.to] > hop[def.from]) contraflowLinks.push(def.id);
    }
    this.evac = {
      center,
      radius,
      zone,
      hop,
      nearestExit,
      closedLinks,
      contraflowLinks,
      exits,
      startedAt: this.t,
      evacuated: 0,
      exitRate: 0,
      exitedThisMinute: 0,
    };
    for (const def of this.net.links) this.recomputeLink(def.id);
    for (const sig of this.signals) sig.evacuation = zone.has(sig.node);
    for (const v of this.vehicles.values()) {
      if (v.cls === 'emergency') continue;
      const def = this.net.links[v.link];
      if (zone.has(def.from) || zone.has(def.to)) {
        v.evacuating = true;
        v.dest = nearestExit[def.to];
      } else if (zone.has(v.dest)) {
        v.dest = nearestExit[v.dest];
      } else {
        continue;
      }
      const fresh = def.to === v.dest ? [] : this.nextRoute(v, def.to);
      if (fresh) v.route = [...v.route.slice(0, v.step + 1), ...fresh];
      else v.route = v.route.slice(0, v.step + 1);
    }
    const name = this.net.nodes[center].name;
    this.emit('evacuation', 'Evacuation mode activated', `Zone around ${name} (radius ${radius}); ${contraflowLinks.length} exit corridors opened`, 'critical');
    return this.evacuationStatus()!;
  }

  deactivateEvacuation(announce = true): void {
    if (!this.evac) return;
    const center = this.evac.center;
    this.evac = null;
    for (const def of this.net.links) this.recomputeLink(def.id);
    for (const sig of this.signals) sig.evacuation = false;
    if (announce) this.emit('evacuation', 'Evacuation mode ended', `Normal operation restored around ${this.net.nodes[center].name}`, 'info');
  }

  forecast(): ForecastResponse {
    const meta = this.forecaster?.file;
    const links: LinkForecast[] = this.links.map((L) => ({
      linkId: L.def.id,
      now: round(L.score, 3),
      h15: round(L.fc15, 3),
      h30: round(L.fc30, 3),
      conf15: round(L.conf15, 2),
      conf30: round(L.conf30, 2),
    }));
    return {
      t: this.forecastT,
      clock: this.forecastT >= 0 ? clockOf(this.forecastT) : '--:--',
      model: {
        available: Boolean(this.forecaster),
        name: meta?.name ?? 'Not trained',
        trainedAt: meta?.trainedAt ?? null,
        trees: this.forecaster?.treeCount ?? 0,
        metrics: meta?.metrics ?? null,
      },
      links: this.forecastT >= 0 ? links : [],
      hotspots: this.hotspots,
      interventions: this.interventions,
    };
  }

  predictionAccuracy(): PredictionAccuracy {
    const recent = this.accuracy.slice(-240);
    const agg = (h: 15 | 30) => {
      const rows = recent.filter((r) => r.h === h).slice(-120);
      const n = rows.reduce((a, r) => a + r.n, 0);
      if (!n) return { mae: null, base: null, acc: null, samples: 0 };
      return {
        mae: round(rows.reduce((a, r) => a + r.err, 0) / n, 4),
        base: round(rows.reduce((a, r) => a + r.base, 0) / n, 4),
        acc: round(rows.reduce((a, r) => a + r.hit, 0) / n, 4),
        samples: n,
      };
    };
    const a15 = agg(15);
    const a30 = agg(30);
    return {
      mae15: a15.mae,
      mae30: a30.mae,
      baselineMae15: a15.base,
      baselineMae30: a30.base,
      levelAcc15: a15.acc,
      levelAcc30: a30.acc,
      samples15: a15.samples,
      samples30: a30.samples,
    };
  }

  analytics(): AnalyticsLive {
    const classMixCount: Record<VehicleClass, number> = { private: 0, two_wheeler: 0, cargo: 0, emergency: 0 };
    for (const v of this.vehicles.values()) classMixCount[v.cls]++;
    const tripsByClass = {} as AnalyticsLive['tripsByClass'];
    for (const cls of ['private', 'two_wheeler', 'cargo', 'emergency'] as VehicleClass[]) {
      const rows = this.trips.filter((t) => t.cls === cls);
      tripsByClass[cls] = {
        trips: rows.length,
        avgTravelMin: rows.length ? round(rows.reduce((a, r) => a + r.travelS, 0) / rows.length / 60, 1) : 0,
      };
    }
    const ds = this.dispatchStats;
    return {
      series: this.series,
      prediction: this.predictionAccuracy(),
      classMix: classMixCount,
      tripsByClass,
      emergency: {
        dispatched: ds.dispatched,
        arrived: ds.arrived,
        avgSavedMin: ds.savedN ? round(ds.savedSum / ds.savedN / 60, 1) : null,
      },
    };
  }

  setWeather(weather: Weather): void {
    this.settings.weather = weather;
    this.refreshCosts();
  }

  activeVehicleCount(): number {
    return this.vehicles.size;
  }
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
