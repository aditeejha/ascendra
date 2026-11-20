import { describe, expect, it } from 'vitest';
import { buildNetwork, nodeId } from '../server/sim/network';
import { linkAllowed, shortestPath, type RouteContext } from '../server/sim/routing';

const net = buildNetwork();

function context(cargoRestricted: boolean, closed = new Set<number>()): RouteContext {
  return {
    net,
    cargoRestricted,
    closed: (lid) => closed.has(lid),
    linkTime: (lid) => ({ run: net.links[lid].length / (net.links[lid].speedLimit / 3.6), wait: 10 }),
  };
}

describe('network', () => {
  it('builds a 5 x 7 grid with paired directed links', () => {
    expect(net.nodes).toHaveLength(35);
    expect(net.links).toHaveLength(116);
    for (const link of net.links) {
      const rev = net.links[link.reverse];
      expect(rev.from).toBe(link.to);
      expect(rev.to).toBe(link.from);
    }
  });
});

describe('class-aware routing', () => {
  it('keeps cargo off narrow lanes and links below its weight', () => {
    const lane = net.links.find((l) => l.kind === 'lane')!;
    const bridge = net.links.find((l) => l.maxWeight === 12)!;
    expect(linkAllowed(lane, 'cargo', 3, false)).toBe(false);
    expect(linkAllowed(bridge, 'cargo', 18, false)).toBe(false);
    expect(linkAllowed(bridge, 'cargo', 9, false)).toBe(true);
    expect(linkAllowed(lane, 'two_wheeler', 0.2, true)).toBe(true);
  });

  it('routes cargo around the commuter core during peak hours', () => {
    const from = nodeId(2, 0);
    const to = nodeId(2, 6);
    const free = shortestPath(context(false), from, to, { cls: 'cargo', weightT: 18 })!;
    const peak = shortestPath(context(true), from, to, { cls: 'cargo', weightT: 18 })!;
    expect(free.links.some((l) => net.links[l].core)).toBe(true);
    expect(peak.links.some((l) => net.links[l].core)).toBe(false);
    expect(peak.costS).toBeGreaterThan(free.costS);
  });

  it('avoids closed links unless the vehicle has priority', () => {
    const from = nodeId(2, 2);
    const to = nodeId(2, 4);
    const direct = shortestPath(context(false), from, to, { cls: 'private' })!;
    const closed = new Set([direct.links[0]]);
    const detour = shortestPath(context(false, closed), from, to, { cls: 'private' })!;
    expect(detour.links).not.toContain(direct.links[0]);
    const priority = shortestPath(context(false, closed), from, to, { cls: 'emergency', priority: true })!;
    expect(priority.links).toContain(direct.links[0]);
  });
});
