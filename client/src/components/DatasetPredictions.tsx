import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Table2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Brush, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CountScore, DatasetPredictionRow, DatasetPredictions, JunctionSituation, ReplaySummary, SituationScore } from '../../../shared/types';
import { withRole } from '../lib/api';
import { num, pct } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { SituationBadge } from './JunctionOutlook';
import { Button, buttonClass, Card, CardBody, CardHeader, EmptyState, Skeleton, SkeletonGroup, TD, TH } from './ui';

export const PREDICTION_PAGE = 50;

function CountTile({ label, score }: { label: string; score: CountScore | null }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold text-ink">{score ? `${score.mae} veh` : '—'}</p>
      <p className="mt-1 text-xs text-muted">{score ? `average error · ${score.maePersistence} if nothing changes` : 'Needs at least two rows'}</p>
    </div>
  );
}

function SituationTile({ label, score, sub }: { label: string; score: SituationScore | null; sub: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold text-ink">{score ? pct(score.accuracy, 1) : '—'}</p>
      <p className="mt-1 text-xs text-muted">
        {!score ? 'Needs a Traffic Situation column' : score.accuracyPersistence !== null ? `correct · ${pct(score.accuracyPersistence, 1)} if nothing changes` : sub}
      </p>
    </div>
  );
}

function Hit({ predicted, actual }: { predicted: JunctionSituation; actual: JunctionSituation | null }) {
  if (!actual) return null;
  return predicted === actual ? (
    <Check className="size-4 text-free" aria-label="Situation correct" />
  ) : (
    <X className="size-4 text-jam" aria-label="Situation wrong" />
  );
}

function Forecast({ count, situation }: { count: number; situation: JunctionSituation }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tabular w-9 font-semibold">{count}</span>
      <SituationBadge value={situation} />
    </div>
  );
}

function Outcome({ count, label, predicted }: { count: number | null; label: JunctionSituation | null; predicted: JunctionSituation }) {
  if (count === null) return <span className="text-subtle">end of data</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="tabular w-9">{count}</span>
      {label && <SituationBadge value={label} />}
      <Hit predicted={predicted} actual={label} />
    </div>
  );
}

function PredictionRow({ r }: { r: DatasetPredictionRow }) {
  return (
    <tr className="whitespace-nowrap">
      <td className={`${TD} tabular text-muted`}>{num(r.row)}</td>
      <td className={TD}>
        <p className="font-medium">Day {r.dayNumber}</p>
        <p className="text-xs text-muted">
          {r.weekday.slice(0, 3)} {r.clock}
        </p>
      </td>
      <td className={TD}>
        <p className="tabular font-semibold">{r.total}</p>
        <p className="tabular text-xs text-muted">
          {r.car} cars · {r.bike} 2W · {r.heavy} heavy
        </p>
      </td>
      <td className={TD}>
        <div className="flex flex-wrap items-center gap-1.5">
          <SituationBadge value={r.situationNow} />
          {r.label && <Hit predicted={r.situationNow} actual={r.label} />}
        </div>
      </td>
      <td className={TD}>
        <Forecast count={r.count15} situation={r.situation15} />
      </td>
      <td className={TD}>
        <Outcome count={r.actual15} label={r.label15} predicted={r.situation15} />
      </td>
      <td className={TD}>
        <Forecast count={r.count30} situation={r.situation30} />
      </td>
      <td className={TD}>
        <Outcome count={r.actual30} label={r.label30} predicted={r.situation30} />
      </td>
    </tr>
  );
}

export function DatasetPredictionsCard({ dataset, extraActions }: { dataset: ReplaySummary; extraActions?: ReactNode }) {
  const [offset, setOffset] = useState(0);
  const report = usePoll<DatasetPredictions>(`/replay/predictions?offset=${offset}&limit=${PREDICTION_PAGE}&v=${encodeURIComponent(dataset.uploadedAt)}`);
  const d = report.data;
  const last = d ? Math.max(0, Math.floor((d.rows - 1) / PREDICTION_PAGE) * PREDICTION_PAGE) : 0;

  return (
    <Card>
      <CardHeader
        title="Model predictions for every row"
        icon={Table2}
        subtitle={`The XGBoost junction model run on all ${num(dataset.rows)} rows: the vehicle count and traffic situation 15 and 30 minutes ahead, next to what the data shows`}
        actions={
          <div className="flex flex-wrap gap-2">
            {d && (
              <a href={withRole('/replay/predictions.csv')} download className={buttonClass('primary', 'sm')}>
                <Download className="size-4" />
                Download all (CSV)
              </a>
            )}
            {extraActions}
          </div>
        }
      />
      {!d && report.loading ? (
        <SkeletonGroup label="Predicting every row" className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[...Array(4).keys()].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
          {[...Array(6).keys()].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </SkeletonGroup>
      ) : !d ? (
        <EmptyState icon={Table2} title="Predictions unavailable" description={report.error ?? 'Upload a dataset to see the model run on every row.'} />
      ) : (
        <>
          <CardBody className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <CountTile label="Vehicle count, +15 min" score={d.count15} />
              <CountTile label="Vehicle count, +30 min" score={d.count30} />
              <SituationTile label="Traffic situation, +15 min" score={d.situation15} sub="correct" />
              <SituationTile label="Traffic situation now" score={d.situationNow} sub="agrees with the dataset labels" />
            </div>
            <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-muted">
              Each forecast uses only its own row and the four before it, as the live system does, and is checked against the next one and two rows. A model scores best on data it
              was trained on: the Kaggle sample overlaps its training data, so a file of new counts gives the fair test.
            </p>
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink">Actual vs predicted 15 minutes earlier, whole dataset</p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.chart} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                    <CartesianGrid stroke="#e5eaf3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={48} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line isAnimationActive={false} type="monotone" dataKey="actual" name="Actual (dataset)" stroke="#0a1a3a" strokeWidth={2} dot={false} />
                    <Line isAnimationActive={false} type="monotone" dataKey="predicted" name="Predicted 15 min earlier" stroke="#1d4ed8" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
                    <Brush dataKey="label" height={22} stroke="#1d4ed8" travellerWidth={8} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-xs text-muted">
                {d.chart.length < d.rows ? `${num(d.chart.length)} of ${num(d.rows)} rows plotted. ` : ''}Drag the handles under the chart to zoom in.
              </p>
            </div>
          </CardBody>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[920px]">
              <thead className="border-b border-line bg-navy-50/50">
                <tr>
                  <th className={TH}>Row</th>
                  <th className={TH}>When</th>
                  <th className={TH}>Vehicles</th>
                  <th className={TH}>Situation now</th>
                  <th className={TH}>+15 min predicted</th>
                  <th className={TH}>+15 min actual</th>
                  <th className={TH}>+30 min predicted</th>
                  <th className={TH}>+30 min actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.page.rows.map((r) => (
                  <PredictionRow key={r.row} r={r} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
            <p className="tabular text-xs text-muted">
              Rows {num(d.page.offset + 1)}–{num(Math.min(d.page.offset + PREDICTION_PAGE, d.rows))} of {num(d.rows)}
            </p>
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" icon={ChevronsLeft} aria-label="First page" disabled={offset === 0} onClick={() => setOffset(0)} />
              <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PREDICTION_PAGE))}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={offset >= last} onClick={() => setOffset(Math.min(last, offset + PREDICTION_PAGE))}>
                Next
                <ChevronRight className="size-4" />
              </Button>
              <Button size="sm" variant="secondary" icon={ChevronsRight} aria-label="Last page" disabled={offset >= last} onClick={() => setOffset(last)} />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
