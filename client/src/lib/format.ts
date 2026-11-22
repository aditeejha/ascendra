import { congestionLevel, type CongestionLevel, type NetLink, type NetworkInfo, type VehicleClass } from '../../../shared/types';

export const LEVEL_COLOR: Record<CongestionLevel, string> = {
  free: '#16a34a',
  moderate: '#eab308',
  heavy: '#f97316',
  congested: '#dc2626',
};

export const LEVEL_LABEL: Record<CongestionLevel, string> = {
  free: 'Free flow',
  moderate: 'Moderate',
  heavy: 'Heavy',
  congested: 'Congested',
};

export const CLASS_COLOR: Record<VehicleClass, string> = {
  private: '#1f3d84',
  two_wheeler: '#0ea5e9',
  cargo: '#b45309',
  bus: '#7c3aed',
  emergency: '#dc2626',
};

export const CLASS_BY_CODE: VehicleClass[] = ['private', 'two_wheeler', 'cargo', 'emergency', 'bus'];

export function scoreColor(score: number): string {
  return LEVEL_COLOR[congestionLevel(score)];
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function minutes(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(digits)} min`;
}

export function seconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

export function rupees(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `₹${v.toLocaleString('en-IN')}`;
}

const DIR_WORD = { N: 'northbound', S: 'southbound', E: 'eastbound', W: 'westbound' } as const;

export function linkLabel(net: NetworkInfo, link: NetLink): string {
  return `${link.road} ${DIR_WORD[link.dir]}`;
}

export function linkWhere(net: NetworkInfo, link: NetLink): string {
  return `${net.nodes[link.from].name} → ${net.nodes[link.to].name}`;
}

export function nodeLabel(net: NetworkInfo, id: number): string {
  const n = net.nodes[id];
  return n.poi ? `${n.poi.name} (${n.name})` : n.name;
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
