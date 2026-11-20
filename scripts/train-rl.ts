import { Simulation } from '../server/sim/engine';
import { saveJson } from '../server/sim/models';
import { buildNetwork } from '../server/sim/network';
import { mulberry32, pick } from '../server/sim/random';
import { QPolicy } from '../server/sim/rl';
import type { Weather } from '../shared/types';

const EPISODES = Number(process.env.EPISODES ?? 80);
const EPISODE_S = 5400;
const STARTS = [6.5, 7.5, 8.5, 11.5, 13, 16.5, 17.5, 18.5].map((h) => h * 3600);
const WEATHER: Weather[] = ['clear', 'clear', 'clear', 'rain', 'heavy_rain', 'fog'];

const net = buildNetwork();
const policy = new QPolicy();
const rng = mulberry32(42);

console.log(`Training tabular Q-learning signal agent: ${EPISODES} episodes x ${EPISODE_S / 60} sim-min`);
const started = Date.now();
for (let ep = 0; ep < EPISODES; ep++) {
  const progress = ep / EPISODES;
  const epsilon = 0.03 + 0.27 * (1 - progress);
  const sim = new Simulation(net, {
    seed: 1000 + ep,
    startT: pick(rng, STARTS) + (ep % 5) * 86400,
    policy,
    learning: { epsilon, alpha: 0.12, gamma: 0.9 },
    randomEmergencies: false,
    overspeed: false,
    keepSeries: false,
    settings: {
      adaptive: true,
      randomIncidents: true,
      demand: 0.85 + rng() * 0.35,
      weather: pick(rng, WEATHER),
      forecastRouting: false,
    },
  });
  sim.run(EPISODE_S);
  policy.episodes++;
  if ((ep + 1) % 10 === 0) {
    const s = sim.stats;
    console.log(
      `episode ${ep + 1}/${EPISODES}  eps=${epsilon.toFixed(2)}  delay=${(s.delaySum / s.trips / 60).toFixed(2)} min  states=${policy.statesVisited()}`,
    );
  }
}

type Mode = 'fixed' | 'max-pressure' | 'rl';
function evaluate(mode: Mode, seed: number, startT: number) {
  const sim = new Simulation(net, {
    seed,
    startT,
    policy: mode === 'rl' ? policy : null,
    randomEmergencies: false,
    overspeed: false,
    keepSeries: false,
    settings: { adaptive: mode !== 'fixed', randomIncidents: false, forecastRouting: false },
  });
  sim.run(1800);
  sim.resetStats();
  sim.run(3600);
  const s = sim.stats;
  return { delay: s.delaySum / s.trips / 60, queue: s.queueSum / s.ticks };
}

const results: Record<Mode, { delay: number; queue: number }> = {
  fixed: { delay: 0, queue: 0 },
  'max-pressure': { delay: 0, queue: 0 },
  rl: { delay: 0, queue: 0 },
};
const evalRuns: [number, number][] = [
  [77, 7.5 * 3600],
  [78, 17 * 3600],
  [79, 7.5 * 3600 + 86400],
  [80, 12 * 3600],
];
for (const mode of Object.keys(results) as Mode[]) {
  for (const [seed, start] of evalRuns) {
    const r = evaluate(mode, seed, start);
    results[mode].delay += r.delay / evalRuns.length;
    results[mode].queue += r.queue / evalRuns.length;
  }
}
for (const [mode, r] of Object.entries(results)) {
  console.log(`${mode.padEnd(13)} delay ${r.delay.toFixed(3)} min/trip   queue ${r.queue.toFixed(1)} veh`);
}

const metrics = {
  delayFixedMin: round(results.fixed.delay),
  delayMaxPressureMin: round(results['max-pressure'].delay),
  delayRlMin: round(results.rl.delay),
  queueFixed: round(results.fixed.queue),
  queueRl: round(results.rl.queue),
  delayReductionVsFixedPct: round((1 - results.rl.delay / results.fixed.delay) * 100),
  trainingSeconds: Math.round((Date.now() - started) / 1000),
};
const file = saveJson('signal-policy.json', policy.toFile('Tabular Q-learning (shared, network reward)', metrics));
console.log(`Saved policy to ${file}`);
console.log(metrics);

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
