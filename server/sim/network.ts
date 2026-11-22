import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NetworkInfo } from '../../shared/types';
import { cityConfig, citySlug, DATA_DIR } from '../config';
import { buildFromExtract, haversine, type OsmExtract } from './osm';

export interface Network extends NetworkInfo {
  inLinks: number[][];
  outLinks: number[][];
  linkBetween: Map<string, number>;
  weights: { home: number[]; work: number[]; cargo: number[] };
  stations: number[];
}

let cached: Network | null = null;

export function extractPath(): string {
  return path.join(DATA_DIR, `${citySlug()}-osm.json`);
}

export function buildNetwork(): Network {
  if (cached) return cached;
  const file = extractPath();
  if (!existsSync(file)) throw new Error(`No map data for ${cityConfig().city}. Run "npm run fetch:city" to download it from OpenStreetMap.`);
  const built = buildFromExtract(JSON.parse(readFileSync(file, 'utf8')) as OsmExtract, cityConfig());
  const inLinks: number[][] = built.nodes.map(() => []);
  const outLinks: number[][] = built.nodes.map(() => []);
  const linkBetween = new Map<string, number>();
  for (const link of built.links) {
    inLinks[link.to].push(link.id);
    outLinks[link.from].push(link.id);
    if (!linkBetween.has(`${link.from}-${link.to}`)) linkBetween.set(`${link.from}-${link.to}`, link.id);
  }
  cached = {
    nodes: built.nodes,
    links: built.links,
    width: built.meta.width,
    height: built.meta.height,
    exits: built.nodes.filter((n) => n.exit).map((n) => n.id),
    meta: built.meta,
    inLinks,
    outLinks,
    linkBetween,
    weights: built.weights,
    stations: built.stations,
  };
  return cached;
}

export function publicNetwork(net: Network): NetworkInfo {
  return { nodes: net.nodes, links: net.links, width: net.width, height: net.height, exits: net.exits, meta: net.meta };
}

export function distanceM(net: Network, a: number, b: number): number {
  const p = net.nodes[a];
  const q = net.nodes[b];
  return haversine(p.lat, p.lon, q.lat, q.lon);
}

export function segmentKey(net: Network, linkId: number): number {
  const l = net.links[linkId];
  return l.reverse >= 0 ? Math.min(l.id, l.reverse) : l.id;
}

export function hopDistances(net: Network, start: number): number[] {
  const dist = net.nodes.map(() => Infinity);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const n = queue[head];
    for (const l of net.outLinks[n]) {
      const m = net.links[l].to;
      if (dist[m] === Infinity) {
        dist[m] = dist[n] + 1;
        queue.push(m);
      }
    }
  }
  return dist;
}
