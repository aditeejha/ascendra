import { Brain, Database, FileUp, Play, RotateCcw, Square, Timer, TrendingDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReplayStatus } from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton } from '../components/CityMap';
import { SituationBadge } from '../components/JunctionOutlook';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, ProgressBar, Segmented, Skeleton, SkeletonGroup, Stat } from '../components/ui';
import { api } from '../lib/api';
import { pct } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

const SPEEDS = [16, 32, 64, 128] as const;

export function ReplayPage() {
  const { network, snap } = useLive();
  const { role } = useRole();
  const toast = useToast();
  const status = usePoll<ReplayStatus>('/replay', 1500);
  const [speed, setSpeed] = useState<number>(64);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canRun = role === 'controller' || role === 'authority';
  const s = status.data;

  const call = async (key: string, path: string, body?: unknown, ok?: string) => {
    setBusy(key);
    try {
      const next = await api<ReplayStatus>(path, { method: 'POST', body: body ?? {} });
      status.setData(next);
      if (ok) toast('success', ok);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 6_000_000) {
      toast('error', 'The file is larger than 6 MB.');
      return;
    }
    const csv = await file.text();
    await call('upload', '/replay/dataset', { name: file.name, csv }, `${file.name} loaded.`);
    if (fileRef.current) fileRef.current.value = '';
  };

  const done = s?.dataset ? s.index >= s.dataset.rows - 1 && !s.running : false;
  const chart = (s?.history ?? []).map((p) => ({ t: `${p.day.slice(0, 3)} ${p.clock}`, actual: p.actual, predicted: p.pred15 }));

  return (
    <div>
      <PageHeader
        title="Data replay"
        description="Upload a traffic-count dataset and ASCENDRA plays it through the city: each 15-minute row sets how much traffic there is and its mix of cars, two-wheelers, buses and trucks, while the XGBoost model forecasts the next 15 and 30 minutes and is scored against what the data shows next. Every other feature keeps working on the replayed traffic."
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Dataset" subtitle="CSV with a time column and vehicle counts" icon={Database} />
            <CardBody className="space-y-4">
              {canRun ? (
                <>
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-navy-200 bg-navy-50/60 px-4 py-6 text-center text-sm font-medium text-navy-700 hover:bg-navy-50">
                    <FileUp className="size-6" />
                    {busy === 'upload' ? 'Reading…' : 'Upload a CSV file'}
                    <span className="text-xs font-normal text-muted">Up to 6 MB</span>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
                  </label>
                  <Button className="w-full" variant="secondary" icon={Database} loading={busy === 'sample'} onClick={() => call('sample', '/replay/sample', {}, 'Kaggle sample loaded.')}>
                    Use the Kaggle sample
                  </Button>
                </>
              ) : (
                <p className="rounded-lg bg-navy-50 px-3 py-2 text-[13px] text-muted">Only the traffic controller or authority can load datasets.</p>
              )}
              <div className="rounded-lg bg-navy-50 px-3 py-2.5 text-xs text-muted">
                <p className="font-semibold text-ink">Accepted columns</p>
                <p className="mt-1">
                  <span className="font-mono">Time</span> (08:15 or 8:15:00 AM), optional <span className="font-mono">Day of the week</span>, and either{' '}
                  <span className="font-mono">Total</span> or per-class counts (<span className="font-mono">CarCount, BikeCount, BusCount, TruckCount</span>). An optional{' '}
                  <span className="font-mono">Traffic Situation</span> column (low, normal, high, heavy) is used to score the forecasts. Rows should be 15 minutes apart, the format of the Kaggle Traffic Prediction Dataset.
                </p>
              </div>
              {s?.dataset && (
                <div className="space-y-2 text-[13px]">
                  <p className="font-semibold text-ink">{s.dataset.name}</p>
                  <p className="text-muted">
                    {s.dataset.rows.toLocaleString('en-IN')} rows · about {s.dataset.days} days · mean {s.dataset.meanTotal} vehicles per 15 min, peak {s.dataset.maxTotal}
                  </p>
                  <p className="text-muted">
                    Mix: {pct(s.dataset.shares.car)} cars · {pct(s.dataset.shares.bike)} two-wheelers · {pct(s.dataset.shares.bus)} buses · {pct(s.dataset.shares.truck)} trucks
                  </p>
                  {s.dataset.hasLabels && <Badge tone="green">Has traffic-situation labels</Badge>}
                  {s.dataset.warnings.map((w) => (
                    <p key={w} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {s?.dataset && canRun && (
            <Card>
              <CardHeader title="Playback" subtitle={s.running ? 'Replaying now' : done ? 'Finished' : 'Ready'} icon={Play} />
              <CardBody className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-ink">Speed</p>
                  <Segmented ariaLabel="Replay speed" size="sm" value={speed} onChange={setSpeed} options={SPEEDS.map((v) => ({ value: v as number, label: `${v}×` }))} />
                  <p className="mt-1.5 text-xs text-muted">At {speed}×, one 15-minute row plays in {Math.round(900 / speed)} seconds.</p>
                </div>
                <div className="flex gap-2">
                  <Button icon={done ? RotateCcw : Play} loading={busy === 'start'} onClick={() => call('start', '/replay/start', { speed }, 'Replay started.')}>
                    {done ? 'Play again' : s.running ? 'Restart at this speed' : 'Start replay'}
                  </Button>
                  <Button variant="secondary" icon={Square} loading={busy === 'stop'} onClick={() => call('stop', '/replay/stop', {}, 'Back to live Deoghar traffic.')}>
                    Stop · back to live
                  </Button>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>
                      Row {(s.index + 1).toLocaleString('en-IN')} of {s.dataset.rows.toLocaleString('en-IN')}
                    </span>
                    <span>{s.current ? `${s.current.day} ${s.current.clock}` : ''}</span>
                  </div>
                  <ProgressBar className="mt-1.5" value={(s.index + 1) / s.dataset.rows} />
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {status.loading && !s ? (
            <SkeletonGroup label="Loading replay" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[...Array(3).keys()].map((i) => (
                <Skeleton key={i} className="h-28 rounded-2xl" />
              ))}
            </SkeletonGroup>
          ) : !s?.dataset ? (
            <Card>
              <EmptyState icon={FileUp} title="No dataset loaded" description="Upload a CSV or use the Kaggle sample to replay real traffic counts through the city." />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Stat
                  label="Vehicles in this 15 min"
                  value={s.current?.actual ?? '—'}
                  icon={Timer}
                  tone="navy"
                  sub={s.current ? `${s.current.car} cars · ${s.current.bike} two-wheelers · ${s.current.heavy} buses/trucks` : 'Start the replay'}
                />
                <Stat
                  label="Forecast error, +15 min"
                  value={s.accuracy.mae15 !== null ? `${s.accuracy.mae15} veh` : '—'}
                  icon={TrendingDown}
                  tone="green"
                  sub={s.accuracy.maePersistence15 !== null ? `vs ${s.accuracy.maePersistence15} if nothing changes · ${s.accuracy.n} checks` : 'Scored as rows play'}
                />
                <Stat
                  label="Situation correct, +15 min"
                  value={s.accuracy.situationAcc15 !== null ? pct(s.accuracy.situationAcc15, 1) : '—'}
                  icon={Brain}
                  tone="blue"
                  sub={s.dataset.hasLabels ? 'Against the dataset labels' : 'Needs a Traffic Situation column'}
                />
              </div>

              <Card>
                <CardHeader
                  title="Actual vs predicted traffic"
                  icon={Brain}
                  subtitle="Vehicles per 15 minutes from the dataset, and what the XGBoost model predicted 15 minutes earlier"
                  actions={
                    s.next ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        Next: +15 <SituationBadge value={s.next.situation15} /> ≈{s.next.count15} · +30 <SituationBadge value={s.next.situation30} /> ≈{s.next.count30}
                      </div>
                    ) : undefined
                  }
                />
                <CardBody>
                  {chart.length > 1 ? (
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                          <CartesianGrid stroke="#e5eaf3" vertical={false} />
                          <XAxis dataKey="t" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={40} />
                          <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual (dataset)" stroke="#0a1a3a" strokeWidth={2} dot={false} />
                          <Line isAnimationActive={false} type="monotone" dataKey="predicted" name="Predicted 15 min earlier" stroke="#1d4ed8" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState icon={Brain} title="Waiting for rows" description="The chart fills in as the replay plays the dataset." />
                  )}
                  {s.current && (
                    <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                      Now ({s.current.day} {s.current.clock}): model says <SituationBadge value={s.current.modelSituation ?? 'normal'} />
                      {s.current.situation && (
                        <>
                          dataset label <SituationBadge value={s.current.situation} />
                        </>
                      )}
                      {s.current.predSituation15 && (
                        <>
                          forecast made 15 min ago <SituationBadge value={s.current.predSituation15} />
                        </>
                      )}
                    </p>
                  )}
                </CardBody>
              </Card>
            </>
          )}

          <Card>
            <CardHeader title="City under the replayed traffic" subtitle="Signals, green waves, routing, civic reports and evacuation all respond to the dataset's traffic" icon={Play} />
            <div className="p-3">
              <div className="overflow-hidden rounded-xl ring-1 ring-line">{network ? <CityMap network={network} snap={snap} /> : <MapSkeleton />}</div>
              <MapLegend className="px-2 pt-3" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
