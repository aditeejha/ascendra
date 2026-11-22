import { describe, expect, it } from 'vitest';
import { buildNetwork, distanceM } from '../server/sim/network';
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

const outsideCore = net.nodes.filter((n) => net.inLinks[n.id].every((l) => !net.links[l].core) && net.inLinks[n.id].some((l) => net.links[l].kind !== 'lane'));

describe('real road network', () => {
  it('is built from OpenStreetMap data with paired, drawable links', () => {
    expect(net.meta.source).toContain('OpenStreetMap');
    expect(net.nodes.length).toBeGreaterThan(200);
    expect(net.nodes.filter((n) => n.signal).length).toBeGreaterThan(5);
    expect(net.exits.length).toBeGreaterThanOrEqual(3);
    for (const link of net.links) {
      expect(link.geometry.length).toBeGreaterThanOrEqual(4);
      if (link.reverse >= 0) {
        const rev = net.links[link.reverse];
        expect(rev.from).toBe(link.to);
        expect(rev.to).toBe(link.from);
      }
    }
  });

  it('is strongly connected, so every junction can reach every other', () => {
    const picks = [0, Math.floor(net.nodes.length / 3), Math.floor((net.nodes.length * 2) / 3), net.nodes.length - 1];
    for (const a of picks) for (const b of picks) if (a !== b) expect(shortestPath(context(false), a, b, { cls: 'private' })).not.toBeNull();
  });
});

describe('class-aware routing', () => {
  it('keeps cargo off residential lanes and links below its weight', () => {
    const lane = net.links.find((l) => l.kind === 'lane')!;
    const limited = { ...net.links.find((l) => l.kind !== 'lane')!, maxWeight: 12 };
    expect(linkAllowed(lane, 'cargo', 3, false)).toBe(false);
    expect(linkAllowed(limited, 'cargo', 18, false)).toBe(false);
    expect(linkAllowed(limited, 'cargo', 9, false)).toBe(true);
    expect(linkAllowed(lane, 'two_wheeler', 0.2, true)).toBe(true);
    const route = shortestPath(context(false), net.exits[0], net.exits[1], { cls: 'cargo', weightT: 18 });
    expect(route).not.toBeNull();
    expect(route!.links.some((l) => net.links[l].kind === 'lane')).toBe(false);
  });

  it('routes cargo around the town centre during peak hours', () => {
    let pair: [number, number] | null = null;
    for (const a of outsideCore.slice(0, 60)) {
      for (const b of outsideCore.slice(-60)) {
        if (a.id === b.id || distanceM(net, a.id, b.id) < 1500) continue;
        const free = shortestPath(context(false), a.id, b.id, { cls: 'cargo', weightT: 18 });
        if (free?.links.some((l) => net.links[l].core)) {
          pair = [a.id, b.id];
          break;
        }
      }
      if (pair) break;
    }
    expect(pair).not.toBeNull();
    const free = shortestPath(context(false), pair![0], pair![1], { cls: 'cargo', weightT: 18 })!;
    const peak = shortestPath(context(true), pair![0], pair![1], { cls: 'cargo', weightT: 18 });
    expect(peak).not.toBeNull();
    expect(peak!.links.some((l) => net.links[l].core)).toBe(false);
    expect(peak!.costS).toBeGreaterThan(free.costS);
  });

  it('avoids closed links unless the vehicle has priority', () => {
    const from = net.nodes.find((n) => n.signal)!.id;
    const to = net.nodes.find((n) => n.id !== from && distanceM(net, from, n.id) > 1000)!.id;
    const direct = shortestPath(context(false), from, to, { cls: 'private' })!;
    const blocked = direct.links[Math.floor(direct.links.length / 2)];
    const closed = new Set([blocked]);
    const detour = shortestPath(context(false, closed), from, to, { cls: 'private' })!;
    expect(detour.links).not.toContain(blocked);
    const priority = shortestPath(context(false, closed), from, to, { cls: 'emergency', priority: true })!;
    expect(priority.links).toContain(blocked);
  });
});
