import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Simulation } from '../server/sim/engine';
import { FEATURES, TARGET_WINDOW_MIN } from '../server/sim/forecaster';
import { loadPolicy } from '../server/sim/models';
import { buildNetwork } from '../server/sim/network';
import { mulberry32, pick, randInt } from '../server/sim/random';
import type { Weather } from '../shared/types';

const DAYS = Number(process.env.DAYS ?? 14);
const SAMPLE_EVERY_MIN = 6;
const KEEP_SHARE = 0.5;
const LANE_EVERY = 10;
const START_H = 4;
const RECORD_FROM_H = 5;
const END_H = 23.5;

const net = buildNetwork();
const policy = loadPolicy();
const rng = mulberry32(2026);
const recorded = net.links.filter((l, i) => l.kind !== 'lane' || i % LANE_EVERY === 0).map((l) => l.id);
console.log(`Recording ${recorded.length} of ${net.links.length} links (all main roads, every ${LANE_EVERY}th residential lane)`);
const outDir = path.resolve('ml/data');
mkdirSync(outDir, { recursive: true });
const out = createWriteStream(path.join(outDir, 'link_history.csv'));
out.write(['day', 'minute', 'link', ...FEATURES, 'y15', 'y30'].join(',') + '\n');

function weatherPlan(): { fromMin: number; toMin: number; weather: Weather }[] {
  const plan: { fromMin: number; toMin: number; weather: Weather }[] = [];
  const roll = rng();
  if (roll < 0.15) plan.push({ fromMin: 5 * 60, toMin: randInt(rng, 8, 10) * 60, weather: 'fog' });
  else if (roll < 0.45) {
    const spells = randInt(rng, 1, 2);
    for (let i = 0; i < spells; i++) {
      const start = randInt(rng, 6, 20) * 60;
      plan.push({ fromMin: start, toMin: start + randInt(rng, 60, 180), weather: pick(rng, ['rain', 'heavy_rain'] as Weather[]) });
    }
  }
  return plan;
}

let totalRows = 0;
const started = Date.now();
for (let day = 0; day < DAYS; day++) {
  const adaptive = day % 2 === 1;
  const sim = new Simulation(net, {
    seed: 500 + day,
    startT: day * 86400 + START_H * 3600,
    policy: adaptive ? policy : null,
    randomEmergencies: true,
    overspeed: false,
    keepSeries: false,
    settings: { adaptive, randomIncidents: true, demand: 0.85 + rng() * 0.3, forecastRouting: false },
  });
  const plan = weatherPlan();
  const scores: number[][] = [];
  const samples: { minute: number; rows: number[][] }[] = [];
  const endT = day * 86400 + END_H * 3600;
  while (sim.t < endT) {
    sim.run(60);
    const minuteOfDay = Math.floor((sim.t % 86400) / 60);
    const w = plan.find((p) => minuteOfDay >= p.fromMin && minuteOfDay < p.toMin)?.weather ?? 'clear';
    if (sim.settings.weather !== w) sim.setWeather(w);
    if (minuteOfDay < RECORD_FROM_H * 60) continue;
    scores.push(sim.linkScores());
    const idx = scores.length - 1;
    if (idx >= 15 && idx % SAMPLE_EVERY_MIN === 0) {
      const ids = recorded.filter(() => rng() < KEEP_SHARE);
      samples.push({ minute: idx, rows: ids.map((id) => [id, ...sim.linkFeatures(id)]) });
    }
  }
  let rows = 0;
  for (const s of samples) {
    if (s.minute + 30 >= scores.length) continue;
    const ahead = (link: number, horizon: number) => {
      let sum = 0;
      for (let k = horizon - TARGET_WINDOW_MIN + 1; k <= horizon; k++) sum += scores[s.minute + k][link];
      return sum / TARGET_WINDOW_MIN;
    };
    const lines: string[] = [];
    for (const [link, ...features] of s.rows) {
      lines.push([day, s.minute, link, ...features.map((v) => +v.toFixed(5)), ahead(link, 15).toFixed(5), ahead(link, 30).toFixed(5)].join(','));
    }
    out.write(lines.join('\n') + '\n');
    rows += lines.length;
  }
  totalRows += rows;
  console.log(`day ${day + 1}/${DAYS} (${adaptive ? 'adaptive' : 'fixed'}, weather spells ${plan.length}) -> ${rows} rows`);
}
out.end();
console.log(`Wrote ${totalRows} rows in ${Math.round((Date.now() - started) / 1000)} s`);
