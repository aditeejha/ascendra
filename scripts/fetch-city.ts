import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cityConfig, citySlug, DATA_DIR } from '../server/config';
import type { OsmExtract } from '../server/sim/osm';

const USER_AGENT = 'ASCENDRA/1.0 (smart traffic research prototype)';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const OSM_API = 'https://api.openstreetmap.org/api/0.6/map';
const TILE_DEG = 0.02;

interface RawNode {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface RawWay {
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url: string, init: RequestInit = {}, attempts = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      if (res.ok) return text;
      last = new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
    } catch (err) {
      last = err;
    }
    await wait(2000 * 2 ** i);
  }
  throw last;
}

async function geocode(query: string) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const results = JSON.parse(await request(url)) as { lat: string; lon: string; display_name: string; category: string; type: string }[];
  const place = results.find((r) => r.category === 'place') ?? results[0];
  if (!place) throw new Error(`No geocoding result for "${query}"`);
  return { lat: Number(place.lat), lon: Number(place.lon), displayName: place.display_name };
}

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseOsmXml(xml: string, nodes: Map<number, RawNode>, ways: Map<number, RawWay>): void {
  const element = /<(node|way)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const m of xml.matchAll(element)) {
    const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    const body = m[4] ?? '';
    const tagList = [...body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)];
    const tags = tagList.length ? Object.fromEntries(tagList.map((t) => [decode(t[1]), decode(t[2])])) : undefined;
    const id = Number(attrs.id);
    if (m[1] === 'node') nodes.set(id, { id, lat: Number(attrs.lat), lon: Number(attrs.lon), tags });
    else ways.set(id, { id, nodes: [...body.matchAll(/<nd ref="(\d+)"\s*\/>/g)].map((n) => Number(n[1])), tags });
  }
}

async function viaOverpass(bbox: string) {
  const roads = Object.keys(cityConfig().roads).join('|');
  const query = `[out:json][timeout:180];
way["highway"~"^(${roads})$"](${bbox})->.roads;
.roads out body; .roads >; out skel qt;
(
  node["highway"~"^(traffic_signals|speed_camera)$"](${bbox});
  nwr["amenity"](${bbox});
  nwr["healthcare"="hospital"](${bbox});
  nwr["railway"="station"](${bbox});
  nwr["tourism"](${bbox});
  nwr["shop"](${bbox});
  nwr["office"](${bbox});
  way["landuse"~"^(industrial|residential)$"](${bbox});
  nwr["building"~"^(house|residential|apartments|detached|semidetached_house|commercial|retail|industrial)$"](${bbox});
);
out center tags;`;
  let lastError: unknown;
  for (const endpoint of OVERPASS) {
    try {
      const text = await request(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }) }, 2);
      const data = JSON.parse(text) as { elements: (RawNode & RawWay & { type: string })[] };
      const nodes = new Map<number, RawNode>();
      const ways = new Map<number, RawWay>();
      for (const e of data.elements) {
        if (e.type === 'node') nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, tags: { ...nodes.get(e.id)?.tags, ...e.tags } });
        else if (e.type === 'way') ways.set(e.id, { id: e.id, nodes: e.nodes ?? ways.get(e.id)?.nodes ?? [], tags: e.tags, center: e.center });
      }
      return { nodes, ways, via: `Overpass API (${new URL(endpoint).host})` };
    } catch (err) {
      lastError = err;
      console.log(`  ${new URL(endpoint).host} unavailable: ${(err as Error).message}`);
    }
  }
  throw lastError;
}

async function viaOsmApi(south: number, west: number, north: number, east: number) {
  const nodes = new Map<number, RawNode>();
  const ways = new Map<number, RawWay>();
  const tiles: [number, number, number, number][] = [];
  for (let s = south; s < north; s += TILE_DEG) {
    for (let w = west; w < east; w += TILE_DEG) tiles.push([w, s, Math.min(w + TILE_DEG, east), Math.min(s + TILE_DEG, north)]);
  }
  for (const [i, t] of tiles.entries()) {
    const xml = await request(`${OSM_API}?bbox=${t.map((v) => v.toFixed(5)).join(',')}`);
    parseOsmXml(xml, nodes, ways);
    console.log(`  tile ${i + 1}/${tiles.length}: ${nodes.size.toLocaleString()} nodes, ${ways.size.toLocaleString()} ways so far`);
    await wait(1500);
  }
  return { nodes, ways, via: 'OpenStreetMap API' };
}

function centreOf(way: RawWay, nodes: Map<number, RawNode>): { lat: number; lon: number } | null {
  if (way.center) return way.center;
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const id of way.nodes) {
    const node = nodes.get(id);
    if (!node) continue;
    lat += node.lat;
    lon += node.lon;
    n++;
  }
  return n ? { lat: lat / n, lon: lon / n } : null;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

function poiKind(tags: Record<string, string>): OsmExtract['pois'][number]['kind'] | null {
  if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'hospital';
  if (tags.amenity === 'fire_station') return 'fire';
  if (tags.amenity === 'police') return 'police';
  if (tags.railway === 'station' && tags.station !== 'subway') return 'station';
  if (tags.amenity === 'bus_station') return 'bus';
  if (tags.amenity === 'marketplace') return 'market';
  if ((tags.amenity === 'college' || tags.amenity === 'university') && tags.name) return 'college';
  if ((tags.tourism === 'attraction' || tags.tourism === 'museum') && tags.name) return 'attraction';
  return null;
}

const HOME = /^(house|residential|apartments|detached|semidetached_house)$/;
const SKIP_AMENITY = /^(parking|parking_space|bench|waste_basket|waste_disposal|toilets|drinking_water|recycling|grave_yard|shelter)$/;

function normalise(
  nodes: Map<number, RawNode>,
  ways: Map<number, RawWay>,
  meta: { via: string; city: { lat: number; lon: number; displayName: string }; bbox: OsmExtract['bbox'] },
): OsmExtract {
  const config = cityConfig();
  const inBox = (lat: number, lon: number) => lat >= meta.bbox.south && lat <= meta.bbox.north && lon >= meta.bbox.west && lon <= meta.bbox.east;
  const roadWays: OsmExtract['ways'] = [];
  const used = new Set<number>();
  for (const way of ways.values()) {
    const t = way.tags ?? {};
    if (!t.highway || !(t.highway in config.roads) || t.area === 'yes') continue;
    if (['private', 'no'].includes(t.access ?? '') || t.motor_vehicle === 'no') continue;
    const ids = way.nodes.filter((id) => nodes.has(id));
    if (ids.length < 2) continue;
    const keep: Record<string, string> = {};
    for (const k of ['highway', 'name', 'name:en', 'ref', 'oneway', 'junction', 'lanes', 'maxspeed', 'maxweight', 'bridge']) if (t[k]) keep[k] = t[k];
    roadWays.push({ id: way.id, nodes: ids, tags: keep });
    ids.forEach((id) => used.add(id));
  }
  const coords: OsmExtract['nodes'] = {};
  const names: OsmExtract['nodeNames'] = {};
  for (const id of used) {
    const n = nodes.get(id)!;
    coords[id] = [round(n.lat), round(n.lon)];
    if (n.tags?.name && n.tags.highway !== 'bus_stop') names[id] = n.tags['name:en'] ?? n.tags.name;
  }
  const signals: [number, number][] = [];
  const cameras: [number, number][] = [];
  const pois: OsmExtract['pois'] = [];
  const activity: [number, number, number][] = [];
  const homes: [number, number][] = [];
  const industrial: [number, number][] = [];
  const consider = (tags: Record<string, string> | undefined, at: { lat: number; lon: number } | null, id: string) => {
    if (!tags || !at || !inBox(at.lat, at.lon)) return;
    const p: [number, number] = [round(at.lat), round(at.lon)];
    if (tags.highway === 'traffic_signals') signals.push(p);
    if (tags.highway === 'speed_camera') cameras.push(p);
    const kind = poiKind(tags);
    if (kind) pois.push({ id, kind, name: tags['name:en'] ?? tags.name ?? '', lat: p[0], lon: p[1] });
    if (tags.landuse === 'industrial' || tags.building === 'industrial' || tags.shop === 'wholesale' || tags.man_made === 'works') industrial.push(p);
    if (tags.building && HOME.test(tags.building)) homes.push(p);
    let w = 0;
    if (tags.shop || tags.office) w = 1;
    if (tags.amenity && !SKIP_AMENITY.test(tags.amenity)) w = ['school', 'college', 'university', 'hospital', 'marketplace', 'bus_station'].includes(tags.amenity) ? 4 : 1;
    if (tags.tourism === 'attraction' || tags.amenity === 'place_of_worship') w = Math.max(w, 3);
    if (tags.building === 'commercial' || tags.building === 'retail') w = Math.max(w, 1);
    if (w) activity.push([p[0], p[1], w]);
  };
  for (const n of nodes.values()) consider(n.tags, n, `n${n.id}`);
  for (const way of ways.values()) {
    const t = way.tags;
    if (!t || (t.highway && !t.amenity && !t.shop)) continue;
    consider(t, centreOf(way, nodes), `w${way.id}`);
  }
  return {
    source: 'OpenStreetMap contributors, ODbL 1.0',
    via: meta.via,
    fetchedAt: new Date().toISOString(),
    city: { name: config.city, displayName: meta.city.displayName, lat: round(meta.city.lat), lon: round(meta.city.lon) },
    bbox: meta.bbox,
    nodes: coords,
    nodeNames: names,
    ways: roadWays,
    signals,
    cameras,
    pois,
    activity,
    homes,
    industrial,
  };
}

const config = cityConfig();
console.log(`Geocoding "${config.geocodeQuery}" (Nominatim)…`);
const city = await geocode(config.geocodeQuery);
console.log(`  ${city.displayName}: ${city.lat.toFixed(5)}, ${city.lon.toFixed(5)}`);
const dLat = config.studyRadiusKm / 110.574;
const dLon = config.studyRadiusKm / (111.32 * Math.cos((city.lat * Math.PI) / 180));
const bbox = { south: round(city.lat - dLat), west: round(city.lon - dLon), north: round(city.lat + dLat), east: round(city.lon + dLon) };
console.log(`Downloading OpenStreetMap data for ${config.studyRadiusKm} km around the centre…`);
let result: { nodes: Map<number, RawNode>; ways: Map<number, RawWay>; via: string };
try {
  result = await viaOverpass(`${bbox.south},${bbox.west},${bbox.north},${bbox.east}`);
} catch {
  console.log('  Overpass unavailable, falling back to the OpenStreetMap API in small tiles');
  result = await viaOsmApi(bbox.south, bbox.west, bbox.north, bbox.east);
}
const extract = normalise(result.nodes, result.ways, { via: result.via, city, bbox });
mkdirSync(DATA_DIR, { recursive: true });
const file = path.join(DATA_DIR, `${citySlug()}-osm.json`);
writeFileSync(file, JSON.stringify(extract));
console.log(
  `Saved ${path.relative(process.cwd(), file)} via ${extract.via}: ${extract.ways.length} road ways, ${Object.keys(extract.nodes).length} road nodes, ` +
    `${extract.signals.length} signals, ${extract.pois.length} landmarks, ${extract.activity.length} activity points, ${extract.homes.length} homes`,
);
