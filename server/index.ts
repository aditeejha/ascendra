import { existsSync } from 'node:fs';
import type { Response } from 'express';
import type { Counters } from '../shared/types';
import { createApp, type AppContext } from './app';
import { connectDb } from './db';
import { Repo } from './repo';
import { Simulation } from './sim/engine';
import { loadEvaluation, loadForecaster, loadPolicy } from './sim/models';
import { buildNetwork } from './sim/network';

if (existsSync('.env')) process.loadEnvFile('.env');

const PORT = Number(process.env.PORT ?? 4000);
const FRAME_MS = 250;

const net = buildNetwork();
const policy = loadPolicy();
const forecaster = loadForecaster();
const db = await connectDb();
const repo = new Repo(db);
await repo.seed();

const sim = new Simulation(net, {
  seed: Math.floor(Date.now() % 1e9),
  startT: 7 * 3600 + 30 * 60,
  policy,
  forecaster,
});
sim.run(45 * 60);

const counters: Counters = { openCivic: 0, openAlerts: 0, pendingVerification: 0 };
const ctx: AppContext = {
  net,
  sim,
  repo,
  policy,
  forecaster,
  evaluation: { result: loadEvaluation(), running: false, done: 0, total: 0 },
  civicIncidents: new Map(),
  counters,
  refreshCounters: async () => {
    Object.assign(counters, await repo.counters());
  },
  clients: new Set<Response>(),
};
await ctx.refreshCounters();

sim.onOverspeed((e) => {
  const link = net.links[e.linkId];
  sim.pushEvent('overspeed', 'Overspeeding detected', `${e.plate} at ${e.speedKmh} km/h on ${link.road} (limit ${e.limitKmh})`, 'warning');
  repo
    .createAlert({ plate: e.plate, vehicleClass: e.vehicleClass, speedKmh: e.speedKmh, limitKmh: e.limitKmh, linkId: e.linkId, simClock: e.clock })
    .then(() => ctx.refreshCounters())
    .catch((err) => console.error('Could not store overspeed alert', err));
});

sim.onEmergencyArrival((a) => {
  repo.finishDispatch(a.dispatchId, 'arrived', a.actualS, a.preempted).catch((err) => console.error('Could not close dispatch', err));
});

let carry = 0;
setInterval(() => {
  if (!sim.settings.paused) {
    carry += (sim.settings.speed * FRAME_MS) / 1000;
    while (carry >= 1) {
      sim.step();
      carry -= 1;
    }
  }
  if (!ctx.clients.size) return;
  const frame = `data: ${JSON.stringify({ ...sim.snapshot(), counters })}\n\n`;
  for (const client of ctx.clients) client.write(frame);
}, FRAME_MS);

createApp(ctx).listen(PORT, () => {
  console.log(`ASCENDRA API on http://localhost:${PORT}`);
  console.log(`  database: ${repo.mode === 'postgres' ? 'PostgreSQL' : 'in-memory PostgreSQL (set DATABASE_URL for a real server)'}`);
  console.log(`  forecaster: ${forecaster ? 'XGBoost model loaded' : 'not trained - run npm run train:forecaster'}`);
  console.log(`  signal policy: ${policy ? 'Q-learning policy loaded' : 'not trained - max-pressure fallback'}`);
  console.log(`  simulation clock: ${sim.clock}`);
});
