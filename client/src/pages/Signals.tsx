import clsx from 'clsx';
import { Cpu, MousePointerClick, Siren, SlidersHorizontal, TrafficCone, Wrench, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ForecastResponse, JunctionOutlook, NetworkInfo, SignalDetail, SignalMode, Snapshot } from '../../../shared/types';
import { CityMap, MapSkeleton } from '../components/CityMap';
import { SituationBadge } from '../components/JunctionOutlook';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Segmented,
  Skeleton,
  SkeletonGroup,
  Stat,
  TD,
  TH,
  Toggle,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

const POLICY_LABEL: Record<SignalDetail['policy'], string> = {
  rl: 'RL agent',
  'max-pressure': 'Queue pressure',
  fixed: 'Fixed plan',
  preemption: 'Green wave',
  evacuation: 'Evacuation',
};

const POLICY_TONE: Record<SignalDetail['policy'], Tone> = {
  rl: 'blue',
  'max-pressure': 'sky',
  fixed: 'neutral',
  preemption: 'green',
  evacuation: 'red',
};

const STATE_DOT: Record<SignalDetail['state'], string> = {
  green: 'bg-free',
  yellow: 'bg-moderate',
  allred: 'bg-jam',
};

function PhaseCell({ signal }: { signal: SignalDetail }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={clsx('size-2.5 rounded-full ring-2 ring-white', STATE_DOT[signal.state])} />
      <span className="font-semibold text-navy-900">{signal.phase}</span>
      <span className="text-[13px] text-muted">{signal.state === 'allred' ? 'all red' : signal.state}</span>
    </span>
  );
}

function QueueBar({ value }: { value: number }) {
  const color = value >= 15 ? 'bg-jam' : value >= 8 ? 'bg-heavy' : value >= 4 ? 'bg-moderate' : 'bg-free';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-navy-50">
        <div className={clsx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.min(100, (value / 20) * 100)}%` }} />
      </div>
      <span className="tabular w-6 text-right text-xs text-muted">{value}</span>
    </div>
  );
}

function SignalStatusBadges({ signal }: { signal: SignalDetail }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={signal.mode === 'adaptive' ? 'blue' : 'neutral'}>{signal.mode === 'adaptive' ? 'Adaptive' : 'Fixed-time'}</Badge>
      {signal.fault && (
        <Badge tone="amber" dot>
          Fault
        </Badge>
      )}
      {signal.preempted && (
        <Badge tone="green" dot>
          Preempted
        </Badge>
      )}
    </div>
  );
}

function SignalTable({
  signals,
  network,
  selected,
  onSelect,
}: {
  signals: SignalDetail[];
  network: NetworkInfo;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead className="border-b border-line bg-navy-50/60">
          <tr>
            <th className={TH}>Junction</th>
            <th className={TH}>Control</th>
            <th className={TH}>Phase</th>
            <th className={TH}>Queues</th>
            <th className={TH}>Plan</th>
            <th className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {signals.map((s) => (
            <tr
              key={s.nodeId}
              onClick={() => onSelect(s.nodeId)}
              className={clsx('cursor-pointer transition-colors', selected === s.nodeId ? 'bg-brand-50/70' : 'hover:bg-navy-50/60')}
            >
              <td className={clsx(TD, 'min-w-[190px]')}>
                <p className="font-medium text-ink">{s.name}</p>
                <p className="text-xs text-muted">{network.nodes[s.nodeId].key}</p>
              </td>
              <td className={TD}>
                <div className="flex flex-col items-start gap-1.5">
                  <SignalStatusBadges signal={s} />
                  <Badge tone={POLICY_TONE[s.policy]}>{POLICY_LABEL[s.policy]}</Badge>
                </div>
              </td>
              <td className={clsx(TD, 'whitespace-nowrap')}>
                <PhaseCell signal={s} />
                <p className="tabular mt-0.5 text-xs text-muted">{s.state === 'green' ? `${s.greenElapsed}s green` : s.state === 'yellow' ? 'Changing' : 'Clearing'}</p>
              </td>
              <td className={TD}>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-[11px] font-semibold text-subtle">NS</span>
                    <QueueBar value={s.queueNS} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 text-[11px] font-semibold text-subtle">EW</span>
                    <QueueBar value={s.queueEW} />
                  </div>
                </div>
              </td>
              <td className={clsx(TD, 'tabular whitespace-nowrap text-muted')}>
                <p className="text-ink">
                  {s.plan.greenNS}s / {s.plan.greenEW}s
                </p>
                <p className="text-xs">{s.switches} changes</p>
              </td>
              <td className={clsx(TD, 'text-right')}>
                <Button
                  size="sm"
                  variant={selected === s.nodeId ? 'primary' : 'secondary'}
                  icon={SlidersHorizontal}
                  aria-label={`Configure ${s.name}`}
                  title="Configure timing"
                  className="w-8 px-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(s.nodeId);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GreenSlider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-ink">
        {label}
        <span className="tabular rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-800">{value}s</span>
      </span>
      <input
        type="range"
        min={10}
        max={120}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function SignalEditor({ signal, onSaved }: { signal: SignalDetail; onSaved: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<SignalMode>(signal.mode);
  const [greenNS, setGreenNS] = useState(signal.plan.greenNS);
  const [greenEW, setGreenEW] = useState(signal.plan.greenEW);
  const [saving, setSaving] = useState(false);
  const cycle = greenNS + greenEW + 10;
  const dirty = mode !== signal.mode || greenNS !== signal.plan.greenNS || greenEW !== signal.plan.greenEW;

  const save = async () => {
    setSaving(true);
    try {
      await api<SignalDetail>(`/signals/${signal.nodeId}`, { method: 'PATCH', body: { mode, greenNS, greenEW } });
      toast('success', `${signal.name} updated: ${mode === 'adaptive' ? 'adaptive' : 'fixed-time'}, NS ${greenNS}s / EW ${greenEW}s.`);
      onSaved();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the signal.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-ink">Control mode</p>
        <Segmented
          ariaLabel="Control mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'adaptive', label: 'Adaptive' },
            { value: 'fixed', label: 'Fixed-time' },
          ]}
        />
        <p className="mt-1.5 text-xs text-muted">
          {mode === 'adaptive'
            ? 'The RL agent decides when to switch phases. The plan below is the fallback if adaptive control is turned off or the signal faults.'
            : 'The signal runs the green times below on a fixed cycle.'}
        </p>
      </div>
      <GreenSlider label="North–South green" value={greenNS} onChange={setGreenNS} />
      <GreenSlider label="East–West green" value={greenEW} onChange={setGreenEW} />
      <div className="rounded-xl bg-navy-50 px-4 py-3">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-muted">Cycle length</span>
          <span className="tabular font-semibold text-navy-900">{cycle}s</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full">
          <div className="bg-free" style={{ width: `${(greenNS / cycle) * 100}%` }} />
          <div className="bg-moderate" style={{ width: `${(5 / cycle) * 100}%` }} />
          <div className="bg-brand-500" style={{ width: `${(greenEW / cycle) * 100}%` }} />
          <div className="bg-moderate" style={{ width: `${(5 / cycle) * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted">
          <span>NS green</span>
          <span>EW green</span>
          <span>3s yellow + 2s all-red per change</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={save} loading={saving} disabled={!dirty}>
          Save plan
        </Button>
        <Button
          variant="secondary"
          disabled={!dirty || saving}
          onClick={() => {
            setMode(signal.mode);
            setGreenNS(signal.plan.greenNS);
            setGreenEW(signal.plan.greenEW);
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}

function SignalPanel({
  signal,
  network,
  snap,
  outlook,
  canEdit,
  onSelect,
  onClose,
  onSaved,
}: {
  signal: SignalDetail | null;
  network: NetworkInfo;
  snap: Snapshot | null;
  outlook: JunctionOutlook | null;
  canEdit: boolean;
  onSelect: (id: number) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!signal) {
    return (
      <Card>
        <CardHeader title="Junction detail" subtitle="Pick a junction on the map or in the table" icon={MousePointerClick} />
        <div className="p-3">
          <CityMap network={network} snap={snap} compact onNodeClick={onSelect} ariaLabel="Select a junction" />
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title={signal.name}
        subtitle={`${network.nodes[signal.nodeId].key} · ${signal.mode === 'adaptive' ? 'Adaptive control' : 'Fixed-time plan'}`}
        icon={TrafficCone}
        actions={
          <button className="grid size-8 place-items-center rounded-lg text-muted hover:bg-navy-50 hover:text-ink" onClick={onClose} aria-label="Close junction detail">
            <X className="size-4" />
          </button>
        }
      />
      <div className="p-3">
        <CityMap network={network} snap={snap} compact selectedNode={signal.nodeId} onNodeClick={onSelect} ariaLabel={`Map centred on ${signal.name}`} />
      </div>
      <CardBody className="border-t border-line pt-2">
        <div className="divide-y divide-line">
          <DetailRow label="Current phase">
            <PhaseCell signal={signal} />
          </DetailRow>
          <DetailRow label="Green elapsed">{signal.state === 'green' ? `${signal.greenElapsed}s` : '—'}</DetailRow>
          <DetailRow label="Queue NS / EW">
            <span className="tabular">
              {signal.queueNS} / {signal.queueEW} vehicles
            </span>
          </DetailRow>
          <DetailRow label="Deciding policy">
            <Badge tone={POLICY_TONE[signal.policy]}>{POLICY_LABEL[signal.policy]}</Badge>
          </DetailRow>
          <DetailRow label="Last action">{signal.lastAction}</DetailRow>
          <DetailRow label="Phase switches">
            <span className="tabular">{signal.switches}</span>
          </DetailRow>
        </div>
      </CardBody>
      <CardBody className="border-t border-line">
        <p className="text-sm font-semibold text-ink">Junction outlook</p>
        <p className="mb-3 text-xs text-muted">XGBoost trained on real camera counts (Kaggle), from the last 15-minute count on the busiest approach</p>
        {outlook ? (
          <div className="space-y-2.5 text-[13px]">
            <DetailRow label={`Counted on ${outlook.approachRoad}`}>
              <span className="tabular">
                {outlook.counts.total} vehicles ({outlook.counts.car} cars, {outlook.counts.bike} two-wheelers, {outlook.counts.heavy} heavy)
              </span>
            </DetailRow>
            <DetailRow label="Situation now">
              <SituationBadge value={outlook.situationNow} />
            </DetailRow>
            <DetailRow label="In 15 minutes">
              <span className="inline-flex items-center gap-2">
                <SituationBadge value={outlook.situation15} prob={Math.max(...outlook.probs15)} />
                <span className="tabular text-muted">≈ {outlook.count15} vehicles</span>
              </span>
            </DetailRow>
            <DetailRow label="In 30 minutes">
              <span className="inline-flex items-center gap-2">
                <SituationBadge value={outlook.situation30} prob={Math.max(...outlook.probs30)} />
                <span className="tabular text-muted">≈ {outlook.count30} vehicles</span>
              </span>
            </DetailRow>
          </div>
        ) : (
          <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-muted">The outlook appears after the next 15-minute count at this junction.</p>
        )}
      </CardBody>
      <CardBody className="border-t border-line">
        <p className="mb-3 text-sm font-semibold text-ink">Timing plan</p>
        {canEdit ? (
          <SignalEditor key={signal.nodeId} signal={signal} onSaved={onSaved} />
        ) : (
          <div className="space-y-3">
            <DetailRow label="North–South green">{signal.plan.greenNS}s</DetailRow>
            <DetailRow label="East–West green">{signal.plan.greenEW}s</DetailRow>
            <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-muted">Only the traffic controller can change signal timing.</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SignalsSkeleton() {
  return (
    <SkeletonGroup label="Loading signals…" className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4).keys()].map((i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="border-b border-line px-5 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          <div className="divide-y divide-line">
            {[...Array(9).keys()].map((i) => (
              <div key={i} className="flex items-center gap-6 px-4 py-3.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-2 w-20" />
                <Skeleton className="h-2 w-20" />
                <Skeleton className="ml-auto h-8 w-24" />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="border-b border-line px-5 py-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-2 h-3 w-52" />
          </div>
          <div className="p-3">
            <MapSkeleton />
          </div>
        </Card>
      </div>
    </SkeletonGroup>
  );
}

export function SignalsPage() {
  const { network, snap } = useLive();
  const { role } = useRole();
  const toast = useToast();
  const canEdit = role === 'controller';
  const { data: signals, refresh } = usePoll<SignalDetail[]>('/signals', 2000);
  const forecast = usePoll<ForecastResponse>('/forecast', 30000);
  const [params, setParams] = useSearchParams();
  const [savingAdaptive, setSavingAdaptive] = useState(false);
  const nodeParam = params.get('node');
  const selected = nodeParam !== null && nodeParam !== '' && !Number.isNaN(Number(nodeParam)) ? Number(nodeParam) : null;

  const select = (id: number | null) => {
    setParams(id === null ? {} : { node: String(id) }, { replace: true });
  };

  const setAdaptive = async (adaptive: boolean) => {
    setSavingAdaptive(true);
    try {
      await api('/settings', { method: 'PATCH', body: { adaptive } });
      toast('success', adaptive ? 'Adaptive control enabled across the network.' : 'All signals switched to their fixed-time plans.');
      refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not change the control mode.');
    } finally {
      setSavingAdaptive(false);
    }
  };

  const header = (
    <PageHeader
      title="Traffic signals"
      description="Live phase state, queues, timing plans and a 15–30 minute outlook for every signalised junction. Adaptive junctions are timed by the reinforcement-learning agent with forecast-driven priority."
      actions={
        <div className="w-full rounded-xl border border-line bg-white px-4 sm:w-80">
          <Toggle
            checked={snap?.adaptive ?? true}
            onChange={setAdaptive}
            disabled={!canEdit || savingAdaptive || !snap}
            label="Adaptive control"
            description={canEdit ? 'RL agent + 15–30 min forecasts' : 'Set by the traffic controller'}
          />
        </div>
      }
    />
  );

  if (!signals || !network) {
    return (
      <div>
        {header}
        <SignalsSkeleton />
      </div>
    );
  }

  const adaptiveCount = signals.filter((s) => s.mode === 'adaptive').length;
  const fixedCount = signals.length - adaptiveCount;
  const preempted = signals.filter((s) => s.preempted).length;
  const faults = signals.filter((s) => s.fault).length;
  const busiest = [...signals].sort((a, b) => b.queueNS + b.queueEW - (a.queueNS + a.queueEW))[0];
  const current = selected !== null ? (signals.find((s) => s.nodeId === selected) ?? null) : null;

  return (
    <div>
      {header}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Adaptive signals" value={adaptiveCount} icon={Cpu} tone="blue" sub={`of ${signals.length} junctions`} />
        <Stat label="Fixed-time signals" value={fixedCount} icon={TrafficCone} tone="navy" sub={snap?.adaptive ? 'Set per junction' : 'Network-wide fixed plans'} />
        <Stat label="Green-wave preemptions" value={preempted} icon={Siren} tone="green" sub={`${snap?.kpis.emergencyEnRoute ?? 0} emergency vehicles en route`} />
        <Stat
          label="Signal faults"
          value={faults}
          icon={Wrench}
          tone={faults ? 'amber' : 'green'}
          sub={busiest ? `Longest queue: ${busiest.name.split(' × ')[0]}` : undefined}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHeader
            title="All junctions"
            subtitle="Select a row to inspect or configure its timing plan"
            actions={
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-free" /> Green
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-moderate" /> Yellow
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-jam" /> All red
                </span>
              </div>
            }
          />
          <SignalTable signals={signals} network={network} selected={selected} onSelect={select} />
        </Card>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <SignalPanel
            signal={current}
            network={network}
            snap={snap}
            outlook={current ? (forecast.data?.junctions.find((j) => j.nodeId === current.nodeId) ?? null) : null}
            canEdit={canEdit}
            onSelect={select}
            onClose={() => select(null)}
            onSaved={refresh}
          />
        </div>
      </div>
    </div>
  );
}
