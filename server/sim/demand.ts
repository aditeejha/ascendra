import type { VehicleClass } from '../../shared/types';
import { pick, randInt, type Rng } from './random';

const WEEKDAY = [
  0.08, 0.05, 0.04, 0.04, 0.07, 0.18, 0.42, 0.82, 1.0, 0.94, 0.72, 0.62, 0.64, 0.62, 0.6, 0.66, 0.8, 0.97, 1.0,
  0.86, 0.62, 0.42, 0.26, 0.13,
];
const WEEKEND = [
  0.1, 0.07, 0.05, 0.04, 0.05, 0.08, 0.18, 0.32, 0.48, 0.6, 0.7, 0.74, 0.76, 0.74, 0.72, 0.72, 0.74, 0.78, 0.76,
  0.66, 0.52, 0.38, 0.24, 0.14,
];

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SECONDS = 86400;

export function dayIndex(t: number): number {
  return Math.floor(t / DAY_SECONDS) % 7;
}

export function isWeekend(t: number): boolean {
  return dayIndex(t) >= 5;
}

export function hourOfDay(t: number): number {
  return (t % DAY_SECONDS) / 3600;
}

export function demandProfile(t: number): number {
  const profile = isWeekend(t) ? WEEKEND : WEEKDAY;
  const h = hourOfDay(t);
  const h0 = Math.floor(h);
  const frac = h - h0;
  return profile[h0] * (1 - frac) + profile[(h0 + 1) % 24] * frac;
}

export function isCargoRestricted(t: number): boolean {
  if (isWeekend(t)) return false;
  const h = hourOfDay(t);
  return (h >= 8 && h < 11) || (h >= 17 && h < 20);
}

export function clockOf(t: number): string {
  const s = Math.floor(t % DAY_SECONDS);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function classMix(t: number): { cls: VehicleClass[]; weights: number[] } {
  const h = hourOfDay(t);
  const night = h >= 22 || h < 6;
  const cargo = night ? 0.3 : isCargoRestricted(t) ? 0.06 : 0.13;
  const twoWheeler = night ? 0.18 : 0.32;
  return { cls: ['private', 'two_wheeler', 'cargo'], weights: [1 - cargo - twoWheeler, twoWheeler, cargo] };
}

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function makePlate(rng: Rng, cls: VehicleClass): string {
  const state = cls === 'cargo' && rng() < 0.35 ? pick(rng, ['BR 01', 'WB 23', 'JH 01', 'JH 10']) : 'JH 15';
  const series = pick(rng, LETTERS.split('')) + pick(rng, LETTERS.split(''));
  return `${state} ${series} ${String(randInt(rng, 1, 9999)).padStart(4, '0')}`;
}

export const PCU: Record<VehicleClass, number> = {
  private: 1,
  two_wheeler: 0.5,
  cargo: 2.5,
  emergency: 1.5,
};

export const CLASS_SPEED: Record<VehicleClass, number> = {
  private: 1,
  two_wheeler: 1,
  cargo: 0.85,
  emergency: 1.3,
};

export const CLASS_CODE: Record<VehicleClass, number> = {
  private: 0,
  two_wheeler: 1,
  cargo: 2,
  emergency: 3,
};
