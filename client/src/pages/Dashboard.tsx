import clsx from 'clsx';
import {
  Activity,
  Ambulance,
  ArrowRight,
  Brain,
  Car,
  Clock,
  Gauge,
  MessageSquareExclamationPoint,
  Radio,
  Siren,
  Sparkles,
  TrafficCone,
  TriangleExclamationPoint,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnalyticsLive, FeedEvent, ForecastResponse, NetworkInfo, SignalDetail, Snapshot } from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton } from '../components/CityMap';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, LevelBadge, PageHeader, Segmented, Skeleton, SkeletonGroup, Stat } from '../components/ui';
import { scoreColor, linkLabel, pct } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';

type Layer = 'now' | 'h15' | 'h30';

const EVENT_ICON: Record<FeedEvent['kind'], LucideIcon> = {
  ambulance: Ambulance,
  accident: TriangleExclamationPoint,
  overspeed: Gauge,
  civic: MessageSquareExclamationPoint,
  forecast: Brain,
  evacuation: Siren,
  signal: TrafficCone,
  system: Radio,
};

const SEVERITY_STYLE: Record<FeedEvent['severity'], string> = {
  info: 'bg-brand-50 text-brand-600',
  warning: 'bg-amber-50 text-amber-600',
  critical: 'bg-red-50 text-jam',
};

const POLICY_LABEL: Record<SignalDetail['policy'], string> = {
  rl: 'RL agent',
  'max-pressure': 'Queue pressure',
  fixed: 'Fixed plan',
  preemption: 'Green wave',
  evacuation: 'Evacuation',
};

export function DashboardPage() {
  const { network, snap } = useLive();
  const { can } = useRole();
  const [layer, setLayer] = useState<Layer>('now');
  const [selected, setSelected] = useState<number | null>(null);
  const forecast = usePoll<ForecastResponse>('/forecast', 15000);
  const events = usePoll<FeedEvent[]>('/events', 4000);
  const analytics = usePoll<AnalyticsLive>('/analytics', 20000);
  const signals = usePoll<SignalDetail[]>('/signals', 2000);

  const busiest = useMemo(() => {
    if (!signals.data) return null;
    return [...signals.data].sort((a, b) => b.queueNS + b.queueEW - (a.queueNS + a.queueEW))[0]?.nodeId ?? null;
  }, [signals.data]);
  const focus = selected ?? busiest;

  const layerScores = useMemo(() => {
    if (layer === 'now' || !forecast.data?.links.length) return null;
    return forecast.data.links.map((l) => (layer === 'h15' ? l.h15 : l.h30));
  }, [layer, forecast.data]);

  if (!network || !snap) return <DashboardSkeleton />;

  const k = snap.kpis;
  const segmentsTotal = network.links.length / 2;
  const predicted = forecast.data?.hotspots.length ?? 0;
  const focusSignal = focus !== null ? signals.data?.find((s) => s.nodeId === focus) ?? null : null;

  return (
    <>
      <PageHeader
        title="City operations"
        description={`Live view of the network on ${snap.day}. Signals adapt in real time, congestion is forecast 15–30 minutes ahead and emergency vehicles get green waves.`}
        actions={
          can('map') ? (
            <Link to="/map">
              <Button variant="secondary" icon={ArrowRight}>
                Open live map
              </Button>
            </Link>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Vehicles on network" value={k.activeVehicles.toLocaleString('en-IN')} icon={Car} tone="blue" sub={`${k.throughputPerHour.toLocaleString('en-IN')} trips/h · ${k.avgSpeedKmh} km/h avg`} />
        <Stat
          label="Congested segments"
          value={
            <span>
              {k.congestedSegments}
              <span className="text-base font-medium text-subtle"> / {segmentsTotal}</span>
            </span>
          }
          icon={TriangleExclamationPoint}
          tone="red"
          sub={predicted ? `${predicted} links forecast to build up in 15–30 min` : 'No build-up forecast in 15–30 min'}
        />
        <Stat label="Avg travel time" value={`${k.avgTravelMin} min`} icon={Clock} tone="green" sub={`Signal & queue delay ${k.avgDelayMin} min per trip`} />
        <Stat
          label="Emergency en route"
          value={k.emergencyEnRoute}
          icon={Ambulance}
          tone="amber"
          sub={k.emergencyEnRoute ? 'Green wave active along their routes' : 'No emergency vehicles moving'}
        />
        <Stat
          label="Civic issues open"
          value={snap.counters?.openCivic ?? 0}
          icon={MessageSquareExclamationPoint}
          tone="navy"
          sub={`${snap.counters?.openAlerts ?? 0} overspeed ${snap.counters?.openAlerts === 1 ? 'alert' : 'alerts'} awaiting action`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
        <Card>
          <CardHeader
            title="Live city map"
            icon={Activity}
            subtitle={
              layer === 'now'
                ? 'Current congestion, signal states and vehicles. Click a junction to inspect it.'
                : `Congestion forecast for ${layer === 'h15' ? '+15' : '+30'} min from the XGBoost model`
            }
            actions={
              <Segmented<Layer>
                ariaLabel="Map layer"
                size="sm"
                value={layer}
                onChange={setLayer}
                options={[
                  { value: 'now', label: 'Now' },
                  { value: 'h15', label: '+15 min' },
                  { value: 'h30', label: '+30 min' },
                ]}
              />
            }
          />
          <div className="p-3">
            <div className="overflow-hidden rounded-xl ring-1 ring-line">
              <CityMap network={network} snap={snap} scores={layerScores} showVehicles={layer === 'now'} selectedNode={focus} onNodeClick={setSelected} />
            </div>
            <MapLegend className="px-2 pt-3" />
          </div>
        </Card>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <HotspotsCard network={network} forecast={forecast.data} loading={forecast.loading} />
          <InterventionsCard forecast={forecast.data} loading={forecast.loading} />
        </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <IntersectionCard network={network} snap={snap} signal={focusSignal} canEdit={can('signals')} />
          <AlertsCard events={events.data} loading={events.loading} />
          <TrendCard analytics={analytics.data} loading={analytics.loading} />
        </div>
      </div>
    </>
  );
}

function IntersectionCard({ network, snap, signal, canEdit }: { network: NetworkInfo; snap: Snapshot; signal: SignalDetail | null; canEdit: boolean }) {
  if (!signal) {
    return (
      <Card>
        <CardHeader title="Selected intersection" icon={TrafficCone} />
        <SkeletonGroup label="Loading intersection" className="space-y-3 p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </SkeletonGroup>
      </Card>
    );
  }
  const node = network.nodes[signal.nodeId];
  const nodeLinks = network.links.filter((l) => l.to === signal.nodeId);
  const worst = Math.max(...nodeLinks.map((l) => snap.linkScore[l.id]));
  const phases = (['NS', 'EW'] as const).map((p) => {
    const active = signal.phase === p;
    const color = !active || signal.state === 'allred' ? '#ef4444' : signal.state === 'yellow' ? '#facc15' : '#22c55e';
    const plan = p === 'NS' ? signal.plan.greenNS : signal.plan.greenEW;
    const queue = p === 'NS' ? signal.queueNS : signal.queueEW;
    return { p, active, color, plan, queue, label: p === 'NS' ? 'North – South' : 'East – West' };
  });
  return (
    <Card>
      <CardHeader
        title="Selected intersection"
        icon={TrafficCone}
        actions={
          canEdit ? (
            <Link to={`/signals?node=${signal.nodeId}`}>
              <Button size="sm" variant="secondary">
                Adjust timing
              </Button>
            </Link>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        <div>
          <p className="text-[15px] font-semibold text-ink">{node.name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{node.key}</Badge>
            <Badge tone={signal.mode === 'adaptive' ? 'blue' : 'neutral'}>{signal.mode === 'adaptive' ? 'Adaptive' : 'Fixed-time'}</Badge>
            <Badge tone={signal.policy === 'preemption' ? 'green' : signal.policy === 'evacuation' ? 'red' : 'navy'}>{POLICY_LABEL[signal.policy]}</Badge>
            {signal.fault && <Badge tone="amber">Fault</Badge>}
            <LevelBadge score={worst} />
          </div>
        </div>
        <div className="space-y-2.5">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Signal timing (current)</p>
          {phases.map((ph) => (
            <div key={ph.p} className={clsx('rounded-xl border px-3 py-2.5', ph.active ? 'border-brand-100 bg-brand-50/50' : 'border-line')}>
              <div className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <span className="size-2.5 rounded-full" style={{ background: ph.color }} />
                  {ph.label}
                </span>
                <span className="tabular text-muted">
                  {ph.active && signal.state === 'green' ? `${signal.greenElapsed}s green` : ph.active ? signal.state : 'red'} · plan {ph.plan}s
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-navy-50">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${Math.min(100, ((ph.active ? signal.greenElapsed : 0) / Math.max(ph.plan, 1)) * 100)}%`, background: ph.color }}
                  />
                </div>
                <span className="tabular w-20 text-right text-xs text-muted">{ph.queue} queued</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Last action: <span className="font-medium text-ink">{signal.lastAction}</span> · {signal.switches} phase changes
        </p>
      </CardBody>
    </Card>
  );
}

function AlertsCard({ events, loading }: { events: FeedEvent[] | null; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Recent alerts" icon={Zap} subtitle="Emergencies, incidents, forecasts and citizen reports" />
      {loading && !events ? (
        <SkeletonGroup label="Loading alerts" className="space-y-4 p-5">
          {Array.from({ length: 5 }, (item, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
          ))}
        </SkeletonGroup>
      ) : !events?.length ? (
        <EmptyState icon={Zap} title="All quiet" description="New incidents and dispatches will appear here." />
      ) : (
        <ul className="divide-y divide-line">
          {events.slice(0, 5).map((e) => {
            const Icon = EVENT_ICON[e.kind];
            return (
              <li key={e.id} className="flex gap-3 px-5 py-3">
                <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg', SEVERITY_STYLE[e.severity])}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[13px] font-semibold text-ink">{e.title}</p>
                    <span className="tabular shrink-0 text-xs text-subtle">{e.clock}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{e.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HotspotsCard({ network, forecast, loading }: { network: NetworkInfo; forecast: ForecastResponse | null; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Predicted hotspots" icon={Brain} subtitle={forecast?.model.available ? `${forecast.model.name} · updated ${forecast.clock}` : 'Forecast model not loaded'} />
      {loading && !forecast ? (
        <SkeletonGroup label="Loading forecast" className="space-y-3 p-5">
          {Array.from({ length: 4 }, (item, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </SkeletonGroup>
      ) : !forecast?.hotspots.length ? (
        <EmptyState icon={Sparkles} title="No hotspots ahead" description="Every link is forecast to stay free-flowing for the next 30 minutes." />
      ) : (
        <ul className="divide-y divide-line">
          {forecast.hotspots.slice(0, 5).map((h) => (
            <li key={h.linkId} className="px-5 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-ink">{linkLabel(network, network.links[h.linkId])}</p>
                <span className="tabular shrink-0 text-xs text-muted">{pct(h.conf)} conf.</span>
              </div>
              <p className="truncate text-xs text-muted">to {h.toName}</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                {(
                  [
                    ['Now', h.now],
                    ['+15', h.h15],
                    ['+30', h.h30],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-lg bg-navy-50 px-2 py-1.5">
                    <p className="text-subtle">{label}</p>
                    <p className="tabular font-semibold" style={{ color: scoreColor(v) }}>
                      {v.toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function InterventionsCard({ forecast, loading }: { forecast: ForecastResponse | null; loading: boolean }) {
  return (
    <Card>
      <CardHeader title="Proactive interventions" icon={Sparkles} subtitle="Actions taken before queues build up" />
      {loading && !forecast ? (
        <SkeletonGroup label="Loading interventions" className="space-y-3 p-5">
          {Array.from({ length: 4 }, (item, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </SkeletonGroup>
      ) : !forecast?.interventions.length ? (
        <EmptyState icon={Sparkles} title="Nothing needed yet" description="When the forecaster sees a link turning heavy, the signal downstream gets priority and connected vehicles are rerouted." />
      ) : (
        <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
          {forecast.interventions.slice(0, 8).map((i) => (
            <li key={i.id} className="flex gap-3 px-5 py-3">
              <span className="tabular mt-0.5 shrink-0 rounded-md bg-navy-900 px-1.5 py-0.5 text-[11px] font-semibold text-white">{i.clock}</span>
              <p className="text-xs leading-relaxed text-ink">{i.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TrendCard({ analytics, loading }: { analytics: AnalyticsLive | null; loading: boolean }) {
  const data = analytics?.series.slice(-120) ?? [];
  return (
    <Card>
      <CardHeader title="Network trend" icon={Activity} subtitle="Vehicles on the network and congested segments (sim time)" />
      <div className="h-[300px] px-2 pt-4 pb-2">
        {loading && !analytics ? (
          <SkeletonGroup label="Loading trend" className="h-full px-3 pb-3">
            <Skeleton className="h-full w-full" />
          </SkeletonGroup>
        ) : data.length < 2 ? (
          <EmptyState icon={Activity} title="Collecting data" description="The trend fills in as simulated minutes pass." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="gVeh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1d4ed8" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gCong" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e3e8f1" vertical={false} />
              <XAxis dataKey="clock" tick={{ fontSize: 11, fill: '#8a98b1' }} tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis yAxisId="v" tick={{ fontSize: 11, fill: '#8a98b1' }} tickLine={false} axisLine={false} width={44} />
              <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11, fill: '#8a98b1' }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e3e8f1', fontSize: 12 }} />
              <Area isAnimationActive={false} yAxisId="v" type="monotone" dataKey="activeVehicles" name="Vehicles" stroke="#1d4ed8" strokeWidth={2} fill="url(#gVeh)" />
              <Area isAnimationActive={false} yAxisId="c" type="monotone" dataKey="congestedSegments" name="Congested segments" stroke="#dc2626" strokeWidth={2} fill="url(#gCong)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function DashboardSkeleton() {
  const { network } = useLive();
  return (
    <SkeletonGroup label="Loading dashboard">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-[min(560px,100%)]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (item, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-7 w-20" />
              </div>
              <Skeleton className="size-10 rounded-xl" />
            </div>
            <Skeleton className="mt-3 h-3 w-36" />
          </Card>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="border-b border-line px-5 py-4">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="p-3">
            <MapSkeleton network={network} />
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </Card>
          <Card className="space-y-3 p-5">
            <Skeleton className="h-5 w-32" />
            {Array.from({ length: 4 }, (item, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </Card>
        </div>
      </div>
    </SkeletonGroup>
  );
}
