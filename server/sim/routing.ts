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

export function linkAllowed(link: NetLink, cls: VehicleClass, weightT: number, cargoRestricted: boolean): boolean {
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
      if (link.kind === 'highway') run *= 0.72;
      if (link.core) run *= 1.25;
      wait *= 1.8;
      break;
    case 'bus':
      if (link.kind === 'highway' || link.kind === 'arterial') run *= 0.85;
      if (link.kind === 'street') run *= 1.15;
      if (link.kind === 'lane') run *= 4;
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

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

export function shortestPath(ctx: RouteContext, from: number, to: number, opts: RouteOptions): PathResult | null {
  if (from === to) return null;
  const { net } = ctx;
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prevLink = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const weightT = opts.weightT ?? 0;
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const lid of net.outLinks[u]) {
      const link = net.links[lid];
      if (done[link.to]) continue;
      if (!opts.priority && ctx.closed(lid)) continue;
      if (!linkAllowed(link, opts.cls, weightT, ctx.cargoRestricted)) continue;
      const nd = d + linkCost(link, ctx.linkTime(lid, d), opts);
      if (nd < dist[link.to]) {
        dist[link.to] = nd;
        prevLink[link.to] = lid;
        heap.push(nd, link.to);
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
