import clsx from 'clsx';
import { Ambulance, BadgeCheck, Clock, Navigation, Route, ShieldCheck, Siren, Timer, TriangleExclamationPoint, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ActiveEmergency,
  Dispatch,
  NetworkInfo,
  RegisteredVehicle,
  RoutePlan,
  SimSettings,
  Snapshot,
} from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton, type MapRoute } from '../components/CityMap';
import { NodeSelect } from '../components/NodeSelect';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  SkeletonGroup,
  Stat,
  TD,
  TH,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { seconds } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

interface EmergencyData {
  active: ActiveEmergency[];
  dispatches: Dispatch[];
}

interface DispatchResult {
  dispatch: Dispatch;
  plan: RoutePlan;
}

const STATUS_TONE: Record<Dispatch['status'], Tone> = { en_route: 'blue', arrived: 'green', cancelled: 'neutral' };
const STATUS_LABEL: Record<Dispatch['status'], string> = { en_route: 'En route', arrived: 'Arrived', cancelled: 'Cancelled' };

function placeName(net: NetworkInfo, id: number): string {
  const n = net.nodes[id];
  return n.poi?.name ?? n.exit ?? n.name;
}

function stationFor(vehicle: RegisteredVehicle, net: NetworkInfo): number | null {
  const owner = vehicle.ownerName.toLowerCase();
  const byName = net.nodes.find((n) => {
    if (!n.poi) return false;
    const poi = n.poi.name.toLowerCase();
    return owner.includes(poi) || poi.includes(owner);
  });
  if (byName) return byName.id;
  const agency = (vehicle.agency ?? '').toLowerCase();
  const kind = agency.includes('fire') ? 'fire' : agency.includes('police') ? 'police' : 'hospital';
  return net.nodes.find((n) => n.poi?.kind === kind)?.id ?? null;
}

function PriorityBanner({ settings, canConfigure }: { settings: SimSettings | null; canConfigure: boolean }) {
  if (!settings || settings.emergencyPriority) return null;
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
      <TriangleExclamationPoint className="mt-0.5 size-5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900">Emergency signal priority is switched off</p>
        <p className="mt-0.5 text-[13px] text-amber-800">
          Dispatched vehicles will follow normal signal timing. Green waves are not requested until priority is turned back on.
        </p>
      </div>
      {canConfigure && (
        <Link to="/settings" className="text-[13px] font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700">
          Open settings
        </Link>
      )}
    </div>
  );
}

function DispatchForm({
  network,
  vehicles,
  busyIds,
  canDispatch,
  onDispatched,
}: {
  network: NetworkInfo;
  vehicles: RegisteredVehicle[] | null;
  busyIds: Set<number>;
  canDispatch: boolean;
  onDispatched: (result: DispatchResult) => void;
}) {
  const toast = useToast();
  const verified = useMemo(() => (vehicles ?? []).filter((v) => v.vehicleClass === 'emergency' && v.status === 'verified'), [vehicles]);
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (vehicleId === null && verified.length) {
      const first = verified.find((v) => !busyIds.has(v.id)) ?? verified[0];
      setVehicleId(first.id);
      setFrom(stationFor(first, network));
    }
  }, [verified, vehicleId, busyIds, network]);

  const chooseVehicle = (id: number) => {
    setVehicleId(id);
    const v = verified.find((x) => x.id === id);
    if (v) setFrom(stationFor(v, network));
  };

  const hospitals = network.nodes.filter((n) => n.poi?.kind === 'hospital');

  const submit = async () => {
    if (vehicleId === null || from === null || to === null) return;
    setSending(true);
    try {
      const result = await api<DispatchResult>('/emergency/dispatch', { method: 'POST', body: { vehicleId, from, to } });
      toast('success', `${result.dispatch.plate} dispatched to ${placeName(network, to)}. Green wave requested.`);
      onDispatched(result);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Dispatch failed.');
    } finally {
      setSending(false);
    }
  };

  if (!vehicles) {
    return (
      <SkeletonGroup label="Loading emergency fleet…" className="space-y-4">
        {[...Array(3).keys()].map((i) => (
          <div key={i}>
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-2 h-10 w-full" />
          </div>
        ))}
        <Skeleton className="h-10 w-full" />
      </SkeletonGroup>
    );
  }

  if (!verified.length) {
    return <EmptyState icon={ShieldCheck} title="No verified emergency vehicles" description="Emergency vehicles must be verified by the traffic authority before they can request priority." />;
  }

  const selectedBusy = vehicleId !== null && busyIds.has(vehicleId);

  return (
    <div className="space-y-4">
      <Field label="Emergency vehicle" hint={selectedBusy ? 'This vehicle is already on a dispatch.' : 'Only authority-verified vehicles can request priority.'}>
        <Select value={vehicleId ?? ''} onChange={(e) => chooseVehicle(Number(e.target.value))} disabled={!canDispatch}>
          {verified.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate} · {v.agency ?? v.ownerName}
              {busyIds.has(v.id) ? ' (en route)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Start from">
        <NodeSelect network={network} value={from} onChange={setFrom} placeholder="Choose the starting point" disabled={!canDispatch} />
      </Field>
      <Field label="Destination">
        <NodeSelect network={network} value={to} onChange={setTo} placeholder="Choose the destination" disabled={!canDispatch} />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {hospitals.map((h) => (
          <button
            type="button"
            key={h.id}
            onClick={() => setTo(h.id)}
            disabled={!canDispatch}
            className={clsx(
              'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
              to === h.id ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-navy-700 ring-line hover:bg-navy-50',
            )}
          >
            {h.poi!.name}
          </button>
        ))}
      </div>
      <Button
        className="w-full"
        variant="danger"
        icon={Siren}
        loading={sending}
        disabled={!canDispatch || vehicleId === null || from === null || to === null || from === to || selectedBusy}
        onClick={submit}
      >
        Request green wave
      </Button>
      {from !== null && to !== null && from === to && <p className="text-xs text-jam">Start and destination must be different.</p>}
    </div>
  );
}

function PlanSummary({ result, network }: { result: DispatchResult; network: NetworkInfo }) {
  const eta = result.dispatch.etaInitialS;
  const without = result.dispatch.estNoPriorityS;
  const saved = Math.max(0, without - eta);
  return (
    <div className="rounded-xl border border-green-200 bg-green-50/60 p-4">
      <div className="flex items-center gap-2">
        <BadgeCheck className="size-4 text-free" />
        <p className="text-sm font-semibold text-ink">Dispatch #{result.dispatch.id} on its way</p>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {result.dispatch.plate} · {placeName(network, result.dispatch.originNode)} → {placeName(network, result.dispatch.destNode)}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['ETA with priority', seconds(eta)],
          ['Without priority', seconds(without)],
          ['Expected saving', seconds(saved)],
          ['Signals pre-empted', String(result.plan.signals)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white px-3 py-2 ring-1 ring-line">
            <dt className="text-[11px] font-medium text-muted">{label}</dt>
            <dd className="tabular mt-0.5 text-sm font-semibold text-navy-900">{value}</dd>
          </div>
        ))}
      </dl>
      {result.plan.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {result.plan.notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <Route className="mt-0.5 size-3 shrink-0 text-brand-600" />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActiveList({ emergencies, network }: { emergencies: ActiveEmergency[]; network: NetworkInfo }) {
  if (!emergencies.length) {
    return <EmptyState icon={Ambulance} title="No emergency vehicles on the road" description="Active dispatches and their green waves appear here in real time." />;
  }
  return (
    <ul className="divide-y divide-line">
      {emergencies.map((e) => {
        const progress = e.route.length ? (e.step + 1) / e.route.length : 0;
        const link = network.links[e.route[e.step]];
        return (
          <li key={e.vehicleId} className="px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-red-50 text-jam">
                  <Ambulance className="size-4" />
                  <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-jam ring-2 ring-white" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {e.label} <span className="font-normal text-muted">· {e.plate}</span>
                  </p>
                  <p className="text-[13px] text-muted">
                    To {e.destName}
                    {link ? ` · on ${link.road}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="green" dot>
                  {e.preempted} signals cleared
                </Badge>
                <span className="tabular inline-flex items-center gap-1 rounded-md bg-navy-900 px-2 py-1 text-xs font-semibold text-white">
                  <Timer className="size-3.5" />
                  {seconds(e.etaS)}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={progress} color="#dc2626" />
              <span className="tabular shrink-0 text-xs text-muted">
                {Math.min(e.step + 1, e.route.length)}/{e.route.length} links
              </span>
            </div>
            {e.dispatchId === null && <p className="mt-2 text-[11.5px] text-subtle">Routine call generated by the city simulation</p>}
          </li>
        );
      })}
    </ul>
  );
}

function VerificationQueue({ vehicles, onChanged }: { vehicles: RegisteredVehicle[] | null; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const pending = (vehicles ?? []).filter((v) => v.vehicleClass === 'emergency' && v.status === 'pending_verification');

  const decide = async (v: RegisteredVehicle, status: 'verified' | 'rejected') => {
    setBusy(v.id);
    try {
      await api(`/vehicles/${v.id}`, { method: 'PATCH', body: { status } });
      toast('success', `${v.plate} ${status === 'verified' ? 'verified for priority routing' : 'rejected'}.`);
      onChanged();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the registration.');
    } finally {
      setBusy(null);
    }
  };

  if (!vehicles) {
    return (
      <SkeletonGroup label="Loading verification queue…" className="divide-y divide-line">
        {[...Array(2).keys()].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-44" />
            </div>
            <Skeleton className="h-8 w-36" />
          </div>
        ))}
      </SkeletonGroup>
    );
  }

  if (!pending.length) {
    return <EmptyState icon={ShieldCheck} title="Nothing waiting for verification" description="New emergency registrations appear here before they can request green waves." />;
  }

  return (
    <ul className="divide-y divide-line">
      {pending.map((v) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{v.plate}</p>
            <p className="text-[13px] text-muted">
              {v.ownerName}
              {v.agency ? ` · ${v.agency}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="success" loading={busy === v.id} onClick={() => decide(v, 'verified')}>
              Verify
            </Button>
            <Button size="sm" variant="secondary" disabled={busy === v.id} onClick={() => decide(v, 'rejected')}>
              Reject
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function HistoryTable({ dispatches, network }: { dispatches: Dispatch[]; network: NetworkInfo }) {
  if (!dispatches.length) {
    return <EmptyState icon={Clock} title="No dispatches yet" description="Requested green waves are logged here with their actual travel time." />;
  }
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[820px]">
        <thead className="border-b border-line bg-navy-50/60">
          <tr>
            <th className={TH}>#</th>
            <th className={TH}>Vehicle</th>
            <th className={TH}>Route</th>
            <th className={TH}>Started</th>
            <th className={TH}>Status</th>
            <th className={TH}>Est. without priority</th>
            <th className={TH}>Actual</th>
            <th className={TH}>Time saved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dispatches.map((d) => {
            const saved = d.actualS !== null ? d.estNoPriorityS - d.actualS : null;
            return (
              <tr key={d.id}>
                <td className={clsx(TD, 'tabular text-muted')}>{d.id}</td>
                <td className={TD}>
                  <p className="font-medium">{d.label}</p>
                  <p className="text-xs text-muted">{d.plate}</p>
                </td>
                <td className={clsx(TD, 'text-[13px]')}>
                  {placeName(network, d.originNode)} <span className="text-subtle">→</span> {placeName(network, d.destNode)}
                </td>
                <td className={clsx(TD, 'tabular text-muted')}>{d.startedClock}</td>
                <td className={TD}>
                  <Badge tone={STATUS_TONE[d.status]} dot>
                    {STATUS_LABEL[d.status]}
                  </Badge>
                </td>
                <td className={clsx(TD, 'tabular text-muted')}>{d.status === 'cancelled' ? '—' : seconds(d.estNoPriorityS)}</td>
                <td className={clsx(TD, 'tabular')}>{seconds(d.actualS)}</td>
                <td className={clsx(TD, 'tabular font-semibold', saved !== null && saved > 0 ? 'text-free' : 'text-muted')}>
                  {saved === null ? '—' : saved > 0 ? `−${seconds(saved)}` : seconds(0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmergencyMap({ network, snap, preview }: { network: NetworkInfo; snap: Snapshot | null; preview: RoutePlan | null }) {
  const routes: MapRoute[] = (snap?.emergencies ?? []).map((e) => ({
    links: e.route.slice(e.step),
    color: '#dc2626',
    width: 5,
    label: `${e.label} ${e.plate} to ${e.destName}`,
  }));
  if (preview && !routes.length) routes.push({ links: preview.links, color: '#1d4ed8', width: 5, label: 'Last planned route' });
  return <CityMap network={network} snap={snap} routes={routes} ariaLabel="Emergency routes and green waves" />;
}

export function EmergencyPage() {
  const { network, snap } = useLive();
  const { role } = useRole();
  const canDispatch = role === 'controller' || role === 'emergency';
  const { data: settings } = usePoll<SimSettings>('/settings', 5000);
  const { data: vehicles, refresh: refreshVehicles } = usePoll<RegisteredVehicle[]>('/vehicles', 15000);
  const { data: history, refresh: refreshHistory } = usePoll<EmergencyData>('/emergency', 4000);
  const [result, setResult] = useState<DispatchResult | null>(null);

  const busyIds = useMemo(() => new Set((history?.dispatches ?? []).filter((d) => d.status === 'en_route').map((d) => d.vehicleId)), [history]);
  const arrived = (history?.dispatches ?? []).filter((d) => d.status === 'arrived' && d.actualS !== null);
  const avgSaved = arrived.length ? arrived.reduce((a, d) => a + Math.max(0, d.estNoPriorityS - (d.actualS ?? 0)), 0) / arrived.length : null;
  const emergencies = snap?.emergencies ?? [];

  return (
    <div>
      <PageHeader
        title="Emergency vehicles"
        description="Dispatch verified ambulances, fire tenders and police with a green wave: signals ahead of the vehicle switch to its approach before it arrives."
      />
      <PriorityBanner settings={settings} canConfigure={role === 'controller'} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="En route now" value={emergencies.length} icon={Siren} tone="red" sub={`${emergencies.reduce((a, e) => a + e.preempted, 0)} signals cleared so far`} />
        <Stat label="Dispatches logged" value={history ? history.dispatches.length : '—'} icon={Navigation} tone="blue" sub={`${arrived.length} arrived`} />
        <Stat label="Avg. time saved" value={avgSaved === null ? '—' : seconds(avgSaved)} icon={Timer} tone="green" sub="vs. estimate without priority" />
        <Stat
          label="Signal priority"
          value={settings ? (settings.emergencyPriority ? 'On' : 'Off') : '—'}
          icon={Zap}
          tone={settings && !settings.emergencyPriority ? 'amber' : 'navy'}
          sub="Green-wave preemption"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Request priority route" subtitle="Green wave along the fastest emergency route" icon={Siren} />
          <CardBody className="space-y-4">
            {network ? (
              <DispatchForm
                network={network}
                vehicles={vehicles}
                busyIds={busyIds}
                canDispatch={canDispatch}
                onDispatched={(r) => {
                  setResult(r);
                  refreshHistory();
                }}
              />
            ) : (
              <SkeletonGroup label="Loading dispatch form…" className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </SkeletonGroup>
            )}
            {result && network && <PlanSummary result={result} network={network} />}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Real-time clear path" subtitle="Red routes are active dispatches; animated green links are holding a green wave" icon={Route} />
          <div className="p-3">{network ? <EmergencyMap network={network} snap={snap} preview={result?.plan ?? null} /> : <MapSkeleton />}</div>
          <div className="border-t border-line px-5 py-3">
            <MapLegend />
          </div>
        </Card>
      </div>

      <div className={clsx('mt-6 grid gap-6', role === 'controller' && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        <Card>
          <CardHeader title="Active emergencies" subtitle="Live ETA and signals pre-empted for each vehicle" icon={Ambulance} />
          {network ? (
            <ActiveList emergencies={emergencies} network={network} />
          ) : (
            <SkeletonGroup label="Loading active emergencies…" className="space-y-3 px-5 py-4">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-1.5 w-full" />
            </SkeletonGroup>
          )}
        </Card>
        {role === 'controller' && (
          <Card>
            <CardHeader title="Verification queue" subtitle="Emergency registrations awaiting authority approval" icon={ShieldCheck} />
            <VerificationQueue vehicles={vehicles} onChanged={refreshVehicles} />
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title="Dispatch history" subtitle="Estimated travel time without priority compared with the actual trip" icon={Clock} />
        {history && network ? (
          <HistoryTable dispatches={history.dispatches} network={network} />
        ) : (
          <SkeletonGroup label="Loading dispatch history…" className="divide-y divide-line">
            {[...Array(4).keys()].map((i) => (
              <div key={i} className="flex items-center gap-6 px-4 py-3.5">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            ))}
          </SkeletonGroup>
        )}
      </Card>
    </div>
  );
}
