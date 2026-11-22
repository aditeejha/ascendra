import clsx from 'clsx';
import { Bus, Flame, GraduationCap, Hospital, Landmark, Shield, ShoppingBag, TrainFront, type LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import {
  LINK_FLAG,
  SIGNAL_FLAG,
  VEHICLE_FLAG,
  congestionLevel,
  type CongestionLevel,
  type LinkKind,
  type NetLink,
  type NetworkInfo,
  type PoiKind,
  type Snapshot,
  type VehicleTuple,
} from '../../../shared/types';
import { CLASS_BY_CODE, CLASS_COLOR, LEVEL_COLOR, LEVEL_LABEL, linkLabel } from '../lib/format';

const ROAD_WIDTH: Record<LinkKind, number> = { highway: 11, arterial: 9.5, street: 7, lane: 4 };
const INSET = 6;

const POI_STYLE: Record<PoiKind, { icon: LucideIcon; color: string; rank: number }> = {
  station: { icon: TrainFront, color: '#2563eb', rank: 8 },
  bus: { icon: Bus, color: '#0f766e', rank: 7 },
  market: { icon: ShoppingBag, color: '#7c3aed', rank: 6 },
  attraction: { icon: Landmark, color: '#9333ea', rank: 5 },
  college: { icon: GraduationCap, color: '#b45309', rank: 4 },
  hospital: { icon: Hospital, color: '#dc2626', rank: 3 },
  fire: { icon: Flame, color: '#ea580c', rank: 3 },
  police: { icon: Shield, color: '#1f3d84', rank: 3 },
};

const SIGNAL_COLOR = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' };
const LEVEL_CODE: Record<CongestionLevel, string> = { free: 'f', moderate: 'm', heavy: 'h', congested: 'c' };
const CODE_LEVEL: Record<string, CongestionLevel> = { f: 'free', m: 'moderate', h: 'heavy', c: 'congested' };

export interface MapRoute {
  links: number[];
  color: string;
  width?: number;
  label?: string;
}

export interface MapMarker {
  linkId?: number | null;
  nodeId?: number | null;
  color: string;
  title?: string;
}

interface Geometry {
  pts: number[];
  cum: number[];
  d: string;
  mx: number;
  my: number;
  nx: number;
  ny: number;
}

export interface CityMapProps {
  network: NetworkInfo;
  snap: Snapshot | null;
  scores?: number[] | null;
  showVehicles?: boolean;
  showSignals?: boolean;
  showCongestion?: boolean;
  basemap?: boolean;
  routes?: MapRoute[];
  zoneCircle?: { node: number; radiusKm: number } | null;
  selectedNode?: number | null;
  selectedLink?: number | null;
  onNodeClick?: (id: number) => void;
  onLinkClick?: (id: number) => void;
  markers?: MapMarker[];
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

function offsetLine(flat: number[], off: number): number[] {
  const n = flat.length / 2;
  if (!off || n < 2) return flat.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let ny = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ]) {
      if (a < 0 || b >= n) continue;
      const dx = flat[b * 2] - flat[a * 2];
      const dy = flat[b * 2 + 1] - flat[a * 2 + 1];
      const len = Math.hypot(dx, dy) || 1;
      nx += dy / len;
      ny += -dx / len;
    }
    const l = Math.hypot(nx, ny) || 1;
    out.push(flat[i * 2] + (nx / l) * off, flat[i * 2 + 1] + (ny / l) * off);
  }
  return out;
}

function trimLine(flat: number[], inset: number): number[] {
  const n = flat.length / 2;
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
  const cut = Math.min(inset, total / 4);
  const at = (dist: number) => {
    let walked = 0;
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(flat[i * 2] - flat[i * 2 - 2], flat[i * 2 + 1] - flat[i * 2 - 1]);
      if (walked + d >= dist) {
        const f = d ? (dist - walked) / d : 0;
        return { i, x: flat[i * 2 - 2] + (flat[i * 2] - flat[i * 2 - 2]) * f, y: flat[i * 2 - 1] + (flat[i * 2 + 1] - flat[i * 2 - 1]) * f };
      }
      walked += d;
    }
    return { i: n - 1, x: flat[n * 2 - 2], y: flat[n * 2 - 1] };
  };
  const s = at(cut);
  const e = at(total - cut);
  const out = [s.x, s.y];
  for (let i = s.i; i < e.i; i++) out.push(flat[i * 2], flat[i * 2 + 1]);
  out.push(e.x, e.y);
  return out;
}

function pathOf(flat: number[]): string {
  let d = `M${flat[0].toFixed(1)} ${flat[1].toFixed(1)}`;
  for (let i = 2; i < flat.length; i += 2) d += `L${flat[i].toFixed(1)} ${flat[i + 1].toFixed(1)}`;
  return d;
}

function buildGeometry(net: NetworkInfo): Geometry[] {
  return net.links.map((link) => {
    const pts = trimLine(offsetLine(link.geometry, link.oneway ? 0 : ROAD_WIDTH[link.kind] / 4), INSET);
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
    const [mx, my, tx, ty] = pointAt({ pts, cum } as Geometry, 0.5, true);
    return { pts, cum, d: pathOf(pts), mx, my, nx: ty, ny: -tx };
  });
}

function pointAt(g: Pick<Geometry, 'pts' | 'cum'>, pos: number, withTangent = false): number[] {
  const total = g.cum[g.cum.length - 1];
  const target = Math.min(1, Math.max(0, pos)) * total;
  let i = 1;
  while (i < g.cum.length - 1 && g.cum[i] < target) i++;
  const seg = g.cum[i] - g.cum[i - 1] || 1;
  const f = (target - g.cum[i - 1]) / seg;
  const x0 = g.pts[i * 2 - 2];
  const y0 = g.pts[i * 2 - 1];
  const x1 = g.pts[i * 2] ?? x0;
  const y1 = g.pts[i * 2 + 1] ?? y0;
  const x = x0 + (x1 - x0) * f;
  const y = y0 + (y1 - y0) * f;
  if (!withTangent) return [x, y];
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  return [x, y, (x1 - x0) / len, (y1 - y0) / len];
}

export function segmentLinks(net: NetworkInfo): NetLink[] {
  return net.links.filter((l) => l.reverse < 0 || l.id < l.reverse);
}

const Basemap = memo(function Basemap({ network }: { network: NetworkInfo }) {
  const { meta } = network;
  const z = meta.zoom - 1;
  const size = 512;
  const ox = meta.tileOrigin.x;
  const oy = meta.tileOrigin.y;
  const tiles: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let tx = Math.floor(ox / size); tx <= Math.floor((ox + network.width) / size); tx++) {
    for (let ty = Math.floor(oy / size); ty <= Math.floor((oy + network.height) / size); ty++) tiles.push({ tx, ty, x: tx * size - ox, y: ty * size - oy });
  }
  return (
    <g opacity={0.42} style={{ filter: 'grayscale(1) contrast(0.95)' }} pointerEvents="none">
      {tiles.map((t) => (
        <image key={`${t.tx}-${t.ty}`} href={`https://tile.openstreetmap.org/${z}/${t.tx}/${t.ty}.png`} x={t.x} y={t.y} width={size} height={size} />
      ))}
    </g>
  );
});

const StaticLayer = memo(function StaticLayer({ network, compact, basemap }: { network: NetworkInfo; compact: boolean; basemap: boolean }) {
  const segs = useMemo(() => segmentLinks(network), [network]);
  const labels = useMemo(() => {
    if (compact) return [];
    const best = new Map<string, NetLink>();
    for (const l of segs) {
      if (l.kind === 'lane' || l.road === 'Unnamed road') continue;
      if (l.kind === 'street' && l.length < 400) continue;
      const cur = best.get(l.road);
      if (!cur || l.length > cur.length) best.set(l.road, l);
    }
    return [...best.values()].map((l) => {
      const g = l.geometry;
      const pairs: [number, number][] = [];
      for (let i = 0; i < g.length; i += 2) pairs.push([g[i], g[i + 1]]);
      if (g[0] > g[g.length - 2]) pairs.reverse();
      return { id: l.id, road: l.road, d: pathOf(pairs.flat()), kind: l.kind };
    });
  }, [segs, compact]);
  const centre = network.meta.centre;
  return (
    <g>
      <rect x={0} y={0} width={network.width} height={network.height} fill="#f4f6fb" />
      {basemap && <Basemap network={network} />}
      <defs>
        {labels.map((l) => (
          <path key={l.id} id={`road-label-${l.id}`} d={l.d} />
        ))}
      </defs>
      {segs.map((l) => (
        <path key={`o${l.id}`} d={pathOf(l.geometry)} fill="none" stroke="#c3cddd" strokeWidth={ROAD_WIDTH[l.kind] + 2.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {segs.map((l) => (
        <path key={`i${l.id}`} d={pathOf(l.geometry)} fill="none" stroke="#ffffff" strokeWidth={ROAD_WIDTH[l.kind]} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {labels.map((l) => (
        <text key={`t${l.id}`} fontSize={l.kind === 'street' ? 12 : 14} fontWeight={700} fill="#64748b" stroke="#ffffff" strokeWidth={4} paintOrder="stroke" letterSpacing={0.4} dy={-ROAD_WIDTH[l.kind] / 2 - 4}>
          <textPath href={`#road-label-${l.id}`} startOffset="50%" textAnchor="middle">
            {l.road.toUpperCase()}
          </textPath>
        </text>
      ))}
      {!compact &&
        network.nodes
          .filter((n) => n.exit)
          .map((n) => {
            const dx = n.x - centre.x;
            const dy = n.y - centre.y;
            const len = Math.hypot(dx, dy) || 1;
            const x = Math.min(network.width - 8, Math.max(8, n.x - (dx / len) * 30));
            const y = Math.min(network.height - 8, Math.max(16, n.y - (dy / len) * 30));
            return (
              <text key={`x${n.id}`} x={x} y={y} textAnchor={dx > 0 ? 'end' : 'start'} fontSize={13} fontWeight={700} fill="#15803d" stroke="#ffffff" strokeWidth={4} paintOrder="stroke">
                {n.exit}
              </text>
            );
          })}
    </g>
  );
});

const CongestionLayer = memo(function CongestionLayer({ network, geometry, levels }: { network: NetworkInfo; geometry: Geometry[]; levels: string }) {
  return (
    <g pointerEvents="none">
      {network.links.map((l, i) => {
        const level = CODE_LEVEL[levels[i]] ?? 'free';
        if (level === 'free' && l.kind === 'lane') return null;
        return (
          <path
            key={l.id}
            d={geometry[i].d}
            fill="none"
            stroke={LEVEL_COLOR[level]}
            strokeWidth={Math.max(2.4, ROAD_WIDTH[l.kind] / 2)}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={level === 'free' ? 0.5 : 0.92}
          />
        );
      })}
    </g>
  );
});

const PoiLayer = memo(function PoiLayer({ network, compact }: { network: NetworkInfo; compact: boolean }) {
  const placed = useMemo(() => {
    const items = network.nodes
      .filter((n) => n.poi)
      .map((n) => ({ n, style: POI_STYLE[n.poi!.kind] }))
      .sort((a, b) => b.style.rank - a.style.rank);
    const boxes: [number, number, number, number][] = items.map(({ n }) => [n.x + 4, n.y - 32, n.x + 32, n.y - 4]);
    return items.map(({ n, style }) => {
      const cx = n.x + 18;
      const cy = n.y - 18;
      let label = false;
      if (!compact) {
        const w = n.poi!.name.length * 7 + 8;
        const box: [number, number, number, number] = [cx + 14, cy - 10, cx + 14 + w, cy + 10];
        const hit = boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        if (!hit && box[2] < network.width) {
          boxes.push(box);
          label = true;
        }
      }
      return { n, style, cx, cy, label };
    });
  }, [network, compact]);
  return (
    <g pointerEvents="none">
      {placed.map(({ n, style, cx, cy, label }) => {
        const Icon = style.icon;
        return (
          <g key={n.id}>
            <circle cx={cx} cy={cy} r={12} fill="#ffffff" stroke={style.color} strokeWidth={1.8} />
            <Icon x={cx - 7} y={cy - 7} width={14} height={14} color={style.color} strokeWidth={2.2} />
            {label && (
              <text x={cx + 16} y={cy + 4.5} fontSize={13} fontWeight={650} fill="#0b1730" stroke="#ffffff" strokeWidth={4} paintOrder="stroke">
                {n.poi!.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

const VehicleLayer = memo(function VehicleLayer({ vehicles, geometry }: { vehicles: VehicleTuple[]; geometry: Geometry[] }) {
  return (
    <g pointerEvents="none">
      {vehicles.map(([id, linkId, pos, cls, flags]) => {
        const g = geometry[linkId];
        if (!g) return null;
        const [x, y] = pointAt(g, pos);
        if (flags & VEHICLE_FLAG.priority) {
          return (
            <g key={id} className="vehicle-dot" style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle r={7} fill="#ef4444" className="pulse-ring" />
              <circle r={5.5} fill="#dc2626" stroke="#ffffff" strokeWidth={1.8} />
            </g>
          );
        }
        const r = cls === 4 ? 5.2 : cls === 2 ? 4.6 : cls === 1 ? 2.9 : 3.7;
        return (
          <circle
            key={id}
            className="vehicle-dot"
            r={r}
            fill={CLASS_COLOR[CLASS_BY_CODE[cls]]}
            opacity={flags & VEHICLE_FLAG.evacuating ? 1 : 0.9}
            style={{ transform: `translate(${x}px, ${y}px)` }}
          />
        );
      })}
    </g>
  );
});

function signalColors(phase: number, state: number): { ns: string; ew: string } {
  const active = state === 0 ? SIGNAL_COLOR.green : state === 1 ? SIGNAL_COLOR.yellow : SIGNAL_COLOR.red;
  if (state === 2) return { ns: SIGNAL_COLOR.red, ew: SIGNAL_COLOR.red };
  return phase === 0 ? { ns: active, ew: SIGNAL_COLOR.red } : { ns: SIGNAL_COLOR.red, ew: active };
}

export function CityMap({
  network,
  snap,
  scores,
  showVehicles = true,
  showSignals = true,
  showCongestion = true,
  basemap = true,
  routes = [],
  zoneCircle,
  selectedNode,
  selectedLink,
  onNodeClick,
  onLinkClick,
  markers = [],
  compact = false,
  className,
  ariaLabel = 'City traffic map',
}: CityMapProps) {
  const geometry = useMemo(() => buildGeometry(network), [network]);
  const layerScores = scores ?? snap?.linkScore ?? null;
  const levels = useMemo(() => (layerScores ? layerScores.map((s) => LEVEL_CODE[congestionLevel(s ?? 0)]).join('') : ''), [layerScores]);
  const signalNodes = useMemo(() => network.nodes.filter((n) => n.signal), [network]);
  const flagged = snap ? network.links.filter((l) => snap.linkFlags[l.id]) : [];
  const zone = zoneCircle ? { n: network.nodes[zoneCircle.node], r: (zoneCircle.radiusKm * 1000) / network.meta.metersPerPixel } : null;

  return (
    <svg viewBox={`0 0 ${network.width} ${network.height}`} className={clsx('block h-auto w-full select-none', className)} role="img" aria-label={ariaLabel}>
      <defs>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      <StaticLayer network={network} compact={compact} basemap={basemap} />

      {zone && <circle cx={zone.n.x} cy={zone.n.y} r={zone.r} fill="rgb(220 38 38 / 0.08)" stroke="#dc2626" strokeWidth={2} strokeDasharray="10 7" />}

      {flagged
        .filter((l) => snap!.linkFlags[l.id] & LINK_FLAG.measured)
        .map((l) => (
          <path key={`ms${l.id}`} d={geometry[l.id].d} fill="none" stroke="#0a1a3a" strokeWidth={ROAD_WIDTH[l.kind] / 2 + 4} strokeLinecap="round" opacity={0.55} pointerEvents="none" />
        ))}

      {showCongestion && levels && <CongestionLayer network={network} geometry={geometry} levels={levels} />}

      {flagged.map((l) => {
        const flags = snap!.linkFlags[l.id];
        const g = geometry[l.id];
        return (
          <g key={`f${l.id}`} pointerEvents="none">
            {flags & LINK_FLAG.closed ? <path d={g.d} fill="none" stroke="#7f1d1d" strokeWidth={5} strokeDasharray="4 5" /> : null}
            {flags & LINK_FLAG.contraflow ? <path d={g.d} fill="none" stroke="#2563eb" strokeWidth={4} markerEnd="url(#arrow-blue)" /> : null}
            {flags & LINK_FLAG.greenWave ? <path d={g.d} fill="none" stroke="#10b981" strokeWidth={6} strokeLinecap="round" className="green-wave" /> : null}
          </g>
        );
      })}

      {routes.map((route, i) =>
        route.links.length ? (
          <path
            key={i}
            d={pathOf(route.links.flatMap((lid) => geometry[lid].pts))}
            fill="none"
            stroke={route.color}
            strokeWidth={route.width ?? Math.max(4, 10 - i * 2)}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.85}
          >
            {route.label && <title>{route.label}</title>}
          </path>
        ) : null,
      )}

      {selectedLink !== null && selectedLink !== undefined && geometry[selectedLink] && (
        <path d={geometry[selectedLink].d} fill="none" stroke="#1d4ed8" strokeWidth={12} strokeLinecap="round" opacity={0.35} />
      )}

      {showVehicles && snap && <VehicleLayer vehicles={snap.vehicles} geometry={geometry} />}

      {showSignals &&
        (snap
          ? snap.signals.map(([nodeId, phase, state, flags]) => {
              const n = network.nodes[nodeId];
              const colors = signalColors(phase, state);
              return (
                <g key={n.id} pointerEvents="none">
                  {flags & SIGNAL_FLAG.preempted ? <circle cx={n.x} cy={n.y} r={13} fill="#10b981" className="pulse-ring" /> : null}
                  <rect
                    x={n.x - 8}
                    y={n.y - 8}
                    width={16}
                    height={16}
                    rx={4}
                    fill="#0a1a3a"
                    stroke={flags & SIGNAL_FLAG.fault ? '#f59e0b' : flags & SIGNAL_FLAG.evacuation ? '#dc2626' : flags & SIGNAL_FLAG.preempted ? '#10b981' : '#ffffff'}
                    strokeWidth={flags & (SIGNAL_FLAG.fault | SIGNAL_FLAG.evacuation | SIGNAL_FLAG.preempted) ? 2.4 : 1.4}
                    className={flags & SIGNAL_FLAG.fault ? 'blink' : undefined}
                  />
                  <rect x={n.x - 1.5} y={n.y - 5.6} width={3} height={11.2} rx={1.3} fill={colors.ns} />
                  <rect x={n.x - 5.6} y={n.y - 1.5} width={11.2} height={3} rx={1.3} fill={colors.ew} />
                </g>
              );
            })
          : signalNodes.map((n) => <rect key={n.id} x={n.x - 7} y={n.y - 7} width={14} height={14} rx={3.5} fill="#0a1a3a" stroke="#ffffff" strokeWidth={1.4} pointerEvents="none" />))}

      {flagged
        .filter((l) => snap!.linkFlags[l.id] & (LINK_FLAG.incident | LINK_FLAG.liveIncident))
        .map((l) => {
          const g = geometry[l.id];
          const live = snap!.linkFlags[l.id] & LINK_FLAG.liveIncident;
          const x = g.mx + g.nx * 14;
          const y = g.my + g.ny * 14;
          return (
            <g key={`inc${l.id}`} pointerEvents="none">
              <circle cx={x} cy={y} r={10} fill={live ? '#dc2626' : '#ffffff'} stroke="#dc2626" strokeWidth={2} />
              <text x={x} y={y + 4.5} textAnchor="middle" fontSize={14} fontWeight={800} fill={live ? '#ffffff' : '#dc2626'}>
                !
              </text>
            </g>
          );
        })}

      {markers.map((m, i) => {
        let x: number;
        let y: number;
        if (m.linkId !== null && m.linkId !== undefined && geometry[m.linkId]) {
          const g = geometry[m.linkId];
          x = g.mx + g.nx * 14;
          y = g.my + g.ny * 14;
        } else if (m.nodeId !== null && m.nodeId !== undefined) {
          x = network.nodes[m.nodeId].x;
          y = network.nodes[m.nodeId].y;
        } else return null;
        return (
          <g key={`m${i}`}>
            <path d={`M ${x} ${y} l -9 -15 a 10 10 0 1 1 18 0 z`} fill={m.color} stroke="#ffffff" strokeWidth={1.8} />
            <circle cx={x} cy={y - 19} r={3.6} fill="#ffffff" />
            {m.title && <title>{m.title}</title>}
          </g>
        );
      })}

      <PoiLayer network={network} compact={compact} />

      {selectedNode !== null && selectedNode !== undefined && network.nodes[selectedNode] && (
        <circle cx={network.nodes[selectedNode].x} cy={network.nodes[selectedNode].y} r={17} fill="none" stroke="#1d4ed8" strokeWidth={3} />
      )}

      {onLinkClick &&
        network.links.map((l) => {
          const score = layerScores?.[l.id] ?? 0;
          return (
            <path
              key={`h${l.id}`}
              d={geometry[l.id].d}
              fill="none"
              stroke="transparent"
              strokeWidth={ROAD_WIDTH[l.kind] / 2 + 8}
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={() => onLinkClick(l.id)}
            >
              <title>{`${linkLabel(network, l)} · ${LEVEL_LABEL[congestionLevel(score)]} (${score.toFixed(2)})`}</title>
            </path>
          );
        })}

      {onNodeClick &&
        network.nodes.map((n) => (
          <circle key={`hn${n.id}`} cx={n.x} cy={n.y} r={n.signal || n.poi ? 15 : 9} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onNodeClick(n.id)}>
            <title>{n.poi ? `${n.poi.name} · ${n.name}` : n.name}</title>
          </circle>
        ))}

      <text x={network.width - 10} y={network.height - 10} textAnchor="end" fontSize={12} fill="#64748b" stroke="#ffffff" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
        Map data © OpenStreetMap contributors
      </text>
    </svg>
  );
}

export function MapLegend({ showClasses = true, showLive = false, className }: { showClasses?: boolean; showLive?: boolean; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted', className)}>
      {(['free', 'moderate', 'heavy', 'congested'] as const).map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full" style={{ background: LEVEL_COLOR[level] }} />
          {LEVEL_LABEL[level]}
        </span>
      ))}
      {showClasses && (
        <>
          <span className="hidden h-4 w-px bg-line sm:block" />
          {(
            [
              ['private', 'Car'],
              ['two_wheeler', 'Two-wheeler'],
              ['cargo', 'Cargo'],
              ['bus', 'Bus'],
              ['emergency', 'Emergency'],
            ] as const
          ).map(([cls, label]) => (
            <span key={cls} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: CLASS_COLOR[cls] }} />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full bg-emerald-500" />
            Green wave
          </span>
        </>
      )}
      {showLive && (
        <>
          <span className="hidden h-4 w-px bg-line sm:block" />
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-5 rounded-full bg-navy-900/60" />
            Measured by TomTom
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex size-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white">!</span>
            Live incident
          </span>
        </>
      )}
    </div>
  );
}

export function MapSkeleton({ network }: { network?: NetworkInfo | null }) {
  const ratio = network ? network.height / network.width : 1;
  return <div className="skeleton w-full rounded-xl" style={{ aspectRatio: `${1 / ratio}` }} />;
}
