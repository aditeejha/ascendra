import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { datasetFeatures, parseTrafficCsv, predictionReport, predictionsCsv, predictRows, Replay } from '../server/live/replay';
import { Simulation } from '../server/sim/engine';
import { loadJunctionModel } from '../server/sim/models';
import { buildNetwork, distanceM } from '../server/sim/network';
import { linkCost, shortestPath, type RouteContext } from '../server/sim/routing';

const net = buildNetwork();
const context: RouteContext = {
  net,
  cargoRestricted: false,
  closed: () => false,
  linkTime: (lid) => ({ run: net.links[lid].length / (net.links[lid].speedLimit / 3.6), wait: 10 }),
};

describe('class-wise routing', () => {
  it('keeps buses on main roads, using lanes far less than two-wheelers do', () => {
    const mainNodes = net.nodes.filter((n) => net.inLinks[n.id].length && net.inLinks[n.id].every((l) => net.links[l].kind !== 'lane'));
    const laneMetres = (links: number[]) => links.filter((l) => net.links[l].kind === 'lane').reduce((a, l) => a + net.links[l].length, 0);
    let busLanes = 0;
    let bikeLanes = 0;
    let pairs = 0;
    for (let i = 0; i < 12; i++) {
      const from = mainNodes[(i * 37) % mainNodes.length].id;
      const to = mainNodes.find((n) => distanceM(net, from, n.id) > 1500 + i * 50)?.id;
      if (to === undefined) continue;
      const bus = shortestPath(context, from, to, { cls: 'bus' });
      const bike = shortestPath(context, from, to, { cls: 'two_wheeler' });
      expect(bus).not.toBeNull();
      busLanes += laneMetres(bus!.links);
      bikeLanes += laneMetres(bike!.links);
      pairs++;
    }
    expect(pairs).toBeGreaterThan(5);
    expect(busLanes).toBeLessThanOrEqual(bikeLanes);
    const sim = new Simulation(net, { seed: 2, startT: 9 * 3600 });
    expect(sim.planRoute(mainNodes[0].id, mainNodes[mainNodes.length - 1].id, 'bus').notes.join(' ')).toMatch(/public transport/i);
  });

  it('sends a truck to the nearest legal drop point when the destination is inside residential lanes', () => {
    const sim = new Simulation(net, { seed: 2, startT: 13 * 3600 });
    const laneOnly = net.nodes.find((n) => net.inLinks[n.id].length > 0 && net.inLinks[n.id].every((l) => net.links[l].kind === 'lane') && distanceM(net, net.exits[0], n.id) > 1000)!;
    const plan = sim.planRoute(net.exits[0], laneOnly.id, 'cargo', 18);
    expect(plan.feasible).toBe(true);
    expect(plan.links.some((l) => net.links[l].kind === 'lane')).toBe(false);
    expect(plan.notes.join(' ')).toMatch(/only reachable by residential lanes/);
  });

  it('makes trucks weigh queues more heavily than cars, so they take the least congested road', () => {
    const link = net.links.find((l) => l.kind === 'arterial')!;
    const calm = { run: 30, wait: 10 };
    const queued = { run: 30, wait: 60 };
    const carPenalty = linkCost(link, queued, { cls: 'private' }) - linkCost(link, calm, { cls: 'private' });
    const truckPenalty = linkCost(link, queued, { cls: 'cargo', weightT: 18 }) - linkCost(link, calm, { cls: 'cargo', weightT: 18 });
    expect(truckPenalty).toBeGreaterThan(carPenalty * 1.5);
  });
});

describe('disaster evacuation', () => {
  const bridge = net.links.find((l) => l.bridge);

  it('closes nearby bridges and slows lanes in an earthquake', () => {
    expect(bridge).toBeDefined();
    const sim = new Simulation(net, { seed: 4, startT: 10 * 3600 });
    sim.run(120);
    const status = sim.activateEvacuation(bridge!.from, 0.5, 'earthquake');
    expect(status.kind).toBe('earthquake');
    expect(status.bridgesClosed).toContain(bridge!.id);
    expect(status.slowedLinks).toBeGreaterThan(0);
    expect(sim.snapshot().linkFlags[bridge!.id] & 2).toBe(2);
  });

  it('slows every road in a flood zone and leaves bridges alone in a generic evacuation', () => {
    const sim = new Simulation(net, { seed: 4, startT: 10 * 3600 });
    const flood = sim.activateEvacuation(bridge!.from, 0.5, 'flood');
    const zoneLinks = net.links.filter((l) => flood.zoneNodes.includes(l.from) || flood.zoneNodes.includes(l.to)).length;
    expect(flood.slowedLinks).toBe(zoneLinks);
    const other = sim.activateEvacuation(bridge!.from, 0.5, 'other');
    expect(other.bridgesClosed).toHaveLength(0);
    expect(other.slowedLinks).toBe(0);
  });
});

describe('dataset replay', () => {
  it('parses the Kaggle traffic format', () => {
    const csv = [
      'Time,Date,Day of the week,CarCount,BikeCount,BusCount,TruckCount,Total,Traffic Situation',
      '8:00:00 AM,10,Tuesday,90,20,15,10,135,high',
      '8:15:00 AM,10,Tuesday,110,25,18,12,165,heavy',
      '12:00:00 AM,11,Wednesday,10,1,0,4,15,low',
    ].join('\n');
    const { rows, warnings } = parseTrafficCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ minute: 480, dow: 1, car: 90, bike: 20, bus: 15, truck: 10, total: 135, situation: 'high' });
    expect(rows[2]).toMatchObject({ minute: 0, dow: 2, situation: 'low' });
    expect(warnings).toHaveLength(0);
  });

  it('accepts a minimal timestamp + total file and explains its assumptions', () => {
    const { rows, warnings } = parseTrafficCsv('timestamp,vehicles\n2026-11-23 07:45,120\n2026-11-23 08:00,140\n');
    expect(rows.map((r) => r.minute)).toEqual([465, 480]);
    expect(rows[0].car + rows[0].bike + rows[0].bus + rows[0].truck).toBe(120);
    expect(warnings.length).toBeGreaterThan(0);
    expect(() => parseTrafficCsv('a,b\n1,2\n3,4')).toThrow(/time column/i);
  });

  it('predicts every row of an uploaded dataset and lines each forecast up with what came next', async () => {
    const model = loadJunctionModel()!;
    const lines = Array.from({ length: 12 }, (_, i) => {
      const time = `${8 + Math.floor(i / 4)}:${String((i % 4) * 15).padStart(2, '0')}:00 AM`;
      return `${time},Monday,${60 + i * 5},${20 + i},5,8,${93 + i * 6},${i < 6 ? 'normal' : 'heavy'}`;
    });
    const csv = ['Time,Day of the week,CarCount,BikeCount,BusCount,TruckCount,Total,Traffic Situation', ...lines].join('\n');
    const { rows } = parseTrafficCsv(csv);
    const predicted = await predictRows(model, rows);
    expect(predicted).toHaveLength(12);
    expect(predicted[0].count15).toBe(Math.round(model.count(15, datasetFeatures(rows, 0))));
    expect(predicted[3]).toMatchObject({ row: 4, dayNumber: 1, weekday: 'Monday', clock: '08:45', actual15: rows[4].total, actual30: rows[5].total, label15: 'normal' });
    expect(predicted[11]).toMatchObject({ actual15: null, actual30: null, label15: null, label30: null });

    const report = predictionReport('test.csv', predicted, 10, 5);
    expect(report.count15!.n).toBe(11);
    expect(report.count30!.n).toBe(10);
    expect(report.situationNow!.n).toBe(12);
    expect(report.situation15!.accuracyPersistence).toBe(0.909);
    expect(report.page.rows.map((r) => r.row)).toEqual([11, 12]);
    expect(report.chart).toHaveLength(12);

    const out = predictionsCsv(predicted).trim().split('\n');
    expect(out).toHaveLength(13);
    expect(out[0].split(',')).toContain('predicted_total_15min');
    expect(out[12].split(',')[11]).toBe('');

    const replay = new Replay(() => model);
    replay.load('a.csv', csv);
    const first = replay.predictAll();
    expect(replay.predictAll()).toBe(first);
    replay.load('b.csv', csv);
    expect(replay.predictAll()).not.toBe(first);
    expect(new Replay(() => null).predictAll()).toBeNull();
  });

  it.runIf(existsSync('ml/data/kaggle-traffic/TrafficTwoMonth.csv'))('drives the simulation from the dataset and scores the forecasts', () => {
    const replay = new Replay(() => loadJunctionModel());
    const summary = replay.load('kaggle', readFileSync('ml/data/kaggle-traffic/TrafficTwoMonth.csv', 'utf8'));
    expect(summary.rows).toBe(5952);
    expect(summary.meanTotal).toBe(109);
    expect(summary.maxTotal).toBe(279);
    expect(summary.hasLabels).toBe(true);
    replay.start(64);
    const sim = new Simulation(net, { seed: 8, startT: replay.startT(), settings: { liveClock: false } });
    replay.rowStartT = sim.t;
    replay.apply(sim);
    expect(sim.demandOverridden).toBe(true);
    for (let i = 0; i < 900 * 4; i++) {
      sim.step();
      replay.advance(sim);
    }
    const status = replay.status();
    expect(status.index).toBe(4);
    expect(status.history.length).toBe(5);
    expect(status.accuracy.n).toBeGreaterThan(0);
    expect(status.next).not.toBeNull();
  });
});
