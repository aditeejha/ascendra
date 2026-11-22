import type { VehicleClass } from '../../shared/types';
import { cityConfig } from '../config';
import { pick, randInt, type Rng } from './random';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SECONDS = 86400;

export function dayIndex(t: number): number {
  return Math.floor(t / DAY_SECONDS) % 7;
}

export function isOffDay(t: number): boolean {
  return cityConfig().rules.weeklyOff.includes(DAY_NAMES[dayIndex(t)]);
}

export function hourOfDay(t: number): number {
  return (t % DAY_SECONDS) / 3600;
}

export function demandProfile(t: number): number {
  const d = cityConfig().demand;
  const profile = isOffDay(t) ? d.offDayProfile : d.weekdayProfile;
  const h = hourOfDay(t);
  const h0 = Math.floor(h);
  const frac = h - h0;
  return profile[h0] * (1 - frac) + profile[(h0 + 1) % 24] * frac;
}

export function isCargoRestricted(t: number): boolean {
  if (isOffDay(t)) return false;
  const h = hourOfDay(t);
  return cityConfig().rules.freightBanHours.some(([a, b]) => h >= a && h < b);
}

export function clockOf(t: number): string {
  const s = Math.floor(t % DAY_SECONDS);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function classMix(t: number): { cls: VehicleClass[]; weights: number[] } {
  const d = cityConfig().demand;
  const h = hourOfDay(t);
  const night = h >= 22 || h < 6;
  const cargo = night ? d.cargoShare.night : isCargoRestricted(t) ? d.cargoShare.restricted : d.cargoShare.day;
  const twoWheeler = night ? d.twoWheelerShare.night : d.twoWheelerShare.day;
  const bus = night ? d.busShare.night : d.busShare.day;
  return { cls: ['private', 'two_wheeler', 'cargo', 'bus'], weights: [1 - cargo - twoWheeler - bus, twoWheeler, cargo, bus] };
}

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function makePlate(rng: Rng, cls: VehicleClass): string {
  const rules = cityConfig().rules;
  const state = cls === 'cargo' && rng() < 0.35 && rules.outOfStatePlates.length ? pick(rng, rules.outOfStatePlates) : rules.platePrefix;
  const series = pick(rng, LETTERS.split('')) + pick(rng, LETTERS.split(''));
  return `${state} ${series} ${String(randInt(rng, 1, 9999)).padStart(4, '0')}`;
}

export function liveSimTime(timezone: string, now = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.floor(localAsUtc / 1000) - 4 * DAY_SECONDS;
}

export const PCU: Record<VehicleClass, number> = {
  private: 1,
  two_wheeler: 0.5,
  cargo: 2.5,
  bus: 3,
  emergency: 1.5,
};

export const CLASS_SPEED: Record<VehicleClass, number> = {
  private: 1,
  two_wheeler: 1,
  cargo: 0.85,
  bus: 0.8,
  emergency: 1.3,
};

export const CLASS_CODE: Record<VehicleClass, number> = {
  private: 0,
  two_wheeler: 1,
  cargo: 2,
  emergency: 3,
  bus: 4,
};
