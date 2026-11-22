import type { Dir, LinkKind, NetLink, NetNode, NetworkMeta, Phase, Poi, PoiKind } from '../../shared/types';
import type { CityConfig } from '../config';

export interface OsmExtract {
  source: string;
  via: string;
  fetchedAt: string;
  city: { name: string; displayName: string; lat: number; lon: number };
  bbox: { south: number; west: number; north: number; east: number };
  nodes: Record<string, [number, number]>;
  nodeNames: Record<string, string>;
  ways: { id: number; nodes: number[]; tags: Record<string, string> }[];
  signals: [number, number][];
  cameras: [number, number][];
  pois: { id: string; kind: PoiKind; name: string; lat: number; lon: number }[];
  activity: [number, number, number][];
  homes: [number, number][];
  industrial: [number, number][];
}

export interface BuiltNetwork {
  nodes: NetNode[];
  links: NetLink[];
  meta: NetworkMeta;
  weights: { home: number[]; work: number[]; cargo: number[] };
  stations: number[];
}

const KIND_RANK: Record<LinkKind, number> = { highway: 4, arterial: 3, street: 2, lane: 1 };
const POI_RANK: Record<PoiKind, number> = { station: 8, bus: 7, hospital: 6, fire: 6, police: 6, market: 5, attraction: 4, college: 3 };
const POI_WORK: Record<PoiKind, number> = { station: 12, bus: 8, market: 10, attraction: 8, college: 6, hospital: 3, fire: 0.5, police: 0.5 };
const EARTH_M = 6371008.8;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function compass(deg: number): Dir {
  if (deg >= 315 || deg < 45) return 'N';
  if (deg < 135) return 'E';
  if (deg < 225) return 'S';
  return 'W';
}

function compassWord(deg: number): string {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
}

export function unproject(x: number, y: number, meta: Pick<NetworkMeta, 'tileOrigin' | 'zoom'>): [number, number] {
  const scale = 256 * 2 ** meta.zoom;
  const mx = x + meta.tileOrigin.x;
  const my = y + meta.tileOrigin.y;
  const lon = (mx / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * my) / scale;
  return [(Math.atan(Math.sinh(n)) * 180) / Math.PI, lon];
}

function mercator(lat: number, lon: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

function parseNumber(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/[\d.]+/);
  return m ? Number(m[0]) : null;
}

function roadName(tags: Record<string, string>): string | null {
  const ref = tags.ref ? tags.ref.split(';')[0].trim().replace(/^([A-Za-z]+)\s*(\d)/, '$1 $2') : null;
  const name = tags['name:en'] ?? tags.name;
  if (!name) return ref;
  return name === name.toLowerCase() ? name.replace(/(^|[\s.(-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase()) : name;
}

class UnionFind {
  parent: Map<number, number> = new Map();
  find(a: number): number {
    let p = this.parent.get(a) ?? a;
    if (p === a) return a;
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

interface Segment {
  a: number;
  b: number;
  pts: [number, number][];
  dirs: { fwd: boolean; back: boolean };
  kind: LinkKind;
  name: string | null;
  lanesF: number;
  lanesB: number;
  speed: number;
  maxWeight: number | null;
  length: number;
  boundaryA: boolean;
  boundaryB: boolean;
  bridge: boolean;
}

function lengthOf(pts: [number, number][]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return s;
}

export function buildFromExtract(x: OsmExtract, config: CityConfig): BuiltNetwork {
  const { bbox } = x;
  const inBox = (p: [number, number]) => p[0] >= bbox.south && p[0] <= bbox.north && p[1] >= bbox.west && p[1] <= bbox.east;
  const coord = (id: number) => x.nodes[id];

  interface Run {
    ids: number[];
    tags: Record<string, string>;
    cutStart: boolean;
    cutEnd: boolean;
  }
  const runs: Run[] = [];
  for (const way of x.ways) {
    let cur: number[] = [];
    let cutStart = false;
    way.nodes.forEach((id, i) => {
      const p = coord(id);
      if (p && inBox(p)) {
        if (!cur.length) cutStart = i > 0;
        cur.push(id);
      } else if (cur.length) {
        if (cur.length > 1) runs.push({ ids: cur, tags: way.tags, cutStart, cutEnd: true });
        cur = [];
      }
    });
    if (cur.length > 1) runs.push({ ids: cur, tags: way.tags, cutStart, cutEnd: false });
  }

  const refs = new Map<number, number>();
  for (const run of runs) {
    run.ids.forEach((id, i) => refs.set(id, (refs.get(id) ?? 0) + (i === 0 || i === run.ids.length - 1 ? 2 : 1)));
  }

  let segments: Segment[] = [];
  const boundary = new Set<number>();
  for (const run of runs) {
    const t = run.tags;
    const kind = config.roads[t.highway];
    const def = config.kindDefaults[kind];
    const ow = t.oneway === '-1' ? -1 : ['yes', 'true', '1'].includes(t.oneway ?? '') || ['roundabout', 'circular'].includes(t.junction ?? '') ? 1 : 0;
    const totalLanes = parseNumber(t.lanes);
    const perDir = totalLanes ? Math.max(1, ow ? Math.round(totalLanes) : Math.round(totalLanes / 2)) : def.lanesPerDirection;
    const speed = parseNumber(t.maxspeed) ?? def.speedKmh;
    const maxWeight = parseNumber(t.maxweight) ?? def.maxWeightT;
    if (run.cutStart) boundary.add(run.ids[0]);
    if (run.cutEnd) boundary.add(run.ids[run.ids.length - 1]);
    let start = 0;
    for (let i = 1; i < run.ids.length; i++) {
      if (i === run.ids.length - 1 || (refs.get(run.ids[i]) ?? 0) >= 2) {
        const ids = run.ids.slice(start, i + 1);
        const pts = ids.map((id) => coord(id));
        segments.push({
          a: ids[0],
          b: ids[ids.length - 1],
          pts,
          dirs: { fwd: ow >= 0, back: ow <= 0 },
          kind,
          name: roadName(t),
          lanesF: perDir,
          lanesB: perDir,
          speed,
          maxWeight,
          length: lengthOf(pts),
          boundaryA: false,
          boundaryB: false,
          bridge: Boolean(t.bridge) && t.bridge !== 'no',
        });
        start = i;
      }
    }
  }

  const uf = new UnionFind();
  for (const s of segments) if (s.length < config.network.mergeJunctionsWithinM) uf.union(s.a, s.b);
  const clusterPts = new Map<number, [number, number][]>();
  for (const s of segments) {
    for (const id of [s.a, s.b]) {
      const r = uf.find(id);
      if (!clusterPts.has(r)) clusterPts.set(r, []);
      clusterPts.get(r)!.push(coord(id));
    }
  }
  const clusterCoord = new Map<number, [number, number]>();
  for (const [r, pts] of clusterPts) {
    const lat = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const lon = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    clusterCoord.set(r, [lat, lon]);
  }
  const boundaryClusters = new Set([...boundary].map((id) => uf.find(id)));
  const named = new Map<number, string>();
  for (const [id, name] of Object.entries(x.nodeNames)) {
    const r = uf.find(Number(id));
    if (clusterCoord.has(r) && !named.has(r)) named.set(r, name);
  }

  const byPair = new Map<string, Segment>();
  for (const s of segments) {
    const a = uf.find(s.a);
    const b = uf.find(s.b);
    if (a === b) continue;
    const pts = [clusterCoord.get(a)!, ...s.pts.slice(1, -1), clusterCoord.get(b)!];
    const seg: Segment = { ...s, a, b, pts, length: Math.max(1, lengthOf(pts)) };
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const prev = byPair.get(key);
    if (!prev) {
      byPair.set(key, a < b ? seg : flip(seg));
      continue;
    }
    const norm = a < b ? seg : flip(seg);
    const better = KIND_RANK[norm.kind] > KIND_RANK[prev.kind] || (KIND_RANK[norm.kind] === KIND_RANK[prev.kind] && norm.length < prev.length);
    const base = better ? norm : prev;
    const other = better ? prev : norm;
    byPair.set(key, {
      ...base,
      dirs: { fwd: base.dirs.fwd || other.dirs.fwd, back: base.dirs.back || other.dirs.back },
      lanesF: base.dirs.fwd ? base.lanesF : other.lanesF,
      lanesB: base.dirs.back ? base.lanesB : other.lanesB,
    });
  }
  segments = [...byPair.values()];

  const protectedNodes = (n: number) => boundaryClusters.has(n) || named.has(n);
  const incident = () => {
    const m = new Map<number, Segment[]>();
    for (const s of segments) {
      for (const n of [s.a, s.b]) {
        if (!m.has(n)) m.set(n, []);
        m.get(n)!.push(s);
      }
    }
    return m;
  };

  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    const inc = incident();
    const prune = new Set(config.network.pruneDeadEndKinds);
    const remove = new Set<Segment>();
    for (const [n, list] of inc) {
      if (list.length === 1 && !protectedNodes(n) && prune.has(list[0].kind)) remove.add(list[0]);
    }
    if (remove.size) {
      segments = segments.filter((s) => !remove.has(s));
      changed = true;
    }
    const inc2 = incident();
    const merged = new Set<Segment>();
    const added: Segment[] = [];
    for (const [n, list] of inc2) {
      if (list.length !== 2 || protectedNodes(n)) continue;
      const [s1, s2] = list;
      if (merged.has(s1) || merged.has(s2) || s1 === s2 || s1.kind !== s2.kind || s1.bridge !== s2.bridge) continue;
      const p = s1.b === n ? s1 : flip(s1);
      const q = s2.a === n ? s2 : flip(s2);
      if (p.a === q.b) continue;
      if (p.dirs.fwd !== q.dirs.fwd || p.dirs.back !== q.dirs.back) continue;
      merged.add(s1);
      merged.add(s2);
      const pts = [...p.pts, ...q.pts.slice(1)];
      added.push({
        ...(p.length >= q.length ? p : q),
        a: p.a,
        b: q.b,
        pts,
        dirs: p.dirs,
        lanesF: Math.min(p.lanesF, q.lanesF),
        lanesB: Math.min(p.lanesB, q.lanesB),
        speed: Math.min(p.speed, q.speed),
        maxWeight: p.maxWeight === null ? q.maxWeight : q.maxWeight === null ? p.maxWeight : Math.min(p.maxWeight, q.maxWeight),
        length: p.length + q.length,
      });
    }
    if (merged.size) {
      segments = [...segments.filter((s) => !merged.has(s)), ...added];
      changed = true;
    }
    if (!changed) break;
  }

  interface DLink {
    from: number;
    to: number;
    seg: Segment;
    pts: [number, number][];
    lanes: number;
  }
  const dlinks: DLink[] = [];
  for (const s of segments) {
    if (s.dirs.fwd) dlinks.push({ from: s.a, to: s.b, seg: s, pts: s.pts, lanes: s.lanesF });
    if (s.dirs.back) dlinks.push({ from: s.b, to: s.a, seg: s, pts: [...s.pts].reverse(), lanes: s.lanesB });
  }

  const keep = largestScc(dlinks);
  const live = dlinks.filter((l) => keep.has(l.from) && keep.has(l.to));
  const nodeIds = [...keep];
  const index = new Map(nodeIds.map((n, i) => [n, i]));

  const zoom = config.mapZoom;
  const [ox, oy] = mercator(bbox.north, bbox.west, zoom);
  const [ex, ey] = mercator(bbox.south, bbox.east, zoom);
  const px = (p: [number, number]) => {
    const [mx, my] = mercator(p[0], p[1], zoom);
    return [Math.round((mx - ox) * 10) / 10, Math.round((my - oy) * 10) / 10] as [number, number];
  };
  const metersPerPixel = (156543.03392 * Math.cos((x.city.lat * Math.PI) / 180)) / 2 ** zoom;

  const neighbours = new Map<number, Set<number>>();
  for (const l of live) {
    for (const [u, v] of [
      [l.from, l.to],
      [l.to, l.from],
    ]) {
      if (!neighbours.has(u)) neighbours.set(u, new Set());
      neighbours.get(u)!.add(v);
    }
  }

  const links: NetLink[] = live.map((l, i) => {
    const pts = l.pts;
    const n = pts.length;
    const endBearing = bearing(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1]);
    const overall = bearing(pts[0][0], pts[0][1], pts[n - 1][0], pts[n - 1][1]);
    return {
      id: i,
      from: index.get(l.from)!,
      to: index.get(l.to)!,
      dir: compass(overall),
      phase: 'NS' as Phase,
      road: l.seg.name ?? (l.seg.kind === 'lane' ? 'Residential lane' : 'Unnamed road'),
      kind: l.seg.kind,
      lanes: Math.max(1, l.lanes),
      length: Math.round(l.seg.length),
      speedLimit: l.seg.speed,
      maxWeight: l.seg.maxWeight,
      core: false,
      camera: false,
      reverse: -1,
      oneway: !(l.seg.dirs.fwd && l.seg.dirs.back),
      bridge: l.seg.bridge,
      geometry: pts.flatMap((p) => px(p)),
      endBearing,
    } as NetLink & { endBearing: number };
  });
  const segLinks = new Map<Segment, number[]>();
  live.forEach((l, i) => {
    if (!segLinks.has(l.seg)) segLinks.set(l.seg, []);
    segLinks.get(l.seg)!.push(i);
  });
  for (const ids of segLinks.values()) {
    if (ids.length === 2) {
      links[ids[0]].reverse = ids[1];
      links[ids[1]].reverse = ids[0];
    }
  }

  const inLinks: number[][] = nodeIds.map(() => []);
  for (const l of links) inLinks[l.to].push(l.id);

  const nodes: NetNode[] = nodeIds.map((raw, i) => {
    const [lat, lon] = clusterCoord.get(raw)!;
    const [nx, ny] = px([lat, lon]);
    const names = [...new Set(inLinks[i].map((lid) => links[lid]).sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.length - a.length).map((l) => l.road))].filter(
      (n) => n !== 'Residential lane' && n !== 'Unnamed road',
    );
    const name = named.get(raw) ?? (names.length >= 2 ? `${names[0]} × ${names[1]}` : names.length === 1 ? `${names[0]} junction` : `Junction ${i}`);
    return { id: i, key: `J${i}`, x: nx, y: ny, lat, lon, name, signal: null };
  });

  const centre = { lat: x.city.lat, lon: x.city.lon };
  const distC = (n: NetNode) => haversine(n.lat, n.lon, centre.lat, centre.lon);
  const zoneM = config.network.restrictedZoneKm * 1000;
  for (const l of links) l.core = distC(nodes[l.from]) <= zoneM && distC(nodes[l.to]) <= zoneM;

  const segKey = (l: NetLink) => (l.reverse >= 0 ? Math.min(l.id, l.reverse) : l.id);
  const outLinks: number[][] = nodeIds.map(() => []);
  for (const l of links) outLinks[l.from].push(l.id);
  const rule = config.network.inferSignals;
  const candidates: { n: NetNode; score: number }[] = [];
  for (const n of nodes) {
    const segs = new Map<number, LinkKind>();
    for (const lid of [...inLinks[n.id], ...outLinks[n.id]]) segs.set(segKey(links[lid]), links[lid].kind);
    const kinds = [...segs.values()];
    const major = kinds.filter((k) => KIND_RANK[k] >= KIND_RANK.arterial).length;
    const streets = kinds.filter((k) => k === 'street').length;
    if (major >= rule.minMajorSegments || (major >= rule.orMajorSegments && streets >= rule.withStreetSegments)) {
      candidates.push({ n, score: major * 10 + streets * 3 + kinds.length });
    }
  }
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (nodes.some((m) => m.signal && haversine(m.lat, m.lon, c.n.lat, c.n.lon) < rule.minSpacingM)) continue;
    c.n.signal = 'inferred';
  }
  for (const [lat, lon] of x.signals) {
    let best = -1;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = haversine(lat, lon, n.lat, n.lon);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    if (best >= 0 && bestD <= config.network.signalSnapM) nodes[best].signal = 'osm';
  }

  for (const n of nodes) {
    const incoming = inLinks[n.id].map((lid) => links[lid] as NetLink & { endBearing: number });
    if (!incoming.length) continue;
    const axisLink = [...incoming].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || b.length - a.length)[0];
    const axis = axisLink.endBearing % 180;
    const axisIsNS = axis < 45 || axis >= 135;
    for (const l of incoming) {
      const d = Math.abs((l.endBearing % 180) - axis);
      const sameAxis = Math.min(d, 180 - d) <= 45;
      l.phase = sameAxis === axisIsNS ? 'NS' : 'EW';
    }
  }

  const stations: number[] = [];
  const nearestNode = (lat: number, lon: number) => {
    let best = -1;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = haversine(lat, lon, n.lat, n.lon);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return { id: best, d: bestD };
  };
  const poiAt = new Map<number, Poi[]>();
  const exclude = new RegExp(config.network.hospitalNameExclude, 'i');
  for (const p of x.pois) {
    if (p.kind === 'hospital' && exclude.test(p.name) && !/hospital/i.test(p.name)) continue;
    const near = nearestNode(p.lat, p.lon);
    if (near.id < 0 || near.d > config.network.poiSnapM) continue;
    const label = p.name || { hospital: 'Hospital', fire: 'Fire station', police: 'Police station', station: 'Railway station', bus: 'Bus stand', market: 'Market', college: 'College', attraction: 'Attraction' }[p.kind];
    if (!poiAt.has(near.id)) poiAt.set(near.id, []);
    poiAt.get(near.id)!.push({ kind: p.kind, name: label });
    if (['hospital', 'fire', 'police'].includes(p.kind) && !stations.includes(near.id)) stations.push(near.id);
  }
  for (const [id, list] of poiAt) nodes[id].poi = list.sort((a, b) => POI_RANK[b.kind] - POI_RANK[a.kind])[0];
  const landmarkNodes = nodes.filter((n) => n.poi);
  for (const n of nodes) {
    if (n.poi || named.has(nodeIds[n.id])) continue;
    if (!/ junction$|^Junction \d+$/.test(n.name)) continue;
    let best: NetNode | null = null;
    let bestD = config.network.landmarkNamingM;
    for (const m of landmarkNodes) {
      const d = haversine(n.lat, n.lon, m.lat, m.lon);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) continue;
    const road = n.name.replace(/ junction$/, '');
    n.name = /^Junction \d+$/.test(n.name) ? `Lane near ${best.poi!.name}` : `${road} near ${best.poi!.name}`;
  }

  const exitCandidates = nodes
    .filter((n) => boundaryClusters.has(nodeIds[n.id]))
    .map((n) => {
      const best = inLinks[n.id].map((lid) => links[lid]).sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind])[0];
      return { n, rank: best ? KIND_RANK[best.kind] : 0, road: best?.road ?? 'road' };
    })
    .sort((a, b) => b.rank - a.rank);
  const majorExits = exitCandidates.filter((c) => c.rank >= KIND_RANK.arterial);
  const exitPool = majorExits.length >= 3 ? majorExits : exitCandidates.filter((c) => c.rank >= KIND_RANK.street);
  const exits: number[] = [];
  for (const c of exitPool) {
    if (exits.some((e) => haversine(nodes[e].lat, nodes[e].lon, c.n.lat, c.n.lon) < config.network.exitMergeM)) continue;
    exits.push(c.n.id);
    const toward = compassWord(bearing(centre.lat, centre.lon, c.n.lat, c.n.lon));
    c.n.exit = c.road === 'Residential lane' || c.road === 'Unnamed road' ? `Exit ${toward}` : `Exit ${toward} via ${c.road}`;
  }

  const camLinks = new Set<number>();
  for (const [lat, lon] of x.cameras) {
    const near = nearestNode(lat, lon);
    const l = links.find((k) => k.from === near.id || k.to === near.id);
    if (l) camLinks.add(segKey(l));
  }
  const usedRoads = new Set<string>();
  for (const l of [...links].filter((k) => KIND_RANK[k.kind] >= KIND_RANK.arterial).sort((a, b) => b.length - a.length)) {
    if (camLinks.size >= config.network.cameraSites) break;
    if (usedRoads.has(l.road) || l.road === 'Unnamed road') continue;
    usedRoads.add(l.road);
    camLinks.add(segKey(l));
  }
  for (const l of links) l.camera = camLinks.has(segKey(l));

  const within = (n: NetNode, lat: number, lon: number, r: number) => haversine(n.lat, n.lon, lat, lon) <= r;
  const home = nodes.map(() => 0.2);
  const work = nodes.map(() => 0.3);
  const cargo = nodes.map(() => 0.3);
  for (const l of links) {
    if (l.kind !== 'lane') continue;
    const km = l.length / 1000 / 2;
    home[l.from] += km;
    home[l.to] += km;
  }
  const smooth = (v: number[]) =>
    nodes.map((n) => {
      let s = 0;
      for (const m of nodes) {
        const d = haversine(n.lat, n.lon, m.lat, m.lon);
        if (d <= 600) s += v[m.id] * (1 - d / 600);
      }
      return s;
    });
  for (const [lat, lon, w] of x.activity) {
    const near = nearestNode(lat, lon);
    if (near.d <= 500) work[near.id] += w;
  }
  for (const [lat, lon] of x.homes) {
    const near = nearestNode(lat, lon);
    if (near.d <= 400) home[near.id] += 0.05;
  }
  for (const [id, list] of poiAt) for (const p of list) work[id] += POI_WORK[p.kind];
  for (const n of nodes) {
    const best = Math.max(...inLinks[n.id].map((lid) => KIND_RANK[links[lid].kind]), 0);
    cargo[n.id] = best >= KIND_RANK.highway ? 1.5 : best >= KIND_RANK.arterial ? 0.8 : best >= KIND_RANK.street ? 0.3 : 0.05;
    if (n.poi?.kind === 'market') cargo[n.id] += 4;
    if (n.poi?.kind === 'station') cargo[n.id] += 2;
  }
  for (const e of exits) cargo[e] += KIND_RANK[links[inLinks[e][0]]?.kind ?? 'street'] >= KIND_RANK.arterial ? 8 : 2;
  for (const [lat, lon] of x.industrial) {
    for (const n of nodes) if (within(n, lat, lon, 500)) cargo[n.id] += 2;
  }

  for (const l of links) delete (l as Partial<NetLink & { endBearing: number }>).endBearing;
  const [cx, cy] = px([centre.lat, centre.lon]);
  const segmentCount = new Set(links.map(segKey)).size;
  return {
    nodes,
    links,
    meta: {
      city: x.city.name,
      region: config.region,
      country: config.country,
      displayName: x.city.displayName,
      source: x.source,
      via: x.via,
      fetchedAt: x.fetchedAt,
      centre: { lat: centre.lat, lon: centre.lon, x: cx, y: cy },
      zoom,
      tileOrigin: { x: ox, y: oy },
      metersPerPixel,
      restrictedZoneKm: config.network.restrictedZoneKm,
      segmentCount,
      signalCount: nodes.filter((n) => n.signal).length,
      evacuationRadiiKm: config.evacuation.radiiKm,
      rules: { weeklyOff: config.rules.weeklyOff, freightBanHours: config.rules.freightBanHours, timezone: config.timezone },
      bbox,
      width: Math.ceil(ex - ox),
      height: Math.ceil(ey - oy),
    },
    weights: { home: smooth(home), work: smooth(work), cargo: smooth(cargo) },
    stations,
  };
}

function flip(s: Segment): Segment {
  return {
    ...s,
    a: s.b,
    b: s.a,
    pts: [...s.pts].reverse(),
    dirs: { fwd: s.dirs.back, back: s.dirs.fwd },
    lanesF: s.lanesB,
    lanesB: s.lanesF,
    boundaryA: s.boundaryB,
    boundaryB: s.boundaryA,
  };
}

function largestScc(links: { from: number; to: number }[]): Set<number> {
  const out = new Map<number, number[]>();
  const inc = new Map<number, number[]>();
  for (const l of links) {
    if (!out.has(l.from)) out.set(l.from, []);
    if (!inc.has(l.to)) inc.set(l.to, []);
    out.get(l.from)!.push(l.to);
    inc.get(l.to)!.push(l.from);
  }
  const all = new Set([...out.keys(), ...inc.keys()]);
  const seen = new Set<number>();
  const order: number[] = [];
  for (const start of all) {
    if (seen.has(start)) continue;
    const stack: [number, number][] = [[start, 0]];
    seen.add(start);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const nb = out.get(top[0]) ?? [];
      if (top[1] < nb.length) {
        const v = nb[top[1]++];
        if (!seen.has(v)) {
          seen.add(v);
          stack.push([v, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }
  const comp = new Map<number, number>();
  let best = -1;
  let bestSize = 0;
  let c = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i];
    if (comp.has(s)) continue;
    let size = 0;
    const stack = [s];
    comp.set(s, c);
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const v of inc.get(u) ?? []) {
        if (!comp.has(v)) {
          comp.set(v, c);
          stack.push(v);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = c;
    }
    c++;
  }
  return new Set([...comp].filter(([, k]) => k === best).map(([n]) => n));
}
