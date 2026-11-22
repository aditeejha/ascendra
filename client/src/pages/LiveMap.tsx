import clsx from 'clsx';
import { Camera, Car, Layers, MapPin, MousePointerClick, TrafficCone } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  CLASS_LABEL,
  LINK_FLAG,
  SIGNAL_FLAG,
  VEHICLE_CLASSES,
  congestionLevel,
  type ForecastResponse,
  type NetworkInfo,
  type Snapshot,
  type TrafficSample,
  type VehicleClass,
} from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton } from '../components/CityMap';
import { Badge, Card, CardBody, CardHeader, EmptyState, LevelBadge, PageHeader, ProgressBar, Segmented, Skeleton, SkeletonGroup } from '../components/ui';
import { CLASS_BY_CODE, CLASS_COLOR, LEVEL_COLOR, LEVEL_LABEL, linkLabel, pct, scoreColor, titleCase } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';

type Layer = 'now' | 'h15' | 'h30';
type Selection = { kind: 'link'; id: number } | { kind: 'node'; id: number } | null;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
        active ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-muted ring-line hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function LiveMapPage() {
  const { network, snap, live } = useLive();
  const [layer, setLayer] = useState<Layer>('now');
  const [selection, setSelection] = useState<Selection>(null);
  const [showVehicles, setShowVehicles] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [hidden, setHidden] = useState<VehicleClass[]>([]);
  const forecast = usePoll<ForecastResponse>('/forecast', 15000);

  const filteredSnap = useMemo(() => {
    if (!snap || !hidden.length) return snap;
    const hiddenCodes = new Set(hidden.map((c) => CLASS_BY_CODE.indexOf(c)));
    return { ...snap, vehicles: snap.vehicles.filter((v) => !hiddenCodes.has(v[3])) };
  }, [snap, hidden]);

  const layerScores = useMemo(() => {
    if (layer === 'now' || !forecast.data?.links.length) return null;
    return forecast.data.links.map((l) => (layer === 'h15' ? l.h15 : l.h30));
  }, [layer, forecast.data]);

  if (!network || !snap || !filteredSnap) {
    return (
      <SkeletonGroup label="Loading live map">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
          <Card className="p-3">
            <MapSkeleton network={network} />
          </Card>
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </Card>
        </div>
      </SkeletonGroup>
    );
  }

  const toggleClass = (cls: VehicleClass) => setHidden((h) => (h.includes(cls) ? h.filter((c) => c !== cls) : [...h, cls]));

  return (
    <>
      <PageHeader
        title="Live map"
        description={`${network.meta.city}'s real road network from OpenStreetMap with every vehicle, signal and congestion level, updated four times a second. Click a road or junction for details.`}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <Segmented<Layer>
              ariaLabel="Congestion layer"
              size="sm"
              value={layer}
              onChange={setLayer}
              options={[
                { value: 'now', label: 'Now' },
                { value: 'h15', label: 'Forecast +15' },
                { value: 'h30', label: 'Forecast +30' },
              ]}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={showVehicles} onClick={() => setShowVehicles((v) => !v)}>
                <Car className="size-3.5" /> Vehicles
              </Chip>
              <Chip active={showSignals} onClick={() => setShowSignals((v) => !v)}>
                <TrafficCone className="size-3.5" /> Signals
              </Chip>
              {VEHICLE_CLASSES.map((cls) => (
                <Chip key={cls} active={!hidden.includes(cls)} onClick={() => toggleClass(cls)}>
                  <span className="size-2 rounded-full" style={{ background: CLASS_COLOR[cls] }} />
                  {CLASS_LABEL[cls]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="p-3">
            <div className="overflow-hidden rounded-xl ring-1 ring-line">
              <CityMap
                network={network}
                snap={filteredSnap}
                scores={layerScores}
                showVehicles={showVehicles}
                showSignals={showSignals}
                selectedNode={selection?.kind === 'node' ? selection.id : null}
                selectedLink={selection?.kind === 'link' ? selection.id : null}
                onNodeClick={(id) => setSelection({ kind: 'node', id })}
                onLinkClick={(id) => setSelection({ kind: 'link', id })}
              />
            </div>
            <MapLegend className="px-2 pt-3" showLive />
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <SelectionCard network={network} snap={snap} forecast={forecast.data} selection={selection} samples={live?.traffic.samples ?? []} />
          <NetworkMixCard network={network} snap={snap} />
        </div>
      </div>
    </>
  );
}

function SelectionCard({
  network,
  snap,
  forecast,
  selection,
  samples,
}: {
  network: NetworkInfo;
  snap: Snapshot;
  forecast: ForecastResponse | null;
  selection: Selection;
  samples: TrafficSample[];
}) {
  if (!selection) {
    return (
      <Card>
        <CardHeader title="Details" icon={MapPin} />
        <EmptyState icon={MousePointerClick} title="Nothing selected" description="Click a road segment to see its congestion and forecast, or a junction to see its signal." />
      </Card>
    );
  }
  if (selection.kind === 'node') {
    const node = network.nodes[selection.id];
    const sig = snap.signals.find((s) => s[0] === selection.id);
    const flags = sig?.[3] ?? 0;
    const incoming = network.links.filter((l) => l.to === node.id);
    if (!sig) {
      return (
        <Card>
          <CardHeader title={node.name} subtitle={node.poi?.name ?? node.exit ?? `Junction ${node.key}`} icon={TrafficCone} />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">{node.key}</Badge>
              <Badge tone="navy">Give-way junction · no signal</Badge>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Approaches</p>
              <ul className="space-y-2">
                {incoming.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-ink">{linkLabel(network, l)}</span>
                    <span className="tabular shrink-0 text-muted">{snap.linkQueue[l.id]} queued</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader title={node.name} subtitle={node.poi?.name ?? node.exit ?? `Junction ${node.key}`} icon={TrafficCone} />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">{node.key}</Badge>
            <Badge tone={flags & SIGNAL_FLAG.adaptive ? 'blue' : 'neutral'}>{flags & SIGNAL_FLAG.adaptive ? 'Adaptive' : 'Fixed-time'}</Badge>
            {flags & SIGNAL_FLAG.preempted ? <Badge tone="green">Green wave</Badge> : null}
            {flags & SIGNAL_FLAG.fault ? <Badge tone="amber">Fault</Badge> : null}
            {flags & SIGNAL_FLAG.evacuation ? <Badge tone="red">Evacuation</Badge> : null}
          </div>
          <div className="rounded-xl bg-navy-50 px-3 py-2.5 text-[13px]">
            <span className="text-muted">Green for </span>
            <span className="font-semibold text-ink">{sig[1] === 0 ? 'North – South' : 'East – West'}</span>
            <span className="text-muted"> approaches</span>
            <span className="text-muted"> · {['green', 'yellow', 'all-red'][sig[2]]}</span>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Approaches</p>
            <ul className="space-y-2">
              {incoming.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="truncate text-ink">{linkLabel(network, l)}</span>
                  <span className="tabular shrink-0 text-muted">{snap.linkQueue[l.id]} queued</span>
                </li>
              ))}
            </ul>
          </div>
        </CardBody>
      </Card>
    );
  }
  const link = network.links[selection.id];
  const score = snap.linkScore[link.id];
  const flags = snap.linkFlags[link.id];
  const fc = forecast?.links[link.id];
  const measured = samples.find((m) => m.linkId === link.id || m.linkId === link.reverse);
  return (
    <Card>
      <CardHeader title={linkLabel(network, link)} subtitle={`${network.nodes[link.from].name} → ${network.nodes[link.to].name}`} icon={MapPin} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <LevelBadge score={score} />
          <Badge tone="neutral">{titleCase(link.kind)}</Badge>
          {link.camera && (
            <Badge tone="sky">
              <Camera className="size-3" /> Speed camera
            </Badge>
          )}
          {flags & LINK_FLAG.incident ? <Badge tone="red">Incident</Badge> : null}
          {flags & LINK_FLAG.closed ? <Badge tone="red">Closed</Badge> : null}
          {flags & LINK_FLAG.contraflow ? <Badge tone="blue">Contraflow</Badge> : null}
          {flags & LINK_FLAG.greenWave ? <Badge tone="green">Green wave</Badge> : null}
        </div>
        {measured && (
          <div className="rounded-xl bg-navy-900 px-3.5 py-3 text-[13px] text-white">
            <p className="text-xs font-semibold tracking-wide text-navy-200 uppercase">Measured by TomTom · {new Date(measured.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
            <p className="mt-1">
              <span className="tabular text-lg font-semibold">{Math.round(measured.currentKmh)} km/h</span>
              <span className="text-navy-200"> now vs {Math.round(measured.freeFlowKmh)} km/h free-flow · simulated score {measured.simScore.toFixed(2)}, measured {measured.measuredScore.toFixed(2)}</span>
            </p>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-3 text-[13px]">
          {(
            [
              ['Length', `${link.length} m`],
              ['Lanes', link.lanes],
              ['Speed limit', `${link.speedLimit} km/h`],
              ['Weight limit', link.maxWeight ? `${link.maxWeight} t` : 'None'],
              ['Queue now', `${snap.linkQueue[link.id]} vehicles`],
              ['Freight in peak', link.core ? 'Restricted' : 'Allowed'],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-navy-50 px-3 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="tabular font-semibold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Congestion score</p>
          <div className="space-y-2.5">
            {(
              [
                ['Now', score, null],
                ['+15 min', fc?.h15, fc?.conf15],
                ['+30 min', fc?.h30, fc?.conf30],
              ] as const
            ).map(([label, v, conf]) => (
              <div key={label} className="grid grid-cols-[64px_1fr_72px] items-center gap-2 text-[13px]">
                <span className="text-muted">{label}</span>
                {v === undefined ? <Skeleton className="h-1.5 w-full" /> : <ProgressBar value={v} color={scoreColor(v)} />}
                <span className="tabular text-right text-ink">
                  {v === undefined ? '—' : v.toFixed(2)}
                  {conf ? <span className="text-subtle"> · {pct(conf)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function NetworkMixCard({ network, snap }: { network: NetworkInfo; snap: Snapshot }) {
  const counts: Record<VehicleClass, number> = { private: 0, two_wheeler: 0, cargo: 0, bus: 0, emergency: 0 };
  for (const v of snap.vehicles) counts[CLASS_BY_CODE[v[3]]]++;
  const levels = { free: 0, moderate: 0, heavy: 0, congested: 0 };
  for (const s of snap.linkScore) levels[congestionLevel(s)]++;
  const total = snap.vehicles.length || 1;
  return (
    <Card>
      <CardHeader title="On the network now" icon={Layers} />
      <CardBody className="space-y-5">
        <div className="space-y-2.5">
          {VEHICLE_CLASSES.map((cls) => (
            <div key={cls} className="grid grid-cols-[110px_1fr_48px] items-center gap-2 text-[13px]">
              <span className="text-muted">{CLASS_LABEL[cls]}</span>
              <ProgressBar value={counts[cls] / total} color={CLASS_COLOR[cls]} />
              <span className="tabular text-right font-medium text-ink">{counts[cls]}</span>
            </div>
          ))}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Road links by level ({network.links.length})</p>
          <div className="flex h-2.5 overflow-hidden rounded-full">
            {(Object.keys(levels) as (keyof typeof levels)[]).map((lvl) => (
              <div key={lvl} style={{ width: `${(levels[lvl] / network.links.length) * 100}%`, background: LEVEL_COLOR[lvl] }} />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted">
            {(Object.keys(levels) as (keyof typeof levels)[]).map((lvl) => (
              <span key={lvl} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: LEVEL_COLOR[lvl] }} />
                {LEVEL_LABEL[lvl]} <span className="tabular ml-auto font-medium text-ink">{levels[lvl]}</span>
              </span>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
