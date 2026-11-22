import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LiveIncident, TrafficSample } from '../../shared/types';
import { ROOT } from '../config';
import type { Simulation } from '../sim/engine';
import { haversine, unproject } from '../sim/osm';
import { segmentKey, type Network } from '../sim/network';

const USAGE_FILE = path.join(ROOT, '.cache', 'tomtom-usage.json');
const KIND_RANK = { highway: 4, arterial: 3, street: 2, lane: 1 } as const;
const CATEGORY: Record<number, string> = {
  0: 'Unknown',
  1: 'Accident',
  2: 'Fog',
  3: 'Dangerous conditions',
  4: 'Rain',
  5: 'Ice',
  6: 'Traffic jam',
  7: 'Lane closed',
  8: 'Road closed',
  9: 'Road works',
  10: 'Wind',
  11: 'Flooding',
  14: 'Broken-down vehicle',
};

interface Effect {
  lanesLost: number;
  speedFactor: number;
  closes: boolean;
}

function effectOf(category: number): Effect | null {
  switch (category) {
    case 8:
      return { lanesLost: 0, speedFactor: 1, closes: true };
    case 1:
    case 14:
      return { lanesLost: 1, speedFactor: 0.55, closes: false };
    case 7:
    case 9:
      return { lanesLost: 1, speedFactor: 0.7, closes: false };
    case 11:
      return { lanesLost: 0, speedFactor: 0.4, closes: false };
    case 3:
      return { lanesLost: 0, speedFactor: 0.7, closes: false };
    default:
      return null;
  }
}

export interface TomTomOptions {
  key: string | undefined;
  flowSamples: number;
  flowIntervalMin: number;
  incidentIntervalMin: number;
  dailyBudget: number;
  timezone: string;
}

export class TomTomTraffic {
  status: 'ok' | 'no_key' | 'error' | 'budget' | 'starting';
  error: string | null = null;
  lastFlowAt: string | null = null;
  lastIncidentsAt: string | null = null;
  incidents: LiveIncident[] = [];
  private samples = new Map<number, TrafficSample>();
  private previous = new Map<number, { score: number; at: number }>();
  private sampleLinks: number[] = [];
  private cursor = 0;
  private roundPairs: { measured: number; sim: number }[] = [];
  private errors: { model: number; base: number }[] = [];
  private simIncidents = new Map<string, string>();
  private latlon: [number, number][][];
  private usage: { day: string; count: number };
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private net: Network,
    private getSim: () => Simulation,
    private opts: TomTomOptions,
  ) {
    this.status = opts.key ? 'starting' : 'no_key';
    this.latlon = net.links.map((l) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < l.geometry.length; i += 2) pts.push(unproject(l.geometry[i], l.geometry[i + 1], net.meta));
      return pts;
    });
    this.usage = this.loadUsage();
    this.sampleLinks = this.pickSamples();
  }

  get configured(): boolean {
    return Boolean(this.opts.key);
  }

  get requestsToday(): number {
    this.rollDay();
    return this.usage.count;
  }

  get sampleList(): TrafficSample[] {
    return [...this.samples.values()].sort((a, b) => a.measuredScore - b.measuredScore).reverse();
  }

  get accuracy(): { mae: number | null; baselineMae: number | null; n: number } {
    const n = this.errors.length;
    if (!n) return { mae: null, baselineMae: null, n: 0 };
    return {
      mae: Math.round((this.errors.reduce((a, e) => a + e.model, 0) / n) * 1000) / 1000,
      baselineMae: Math.round((this.errors.reduce((a, e) => a + e.base, 0) / n) * 1000) / 1000,
      n,
    };
  }

  measuredLinks(maxAgeMs: number): Set<number> {
    const now = Date.now();
    const out = new Set<number>();
    for (const s of this.samples.values()) {
      if (now - Date.parse(s.at) > maxAgeMs) continue;
      out.add(s.linkId);
      const rev = this.net.links[s.linkId].reverse;
      if (rev >= 0) out.add(rev);
    }
    return out;
  }

  start(): void {
    if (!this.opts.key) return;
    void this.pollIncidents();
    const incidentTimer = setInterval(() => void this.pollIncidents(), this.opts.incidentIntervalMin * 60_000);
    const stepMs = Math.max(5_000, (this.opts.flowIntervalMin * 60_000) / Math.max(1, this.sampleLinks.length));
    const flowTimer = setInterval(() => void this.pollNextFlow(), stepMs);
    incidentTimer.unref();
    flowTimer.unref();
    this.timers.push(incidentTimer, flowTimer);
    void this.pollNextFlow();
  }

  reapply(): void {
    this.simIncidents.clear();
    const current = this.incidents;
    this.incidents = [];
    this.applyIncidents(current.map((i) => ({ ...i })));
  }

  private rollDay(): void {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: this.opts.timezone }).format(new Date());
    if (this.usage.day !== today) this.usage = { day: today, count: 0 };
  }

  private loadUsage(): { day: string; count: number } {
    try {
      if (existsSync(USAGE_FILE)) return JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
    } catch {
      return { day: '', count: 0 };
    }
    return { day: '', count: 0 };
  }

  private spend(): boolean {
    this.rollDay();
    if (this.usage.count >= this.opts.dailyBudget) {
      this.status = 'budget';
      this.error = `Daily request budget of ${this.opts.dailyBudget} used; live traffic resumes after midnight.`;
      return false;
    }
    this.usage.count++;
    try {
      mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
      writeFileSync(USAGE_FILE, JSON.stringify(this.usage));
    } catch {
      return true;
    }
    return true;
  }

  private async get(url: string): Promise<unknown> {
    if (!this.spend()) return null;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (res.status === 401 || res.status === 403) throw new Error('TomTom rejected the API key. Check TOMTOM_API_KEY in .env.');
      if (res.status === 429) throw new Error('TomTom rate limit reached; retrying later.');
      if (!res.ok) throw new Error(`TomTom answered HTTP ${res.status}`);
      const data = await res.json();
      this.status = 'ok';
      this.error = null;
      return data;
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  private midpoint(linkId: number): [number, number] {
    const pts = this.latlon[linkId];
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      if (walked + d >= total / 2) {
        const f = d ? (total / 2 - walked) / d : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      }
      walked += d;
    }
    return pts[0];
  }

  private pickSamples(): number[] {
    const seen = new Set<number>();
    const candidates = this.net.links.filter((l) => {
      if (KIND_RANK[l.kind] < KIND_RANK.street || l.length < 150) return false;
      const key = segmentKey(this.net, l.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const chosen: number[] = [];
    const mids = new Map(candidates.map((l) => [l.id, this.midpoint(l.id)]));
    while (chosen.length < this.opts.flowSamples && chosen.length < candidates.length) {
      let best = -1;
      let bestScore = -1;
      for (const l of candidates) {
        if (chosen.includes(l.id)) continue;
        const [lat, lon] = mids.get(l.id)!;
        const spread = chosen.length ? Math.min(...chosen.map((c) => haversine(lat, lon, ...mids.get(c)!))) : l.length;
        const score = spread * KIND_RANK[l.kind];
        if (score > bestScore) {
          bestScore = score;
          best = l.id;
        }
      }
      if (best < 0) break;
      chosen.push(best);
    }
    return chosen;
  }

  private async pollNextFlow(): Promise<void> {
    if (!this.sampleLinks.length) return;
    const linkId = this.sampleLinks[this.cursor];
    this.cursor = (this.cursor + 1) % this.sampleLinks.length;
    const [lat, lon] = this.midpoint(linkId);
    const data = (await this.get(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/14/json?point=${lat.toFixed(6)},${lon.toFixed(6)}&unit=KMPH&key=${this.opts.key}`,
    )) as { flowSegmentData?: { currentSpeed: number; freeFlowSpeed: number; confidence: number; roadClosure: boolean } } | null;
    const f = data?.flowSegmentData;
    if (!f || !f.freeFlowSpeed) return;
    const sim = this.getSim();
    const ratio = Math.min(1.2, f.currentSpeed / f.freeFlowSpeed);
    const measuredScore = Math.min(1, Math.max(0, (1 - Math.min(1, ratio)) / 0.75));
    const simScore = sim.linkScore(linkId);
    const at = new Date().toISOString();
    this.samples.set(linkId, {
      linkId,
      road: this.net.links[linkId].road,
      currentKmh: f.currentSpeed,
      freeFlowKmh: f.freeFlowSpeed,
      ratio: Math.round(ratio * 1000) / 1000,
      measuredScore: Math.round(measuredScore * 1000) / 1000,
      simScore: Math.round(simScore * 1000) / 1000,
      confidence: f.confidence,
      closed: f.roadClosure,
      at,
    });
    this.lastFlowAt = at;
    this.validateForecast(linkId, measuredScore);
    this.applyClosure(linkId, f.roadClosure);
    if (sim.settings.liveClock) {
      this.roundPairs.push({ measured: measuredScore, sim: simScore });
      if (this.roundPairs.length >= Math.max(4, Math.floor(this.sampleLinks.length / 2))) {
        const m = this.roundPairs.reduce((a, p) => a + p.measured, 0) / this.roundPairs.length;
        const s = this.roundPairs.reduce((a, p) => a + p.sim, 0) / this.roundPairs.length;
        const gap = m - s;
        if (Math.abs(gap) > 0.03) sim.setCalibration(sim.demandCalibration * Math.exp(Math.max(-0.15, Math.min(0.15, gap * 0.8))));
        this.roundPairs = [];
      }
    }
  }

  private validateForecast(linkId: number, measured: number): void {
    const sim = this.getSim();
    const minute = Math.floor(sim.t / 60);
    const prev = this.previous.get(linkId);
    const forecast = sim.forecastMadeAt(minute - 15, linkId, 15);
    if (prev && Date.now() - prev.at >= 10 * 60_000 && forecast !== null) {
      this.errors.push({ model: Math.abs(forecast - measured), base: Math.abs(prev.score - measured) });
      if (this.errors.length > 300) this.errors.shift();
    }
    this.previous.set(linkId, { score: measured, at: Date.now() });
  }

  private applyClosure(linkId: number, closed: boolean): void {
    const key = `flow-${linkId}`;
    const sim = this.getSim();
    const existing = this.simIncidents.get(key);
    if (closed && !existing) {
      const l = this.net.links[linkId];
      const ids = l.reverse >= 0 ? [l.id, l.reverse] : [l.id];
      this.simIncidents.set(key, sim.addIncident({ linkIds: ids, source: 'live', durationS: null, lanesLost: 0, speedFactor: 1, closes: true, label: `Road closed (TomTom) on ${l.road}` }));
    } else if (!closed && existing) {
      sim.clearIncident(existing);
      this.simIncidents.delete(key);
    }
  }

  private nearestLinks(lat: number, lon: number, maxM: number): number[] {
    let best: { id: number; d: number }[] = [];
    for (let id = 0; id < this.latlon.length; id++) {
      const pts = this.latlon[id];
      let d = Infinity;
      for (const p of pts) d = Math.min(d, haversine(lat, lon, p[0], p[1]));
      if (d <= maxM) best.push({ id, d });
    }
    best = best.sort((a, b) => a.d - b.d).slice(0, 2);
    return best.map((b) => b.id);
  }

  private async pollIncidents(): Promise<void> {
    const b = this.net.meta.bbox;
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},from,to,length,delay}}}';
    const data = (await this.get(
      `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${this.opts.key}&bbox=${b.west},${b.south},${b.east},${b.north}` +
        `&fields=${encodeURIComponent(fields)}&language=en-GB&timeValidityFilter=present`,
    )) as {
      incidents?: {
        geometry: { type: string; coordinates: number[] | number[][] };
        properties: { id: string; iconCategory: number; events?: { description: string }[]; from?: string; to?: string; delay?: number };
      }[];
    } | null;
    if (!data?.incidents) return;
    this.lastIncidentsAt = new Date().toISOString();
    const list: LiveIncident[] = data.incidents.map((inc) => {
      const coords = (inc.geometry.type === 'Point' ? [inc.geometry.coordinates] : inc.geometry.coordinates) as number[][];
      const linkIds = new Set<number>();
      for (const [lon, lat] of coords) for (const id of this.nearestLinks(lat, lon, 35)) linkIds.add(id);
      return {
        id: inc.properties.id,
        category: CATEGORY[inc.properties.iconCategory] ?? 'Incident',
        description: inc.properties.events?.map((e) => e.description).join('; ') || (CATEGORY[inc.properties.iconCategory] ?? 'Incident'),
        delaySec: inc.properties.delay ?? null,
        linkIds: [...linkIds],
        from: inc.properties.from ?? null,
        to: inc.properties.to ?? null,
        iconCategory: inc.properties.iconCategory,
      } as LiveIncident & { iconCategory: number };
    });
    this.applyIncidents(list);
  }

  private applyIncidents(list: LiveIncident[]): void {
    const sim = this.getSim();
    const ids = new Set(list.map((i) => i.id));
    for (const [key, simId] of this.simIncidents) {
      if (key.startsWith('flow-') || ids.has(key)) continue;
      sim.clearIncident(simId);
      this.simIncidents.delete(key);
    }
    for (const inc of list) {
      if (this.simIncidents.has(inc.id) || !inc.linkIds.length) continue;
      const effect = effectOf((inc as LiveIncident & { iconCategory?: number }).iconCategory ?? -1);
      if (!effect) continue;
      this.simIncidents.set(
        inc.id,
        sim.addIncident({ linkIds: inc.linkIds, source: 'live', durationS: null, ...effect, label: `${inc.category} (TomTom) on ${this.net.links[inc.linkIds[0]].road}` }),
      );
    }
    this.incidents = list;
  }

  liveIncidentLinks(): Set<number> {
    const out = new Set<number>();
    for (const inc of this.incidents) for (const id of inc.linkIds) out.add(id);
    return out;
  }
}
