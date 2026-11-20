import clsx from 'clsx';
import { Flame, Hospital, Shield, ShoppingBag, TrainFront, Warehouse, type LucideIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import {
  LINK_FLAG,
  SIGNAL_FLAG,
  VEHICLE_FLAG,
  congestionLevel,
  type LinkKind,
  type NetLink,
  type NetworkInfo,
  type PoiKind,
  type Snapshot,
  type VehicleTuple,
} from '../../../shared/types';
import { CLASS_BY_CODE, CLASS_COLOR, LEVEL_COLOR, LEVEL_LABEL, linkLabel } from '../lib/format';

const ROAD_WIDTH: Record<LinkKind, number> = { ring: 18, arterial: 16, street: 12, lane: 8 };
const INSET = 11;

const POI_STYLE: Record<PoiKind, { icon: LucideIcon; color: string }> = {
  hospital: { icon: Hospital, color: '#dc2626' },
  fire: { icon: Flame, color: '#ea580c' },
  police: { icon: Shield, color: '#1f3d84' },
  depot: { icon: Warehouse, color: '#b45309' },
  station: { icon: TrainFront, color: '#2563eb' },
  market: { icon: ShoppingBag, color: '#7c3aed' },
};

const SIGNAL_COLOR = { green: '#22c55e', yellow: '#facc15', red: '#ef4444' };

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
  sx: number;
  sy: number;
  ex: number;
  ey: number;
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
  routes?: MapRoute[];
  zone?: number[] | null;
  selectedNode?: number | null;
  selectedLink?: number | null;
  onNodeClick?: (id: number) => void;
  onLinkClick?: (id: number) => void;
  markers?: MapMarker[];
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
}

function buildGeometry(net: NetworkInfo): Geometry[] {
  return net.links.map((link) => {
    const a = net.nodes[link.from];
    const b = net.nodes[link.to];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const nx = uy;
    const ny = -ux;
    const off = ROAD_WIDTH[link.kind] / 4;
    const sx = a.x + ux * INSET + nx * off;
    const sy = a.y + uy * INSET + ny * off;
    const ex = b.x - ux * INSET + nx * off;
    const ey = b.y - uy * INSET + ny * off;
    return { sx, sy, ex, ey, mx: (sx + ex) / 2, my: (sy + ey) / 2, nx, ny };
  });
}

function segments(net: NetworkInfo): NetLink[] {
  return net.links.filter((l) => l.id < l.reverse);
}

const StaticLayer = memo(function StaticLayer({ network, compact }: { network: NetworkInfo; compact: boolean }) {
  const cols = Math.max(...network.nodes.map((n) => n.c)) + 1;
  const rows = Math.max(...network.nodes.map((n) => n.r)) + 1;
  const at = (r: number, c: number) => network.nodes[r * cols + c];
  const blocks: { x: number; y: number; w: number; h: number; fill: string; label?: string }[] = [];
  const special: Record<string, { fill: string; label: string }> = {
    '3,4': { fill: '#dcefe1', label: 'City Park' },
    '0,1': { fill: '#d8e9fb', label: 'Lake' },
    '1,5': { fill: '#dcefe1', label: 'Botanical Garden' },
  };
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = at(r, c);
      const b = at(r + 1, c + 1);
      const pad = 13;
      const s = special[`${r},${c}`];
      blocks.push({ x: a.x + pad, y: a.y + pad, w: b.x - a.x - pad * 2, h: b.y - a.y - pad * 2, fill: s?.fill ?? '#eaeff6', label: s?.label });
    }
  }
  const segs = segments(network);
  const exitStubs = network.nodes
    .filter((n) => n.exit)
    .map((n) => {
      const dir = n.r === 0 ? [0, -1] : n.r === rows - 1 ? [0, 1] : n.c === 0 ? [-1, 0] : [1, 0];
      return { node: n, dx: dir[0], dy: dir[1] };
    });

  return (
    <g>
      <rect x={0} y={0} width={network.width} height={network.height} fill="#f6f8fc" />
      {blocks.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} fill={b.fill} />
          {b.label && !compact && (
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={500} fill="#5b8a6b" opacity={0.9}>
              {b.label}
            </text>
          )}
        </g>
      ))}
      {exitStubs.map(({ node, dx, dy }) => (
        <g key={node.id}>
          <line x1={node.x} y1={node.y} x2={node.x + dx * 46} y2={node.y + dy * 46} stroke="#cfd7e4" strokeWidth={20} strokeLinecap="round" />
          <line x1={node.x} y1={node.y} x2={node.x + dx * 46} y2={node.y + dy * 46} stroke="#ffffff" strokeWidth={16} strokeLinecap="round" />
          {!compact && (
            <text
              x={node.x + dx * 54 + (dy !== 0 ? 0 : 0)}
              y={node.y + dy * 54 + (dx !== 0 ? -12 : dy > 0 ? 10 : 0)}
              textAnchor={dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle'}
              fontSize={10.5}
              fontWeight={600}
              fill="#1f3d84"
            >
              {node.exit}
            </text>
          )}
        </g>
      ))}
      {segs.map((l) => {
        const a = network.nodes[l.from];
        const b = network.nodes[l.to];
        return <line key={`o${l.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#cfd7e4" strokeWidth={ROAD_WIDTH[l.kind] + 3} strokeLinecap="round" />;
      })}
      {segs.map((l) => {
        const a = network.nodes[l.from];
        const b = network.nodes[l.to];
        return <line key={`i${l.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={ROAD_WIDTH[l.kind]} strokeLinecap="round" />;
      })}
      {segs
        .filter((l) => l.kind !== 'lane')
        .map((l) => {
          const a = network.nodes[l.from];
          const b = network.nodes[l.to];
          return <line key={`c${l.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#e3e8f1" strokeWidth={1} strokeDasharray="6 6" />;
        })}
      {!compact &&
        segs
          .filter((l) => {
            const a = network.nodes[l.from];
            return (l.dir === 'E' && a.c === 4) || (l.dir === 'S' && a.r === 0) || l.kind === 'lane' || l.maxWeight === 12;
          })
          .map((l) => {
            const a = network.nodes[l.from];
            const b = network.nodes[l.to];
            const horizontal = a.r === b.r;
            const x = (a.x + b.x) / 2;
            const y = (a.y + b.y) / 2;
            const off = ROAD_WIDTH[l.kind] / 2 + 6;
            return horizontal ? (
              <text key={`l${l.id}`} x={x} y={y - off} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#8a98b1" letterSpacing={0.3}>
                {l.road.toUpperCase()}
              </text>
            ) : (
              <text
                key={`l${l.id}`}
                x={x - off}
                y={y}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={600}
                fill="#8a98b1"
                letterSpacing={0.3}
                transform={`rotate(-90 ${x - off} ${y})`}
              >
                {l.road.toUpperCase()}
              </text>
            );
          })}
    </g>
  );
});

const PoiLayer = memo(function PoiLayer({ network, compact }: { network: NetworkInfo; compact: boolean }) {
  return (
    <g>
      {network.nodes
        .filter((n) => n.poi)
        .map((n) => {
          const style = POI_STYLE[n.poi!.kind];
          const Icon = style.icon;
          const cx = n.x + 22;
          const cy = n.y - 22;
          return (
            <g key={n.id} pointerEvents="none">
              <circle cx={cx} cy={cy} r={11} fill="#ffffff" stroke={style.color} strokeWidth={1.5} />
              <Icon x={cx - 6.5} y={cy - 6.5} width={13} height={13} color={style.color} strokeWidth={2.2} />
              {!compact && (
                <text x={cx + 15} y={cy + 3.5} fontSize={10.5} fontWeight={600} fill="#0b1730" stroke="#f6f8fc" strokeWidth={3} paintOrder="stroke">
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
        const x = g.sx + (g.ex - g.sx) * pos;
        const y = g.sy + (g.ey - g.sy) * pos;
        const priority = flags & VEHICLE_FLAG.priority;
        if (priority) {
          return (
            <g key={id} className="vehicle-dot" style={{ transform: `translate(${x}px, ${y}px)` }}>
              <circle r={5} fill="#ef4444" className="pulse-ring" />
              <circle r={4.2} fill="#dc2626" stroke="#ffffff" strokeWidth={1.5} />
            </g>
          );
        }
        const color = CLASS_COLOR[CLASS_BY_CODE[cls]];
        const r = cls === 2 ? 3.4 : cls === 1 ? 2.2 : 2.8;
        return <circle key={id} className="vehicle-dot" r={r} fill={color} opacity={flags & VEHICLE_FLAG.evacuating ? 1 : 0.9} style={{ transform: `translate(${x}px, ${y}px)` }} />;
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
  routes = [],
  zone,
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
  const zoneBox = useMemo(() => {
    if (!zone?.length) return null;
    const pts = zone.map((id) => network.nodes[id]);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 38;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }, [zone, network]);

  return (
    <svg
      viewBox={`0 0 ${network.width} ${network.height}`}
      className={clsx('block h-auto w-full select-none', className)}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>
      <StaticLayer network={network} compact={compact} />

      {zoneBox && (
        <rect x={zoneBox.x} y={zoneBox.y} width={zoneBox.w} height={zoneBox.h} rx={28} fill="rgb(220 38 38 / 0.07)" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="7 5" />
      )}

      {showCongestion &&
        layerScores &&
        network.links.map((l) => {
          const g = geometry[l.id];
          const score = layerScores[l.id] ?? 0;
          const level = congestionLevel(score);
          return (
            <line
              key={l.id}
              x1={g.sx}
              y1={g.sy}
              x2={g.ex}
              y2={g.ey}
              stroke={LEVEL_COLOR[level]}
              strokeWidth={Math.max(3, ROAD_WIDTH[l.kind] / 2 - 2)}
              strokeLinecap="round"
              opacity={level === 'free' ? 0.55 : 0.9}
            />
          );
        })}

      {snap &&
        network.links.map((l) => {
          const flags = snap.linkFlags[l.id];
          if (!flags) return null;
          const g = geometry[l.id];
          return (
            <g key={`f${l.id}`} pointerEvents="none">
              {flags & LINK_FLAG.closed ? (
                <line x1={g.sx} y1={g.sy} x2={g.ex} y2={g.ey} stroke="#7f1d1d" strokeWidth={4} strokeDasharray="3 4" />
              ) : null}
              {flags & LINK_FLAG.contraflow ? (
                <line x1={g.sx} y1={g.sy} x2={g.ex} y2={g.ey} stroke="#2563eb" strokeWidth={3} markerEnd="url(#arrow-blue)" />
              ) : null}
              {flags & LINK_FLAG.greenWave ? (
                <line x1={g.sx} y1={g.sy} x2={g.ex} y2={g.ey} stroke="#10b981" strokeWidth={5} strokeLinecap="round" className="green-wave" />
              ) : null}
            </g>
          );
        })}

      {routes.map((route, i) =>
        route.links.length ? (
          <polyline
            key={i}
            points={[network.links[route.links[0]].from, ...route.links.map((lid) => network.links[lid].to)]
              .map((nid) => `${network.nodes[nid].x},${network.nodes[nid].y}`)
              .join(' ')}
            fill="none"
            stroke={route.color}
            strokeWidth={route.width ?? Math.max(3, 9 - i * 2)}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.85}
          >
            {route.label && <title>{route.label}</title>}
          </polyline>
        ) : null,
      )}

      {selectedLink !== null && selectedLink !== undefined && geometry[selectedLink] && (
        <line
          x1={geometry[selectedLink].sx}
          y1={geometry[selectedLink].sy}
          x2={geometry[selectedLink].ex}
          y2={geometry[selectedLink].ey}
          stroke="#1d4ed8"
          strokeWidth={9}
          strokeLinecap="round"
          opacity={0.35}
        />
      )}

      {showVehicles && snap && <VehicleLayer vehicles={snap.vehicles} geometry={geometry} />}

      {showSignals &&
        network.nodes.map((n) => {
          const sig = snap?.signals[n.id];
          const colors = sig ? signalColors(sig[1], sig[2]) : { ns: '#94a3b8', ew: '#94a3b8' };
          const flags = sig?.[3] ?? 0;
          return (
            <g key={n.id} pointerEvents="none">
              {flags & SIGNAL_FLAG.preempted ? <circle cx={n.x} cy={n.y} r={11} fill="#10b981" className="pulse-ring" /> : null}
              <rect
                x={n.x - 7.5}
                y={n.y - 7.5}
                width={15}
                height={15}
                rx={3.5}
                fill="#0a1a3a"
                stroke={flags & SIGNAL_FLAG.fault ? '#f59e0b' : flags & SIGNAL_FLAG.evacuation ? '#dc2626' : flags & SIGNAL_FLAG.preempted ? '#10b981' : '#ffffff'}
                strokeWidth={flags & (SIGNAL_FLAG.fault | SIGNAL_FLAG.evacuation | SIGNAL_FLAG.preempted) ? 2.2 : 1.2}
                className={flags & SIGNAL_FLAG.fault ? 'blink' : undefined}
              />
              <rect x={n.x - 1.4} y={n.y - 5.2} width={2.8} height={10.4} rx={1.2} fill={colors.ns} />
              <rect x={n.x - 5.2} y={n.y - 1.4} width={10.4} height={2.8} rx={1.2} fill={colors.ew} />
            </g>
          );
        })}

      {snap &&
        network.links.map((l) => {
          if (!(snap.linkFlags[l.id] & LINK_FLAG.incident)) return null;
          const g = geometry[l.id];
          const x = g.mx + g.nx * 10;
          const y = g.my + g.ny * 10;
          return (
            <g key={`inc${l.id}`} pointerEvents="none">
              <circle cx={x} cy={y} r={8} fill="#ffffff" stroke="#dc2626" strokeWidth={1.5} />
              <text x={x} y={y + 3.6} textAnchor="middle" fontSize={11} fontWeight={800} fill="#dc2626">
                !
              </text>
            </g>
          );
        })}

      {markers.map((m, i) => {
        let x: number;
        let y: number;
        if (m.linkId !== null && m.linkId !== undefined) {
          const g = geometry[m.linkId];
          x = g.mx + g.nx * 12;
          y = g.my + g.ny * 12;
        } else if (m.nodeId !== null && m.nodeId !== undefined) {
          x = network.nodes[m.nodeId].x - 16;
          y = network.nodes[m.nodeId].y + 16;
        } else return null;
        return (
          <g key={`m${i}`}>
            <path d={`M ${x} ${y} l -7 -12 a 8 8 0 1 1 14 0 z`} fill={m.color} stroke="#ffffff" strokeWidth={1.5} />
            <circle cx={x} cy={y - 15} r={3} fill="#ffffff" />
            {m.title && <title>{m.title}</title>}
          </g>
        );
      })}

      <PoiLayer network={network} compact={compact} />

      {selectedNode !== null && selectedNode !== undefined && (
        <circle cx={network.nodes[selectedNode].x} cy={network.nodes[selectedNode].y} r={14} fill="none" stroke="#1d4ed8" strokeWidth={2.5} />
      )}

      {onLinkClick &&
        network.links.map((l) => {
          const g = geometry[l.id];
          const score = layerScores?.[l.id] ?? 0;
          return (
            <line
              key={`h${l.id}`}
              x1={g.sx}
              y1={g.sy}
              x2={g.ex}
              y2={g.ey}
              stroke="transparent"
              strokeWidth={ROAD_WIDTH[l.kind] / 2 + 4}
              style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
              onClick={() => onLinkClick(l.id)}
            >
              <title>{`${linkLabel(network, l)} · ${LEVEL_LABEL[congestionLevel(score)]} (${score.toFixed(2)})`}</title>
            </line>
          );
        })}

      {onNodeClick &&
        network.nodes.map((n) => (
          <circle key={`hn${n.id}`} cx={n.x} cy={n.y} r={13} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onNodeClick(n.id)}>
            <title>{n.name}</title>
          </circle>
        ))}
    </svg>
  );
}

export function MapLegend({ showClasses = true, className }: { showClasses?: boolean; className?: string }) {
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
    </div>
  );
}

export function MapSkeleton({ network }: { network?: NetworkInfo | null }) {
  const ratio = network ? network.height / network.width : 660 / 1080;
  return <div className="skeleton w-full rounded-xl" style={{ aspectRatio: `${1 / ratio}` }} />;
}
