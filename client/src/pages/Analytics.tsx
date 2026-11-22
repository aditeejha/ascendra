import clsx from 'clsx';
import { Activity, Ambulance, Brain, ChartColumn, Cpu, FlaskConical, Gauge, RefreshCw, Timer, TrendingDown, Users } from 'lucide-react';
import { useEffect } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CLASS_LABEL, VEHICLE_CLASSES, type AnalyticsLive, type EvaluationResult, type ForecastResponse } from '../../../shared/types';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, ProgressBar, Skeleton, SkeletonGroup, Stat, TD, TH } from '../components/ui';
import { api } from '../lib/api';
import { CLASS_COLOR, num, pct } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

interface EvaluationState {
  result: EvaluationResult | null;
  running: boolean;
  done: number;
  total: number;
}

const TOOLTIP = { borderRadius: 10, border: '1px solid #e3e8f1', fontSize: 12 };
const AXIS = { fontSize: 11, fill: '#8a98b1' };

function reduction(before: number, after: number): number {
  return before > 0 ? 1 - after / before : 0;
}

export function AnalyticsPage() {
  const { role } = useRole();
  const toast = useToast();
  const evaluation = usePoll<EvaluationState>('/evaluation', 0);
  const forecast = usePoll<ForecastResponse>('/forecast', 30000);
  const live = usePoll<AnalyticsLive>('/analytics', 15000);
  const running = evaluation.data?.running ?? false;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(evaluation.refresh, 1500);
    return () => clearInterval(id);
  }, [running, evaluation.refresh]);

  const rerun = async () => {
    try {
      await api('/evaluation', { method: 'POST' });
      toast('success', 'Evaluation started: ASCENDRA vs fixed-time across four scenarios.');
      evaluation.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not start the evaluation');
    }
  };

  const result = evaluation.data?.result ?? null;
  const canRun = role === 'controller' || role === 'authority';

  return (
    <>
      <PageHeader
        title="Reports & analytics"
        description="How ASCENDRA performs against fixed-time signals on the real road network, how accurate both XGBoost forecasters are, and what the city looks like right now."
        actions={
          canRun ? (
            <Button icon={RefreshCw} onClick={rerun} loading={running} variant="navy">
              {running ? `Running ${evaluation.data?.done ?? 0}/${evaluation.data?.total || '…'}` : 'Re-run evaluation'}
            </Button>
          ) : null
        }
      />

      {running && (
        <Card className="mb-6 px-5 py-4">
          <div className="flex items-center justify-between text-[13px]">
            <span className="font-medium text-ink">Running scenario simulations…</span>
            <span className="tabular text-muted">
              {evaluation.data?.done ?? 0} / {evaluation.data?.total || '…'} runs
            </span>
          </div>
          <ProgressBar className="mt-2" value={evaluation.data?.total ? evaluation.data.done / evaluation.data.total : 0.03} />
        </Card>
      )}

      <HeadlineStats result={result} junction={(forecast.data?.junctionModel.metrics as Record<string, number> | null) ?? null} loading={evaluation.loading || forecast.loading} />

      <div className="mt-6">
        <EvaluationCard result={result} loading={evaluation.loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <JunctionModelCard forecast={forecast.data} loading={forecast.loading} />
        <ForecasterCard forecast={forecast.data} loading={forecast.loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <LiveAccuracyCard live={live.data} loading={live.loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <TravelTrendCard live={live.data} loading={live.loading} />
        <CompositionCard live={live.data} result={result} loading={live.loading} />
      </div>
    </>
  );
}

function HeadlineStats({ result, junction, loading }: { result: EvaluationResult | null; junction: Record<string, number> | null; loading: boolean }) {
  if (loading && !result) {
    return (
      <SkeletonGroup label="Loading headline results" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (item, i) => (
          <Card key={i} className="space-y-2 p-4">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-40" />
          </Card>
        ))}
      </SkeletonGroup>
    );
  }
  const scenarios = result?.scenarios ?? [];
  const avgDelayCut = scenarios.length ? scenarios.reduce((a, s) => a + reduction(s.fixed.avgDelayMin, s.adaptive.avgDelayMin), 0) / scenarios.length : null;
  const avgQueueCut = scenarios.length ? scenarios.reduce((a, s) => a + reduction(s.fixed.avgQueue, s.adaptive.avgQueue), 0) / scenarios.length : null;
  const em = result?.emergency;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Signal delay reduction" value={pct(avgDelayCut, 1)} icon={TrendingDown} tone="green" sub="Average across all scenarios vs fixed-time" />
      <Stat label="Queue length reduction" value={pct(avgQueueCut, 1)} icon={Gauge} tone="blue" sub="Vehicles waiting at signals, network-wide" />
      <Stat
        label="Ambulance travel time"
        value={em ? `${em.withPriorityMin} min` : '—'}
        icon={Ambulance}
        tone="red"
        sub={em ? `vs ${em.withoutPriorityMin} min without green wave (${pct(reduction(em.withoutPriorityMin, em.withPriorityMin))} faster)` : 'Run the evaluation'}
      />
      <Stat
        label="Junction forecast accuracy"
        value={pct(junction?.situationAcc15, 1)}
        icon={Brain}
        tone="navy"
        sub={junction ? `+15 min on real camera data · persistence ${pct(junction.situationAccPersistence15, 1)}` : 'Junction model not trained'}
      />
    </div>
  );
}

function EvaluationCard({ result, loading }: { result: EvaluationResult | null; loading: boolean }) {
  if (loading && !result) {
    return (
      <Card>
        <CardHeader title="Simulation evaluation" icon={FlaskConical} />
        <SkeletonGroup label="Loading evaluation" className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[1fr_1.4fr]">
          <Skeleton className="h-[280px] w-full" />
          <div className="space-y-2">
            {Array.from({ length: 5 }, (item, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </SkeletonGroup>
      </Card>
    );
  }
  if (!result) {
    return (
      <Card>
        <CardHeader title="Simulation evaluation" icon={FlaskConical} />
        <EmptyState icon={FlaskConical} title="No evaluation yet" description="Run the evaluation to compare ASCENDRA with fixed-time signal plans." />
      </Card>
    );
  }
  const chart = result.scenarios.map((s) => ({ name: s.label, 'Fixed-time': s.fixed.avgDelayMin, ASCENDRA: s.adaptive.avgDelayMin }));
  return (
    <Card>
      <CardHeader
        title="Simulation evaluation: ASCENDRA vs fixed-time signals"
        icon={FlaskConical}
        subtitle={`${result.seeds} seeds × ${result.durationMin} min per scenario after a 30 min warm-up · generated ${new Date(result.generatedAt).toLocaleString('en-IN')}`}
        actions={result.policy ? <Badge tone="blue">{result.policy.name}</Badge> : null}
      />
      <div className="grid grid-cols-1 gap-6 p-5 2xl:grid-cols-[1fr_1.6fr]">
        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-medium text-ink">Average signal & queue delay per trip (min)</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 5, right: 8, left: -16, bottom: 0 }} barGap={4}>
                <CartesianGrid stroke="#e3e8f1" vertical={false} />
                <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: '#f1f4fa' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar isAnimationActive={false} dataKey="Fixed-time" fill="#8fa3cc" radius={[6, 6, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="ASCENDRA" fill="#1d4ed8" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-line">
              <tr>
                <th className={clsx(TH, 'w-[34%]')}>Scenario</th>
                <th className={TH}>Travel (min)</th>
                <th className={TH}>Delay (min)</th>
                <th className={TH}>Avg queue</th>
                <th className={TH}>Stops / trip</th>
                <th className={TH}>Ambulance (min)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.scenarios.map((s) => (
                <tr key={s.key}>
                  <td className={clsx(TD, 'min-w-[220px]')}>
                    <p className="font-medium">{s.label}</p>
                    <p className="text-xs text-muted">{s.description}</p>
                  </td>
                  <Compare before={s.fixed.avgTravelMin} after={s.adaptive.avgTravelMin} />
                  <Compare before={s.fixed.avgDelayMin} after={s.adaptive.avgDelayMin} />
                  <Compare before={s.fixed.avgQueue} after={s.adaptive.avgQueue} digits={0} />
                  <Compare before={s.fixed.stopsPerTrip} after={s.adaptive.stopsPerTrip} />
                  <Compare before={s.fixed.emergencyEtaMin} after={s.adaptive.emergencyEtaMin} />
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Fixed-time baseline: static signal plans, no forecast-aware routing, no emergency priority. ASCENDRA: RL signal agent with safety constraints, XGBoost forecasts driving interventions and routing, and emergency green waves. Same demand and random seeds for both.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Compare({ before, after, digits = 2 }: { before: number | null; after: number | null; digits?: number }) {
  if (before === null || after === null) return <td className={TD}>—</td>;
  const cut = reduction(before, after);
  return (
    <td className={TD}>
      <span className="tabular text-muted">{before.toFixed(digits)}</span>
      <span className="text-subtle"> → </span>
      <span className="tabular font-semibold text-ink">{after.toFixed(digits)}</span>
      <span className={`tabular ml-1.5 text-xs font-medium ${cut >= 0 ? 'text-free' : 'text-jam'}`}>
        {cut >= 0 ? '−' : '+'}
        {Math.abs(cut * 100).toFixed(0)}%
      </span>
    </td>
  );
}

function ForecasterCard({ forecast, loading }: { forecast: ForecastResponse | null; loading: boolean }) {
  const m = forecast?.model.metrics;
  return (
    <Card>
      <CardHeader
        title="Congestion forecaster"
        icon={Brain}
        subtitle={forecast?.model.available ? `${forecast.model.name} · ${forecast.model.trees} trees · trained ${forecast.model.trainedAt ? new Date(forecast.model.trainedAt).toLocaleDateString('en-IN') : ''}` : 'Not trained'}
      />
      {loading && !forecast ? (
        <SkeletonGroup label="Loading forecaster" className="space-y-2 p-5">
          {Array.from({ length: 5 }, (item, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </SkeletonGroup>
      ) : !m ? (
        <EmptyState icon={Brain} title="Forecaster not trained" description="Run npm run sim:history and npm run train:forecaster." />
      ) : (
        <CardBody>
          <p className="mb-3 text-[13px] text-muted">
            Each forecast is the average congestion over the 5 minutes up to +15 or +30 min. Scored on held-out test days ({num(m.testRows)} link-samples) against persistence (congestion stays at its average over the last 5 minutes).
          </p>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={TH}>Metric</th>
                  <th className={TH}>+15 min</th>
                  <th className={TH}>+30 min</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <MetricRow label="Mean absolute error" a={m.mae15} b={m.mae30} base={[m.baselineMae15, m.baselineMae30]} lowerBetter />
                <MetricRow label="MAE on busy links" a={m.maeBusy15} b={m.maeBusy30} base={[m.baselineMaeBusy15, m.baselineMaeBusy30]} lowerBetter />
                <MetricRow label="Congestion level accuracy" a={m.levelAcc15} b={m.levelAcc30} base={[m.baselineLevelAcc15, m.baselineLevelAcc30]} percent />
                <MetricRow label="R²" a={m.r2_15} b={m.r2_30} />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Per-road model for routing and hotspots, trained on {num(m.trainRows)} samples from {m.days} simulated days on the real road network (no public road-by-road data exists for the city). Exported trees reproduce XGBoost's predictions to within {m.exportParity15?.toExponential(0)}.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function JunctionModelCard({ forecast, loading }: { forecast: ForecastResponse | null; loading: boolean }) {
  const info = forecast?.junctionModel;
  const m = info?.metrics as Record<string, number> | null | undefined;
  return (
    <Card>
      <CardHeader
        title="Junction forecaster · real camera counts"
        icon={Brain}
        subtitle={info?.available ? `${info.name} · trained ${info.trainedAt ? new Date(info.trainedAt).toLocaleDateString('en-IN') : ''}` : 'Not trained'}
      />
      {loading && !forecast ? (
        <SkeletonGroup label="Loading junction forecaster" className="space-y-2 p-5">
          {Array.from({ length: 5 }, (item, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </SkeletonGroup>
      ) : !m || !info?.dataset ? (
        <EmptyState icon={Brain} title="Junction model not trained" description="Run npm run train:junction to train it on the Kaggle Traffic Prediction Dataset." />
      ) : (
        <CardBody>
          <p className="mb-3 text-[13px] text-muted">
            Trained on{' '}
            <a href={info.dataset.url} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
              {info.dataset.name}
            </a>
            : {num(info.dataset.rows)} real 15-minute vehicle counts over {info.dataset.days} days. Tested on the last 9 days ({num(m.testRows)} intervals), against persistence.
          </p>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-line">
                <tr>
                  <th className={TH}>Metric</th>
                  <th className={TH}>+15 min</th>
                  <th className={TH}>+30 min</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <CountRow label="Vehicle count error (MAE)" a={m.countMae15} b={m.countMae30} base={[m.countMaePersistence15, m.countMaePersistence30]} />
                <MetricRow label="Count R²" a={m.countR2_15} b={m.countR2_30} />
                <MetricRow label="Traffic situation accuracy" a={m.situationAcc15} b={m.situationAcc30} base={[m.situationAccPersistence15, m.situationAccPersistence30]} percent />
                <MetricRow label="Heavy traffic caught (recall)" a={m.heavyRecall15} b={m.heavyRecall30} percent />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Every 15 minutes ASCENDRA counts cars, two-wheelers and heavy vehicles on the busiest approach of each signal and asks this model for the situation now, in 15 and in 30 minutes; a predicted jam raises that approach's green priority.
          </p>
        </CardBody>
      )}
    </Card>
  );
}

function CountRow({ label, a, b, base }: { label: string; a: number; b: number; base: [number, number] }) {
  const cell = (v: number, ref: number) => (
    <span>
      <span className="tabular font-semibold text-ink">{v.toFixed(1)}</span>
      <span className={`tabular ml-1.5 text-xs ${v < ref ? 'text-free' : 'text-jam'}`}>vs {ref.toFixed(1)}</span>
    </span>
  );
  return (
    <tr>
      <td className={TD}>{label}</td>
      <td className={TD}>{cell(a, base[0])}</td>
      <td className={TD}>{cell(b, base[1])}</td>
    </tr>
  );
}

function MetricRow({ label, a, b, base, percent, lowerBetter }: { label: string; a: number; b: number; base?: [number, number]; percent?: boolean; lowerBetter?: boolean }) {
  const fmt = (v: number) => (percent ? pct(v, 1) : v.toFixed(3));
  const cell = (v: number, ref?: number) => {
    if (ref === undefined) return <span className="tabular font-semibold text-ink">{fmt(v)}</span>;
    const better = lowerBetter ? v < ref : v > ref;
    return (
      <span>
        <span className="tabular font-semibold text-ink">{fmt(v)}</span>
        <span className={`tabular ml-1.5 text-xs ${better ? 'text-free' : 'text-jam'}`}>vs {fmt(ref)}</span>
      </span>
    );
  };
  return (
    <tr>
      <td className={TD}>{label}</td>
      <td className={TD}>{cell(a, base?.[0])}</td>
      <td className={TD}>{cell(b, base?.[1])}</td>
    </tr>
  );
}

function LiveAccuracyCard({ live, loading }: { live: AnalyticsLive | null; loading: boolean }) {
  const p = live?.prediction;
  return (
    <Card>
      <CardHeader title="Live forecast accuracy" icon={Timer} subtitle="Forecasts made 15 and 30 sim-minutes ago, checked against what actually happened (rolling 2 h)" />
      {loading && !live ? (
        <SkeletonGroup label="Loading live accuracy" className="grid grid-cols-2 gap-4 p-5">
          {Array.from({ length: 4 }, (item, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </SkeletonGroup>
      ) : !p || (!p.samples15 && !p.samples30) ? (
        <EmptyState icon={Timer} title="Collecting outcomes" description="Accuracy appears once the first forecasts reach their 15-minute horizon." />
      ) : (
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              ['+15 min', p.mae15, p.baselineMae15, p.levelAcc15, p.samples15],
              ['+30 min', p.mae30, p.baselineMae30, p.levelAcc30, p.samples30],
            ] as const
          ).map(([label, mae, base, acc, n]) => (
            <div key={label} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold text-ink">{label}</p>
                <Badge tone="neutral">{num(n)} checks</Badge>
              </div>
              <p className="tabular mt-3 text-2xl font-semibold text-ink">{pct(acc, 1)}</p>
              <p className="text-xs text-muted">level accuracy</p>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted">MAE (model)</span>
                  <span className="tabular font-medium text-ink">{mae?.toFixed(3) ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">MAE (persistence)</span>
                  <span className="tabular font-medium text-ink">{base?.toFixed(3) ?? '—'}</span>
                </div>
                {mae !== null && base !== null && base > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted">Error reduction</span>
                    <span className={`tabular font-semibold ${mae < base ? 'text-free' : 'text-jam'}`}>{pct(1 - mae / base, 1)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  );
}

function TravelTrendCard({ live, loading }: { live: AnalyticsLive | null; loading: boolean }) {
  const data = live?.series.slice(-180) ?? [];
  return (
    <Card>
      <CardHeader title="Travel time & speed" icon={Activity} subtitle="Rolling 15-minute averages over simulated time" />
      <div className="h-[300px] px-2 pt-4 pb-2">
        {loading && !live ? (
          <SkeletonGroup label="Loading trend" className="h-full px-3 pb-3">
            <Skeleton className="h-full w-full" />
          </SkeletonGroup>
        ) : data.length < 2 ? (
          <EmptyState icon={Activity} title="Collecting data" description="The chart fills in as simulated minutes pass." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#e3e8f1" vertical={false} />
              <XAxis dataKey="clock" tick={AXIS} tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis yAxisId="m" tick={AXIS} tickLine={false} axisLine={false} width={40} />
              <YAxis yAxisId="s" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={36} />
              <Tooltip contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} yAxisId="m" type="monotone" dataKey="avgTravelMin" name="Travel (min)" stroke="#1d4ed8" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} yAxisId="m" type="monotone" dataKey="avgDelayMin" name="Delay (min)" stroke="#f97316" strokeWidth={2} dot={false} />
              <Line isAnimationActive={false} yAxisId="s" type="monotone" dataKey="avgSpeedKmh" name="Speed (km/h)" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function CompositionCard({ live, result, loading }: { live: AnalyticsLive | null; result: EvaluationResult | null; loading: boolean }) {
  if (loading && !live) {
    return (
      <Card>
        <CardHeader title="Traffic composition" icon={Users} />
        <SkeletonGroup label="Loading composition" className="space-y-3 p-5">
          {Array.from({ length: 6 }, (item, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </SkeletonGroup>
      </Card>
    );
  }
  if (!live) return null;
  const total = VEHICLE_CLASSES.reduce((a, c) => a + live.classMix[c], 0) || 1;
  return (
    <Card>
      <CardHeader title="Traffic composition & agents" icon={Users} subtitle="Vehicle classes on the network, recent trips and control agents" />
      <CardBody className="space-y-5">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead className="border-b border-line">
              <tr>
                <th className={TH}>Class</th>
                <th className={TH}>Share now</th>
                <th className={TH}>Recent trips</th>
                <th className={TH}>Avg trip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {VEHICLE_CLASSES.map((c) => (
                <tr key={c}>
                  <td className={TD}>
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
                      {CLASS_LABEL[c]}
                    </span>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <ProgressBar className="w-20" value={live.classMix[c] / total} color={CLASS_COLOR[c]} />
                      <span className="tabular text-xs text-muted">{pct(live.classMix[c] / total)}</span>
                    </div>
                  </td>
                  <td className={`${TD} tabular`}>{num(live.tripsByClass[c].trips)}</td>
                  <td className={`${TD} tabular`}>{live.tripsByClass[c].avgTravelMin} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Cpu className="size-4 text-brand-600" /> RL signal agent
            </p>
            <p className="mt-2 text-xs text-muted">
              {result?.policy
                ? `${result.policy.name}: ${num(result.policy.states)} traffic states learned over ${result.policy.episodes} training episodes. Unfamiliar states fall back to queue-pressure control.`
                : 'No trained policy loaded; signals use queue-pressure control.'}
            </p>
          </div>
          <div className="rounded-xl border border-line p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <ChartColumn className="size-4 text-brand-600" /> Live dispatches
            </p>
            <p className="mt-2 text-xs text-muted">
              {live.emergency.dispatched} dispatched, {live.emergency.arrived} arrived
              {live.emergency.avgSavedMin !== null ? `, ${live.emergency.avgSavedMin} min saved on average vs estimate without priority` : ''}.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
