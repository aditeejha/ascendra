import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LinkKind } from '../shared/types';

export interface KindDefaults {
  lanesPerDirection: number;
  speedKmh: number;
  maxWeightT: number | null;
}

export interface CityConfig {
  city: string;
  region: string;
  country: string;
  geocodeQuery: string;
  timezone: string;
  studyRadiusKm: number;
  mapZoom: number;
  roads: Record<string, LinkKind>;
  kindDefaults: Record<LinkKind, KindDefaults>;
  network: {
    mergeJunctionsWithinM: number;
    pruneDeadEndKinds: LinkKind[];
    poiSnapM: number;
    signalSnapM: number;
    inferSignals: { minMajorSegments: number; orMajorSegments: number; withStreetSegments: number; minSpacingM: number };
    hospitalNameExclude: string;
    landmarkNamingM: number;
    restrictedZoneKm: number;
    cameraSites: number;
    exitMergeM: number;
  };
  rules: {
    weeklyOff: string[];
    freightBanHours: [number, number][];
    platePrefix: string;
    outOfStatePlates: string[];
  };
  demand: {
    baseTripsPerSecond: number;
    minTripKm: number;
    weekdayProfile: number[];
    offDayProfile: number[];
    twoWheelerShare: { day: number; night: number };
    cargoShare: { day: number; restricted: number; night: number };
    busShare: { day: number; night: number };
    connectedShare: number;
  };
  evacuation: { radiiKm: number[] };
  live: {
    weatherIntervalMin: number;
    tomtom: { flowSamples: number; flowIntervalMin: number; incidentIntervalMin: number; dailyBudget: number };
  };
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'server', 'data');

let cached: CityConfig | null = null;

export function cityConfig(): CityConfig {
  if (!cached) {
    const file = process.env.CITY_CONFIG ? path.resolve(process.env.CITY_CONFIG) : path.join(ROOT, 'config', 'city.json');
    cached = JSON.parse(readFileSync(file, 'utf8')) as CityConfig;
  }
  return cached;
}

export function citySlug(config = cityConfig()): string {
  return config.city.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
