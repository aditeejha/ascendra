import type { EvalMetrics, EvalScenario, EvaluationResult, NetLink, SimSettings } from '../../shared/types';
import { Simulation } from './engine';
import type { Forecaster } from './forecaster';
import type { JunctionForecaster } from './junction';
import { distanceM, type Network } from './network';
import type { QPolicy } from './rl';

export interface ScenarioConfig {
  key: string;
  label: string;
  description: string;
  startT: number;
  settings: Partial<SimSettings>;
  incidents?: number[];
}

const UNNAMED = new Set(['Unnamed road', 'Residential lane']);

export function incidentLinks(net: Network): number[] {
  const major = net.links.filter((l) => (l.kind === 'arterial' || l.kind === 'highway') && !UNNAMED.has(l.road) && !l.bridge);
  const atSignals = major.filter((l) => net.nodes[l.to].signal);
  const pool = atSignals.length >= 2 ? atSignals : major;
  const order = (a: NetLink, b: NetLink) =>
    b.lanes - a.lanes || Number(b.core) - Number(a.core) || Number(b.kind === 'highway') - Number(a.kind === 'highway') || b.length - a.length;
  const chosen: number[] = [];
  const roads = new Set<string>();
  for (const l of [...pool].sort(order)) {
    if (roads.has(l.road)) continue;
    roads.add(l.road);
    chosen.push(l.id);
    if (chosen.length === 2) break;
  }
  return chosen;
}

export function buildScenarios(net: Network): ScenarioConfig[] {
  const incidents = incidentLinks(net);
  const names = incidents.map((id) => net.links[id].road).join(' and ');
  return [
    { key: 'morning', label: 'Morning peak', description: 'Working day 08:00–09:00, clear weather, inbound commute to the centre.', startT: 7.5 * 3600, settings: { weather: 'clear' } },
    { key: 'evening', label: 'Evening peak', description: 'Working day 17:30–18:30, outbound commute from the centre.', startT: 17 * 3600, settings: { weather: 'clear' } },
    { key: 'weather', label: 'Heavy rain', description: 'Morning peak with heavy rain: slower speeds and lower saturation flow.', startT: 7.5 * 3600, settings: { weather: 'heavy_rain' } },
    {
      key: 'accident',
      label: 'Accidents on main roads',
      description: `Morning peak with an accident blocking a lane on ${names}, just before busy junctions.`,
      startT: 7.5 * 3600,
      settings: { weather: 'clear' },
      incidents,
    },
  ];
}

export function emergencyTrips(net: Network, count = 6): [number, number][] {
  const stations = net.stations.length ? [...net.stations].sort((a, b) => a - b) : net.exits;
  const trips: [number, number][] = [];
  for (let i = 0; i < count && stations.length; i++) {
    const from = stations[(i * 7) % stations.length];
    let best = -1;
    let bestGap = Infinity;
    for (const n of net.nodes) {
      const gap = Math.abs(distanceM(net, from, n.id) - (2000 + 250 * (i % 3)));
      if (n.id !== from && gap < bestGap) {
        bestGap = gap;
        best = n.id;
      }
    }
    trips.push([from, best]);
  }
  return trips;
}

export interface RunOptions {
  seed: number;
  durationS: number;
  warmupS: number;
  policy: QPolicy | null;
  forecaster: Forecaster | null;
  junctionModel?: JunctionForecaster | null;
  dispatchEmergencies: boolean;
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function runScenario(
  net: Network,
  scenario: ScenarioConfig,
  mode: 'fixed' | 'adaptive',
  opts: RunOptions,
): Promise<EvalMetrics> {
  const adaptive = mode === 'adaptive';
  const sim = new Simulation(net, {
    seed: opts.seed,
    startT: scenario.startT,
    policy: adaptive ? opts.policy : null,
    forecaster: adaptive ? opts.forecaster : null,
    junctionModel: adaptive ? (opts.junctionModel ?? null) : null,
    randomEmergencies: false,
    overspeed: false,
    keepSeries: false,
    settings: {
      ...scenario.settings,
      adaptive,
      emergencyPriority: adaptive,
      forecastRouting: adaptive,
      randomIncidents: false,
    },
  });
  for (const lid of scenario.incidents ?? []) {
    sim.addIncident({ linkIds: [lid], source: 'random', durationS: null, lanesLost: 1, speedFactor: 0.55, closes: false, label: 'Scenario incident' });
  }
  for (let s = 0; s < opts.warmupS; s += 600) {
    sim.run(Math.min(600, opts.warmupS - s));
    await yieldToLoop();
  }
  sim.resetStats();
  const dispatchPlan = emergencyTrips(net);
  const interval = Math.floor(opts.durationS / (dispatchPlan.length + 1));
  let dispatched = 0;
  for (let s = 0; s < opts.durationS; s += 300) {
    if (opts.dispatchEmergencies && dispatched < dispatchPlan.length && s >= interval * (dispatched + 1)) {
      const [from, to] = dispatchPlan[dispatched];
      sim.dispatchEmergency({ plate: `EVAL-${dispatched}`, label: 'Ambulance', from, to, dispatchId: dispatched + 1 });
      dispatched++;
    }
    sim.run(Math.min(300, opts.durationS - s));
    await yieldToLoop();
  }
  const st = sim.stats;
  const trips = Math.max(1, st.trips);
  return {
    avgTravelMin: round(st.travelSum / trips / 60, 2),
    avgDelayMin: round(st.delaySum / trips / 60, 2),
    avgQueue: round(st.queueSum / Math.max(1, st.ticks), 1),
    tripsCompleted: st.trips,
    stopsPerTrip: round(st.stopsSum / trips, 2),
    emergencyEtaMin: st.emergencyTrips ? round(st.emergencyTravelSum / st.emergencyTrips / 60, 2) : null,
  };
}

function average(rows: EvalMetrics[]): EvalMetrics {
  const avg = (pick: (m: EvalMetrics) => number) => rows.reduce((a, m) => a + pick(m), 0) / rows.length;
  const em = rows.filter((m) => m.emergencyEtaMin !== null);
  return {
    avgTravelMin: round(avg((m) => m.avgTravelMin), 2),
    avgDelayMin: round(avg((m) => m.avgDelayMin), 2),
    avgQueue: round(avg((m) => m.avgQueue), 1),
    tripsCompleted: Math.round(avg((m) => m.tripsCompleted)),
    stopsPerTrip: round(avg((m) => m.stopsPerTrip), 2),
    emergencyEtaMin: em.length ? round(em.reduce((a, m) => a + m.emergencyEtaMin!, 0) / em.length, 2) : null,
  };
}

export async function runEvaluation(
  net: Network,
  policy: QPolicy | null,
  forecaster: Forecaster | null,
  options: { seeds?: number; durationMin?: number; junctionModel?: JunctionForecaster | null; onProgress?: (done: number, total: number) => void } = {},
): Promise<EvaluationResult> {
  const seeds = options.seeds ?? 2;
  const durationS = (options.durationMin ?? 60) * 60;
  const list = buildScenarios(net);
  const total = list.length * seeds * 2;
  let done = 0;
  const scenarios: EvalScenario[] = [];
  let emWith = 0;
  let emWithout = 0;
  let emN = 0;
  for (const scenario of list) {
    const fixedRuns: EvalMetrics[] = [];
    const adaptiveRuns: EvalMetrics[] = [];
    for (let i = 0; i < seeds; i++) {
      const base = { seed: 9000 + i * 17, durationS, warmupS: 1800, policy, forecaster, junctionModel: options.junctionModel ?? null, dispatchEmergencies: true };
      fixedRuns.push(await runScenario(net, scenario, 'fixed', base));
      options.onProgress?.(++done, total);
      adaptiveRuns.push(await runScenario(net, scenario, 'adaptive', base));
      options.onProgress?.(++done, total);
    }
    const fixed = average(fixedRuns);
    const adaptive = average(adaptiveRuns);
    if (fixed.emergencyEtaMin !== null && adaptive.emergencyEtaMin !== null) {
      emWithout += fixed.emergencyEtaMin;
      emWith += adaptive.emergencyEtaMin;
      emN++;
    }
    scenarios.push({ key: scenario.key, label: scenario.label, description: scenario.description, fixed, adaptive });
  }
  return {
    generatedAt: new Date().toISOString(),
    durationMin: durationS / 60,
    seeds,
    scenarios,
    emergency: {
      withPriorityMin: emN ? round(emWith / emN, 2) : 0,
      withoutPriorityMin: emN ? round(emWithout / emN, 2) : 0,
      trips: emN * emergencyTrips(net).length * seeds,
    },
    forecaster: forecaster?.file.metrics ?? null,
    policy: policy ? { name: policy.meta.name ?? 'Q-learning', states: policy.statesVisited(), episodes: policy.episodes } : null,
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
