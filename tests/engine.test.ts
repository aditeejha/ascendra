import { describe, expect, it } from 'vitest';
import { MIN_GREEN, Simulation } from '../server/sim/engine';
import { loadPolicy } from '../server/sim/models';
import { buildNetwork, nodeId } from '../server/sim/network';

const net = buildNetwork();

describe('simulation engine', () => {
  it('is deterministic for a given seed', () => {
    const a = new Simulation(net, { seed: 11, startT: 8 * 3600 });
    const b = new Simulation(net, { seed: 11, startT: 8 * 3600 });
    a.run(900);
    b.run(900);
    expect(a.kpis()).toEqual(b.kpis());
  });

  it('never skips the yellow and all-red intervals and respects minimum greens', () => {
    const sim = new Simulation(net, { seed: 3, startT: 8 * 3600, policy: loadPolicy() });
    sim.run(120);
    const last = new Map<number, { phase: number; state: number; since: number }>();
    for (let t = 0; t < 1800; t++) {
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

  it('gives a dispatched ambulance a green wave and delivers it', () => {
    const sim = new Simulation(net, { seed: 5, startT: 8 * 3600, randomEmergencies: false });
    sim.run(600);
    let arrived: { actualS: number; preempted: number } | null = null;
    sim.onEmergencyArrival((a) => {
      arrived = a;
    });
    const result = sim.dispatchEmergency({ plate: 'JH 15 AM 1081', label: 'Ambulance', from: nodeId(3, 3), to: nodeId(0, 6), dispatchId: 1 });
    expect(result).not.toBeNull();
    expect(result!.plan.feasible).toBe(true);
    for (let i = 0; i < 900 && !arrived; i++) sim.step();
    expect(arrived).not.toBeNull();
    expect(arrived!.preempted).toBeGreaterThan(0);
  });

  it('closes inbound links and opens contraflow in evacuation mode', () => {
    const sim = new Simulation(net, { seed: 9, startT: 8 * 3600 });
    sim.run(300);
    const status = sim.activateEvacuation(nodeId(2, 3), 1);
    expect(status.zoneNodes).toHaveLength(5);
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
});
