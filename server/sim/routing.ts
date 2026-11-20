import type { NetLink, VehicleClass } from '../../shared/types';
import type { Network } from './network';

export interface LinkTime {
  run: number;
  wait: number;
}

export interface RouteContext {
  net: Network;
  linkTime: (linkId: number, offsetS: number) => LinkTime;
  closed: (linkId: number) => boolean;
  cargoRestricted: boolean;
}

export interface RouteOptions {
  cls: VehicleClass;
  weightT?: number;
  priority?: boolean;
}

export interface PathResult {
  links: number[];
  costS: number;
}

export function linkAllowed(
  link: NetLink,
  cls: VehicleClass,
  weightT: number,
  cargoRestricted: boolean,
): boolean {
  if (cls !== 'cargo') return true;
  if (link.kind === 'lane') return false;
  if (link.maxWeight !== null && weightT > link.maxWeight) return false;
  if (cargoRestricted && link.core) return false;
  return true;
}

export function linkCost(link: NetLink, time: LinkTime, opts: RouteOptions): number {
  let run = time.run;
  let wait = time.wait;
  switch (opts.cls) {
    case 'cargo':
      if (link.kind === 'ring') run *= 0.72;
      if (link.core) run *= 1.25;
      break;
    case 'two_wheeler':
      wait *= 0.55;
      if (link.kind === 'lane') run *= 0.8;
      break;
    case 'private':
      if (link.kind === 'lane') run *= 1.35;
      break;
    case 'emergency':
      break;
  }
  if (opts.priority) wait *= 0.15;
  return run + wait;
}

export function shortestPath(ctx: RouteContext, from: number, to: number, opts: RouteOptions): PathResult | null {
  if (from === to) return null;
  const { net } = ctx;
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevLink = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const weightT = opts.weightT ?? 0;
  dist[from] = 0;
  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === to) break;
    done[u] = 1;
    for (const lid of net.outLinks[u]) {
      const link = net.links[lid];
      if (done[link.to]) continue;
      if (!opts.priority && ctx.closed(lid)) continue;
      if (!linkAllowed(link, opts.cls, weightT, ctx.cargoRestricted)) continue;
      const cost = linkCost(link, ctx.linkTime(lid, dist[u]), opts);
      const nd = dist[u] + cost;
      if (nd < dist[link.to]) {
        dist[link.to] = nd;
        prevLink[link.to] = lid;
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const links: number[] = [];
  let cur = to;
  while (cur !== from) {
    const lid = prevLink[cur];
    links.push(lid);
    cur = net.links[lid].from;
  }
  links.reverse();
  return { links, costS: dist[to] };
}

export function routeNodes(net: Network, links: number[]): number[] {
  if (!links.length) return [];
  return [net.links[links[0]].from, ...links.map((l) => net.links[l].to)];
}
