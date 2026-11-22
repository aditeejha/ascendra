import { describe, expect, it } from 'vitest';
import { VEHICLE_FLAG } from '../shared/types';
import { clockOf, dayIndex, liveSimTime } from '../server/sim/demand';
import { MIN_GREEN, Simulation } from '../server/sim/engine';
import { buildScenarios, incidentLinks } from '../server/sim/evaluation';
import { loadPolicy } from '../server/sim/models';
import { buildNetwork, distanceM } from '../server/sim/network';

const net = buildNetwork();

describe('simulation engine', () => {
  it('is deterministic for a given seed', () => {
    const a = new Simulation(net, { seed: 11, startT: 8 * 3600 });
    const b = new Simulation(net, { seed: 11, startT: 8 * 3600 });
    a.run(900);
    b.run(900);
    expect(a.kpis()).toEqual(b.kpis());
  });

  it('only signalises junctions that have a signal, and never skips yellow or all-red', () => {
    const sim = new Simulation(net, { seed: 3, startT: 8 * 3600, policy: loadPolicy() });
    sim.run(120);
    const signalled = new Set(net.nodes.filter((n) => n.signal).map((n) => n.id));
    expect(sim.snapshot().signals.every(([node]) => signalled.has(node))).toBe(true);
    const last = new Map<number, { phase: number; state: number; since: number }>();
    for (let t = 0; t < 1200; t++) {
      sim.step();
      for (const [node, phase, state] of sim.snapshot().signals) {
        const prev = last.get(node);
        if (prev && (prev.phase !== phase || prev.state !== state)) {
          if (prev.state === 0) {
            expect(state).toBe(1);
            expect(phase).toBe(prev.phase);
            if (!Number.isNaN(prev.since)) expect(t - prev.since).toBeGreaterThanOrEqual(5);
          }
          if (prev.state === 1) expect(state).toBe(2);
          if (prev.state === 2) {
            expect(state).toBe(0);
            expect(phase).not.toBe(prev.phase);
          }
        }
        if (!prev) last.set(node, { phase, state, since: Number.NaN });
        else if (prev.phase !== phase || prev.state !== state) last.set(node, { phase, state, since: t });
      }
    }
    expect(MIN_GREEN).toBeGreaterThanOrEqual(10);
  });

  it('gives a dispatched ambulance from a real hospital a green wave and delivers it', () => {
    const sim = new Simulation(net, { seed: 5, startT: 8 * 3600, randomEmergencies: false });
    sim.run(600);
    const from = net.stations[0];
    const to = net.nodes
      .filter((n) => distanceM(net, from, n.id) > 1500 && distanceM(net, from, n.id) < 3000)
      .map((n) => n.id)
      .find((id) => sim.planRoute(from, id, 'emergency').signals > 0)!;
    let arrived: { actualS: number; preempted: number } | null = null;
    sim.onEmergencyArrival((a) => {
      arrived = a;
    });
    const result = sim.dispatchEmergency({ plate: 'JH 15 AM 1081', label: 'Ambulance', from, to, dispatchId: 1 });
    expect(result).not.toBeNull();
    expect(result!.plan.feasible).toBe(true);
    for (let i = 0; i < 1500 && !arrived; i++) sim.step();
    expect(arrived).not.toBeNull();
    expect(arrived!.preempted).toBeGreaterThan(0);
  });

  it('closes inbound links and opens contraflow in evacuation mode', () => {
    const sim = new Simulation(net, { seed: 9, startT: 8 * 3600 });
    sim.run(300);
    const centre = net.nodes.find((n) => n.signal)!.id;
    const status = sim.activateEvacuation(centre, 0.5);
    expect(status.zoneNodes.length).toBeGreaterThan(1);
    expect(status.zoneNodes.every((id) => distanceM(net, centre, id) <= 500)).toBe(true);
    expect(status.closedLinks.length).toBeGreaterThan(0);
    expect(status.contraflowLinks.length).toBeGreaterThan(0);
    const flags = sim.snapshot().linkFlags;
    for (const lid of status.closedLinks) expect(flags[lid] & 2).toBe(2);
    sim.deactivateEvacuation();
    expect(sim.snapshot().evacuation).toBeNull();
  });

  it('cuts delay compared with fixed-time control at peak', () => {
    const run = (adaptive: boolean) => {
      const sim = new Simulation(net, { seed: 21, startT: 7.5 * 3600, policy: adaptive ? loadPolicy() : null, settings: { adaptive, randomIncidents: false } });
      sim.run(1800);
      sim.resetStats();
      sim.run(1800);
      return sim.stats.delaySum / sim.stats.trips;
    };
    expect(run(true)).toBeLessThan(run(false));
  });

  it('lets buses and trucks through short connector roads, so the morning peak never locks up', () => {
    const sim = new Simulation(net, { seed: 1, startT: 7.5 * 3600, policy: loadPolicy(), settings: { randomIncidents: false } });
    sim.run(1800);
    const halfway = sim.kpis().activeVehicles;
    sim.run(1800);
    const snap = sim.snapshot();
    const queued = snap.vehicles.filter(([, , , , flags]) => flags & VEHICLE_FLAG.queued).length;
    expect(snap.kpis.activeVehicles).toBeLessThan(halfway * 1.25);
    expect(queued / snap.vehicles.length).toBeLessThan(0.25);
  });

  it('stages the evaluation accidents on busy two-lane main roads, where losing a lane matters', () => {
    const ids = incidentLinks(net);
    expect(ids).toHaveLength(2);
    const links = ids.map((id) => net.links[id]);
    expect(new Set(links.map((l) => l.road)).size).toBe(2);
    for (const l of links) {
      expect(['highway', 'arterial']).toContain(l.kind);
      expect(l.road).not.toMatch(/Unnamed road|Residential lane/);
      expect(l.lanes).toBeGreaterThanOrEqual(2);
      expect(net.nodes[l.to].signal).not.toBeNull();
    }
    const accident = buildScenarios(net).find((s) => s.key === 'accident')!;
    expect(accident.incidents).toEqual(ids);
    for (const l of links) expect(accident.description).toContain(l.road);
  });

  it('maps real local time onto the simulated week', () => {
    const t = liveSimTime('Asia/Kolkata', new Date('2026-11-23T03:00:00Z'));
    expect(dayIndex(t)).toBe(0);
    expect(clockOf(t)).toBe('08:30');
  });
});
