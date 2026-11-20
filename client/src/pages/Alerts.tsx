import clsx from 'clsx';
import { Cctv, CircleX, Gauge, IndianRupee, MapPin, Receipt, TriangleExclamationPoint } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CLASS_LABEL, type AlertStatus, type NetworkInfo, type OverspeedAlert } from '../../../shared/types';
import { CityMap, MapSkeleton, type MapMarker } from '../components/CityMap';
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, ProgressBar, Segmented, Skeleton, SkeletonGroup, Stat, TD, TH, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';
import { CLASS_COLOR, linkLabel, linkWhere, num, rupees } from '../lib/format';

type Filter = 'open' | 'fined' | 'dismissed' | 'all';

const STATUS_META: Record<AlertStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'orange' },
  fined: { label: 'E-challan issued', tone: 'navy' },
  dismissed: { label: 'Dismissed', tone: 'neutral' },
};

const PAGE = 40;

export function AlertsPage() {
  const { network } = useLive();
  const { role } = useRole();
  const toast = useToast();
  const alerts = usePoll<OverspeedAlert[]>('/alerts', 4000);
  const [filter, setFilter] = useState<Filter>('open');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<number | null>(null);
  const canAct = role === 'controller' || role === 'authority';

  const all = alerts.data ?? [];
  const summary = useMemo(() => {
    const byRoad = new Map<string, number>();
    for (const a of all) {
      const road = network?.links[a.linkId]?.road;
      if (road) byRoad.set(road, (byRoad.get(road) ?? 0) + 1);
    }
    const top = [...byRoad.entries()].sort((x, y) => y[1] - x[1])[0] ?? null;
    return {
      open: all.filter((a) => a.status === 'open').length,
      fined: all.filter((a) => a.status === 'fined').length,
      dismissed: all.filter((a) => a.status === 'dismissed').length,
      total: all.reduce((s, a) => s + (a.fineAmount ?? 0), 0),
      top,
    };
  }, [all, network]);

  const visible = all.filter((a) => filter === 'all' || a.status === filter);

  const act = async (a: OverspeedAlert, action: 'fine' | 'dismiss') => {
    setBusy(a.id);
    try {
      const updated = await api<OverspeedAlert>(`/alerts/${a.id}`, { method: 'PATCH', body: { action } });
      toast('success', action === 'fine' ? `E-challan of ${rupees(updated.fineAmount)} issued to ${a.plate}.` : `Alert for ${a.plate} dismissed.`);
      await alerts.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the alert.');
    } finally {
      setBusy(null);
    }
  };

  const loading = alerts.loading && !alerts.data;

  return (
    <div>
      <PageHeader
        title="Overspeeding"
        description="Speed cameras on arterial and ring-road segments flag vehicles more than 10% over the limit. The traffic authority reviews each detection and issues an e-challan or dismisses it."
      />

      {loading ? (
        <SkeletonGroup label="Loading overspeeding summary…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4).keys()].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-16" />
                </div>
                <Skeleton className="size-10 rounded-xl" />
              </div>
              <Skeleton className="mt-3 h-3 w-32" />
            </Card>
          ))}
        </SkeletonGroup>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Open detections" value={num(summary.open)} icon={TriangleExclamationPoint} tone="amber" sub="Awaiting review" />
          <Stat label="E-challans issued" value={num(summary.fined)} icon={Receipt} tone="navy" sub={`${num(summary.dismissed)} dismissed`} />
          <Stat label="Fines raised" value={rupees(summary.total)} icon={IndianRupee} tone="green" sub="₹1,000–₹2,000 per offence, doubled for cargo" />
          <Stat
            label="Most-flagged road"
            value={<span className="text-lg">{summary.top ? summary.top[0] : '—'}</span>}
            icon={MapPin}
            tone="red"
            sub={summary.top ? `${num(summary.top[1])} detections` : 'No detections yet'}
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader
            title="Detections"
            subtitle="Refreshes every 4 seconds"
            icon={Gauge}
            actions={
              <Segmented
                ariaLabel="Filter detections"
                size="sm"
                value={filter}
                onChange={(f) => {
                  setFilter(f);
                  setLimit(PAGE);
                }}
                options={[
                  { value: 'open', label: `Open (${summary.open})` },
                  { value: 'fined', label: `Fined (${summary.fined})` },
                  { value: 'dismissed', label: `Dismissed (${summary.dismissed})` },
                  { value: 'all', label: `All (${all.length})` },
                ]}
              />
            }
          />
          {loading || !network ? (
            <SkeletonGroup label="Loading detections…">
              <div className="divide-y divide-line">
                {[...Array(6).keys()].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <Skeleton className="h-4 w-12" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-8 w-28 rounded-lg" />
                  </div>
                ))}
              </div>
            </SkeletonGroup>
          ) : visible.length ? (
            <>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[860px]">
                  <thead className="bg-navy-50/60">
                    <tr>
                      <th className={TH}>Time</th>
                      <th className={TH}>Vehicle</th>
                      <th className={TH}>Speed</th>
                      <th className={TH}>Location</th>
                      <th className={TH}>Status</th>
                      <th className={clsx(TH, 'text-right')}>{canAct ? 'Action' : 'Fine'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visible.slice(0, limit).map((a) => (
                      <AlertRow key={a.id} alert={a} network={network} canAct={canAct} busy={busy === a.id} onAct={(action) => act(a, action)} />
                    ))}
                  </tbody>
                </table>
              </div>
              {visible.length > limit && (
                <div className="border-t border-line px-5 py-3 text-center">
                  <Button size="sm" variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>
                    Show {Math.min(PAGE, visible.length - limit)} more of {visible.length - limit}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState icon={Gauge} title="No detections here" description="New detections appear as vehicles pass the speed cameras." />
          )}
        </Card>

        <CameraCard network={network} alerts={all} />
      </div>
    </div>
  );
}

function AlertRow({
  alert: a,
  network,
  canAct,
  busy,
  onAct,
}: {
  alert: OverspeedAlert;
  network: NetworkInfo;
  canAct: boolean;
  busy: boolean;
  onAct: (action: 'fine' | 'dismiss') => void;
}) {
  const link = network.links[a.linkId];
  const excess = a.speedKmh / a.limitKmh - 1;
  const status = STATUS_META[a.status];
  return (
    <tr className="hover:bg-navy-50/40">
      <td className={clsx(TD, 'tabular font-medium text-navy-700')}>{a.simClock}</td>
      <td className={TD}>
        <span className="tabular rounded-md bg-navy-50 px-2 py-1 font-mono text-[13px] font-semibold tracking-wide text-navy-900 ring-1 ring-line ring-inset">{a.plate}</span>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <span className="size-2 rounded-full" style={{ background: CLASS_COLOR[a.vehicleClass] }} />
          {CLASS_LABEL[a.vehicleClass]}
        </p>
      </td>
      <td className={clsx(TD, 'w-44')}>
        <p className="tabular">
          <span className="font-semibold">{a.speedKmh} km/h</span>
          <span className="text-xs text-muted"> / {a.limitKmh}</span>
          <span className={clsx('ml-2 text-xs font-semibold', excess > 0.2 ? 'text-jam' : 'text-heavy')}>+{Math.round(excess * 100)}%</span>
        </p>
        <ProgressBar className="mt-1.5" value={Math.min(1, excess / 0.6)} color={excess > 0.2 ? 'var(--color-jam)' : 'var(--color-heavy)'} />
      </td>
      <td className={TD}>
        {link ? (
          <>
            <p className="font-medium">{linkLabel(network, link)}</p>
            <p className="text-xs text-muted">{linkWhere(network, link)}</p>
          </>
        ) : (
          '—'
        )}
      </td>
      <td className={TD}>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </td>
      <td className={clsx(TD, 'text-right')}>
        {a.status === 'open' && canAct ? (
          <div className="inline-flex gap-2">
            <Button size="sm" variant="navy" icon={Receipt} loading={busy} onClick={() => onAct('fine')}>
              Issue e-challan
            </Button>
            <Button size="sm" variant="ghost" icon={CircleX} disabled={busy} onClick={() => onAct('dismiss')}>
              Dismiss
            </Button>
          </div>
        ) : (
          <span className="tabular font-semibold">{a.fineAmount ? rupees(a.fineAmount) : <span className="font-normal text-subtle">—</span>}</span>
        )}
      </td>
    </tr>
  );
}

function CameraCard({ network, alerts }: { network: NetworkInfo | null; alerts: OverspeedAlert[] }) {
  if (!network) {
    return (
      <SkeletonGroup label="Loading camera locations…">
        <Card>
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="p-3">
            <MapSkeleton />
          </div>
          <div className="space-y-3 px-5 py-4">
            {[...Array(5).keys()].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      </SkeletonGroup>
    );
  }
  const cameras = network.links.filter((l) => l.camera && l.id < l.reverse);
  const counts = new Map<number, number>();
  for (const a of alerts) {
    const link = network.links[a.linkId];
    if (!link) continue;
    const seg = Math.min(link.id, link.reverse);
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const markers: MapMarker[] = cameras.map((l) => ({ linkId: l.id, color: '#1f3d84', title: `Speed camera · ${l.road} (${l.speedLimit} km/h)` }));
  return (
    <Card className="self-start">
      <CardHeader title="Speed cameras" subtitle={`${cameras.length} camera sites, both directions`} icon={Cctv} />
      <div className="p-3">
        <div className="overflow-hidden rounded-xl border border-line">
          <CityMap network={network} snap={null} compact showVehicles={false} showSignals={false} markers={markers} ariaLabel="Speed camera locations" />
        </div>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {cameras.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
            <Cctv className="size-4 shrink-0 text-navy-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{l.road}</p>
              <p className="truncate text-xs text-muted">
                {network.nodes[l.from].name} ↔ {network.nodes[l.to].name}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-[13px] font-semibold text-ink">{num(counts.get(l.id) ?? 0)}</p>
              <p className="text-[11px] text-subtle">{l.speedLimit} km/h</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
