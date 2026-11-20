import clsx from 'clsx';
import { Ambulance, Bike, Car, Clock, Layers, MapPin, Navigation, Route, Signpost, Timer, TrafficCone, Truck, Weight, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CLASS_LABEL,
  type LinkKind,
  type NetworkInfo,
  type RegisteredVehicle,
  type RouteComparison,
  type RoutePlan,
  type Snapshot,
  type VehicleClass,
} from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton, type MapMarker, type MapRoute } from '../components/CityMap';
import { NodeSelect } from '../components/NodeSelect';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, SkeletonGroup, TD, TH } from '../components/ui';
import { api } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { CLASS_COLOR, num } from '../lib/format';

const CLASS_ICON: Record<VehicleClass, LucideIcon> = { private: Car, two_wheeler: Bike, cargo: Truck, emergency: Ambulance };

type Mode = 'all' | VehicleClass;

interface PlanRequest {
  from: number;
  to: number;
  vehicleClass?: VehicleClass;
  weightT?: number;
  plate?: string;
  seq: number;
}

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'all', label: 'Compare all classes' },
  { value: 'private', label: 'Private car' },
  { value: 'two_wheeler', label: 'Two-wheeler' },
  { value: 'cargo', label: 'Cargo' },
  { value: 'emergency', label: 'Emergency' },
];

const KIND_INFO: Record<LinkKind, { label: string; note: string; color: string }> = {
  ring: { label: 'Ring Road', note: 'Freight corridor around the city', color: '#1f3d84' },
  arterial: { label: 'Arterial', note: 'MG Road and Clock Tower Road', color: '#2563eb' },
  street: { label: 'Street', note: 'Local streets between junctions', color: '#8a98b1' },
  lane: { label: 'Narrow lane', note: 'Old-town lanes, closed to cargo', color: '#b45309' },
};

function cargoRestriction(snap: Snapshot | null) {
  if (!snap) return null;
  const [hh, mm] = snap.clock.split(':').map(Number);
  const h = hh + mm / 60;
  const weekday = snap.day !== 'Saturday' && snap.day !== 'Sunday';
  const morning = h >= 8 && h < 11;
  const evening = h >= 17 && h < 20;
  const active = weekday && (morning || evening);
  let next: string;
  if (active) next = morning ? 'Lifts at 11:00' : 'Lifts at 20:00';
  else if (weekday && h < 8) next = 'Starts at 08:00';
  else if (weekday && h >= 11 && h < 17) next = 'Starts at 17:00';
  else next = 'Next window 08:00 on the next weekday';
  return { active, next, weekday };
}

export function RoutingPage() {
  const { network, snap } = useLive();
  const vehicles = usePoll<RegisteredVehicle[]>('/vehicles');
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('all');
  const [weight, setWeight] = useState('18');
  const [vehicleId, setVehicleId] = useState('');
  const [request, setRequest] = useState<PlanRequest | null>(null);
  const [result, setResult] = useState<RouteComparison | null>(null);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plannedAt, setPlannedAt] = useState<string | null>(null);
  const [focus, setFocus] = useState<VehicleClass | null>(null);
  const clockRef = useRef<string | null>(null);
  clockRef.current = snap?.clock ?? null;

  useEffect(() => {
    if (!network || from !== null || to !== null) return;
    const depots = network.nodes.filter((n) => n.poi?.kind === 'depot');
    if (depots.length >= 2) {
      setFrom(depots[0].id);
      setTo(depots[1].id);
    }
  }, [network, from, to]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    const run = async (initial: boolean) => {
      if (initial) setPlanning(true);
      try {
        const res = await api<RouteComparison>('/routes/plan', {
          method: 'POST',
          body: { from: request.from, to: request.to, vehicleClass: request.vehicleClass, weightT: request.weightT },
        });
        if (cancelled) return;
        setResult(res);
        setError(null);
        setPlannedAt(clockRef.current);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not plan the route.');
      } finally {
        if (!cancelled && initial) setPlanning(false);
      }
    };
    run(true);
    const id = setInterval(() => run(false), 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [request]);

  const usable = useMemo(
    () => (vehicles.data ?? []).filter((v) => v.status === 'active' || v.status === 'verified'),
    [vehicles.data],
  );
  const selectedVehicle = usable.find((v) => String(v.id) === vehicleId) ?? null;
  const needsWeight = mode === 'all' || mode === 'cargo';

  const pickVehicle = (id: string) => {
    setVehicleId(id);
    const v = usable.find((x) => String(x.id) === id);
    if (!v) return;
    setMode(v.vehicleClass);
    if (v.weightT) setWeight(String(v.weightT));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (from === null || to === null) {
      setError('Choose where the trip starts and ends.');
      return;
    }
    if (from === to) {
      setError('Origin and destination must be different.');
      return;
    }
    const w = Number(weight);
    if (needsWeight && (!Number.isFinite(w) || w <= 0 || w > 60)) {
      setError('Enter a cargo weight between 0.1 and 60 tonnes.');
      return;
    }
    setError(null);
    setFocus(null);
    setRequest({
      from,
      to,
      vehicleClass: mode === 'all' ? undefined : mode,
      weightT: needsWeight ? w : undefined,
      plate: selectedVehicle?.plate,
      seq: (request?.seq ?? 0) + 1,
    });
  };

  if (!network) return <RoutingSkeleton />;

  const plans = result?.plans ?? [];
  const feasible = plans.filter((p) => p.feasible);
  const fastest = feasible.length > 1 ? feasible.reduce((a, b) => (b.etaMin < a.etaMin ? b : a)).vehicleClass : null;
  const shown = focus ? plans.filter((p) => p.vehicleClass === focus) : plans;
  const routes: MapRoute[] = shown
    .filter((p) => p.feasible)
    .map((p) => ({ links: p.links, color: CLASS_COLOR[p.vehicleClass], width: focus ? 7 : undefined, label: `${CLASS_LABEL[p.vehicleClass]} · ${p.etaMin} min` }));
  const markers: MapMarker[] = result
    ? [
        { nodeId: result.from, color: '#0a1a3a', title: `Start: ${network.nodes[result.from].name}` },
        { nodeId: result.to, color: '#1d4ed8', title: `Destination: ${network.nodes[result.to].name}` },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title="Routing & freight"
        description="Class-aware routes on live traffic. Each vehicle class gets the route that suits it: cargo stays on freight corridors, emergency vehicles get green-wave priority, two-wheelers use lanes."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Plan a trip" subtitle="Routes refresh every 20 s as traffic changes" icon={Navigation} />
          <CardBody>
            <form className="space-y-4" onSubmit={submit}>
              <Field label="From">
                <NodeSelect network={network} value={from} onChange={setFrom} placeholder="Choose a start point" />
              </Field>
              <Field label="To">
                <NodeSelect network={network} value={to} onChange={setTo} placeholder="Choose a destination" />
              </Field>
              <Field label="Use my registered vehicle" hint="Optional. Sets the class and weight from the registry.">
                <Select value={vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
                  <option value="">No vehicle selected</option>
                  {usable.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate} · {CLASS_LABEL[v.vehicleClass]}
                      {v.weightT ? ` · ${v.weightT} t` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <p className="mb-1.5 text-[13px] font-medium text-ink">Vehicle class</p>
                <Segmented
                  ariaLabel="Vehicle class"
                  size="sm"
                  options={MODE_OPTIONS}
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    if (selectedVehicle && m !== selectedVehicle.vehicleClass) setVehicleId('');
                  }}
                />
              </div>
              {needsWeight && (
                <Field label="Cargo gross weight (tonnes)" hint="Links with a lower weight limit are avoided.">
                  <Input type="number" min={0.1} max={60} step={0.5} value={weight} onChange={(e) => setWeight(e.target.value)} />
                </Field>
              )}
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200 ring-inset">{error}</p>}
              <Button type="submit" className="w-full" icon={Route} loading={planning}>
                {mode === 'all' ? 'Compare routes' : 'Find route'}
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card className="min-w-0">
          <CardHeader
            title="Route map"
            subtitle={
              result
                ? `${network.nodes[result.from].poi?.name ?? network.nodes[result.from].name} → ${network.nodes[result.to].poi?.name ?? network.nodes[result.to].name}${plannedAt ? ` · planned at ${plannedAt}` : ''}`
                : 'Pick a start and destination to see routes on live traffic'
            }
            icon={MapPin}
            actions={
              focus ? (
                <Button size="sm" variant="secondary" onClick={() => setFocus(null)}>
                  Show all routes
                </Button>
              ) : null
            }
          />
          <div className="p-3">
            <div className="overflow-hidden rounded-xl border border-line">
              <CityMap network={network} snap={snap} routes={routes} markers={markers} ariaLabel="Route map" />
            </div>
            <MapLegend className="mt-3 px-1" />
          </div>
        </Card>
      </div>

      <section className="mt-6" aria-label="Route options">
        {planning && !result ? (
          <SkeletonGroup label="Planning routes…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            {[...Array(mode === 'all' ? 4 : 1).keys()].map((i) => (
              <PlanCardSkeleton key={i} />
            ))}
          </SkeletonGroup>
        ) : plans.length ? (
          <div className={clsx('grid gap-4', plans.length > 1 ? 'sm:grid-cols-2 2xl:grid-cols-4' : 'max-w-xl')}>
            {plans.map((p) => (
              <PlanCard
                key={p.vehicleClass}
                plan={p}
                fastest={fastest === p.vehicleClass}
                focused={focus === p.vehicleClass}
                plate={request?.plate && request.vehicleClass === p.vehicleClass ? request.plate : undefined}
                onFocus={() => setFocus(focus === p.vehicleClass ? null : p.vehicleClass)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={Route} title="No route planned yet" description="Choose a start point and a destination, then compare how each vehicle class would travel right now." />
          </Card>
        )}
      </section>

      <FreightSection network={network} snap={snap} />
    </div>
  );
}

function PlanCard({
  plan,
  fastest,
  focused,
  plate,
  onFocus,
}: {
  plan: RoutePlan;
  fastest: boolean;
  focused: boolean;
  plate?: string;
  onFocus: () => void;
}) {
  const Icon = CLASS_ICON[plan.vehicleClass];
  const color = CLASS_COLOR[plan.vehicleClass];
  const delay = plan.etaMin - plan.freeFlowMin;
  return (
    <Card className={clsx('flex flex-col overflow-hidden transition-shadow', focused && 'ring-2 ring-brand-500')}>
      <div className="h-1" style={{ background: color }} />
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl" style={{ background: `${color}14`, color }}>
            <Icon className="size-[18px]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">{CLASS_LABEL[plan.vehicleClass]}</p>
            {plate && <p className="text-xs text-muted">{plate}</p>}
          </div>
        </div>
        {!plan.feasible ? <Badge tone="red">No route</Badge> : fastest ? <Badge tone="green">Fastest</Badge> : null}
      </div>
      {plan.feasible ? (
        <>
          <div className="mt-4 px-5">
            <p className="tabular text-3xl font-semibold tracking-tight text-ink">
              {plan.etaMin.toFixed(1)}
              <span className="ml-1 text-base font-medium text-muted">min</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {delay > 0.05 ? `+${delay.toFixed(1)} min over free flow` : 'Running at free-flow speed'}
            </p>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-y border-line bg-navy-50/50 px-5 py-3">
            <Metric icon={Signpost} label="Distance" value={`${plan.distanceKm.toFixed(1)} km`} />
            <Metric icon={TrafficCone} label="Signals" value={String(plan.signals)} />
            <Metric icon={Timer} label="Free flow" value={`${plan.freeFlowMin.toFixed(1)} min`} />
          </dl>
          <ul className="flex-1 space-y-1.5 px-5 py-4 text-[13px] text-muted">
            {plan.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <span>{n}</span>
              </li>
            ))}
          </ul>
          <div className="px-5 pb-4">
            <Button size="sm" variant={focused ? 'navy' : 'secondary'} className="w-full" icon={Layers} onClick={onFocus}>
              {focused ? 'Showing on map' : 'Show only this route'}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex-1 px-5 py-4">
          <ul className="space-y-1.5 text-[13px] text-muted">
            {plan.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-jam" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] font-medium text-muted">
        <Icon className="size-3" />
        {label}
      </dt>
      <dd className="tabular mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function FreightSection({ network, snap }: { network: NetworkInfo; snap: Snapshot | null }) {
  const restriction = cargoRestriction(snap);
  const segments = network.links.filter((l) => l.id < l.reverse);
  const ring = segments.filter((l) => l.kind === 'ring');
  const ringKm = ring.reduce((a, l) => a + l.length, 0) / 1000;
  const limited = segments.filter((l) => l.maxWeight !== null).sort((a, b) => (a.maxWeight ?? 0) - (b.maxWeight ?? 0));
  let cargo = 0;
  let cargoOnRing = 0;
  let cargoInCore = 0;
  for (const v of snap?.vehicles ?? []) {
    if (v[3] !== 2) continue;
    cargo++;
    const link = network.links[v[1]];
    if (link?.kind === 'ring') cargoOnRing++;
    if (link?.core) cargoInCore++;
  }
  const kinds = (['ring', 'arterial', 'street', 'lane'] as LinkKind[]).map((kind) => {
    const sample = segments.find((l) => l.kind === kind);
    return { kind, count: segments.filter((l) => l.kind === kind).length, lanes: sample?.lanes ?? 0, speed: sample?.speedLimit ?? 0 };
  });

  return (
    <section className="mt-8" aria-labelledby="freight-heading">
      <h2 id="freight-heading" className="text-lg font-semibold tracking-tight text-ink">
        Freight corridors & restrictions
      </h2>
      <p className="mt-1 text-sm text-muted">Cargo is kept off commuter roads at peak hours and routed along the Ring Road corridor.</p>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-muted">Commuter-core restriction</p>
              {restriction ? (
                <p className={clsx('mt-1.5 text-xl font-semibold', restriction.active ? 'text-jam' : 'text-free')}>
                  {restriction.active ? 'In force now' : 'Not in force'}
                </p>
              ) : (
                <Skeleton className="mt-2 h-6 w-28" />
              )}
            </div>
            <span className={clsx('grid size-10 place-items-center rounded-xl', restriction?.active ? 'bg-red-50 text-jam' : 'bg-green-50 text-free')}>
              <Clock className="size-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Weekdays 08:00–11:00 and 17:00–20:00. {restriction ? restriction.next : ''}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-muted">Ring Road freight corridor</p>
              <p className="tabular mt-1.5 text-xl font-semibold text-ink">{ringKm.toFixed(1)} km</p>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-navy-100 text-navy-800">
              <Route className="size-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {ring.length} segments, {ring[0]?.lanes ?? 2} lanes each way at {ring[0]?.speedLimit ?? 60} km/h. Cargo routing favours it over the core.
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-muted">Cargo vehicles on the network</p>
              {snap ? <p className="tabular mt-1.5 text-xl font-semibold text-ink">{num(cargo)}</p> : <Skeleton className="mt-2 h-6 w-16" />}
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Truck className="size-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {num(cargoOnRing)} on the Ring Road · {num(cargoInCore)} inside the commuter core
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Weight-limited links" subtitle="Cargo heavier than the limit is routed around these segments" icon={Weight} />
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead className="bg-navy-50/60">
                <tr>
                  <th className={TH}>Road</th>
                  <th className={TH}>Limit</th>
                  <th className={TH}>Between</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {limited.map((l) => (
                  <tr key={l.id}>
                    <td className={TD}>
                      <span className="font-medium">{l.road}</span>
                      {l.kind === 'lane' && (
                        <Badge tone="amber" className="ml-2">
                          No cargo
                        </Badge>
                      )}
                    </td>
                    <td className={clsx(TD, 'tabular font-semibold')}>{l.maxWeight} t</td>
                    <td className={clsx(TD, 'text-muted')}>
                      {network.nodes[l.from].name} ↔ {network.nodes[l.to].name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Road classes" subtitle="How each link type is used for routing" icon={Layers} />
          <ul className="divide-y divide-line">
            {kinds.map((k) => (
              <li key={k.kind} className="flex items-center gap-3 px-5 py-3">
                <span className="h-2 w-8 shrink-0 rounded-full" style={{ background: KIND_INFO[k.kind].color }} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{KIND_INFO[k.kind].label}</p>
                  <p className="text-xs text-muted">{KIND_INFO[k.kind].note}</p>
                </div>
                <div className="text-right text-xs text-muted">
                  <p className="tabular font-medium text-ink">{k.count} segments</p>
                  <p className="tabular">
                    {k.lanes} lane{k.lanes === 1 ? '' : 's'} · {k.speed} km/h
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

function PlanCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-1 rounded-none" />
      <div className="flex items-center gap-3 px-5 pt-4">
        <Skeleton className="size-9 rounded-xl" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="mt-4 px-5">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="mt-2 h-3 w-36" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-line px-5 py-3">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
      <div className="space-y-2 px-5 py-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </Card>
  );
}

function RoutingSkeleton() {
  return (
    <SkeletonGroup label="Loading route planner…">
      <div className="mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="self-start">
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="space-y-4 px-5 py-4">
            {[...Array(4).keys()].map((i) => (
              <div key={i}>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-10 w-full rounded-lg" />
              </div>
            ))}
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-28" />
          </div>
          <div className="p-3">
            <MapSkeleton />
          </div>
        </Card>
      </div>
    </SkeletonGroup>
  );
}
