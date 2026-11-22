import { existsSync } from 'node:fs';
import type { Response } from 'express';
import { LINK_FLAG, type Counters, type LiveStatus, type SimSettings, type Snapshot } from '../shared/types';
import { applyCivicImpact, createApp, type AppContext } from './app';
import { cityConfig } from './config';
import { connectDb } from './db';
import { Replay } from './live/replay';
import { TomTomTraffic } from './live/tomtom';
import { LiveWeather } from './live/weather';
import { Repo } from './repo';
import { DAY_NAMES, clockOf, dayIndex, liveSimTime } from './sim/demand';
import { Simulation } from './sim/engine';
import { loadEvaluation, loadForecaster, loadJunctionModel, loadPolicy } from './sim/models';
import { buildNetwork } from './sim/network';

if (existsSync('.env')) process.loadEnvFile('.env');

const PORT = Number(process.env.PORT ?? 4000);
const FRAME_MS = 250;
const WARMUP_S = 45 * 60;
const config = cityConfig();
const net = buildNetwork();
const policy = loadPolicy();
const forecaster = loadForecaster();
const junctionModel = loadJunctionModel();
const db = await connectDb();
const repo = new Repo(db);

const hospitals = [...new Set(net.stations.map((id) => net.nodes[id].poi).filter((p) => p?.kind === 'hospital').map((p) => p!.name))];
const pickLink = (kinds: string[], core: boolean | null, skip: Set<string>) =>
  [...net.links]
    .filter((l) => kinds.includes(l.kind) && (core === null || l.core === core) && !skip.has(l.road) && l.road !== 'Unnamed road')
    .sort((a, b) => b.length - a.length)[0];
const used = new Set<string>();
const reportLinks: number[] = [];
for (const [kinds, core] of [
  [['arterial', 'highway'], true],
  [['street', 'arterial'], null],
  [['highway', 'arterial'], false],
] as [string[], boolean | null][]) {
  const l = pickLink(kinds, core, used);
  if (!l) continue;
  used.add(l.road);
  reportLinks.push(l.id);
}
await repo.seed({
  city: config.city,
  platePrefix: config.rules.platePrefix,
  outOfStatePlate: config.rules.outOfStatePlates[0] ?? config.rules.platePrefix,
  hospitals,
  reportLinks,
});

const counters: Counters = { openCivic: 0, openAlerts: 0, pendingVerification: 0 };

function attach(sim: Simulation): Simulation {
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
  return sim;
}

function createSim(settings: Partial<SimSettings>, startT?: number, prepare?: (sim: Simulation) => void): Simulation {
  const target = startT ?? liveSimTime(config.timezone);
  const sim = new Simulation(net, { seed: Math.floor(Date.now() % 1e9), startT: target - WARMUP_S, policy, forecaster, junctionModel, settings });
  prepare?.(sim);
  sim.run(WARMUP_S);
  if (startT === undefined) {
    const caught = liveSimTime(config.timezone);
    if (sim.t < caught) sim.run(caught - sim.t);
  }
  return attach(sim);
}

const replay = new Replay(() => junctionModel);

const tomtomKey = process.env.TOMTOM_API_KEY?.trim() || undefined;
const startSettings: Partial<SimSettings> = { liveClock: true, liveWeather: true, speed: 1, randomIncidents: !tomtomKey };
let weather: LiveWeather;
let traffic: TomTomTraffic;

async function reapplyCivic(): Promise<void> {
  ctx.civicIncidents.clear();
  for (const r of await repo.listCivic()) {
    if (r.impactApplied && (r.status === 'verified' || r.status === 'in_progress')) applyCivicImpact(ctx, r);
  }
}

function localNow(): { time: string; day: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { time: `${parts.hour}:${parts.minute}`, day: parts.weekday };
}

const ctx: AppContext = {
  net,
  sim: createSim(startSettings),
  repo,
  policy,
  forecaster,
  junctionModel,
  evaluation: { result: loadEvaluation(), running: false, done: 0, total: 0 },
  civicIncidents: new Map(),
  counters,
  refreshCounters: async () => {
    Object.assign(counters, await repo.counters());
  },
  clients: new Set<Response>(),
  frame: (): Snapshot => {
    const snap = ctx.sim.snapshot();
    for (const id of traffic.measuredLinks(config.live.tomtom.flowIntervalMin * 2 * 60_000)) snap.linkFlags[id] |= LINK_FLAG.measured;
    for (const id of traffic.liveIncidentLinks()) snap.linkFlags[id] |= LINK_FLAG.liveIncident;
    return { ...snap, counters };
  },
  liveStatus: (): LiveStatus => {
    const local = localNow();
    return {
      city: { name: config.city, region: config.region, country: config.country, timezone: config.timezone, localTime: local.time, localDay: local.day },
      clock: { mode: replay.running || ctx.sim.demandOverridden ? 'replay' : ctx.sim.settings.liveClock ? 'live' : 'fast', simClock: clockOf(ctx.sim.t), simDay: DAY_NAMES[dayIndex(ctx.sim.t)] },
      network: {
        source: net.meta.source,
        via: net.meta.via,
        fetchedAt: net.meta.fetchedAt,
        nodes: net.nodes.length,
        links: net.links.length,
        signalsOsm: net.nodes.filter((n) => n.signal === 'osm').length,
        signalsInferred: net.nodes.filter((n) => n.signal === 'inferred').length,
      },
      weather: { source: 'Open-Meteo', mode: ctx.sim.settings.liveWeather ? 'live' : 'manual', reading: weather.reading, error: weather.error },
      traffic: {
        provider: 'TomTom Traffic',
        configured: traffic.configured,
        status: traffic.status,
        error: traffic.error,
        requestsToday: traffic.requestsToday,
        dailyBudget: config.live.tomtom.dailyBudget,
        lastFlowAt: traffic.lastFlowAt,
        lastIncidentsAt: traffic.lastIncidentsAt,
        samples: traffic.sampleList,
        incidents: traffic.incidents,
        calibration: Math.round(ctx.sim.demandCalibration * 100) / 100,
        accuracy: traffic.accuracy,
      },
    };
  },
  replay,
  startReplay: async (speed: number) => {
    replay.start(speed);
    const settings = { ...ctx.sim.settings, liveClock: false, speed, paused: false };
    ctx.sim = createSim(settings, replay.startT(), (sim) => {
      replay.apply(sim);
    });
    replay.rowStartT = ctx.sim.t;
    await reapplyCivic();
    traffic.reapply();
    ctx.sim.pushEvent('system', 'Dataset replay started', `${replay.name}: row ${replay.index + 1} of ${replay.rows.length} at ${speed}× speed`, 'info');
  },
  stopReplay: async () => {
    replay.stop();
    ctx.sim.setDemandOverride(null);
    await ctx.resync();
  },
  resync: async () => {
    const calibration = ctx.sim.demandCalibration;
    ctx.sim = createSim({ ...ctx.sim.settings, liveClock: true });
    ctx.sim.setCalibration(calibration);
    await reapplyCivic();
    traffic.reapply();
    ctx.applyLiveWeather();
    ctx.sim.pushEvent('system', 'Clock synced to live time', `${config.city} is running on ${config.timezone} time again`, 'info');
  },
  applyLiveWeather: () => {
    const r = weather.reading;
    if (!r || !ctx.sim.settings.liveWeather || ctx.sim.settings.weather === r.condition) return;
    ctx.sim.setWeather(r.condition);
    ctx.sim.pushEvent('system', 'Live weather update', `${r.description}, ${r.temperatureC.toFixed(1)}°C (Open-Meteo)`, 'info');
  },
};

weather = new LiveWeather(net.meta.centre.lat, net.meta.centre.lon, config.live.weatherIntervalMin, () => ctx.applyLiveWeather());
traffic = new TomTomTraffic(net, () => ctx.sim, { key: tomtomKey, timezone: config.timezone, ...config.live.tomtom });
weather.start();
traffic.start();
await reapplyCivic();
await ctx.refreshCounters();

let carry = 0;
let resyncing = false;
setInterval(() => {
  const sim = ctx.sim;
  if (!sim.settings.paused) {
    if (sim.settings.liveClock) {
      const behind = liveSimTime(config.timezone) - sim.t;
      if (behind > 900) {
        if (!resyncing) {
          resyncing = true;
          ctx.resync().finally(() => {
            resyncing = false;
          });
        }
      } else {
        for (let i = 0; i < Math.min(behind, 20); i++) sim.step();
      }
    } else {
      carry += (sim.settings.speed * FRAME_MS) / 1000;
      while (carry >= 1) {
        sim.step();
        carry -= 1;
        if (replay.running && replay.advance(sim)) {
          sim.settings.paused = true;
          sim.pushEvent('system', 'Dataset replay finished', `${replay.name}: all ${replay.rows.length} rows played`, 'info');
          break;
        }
      }
    }
  }
  if (!ctx.clients.size) return;
  const frame = `data: ${JSON.stringify(ctx.frame())}\n\n`;
  for (const client of ctx.clients) client.write(frame);
}, FRAME_MS);

createApp(ctx).listen(PORT, () => {
  const local = localNow();
  console.log(`ASCENDRA API on http://localhost:${PORT}`);
  console.log(`  city: ${config.city}, ${config.region} · ${local.day} ${local.time} (${config.timezone})`);
  console.log(`  road network: ${net.nodes.length} junctions, ${net.links.length} links from ${net.meta.source} (${net.meta.fetchedAt.slice(0, 10)})`);
  console.log(`  database: ${repo.mode === 'postgres' ? 'PostgreSQL' : 'in-memory PostgreSQL (set DATABASE_URL for a real server)'}`);
  console.log(`  weather: live from Open-Meteo`);
  console.log(`  traffic: ${tomtomKey ? 'live from TomTom' : 'simulated (add TOMTOM_API_KEY to .env for live speeds and incidents)'}`);
  console.log(`  forecaster: ${forecaster ? 'XGBoost model loaded' : 'not trained - run npm run train:forecaster'}`);
  console.log(`  signal policy: ${policy ? 'Q-learning policy loaded' : 'not trained - max-pressure fallback'}`);
  console.log(`  junction model: ${junctionModel ? 'XGBoost trained on the Kaggle Traffic Prediction Dataset' : 'not trained - run npm run train:junction'}`);
});
