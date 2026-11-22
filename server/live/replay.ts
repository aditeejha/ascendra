import type { JunctionSituation, ReplayPoint, ReplayStatus, ReplaySummary } from '../../shared/types';
import type { JunctionForecaster } from '../sim/junction';
import type { Simulation } from '../sim/engine';
import { DAY_NAMES } from '../sim/demand';

export interface DatasetRow {
  minute: number;
  dow: number;
  car: number;
  bike: number;
  bus: number;
  truck: number;
  total: number;
  situation: JunctionSituation | null;
}

const SITUATIONS: JunctionSituation[] = ['low', 'normal', 'high', 'heavy'];
const MAX_ROWS = 60_000;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if ((ch === ',' || ch === ';' || ch === '\t') && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseMinute(value: string): number | null {
  const v = value.trim();
  const ampm = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/p/i.test(ampm[3])) h += 12;
    return h * 60 + Number(ampm[2]);
  }
  const hm = v.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  return null;
}

export function parseTrafficCsv(text: string): { rows: DatasetRow[]; warnings: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) throw new Error('The file needs a header row and at least two data rows.');
  if (lines.length > MAX_ROWS + 1) throw new Error(`The file is too long; keep it under ${MAX_ROWS.toLocaleString()} rows.`);
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (re: RegExp, skip: number[] = []) => header.findIndex((h, i) => re.test(h) && !skip.includes(i));
  const car = find(/car/);
  const bike = find(/bike|two.?wheel|motor/);
  const bus = find(/bus/);
  const truck = find(/truck|lorry|cargo|heavy|goods/);
  const classCols = [car, bike, bus, truck].filter((i) => i >= 0);
  const exactTotal = find(/^total/);
  const col = {
    time: find(/^(time|timestamp|datetime|date ?time)/),
    day: find(/day of the week|weekday|^day$|day_?name/),
    car,
    bike,
    bus,
    truck,
    total: exactTotal >= 0 ? exactTotal : find(/total|count|volume|vehicles/, classCols),
    situation: find(/situation|status|level|label/),
  };
  if (col.time < 0) throw new Error('No time column found. Add a column called "Time" (e.g. 08:15 or 8:15:00 AM).');
  if (col.total < 0 && col.car < 0) throw new Error('No vehicle counts found. Add a "Total" column or per-class columns such as CarCount, BikeCount, BusCount, TruckCount.');
  const warnings: string[] = [];
  if (col.day < 0) warnings.push('No day-of-week column: days are numbered from Monday in row order.');
  if (col.car < 0) warnings.push('No per-class counts: a typical Indian mix (55% cars, 30% two-wheelers, 15% heavy) is assumed.');
  const rows: DatasetRow[] = [];
  let dayCounter = 0;
  let lastMinute = -1;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const minute = parseMinute(cells[col.time] ?? '');
    if (minute === null) continue;
    if (minute <= lastMinute) dayCounter++;
    lastMinute = minute;
    const num = (idx: number) => (idx >= 0 ? Math.max(0, Number(cells[idx]) || 0) : 0);
    let car = num(col.car);
    let bike = num(col.bike);
    let bus = num(col.bus);
    let truck = num(col.truck);
    let total = col.total >= 0 ? num(col.total) : car + bike + bus + truck;
    if (col.car < 0) {
      car = Math.round(total * 0.55);
      bike = Math.round(total * 0.3);
      truck = Math.round(total * 0.1);
      bus = total - car - bike - truck;
    }
    if (!total) total = car + bike + bus + truck;
    const dayName = col.day >= 0 ? (cells[col.day] ?? '').trim().toLowerCase() : '';
    const dowFromName = DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(dayName.slice(0, 3)) && dayName.length >= 3);
    const label = col.situation >= 0 ? ((cells[col.situation] ?? '').trim().toLowerCase() as JunctionSituation) : null;
    rows.push({
      minute,
      dow: dowFromName >= 0 ? dowFromName : dayCounter % 7,
      car,
      bike,
      bus,
      truck,
      total,
      situation: label && SITUATIONS.includes(label) ? label : null,
    });
  }
  if (rows.length < 2) throw new Error('No usable rows: check the time column format.');
  return { rows, warnings };
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export class Replay {
  name: string | null = null;
  rows: DatasetRow[] = [];
  warnings: string[] = [];
  uploadedAt: string | null = null;
  running = false;
  index = 0;
  speed = 32;
  rowStartT = 0;
  private mean = 1;
  private history: ReplayPoint[] = [];
  private preds = new Map<number, { count15: number; count30: number; sit15: JunctionSituation; sit30: JunctionSituation }>();
  private errs: { model: number; base: number; sitHit: number | null }[] = [];

  constructor(private model: () => JunctionForecaster | null) {}

  load(name: string, text: string): ReplaySummary {
    const { rows, warnings } = parseTrafficCsv(text);
    this.stop();
    this.name = name;
    this.rows = rows;
    this.warnings = warnings;
    this.uploadedAt = new Date().toISOString();
    this.mean = rows.reduce((a, r) => a + r.total, 0) / rows.length || 1;
    this.index = 0;
    this.history = [];
    this.preds.clear();
    this.errs = [];
    return this.summary()!;
  }

  summary(): ReplaySummary | null {
    if (!this.name) return null;
    const totals = this.rows.map((r) => r.total);
    const sum = (k: 'car' | 'bike' | 'bus' | 'truck') => this.rows.reduce((a, r) => a + r[k], 0);
    const all = sum('car') + sum('bike') + sum('bus') + sum('truck') || 1;
    return {
      name: this.name,
      rows: this.rows.length,
      days: Math.ceil(this.rows.length / 96),
      meanTotal: Math.round(this.mean),
      maxTotal: Math.max(...totals),
      shares: { car: sum('car') / all, bike: sum('bike') / all, bus: sum('bus') / all, truck: sum('truck') / all },
      hasLabels: this.rows.some((r) => r.situation !== null),
      warnings: this.warnings,
      uploadedAt: this.uploadedAt!,
    };
  }

  startT(): number {
    const r = this.rows[this.index];
    return r.dow * 86400 + r.minute * 60;
  }

  start(speed: number): void {
    if (!this.rows.length) throw new Error('Upload a dataset first.');
    if (this.index >= this.rows.length - 1) {
      this.index = 0;
      this.history = [];
      this.preds.clear();
      this.errs = [];
    }
    this.speed = speed;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  apply(sim: Simulation): void {
    const r = this.rows[this.index];
    const level = Math.min(2.2, Math.max(0.04, (r.total / this.mean) * 0.75));
    const total = r.car + r.bike + r.bus + r.truck || 1;
    sim.setDemandOverride({ level, mix: { cls: ['private', 'two_wheeler', 'cargo', 'bus'], weights: [r.car / total, r.bike / total, r.truck / total, r.bus / total] } });
    this.record();
  }

  advance(sim: Simulation): boolean {
    if (!this.running) return false;
    if (sim.t < this.rowStartT + 900) return false;
    this.index++;
    this.rowStartT += 900;
    if (this.index >= this.rows.length) {
      this.index = this.rows.length - 1;
      this.running = false;
      return true;
    }
    this.apply(sim);
    return false;
  }

  private features(i: number): number[] {
    const r = this.rows[i];
    const tot = (k: number) => this.rows[Math.max(0, i - k)].total;
    const last4 = [tot(0), tot(1), tot(2), tot(3)];
    const mean4 = last4.reduce((a, v) => a + v, 0) / 4;
    const std4 = Math.sqrt(last4.reduce((a, v) => a + (v - mean4) ** 2, 0) / 3);
    const heavy = r.bus + r.truck;
    const angle = (r.minute / 1440) * Math.PI * 2;
    return [r.car, r.bike, heavy, r.total, tot(1), tot(2), tot(3), tot(4), mean4, std4, r.total - tot(1), r.total ? heavy / r.total : 0, r.total ? r.bike / r.total : 0, Math.sin(angle), Math.cos(angle), r.dow, r.dow >= 5 ? 1 : 0];
  }

  private record(): void {
    const i = this.index;
    const r = this.rows[i];
    const m = this.model();
    const made15 = this.preds.get(i - 1);
    const made30 = this.preds.get(i - 2);
    let now: JunctionSituation | null = null;
    if (m) {
      const x = this.features(i);
      now = m.situation(0, x).label;
      this.preds.set(i, { count15: Math.round(m.count(15, x)), count30: Math.round(m.count(30, x)), sit15: m.situation(15, x).label, sit30: m.situation(30, x).label });
      this.preds.delete(i - 3);
    }
    if (made15 && i > 0) {
      this.errs.push({
        model: Math.abs(made15.count15 - r.total),
        base: Math.abs(this.rows[i - 1].total - r.total),
        sitHit: r.situation ? Number(made15.sit15 === r.situation) : null,
      });
    }
    this.history.push({
      index: i,
      clock: clock(r.minute),
      day: DAY_NAMES[r.dow],
      actual: r.total,
      car: r.car,
      bike: r.bike,
      heavy: r.bus + r.truck,
      situation: r.situation,
      modelSituation: now,
      pred15: made15?.count15 ?? null,
      pred30: made30?.count30 ?? null,
      predSituation15: made15?.sit15 ?? null,
    });
    if (this.history.length > 400) this.history.shift();
  }

  status(): ReplayStatus {
    const n = this.errs.length;
    const labelled = this.errs.filter((e) => e.sitHit !== null);
    const next = this.preds.get(this.index);
    return {
      dataset: this.summary(),
      running: this.running,
      index: this.index,
      speed: this.speed,
      current: this.history[this.history.length - 1] ?? null,
      next: next ? { count15: next.count15, count30: next.count30, situation15: next.sit15, situation30: next.sit30 } : null,
      history: this.history.slice(-192),
      accuracy: {
        n,
        mae15: n ? Math.round((this.errs.reduce((a, e) => a + e.model, 0) / n) * 10) / 10 : null,
        maePersistence15: n ? Math.round((this.errs.reduce((a, e) => a + e.base, 0) / n) * 10) / 10 : null,
        situationAcc15: labelled.length ? Math.round((labelled.reduce((a, e) => a + (e.sitHit ?? 0), 0) / labelled.length) * 1000) / 1000 : null,
      },
    };
  }
}
