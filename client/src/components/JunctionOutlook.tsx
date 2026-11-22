import { ArrowRight, Camera } from 'lucide-react';
import type { ForecastResponse, JunctionOutlook, JunctionSituation } from '../../../shared/types';
import { Badge, Card, CardHeader, EmptyState, Skeleton, SkeletonGroup, type Tone } from './ui';

export const SITUATION_TONE: Record<JunctionSituation, Tone> = { low: 'green', normal: 'blue', high: 'amber', heavy: 'red' };
export const SITUATION_LABEL: Record<JunctionSituation, string> = { low: 'Low', normal: 'Normal', high: 'High', heavy: 'Heavy' };

export function SituationBadge({ value, prob }: { value: JunctionSituation; prob?: number }) {
  return (
    <Badge tone={SITUATION_TONE[value]} dot>
      {SITUATION_LABEL[value]}
      {prob !== undefined && <span className="tabular opacity-70">{Math.round(prob * 100)}%</span>}
    </Badge>
  );
}

export function risk(j: JunctionOutlook): number {
  return j.probs15[3] + j.probs15[2] * 0.5 + j.probs30[3] * 0.3;
}

export function OutlookRow({ j, onSelect }: { j: JunctionOutlook; onSelect?: (id: number) => void }) {
  const idx = (s: JunctionSituation) => ['low', 'normal', 'high', 'heavy'].indexOf(s);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect?.(j.nodeId)}
        className="w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-navy-50 focus-visible:bg-navy-50 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{j.name}</p>
            <p className="truncate text-xs text-muted">
              Busiest approach {j.approachRoad} · {j.counts.total} vehicles in the last 15 min
            </p>
          </div>
          <span className="tabular shrink-0 text-xs text-muted">≈ {j.count15} next 15 min</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <SituationBadge value={j.situationNow} />
          <ArrowRight className="size-3.5" aria-label="then" />
          <span className="text-[11px]">+15</span>
          <SituationBadge value={j.situation15} prob={j.probs15[idx(j.situation15)]} />
          <ArrowRight className="size-3.5" aria-label="then" />
          <span className="text-[11px]">+30</span>
          <SituationBadge value={j.situation30} prob={j.probs30[idx(j.situation30)]} />
        </div>
      </button>
    </li>
  );
}

export function JunctionOutlookCard({ forecast, loading, onSelect, limit = 6 }: { forecast: ForecastResponse | null; loading: boolean; onSelect?: (id: number) => void; limit?: number }) {
  const model = forecast?.junctionModel;
  const rows = [...(forecast?.junctions ?? [])].sort((a, b) => risk(b) - risk(a)).slice(0, limit);
  return (
    <Card>
      <CardHeader
        title="Junction outlook"
        icon={Camera}
        subtitle={model?.available ? `XGBoost trained on real camera counts (${model.dataset?.name ?? 'Kaggle'}), updated every 15 min` : 'Junction model not trained'}
      />
      {loading && !forecast ? (
        <SkeletonGroup label="Loading junction outlook" className="space-y-3 p-5">
          {Array.from({ length: 3 }, (item, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </SkeletonGroup>
      ) : !model?.available ? (
        <EmptyState icon={Camera} title="No junction model" description="Run npm run train:junction to train it on the Kaggle Traffic Prediction Dataset." />
      ) : !rows.length ? (
        <EmptyState icon={Camera} title="Counting vehicles" description="The first outlook appears after the next 15-minute count at each signal." />
      ) : (
        <ul className="space-y-1 p-2">
          {rows.map((j) => (
            <OutlookRow key={j.nodeId} j={j} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Card>
  );
}
