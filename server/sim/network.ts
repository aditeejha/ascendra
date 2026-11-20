import type { Dir, LinkKind, NetLink, NetNode, NetworkInfo, Phase, Poi } from '../../shared/types';

export const ROWS = 5;
export const COLS = 7;
const X0 = 90;
const Y0 = 80;
const DX = 150;
const DY = 125;
const METERS_PER_UNIT = 3;

const ROW_ROADS = ['Ring Road North', 'Station Road', 'MG Road', 'Hospital Road', 'Ring Road South'];
const COL_ROADS = [
  'Ring Road West',
  'College Road',
  'Park Street',
  'Clock Tower Road',
  'Church Road',
  'Court Road',
  'Ring Road East',
];

const POIS: Record<string, Poi> = {
  '1,1': { kind: 'hospital', name: 'Medical College Hospital' },
  '3,3': { kind: 'hospital', name: 'Sadar Hospital' },
  '2,5': { kind: 'fire', name: 'Fire Station' },
  '1,4': { kind: 'police', name: 'Police Control Room' },
  '1,3': { kind: 'station', name: 'Railway Station' },
  '2,3': { kind: 'market', name: 'Clock Tower Market' },
  '4,0': { kind: 'depot', name: 'Logistics Park' },
  '0,6': { kind: 'depot', name: 'Industrial Estate' },
};

const EXITS: Record<string, string> = {
  '0,3': 'North Exit',
  '2,0': 'West Exit',
  '2,6': 'East Exit',
  '4,3': 'South Exit',
};

const SEGMENT_OVERRIDES: Record<string, { road: string; kind?: LinkKind; maxWeight?: number }> = {
  'h:1:4': { road: 'Bazaar Lane', kind: 'lane' },
  'v:5:1': { road: 'Bazaar Lane', kind: 'lane' },
  'h:3:1': { road: 'Old Mill Lane', kind: 'lane' },
  'v:1:2': { road: 'Old Mill Lane', kind: 'lane' },
  'v:5:2': { road: 'Court Road Bridge', maxWeight: 12 },
};

const CAMERA_SEGMENTS = new Set(['h:2:1', 'h:2:4', 'h:0:2', 'v:6:1', 'v:3:0', 'v:3:3', 'h:4:4', 'v:0:2']);

const KIND_SPEC: Record<LinkKind, { lanes: number; speed: number; maxWeight: number | null }> = {
  ring: { lanes: 2, speed: 60, maxWeight: null },
  arterial: { lanes: 2, speed: 50, maxWeight: null },
  street: { lanes: 1, speed: 40, maxWeight: null },
  lane: { lanes: 1, speed: 25, maxWeight: 5 },
};

export interface Network extends NetworkInfo {
  inLinks: number[][];
  outLinks: number[][];
  linkBetween: Map<string, number>;
}

export function nodeId(r: number, c: number): number {
  return r * COLS + c;
}

function isCore(r: number, c: number): boolean {
  return r >= 1 && r <= 3 && c >= 2 && c <= 4;
}

function nodeName(r: number, c: number): string {
  const rowRoad = ROW_ROADS[r];
  const colRoad = COL_ROADS[c];
  const ringRow = r === 0 || r === ROWS - 1;
  const ringCol = c === 0 || c === COLS - 1;
  if (ringRow && ringCol) {
    const ns = r === 0 ? 'North' : 'South';
    const ew = c === 0 ? 'West' : 'East';
    return `${ns}-${ew} Ring Junction`;
  }
  return `${rowRoad} × ${colRoad}`;
}

export function buildNetwork(): Network {
  const nodes: NetNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const key = `${r},${c}`;
      nodes.push({
        id: nodeId(r, c),
        key: `J${r}${c}`,
        r,
        c,
        x: X0 + c * DX,
        y: Y0 + r * DY,
        name: nodeName(r, c),
        poi: POIS[key],
        exit: EXITS[key],
      });
    }
  }

  const links: NetLink[] = [];
  const addPair = (a: NetNode, b: NetNode, horizontal: boolean) => {
    const segKey = horizontal ? `h:${a.r}:${a.c}` : `v:${a.c}:${a.r}`;
    const override = SEGMENT_OVERRIDES[segKey];
    let kind: LinkKind;
    if (horizontal) kind = a.r === 0 || a.r === ROWS - 1 ? 'ring' : a.r === 2 ? 'arterial' : 'street';
    else kind = a.c === 0 || a.c === COLS - 1 ? 'ring' : a.c === 3 ? 'arterial' : 'street';
    if (override?.kind) kind = override.kind;
    const spec = KIND_SPEC[kind];
    const road = override?.road ?? (horizontal ? ROW_ROADS[a.r] : COL_ROADS[a.c]);
    const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y) * METERS_PER_UNIT);
    const core = isCore(a.r, a.c) && isCore(b.r, b.c);
    const camera = CAMERA_SEGMENTS.has(segKey);
    const maxWeight = override?.maxWeight ?? spec.maxWeight;
    const phase: Phase = horizontal ? 'EW' : 'NS';
    const forwardDir: Dir = horizontal ? 'E' : 'S';
    const backwardDir: Dir = horizontal ? 'W' : 'N';
    const base = { road, kind, lanes: spec.lanes, length, speedLimit: spec.speed, maxWeight, core, camera, phase };
    const fwdId = links.length;
    links.push({ ...base, id: fwdId, from: a.id, to: b.id, dir: forwardDir, reverse: fwdId + 1 });
    links.push({ ...base, id: fwdId + 1, from: b.id, to: a.id, dir: backwardDir, reverse: fwdId });
  };

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = nodes[nodeId(r, c)];
      if (c + 1 < COLS) addPair(a, nodes[nodeId(r, c + 1)], true);
      if (r + 1 < ROWS) addPair(a, nodes[nodeId(r + 1, c)], false);
    }
  }

  const inLinks: number[][] = nodes.map(() => []);
  const outLinks: number[][] = nodes.map(() => []);
  const linkBetween = new Map<string, number>();
  for (const link of links) {
    inLinks[link.to].push(link.id);
    outLinks[link.from].push(link.id);
    linkBetween.set(`${link.from}-${link.to}`, link.id);
  }

  return {
    nodes,
    links,
    width: X0 * 2 + (COLS - 1) * DX,
    height: Y0 * 2 + (ROWS - 1) * DY,
    exits: nodes.filter((n) => n.exit).map((n) => n.id),
    inLinks,
    outLinks,
    linkBetween,
  };
}

export function publicNetwork(net: Network): NetworkInfo {
  return { nodes: net.nodes, links: net.links, width: net.width, height: net.height, exits: net.exits };
}

export function hopDistances(net: Network, start: number): number[] {
  const dist = net.nodes.map(() => Infinity);
  dist[start] = 0;
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
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
