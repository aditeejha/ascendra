import clsx from 'clsx';
import {
  Ban,
  CircleCheck,
  CircleX,
  Construction,
  Droplets,
  Lightbulb,
  MapPin,
  MessageSquareExclamationPoint,
  ParkingMeter,
  Play,
  Send,
  ShieldCheck,
  TrafficCone,
  TriangleExclamationPoint,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { CIVIC_LABEL, type CivicCategory, type CivicReport, type CivicStatus, type NetworkInfo, type Severity } from '../../../shared/types';
import { CityMap, MapSkeleton, type MapMarker } from '../components/CityMap';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Segmented, Skeleton, SkeletonGroup, Stat, Textarea, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';
import { linkLabel, linkWhere, num, timeAgo } from '../lib/format';

const CATEGORY_ICON: Record<CivicCategory, LucideIcon> = {
  pothole: Construction,
  waterlogging: Droplets,
  accident: TriangleExclamationPoint,
  broken_signal: TrafficCone,
  road_blockage: Ban,
  illegal_parking: ParkingMeter,
  streetlight: Lightbulb,
};

const CATEGORY_HINT: Record<CivicCategory, string> = {
  pothole: 'Slows traffic on the segment once verified.',
  waterlogging: 'Cuts speed; severe flooding also closes a lane.',
  accident: 'Blocks a lane on the reported direction.',
  broken_signal: 'Puts the junction signal on its fallback plan.',
  road_blockage: 'High severity closes the road to through traffic.',
  illegal_parking: 'Narrows the carriageway and slows traffic.',
  streetlight: 'Sent to maintenance; no traffic impact.',
};

const SEVERITY_COLOR: Record<Severity, string> = { high: '#dc2626', medium: '#f97316', low: '#eab308' };
const SEVERITY_TONE: Record<Severity, Tone> = { high: 'red', medium: 'orange', low: 'amber' };

const STATUS_META: Record<CivicStatus, { label: string; tone: Tone }> = {
  reported: { label: 'Reported', tone: 'blue' },
  verified: { label: 'Verified', tone: 'navy' },
  in_progress: { label: 'In progress', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

const STEPS: { status: CivicStatus; label: string }[] = [
  { status: 'reported', label: 'Reported' },
  { status: 'verified', label: 'Verified' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'resolved', label: 'Resolved' },
];

type Filter = 'open' | 'progress' | 'resolved' | 'all';

const OPEN: CivicStatus[] = ['reported', 'verified', 'in_progress'];

function matches(filter: Filter, status: CivicStatus): boolean {
  if (filter === 'open') return status === 'reported' || status === 'verified';
  if (filter === 'progress') return status === 'in_progress';
  if (filter === 'resolved') return status === 'resolved' || status === 'rejected';
  return true;
}

function reportPlace(network: NetworkInfo, r: CivicReport): { title: string; detail: string } {
  if (r.linkId !== null && network.links[r.linkId]) {
    const link = network.links[r.linkId];
    return { title: linkLabel(network, link), detail: linkWhere(network, link) };
  }
  if (r.nodeId !== null && network.nodes[r.nodeId]) return { title: network.nodes[r.nodeId].name, detail: 'Junction' };
  return { title: 'Unknown location', detail: '' };
}

export function CivicPage() {
  const { network, snap } = useLive();
  const { role } = useRole();
  const toast = useToast();
  const reports = usePoll<CivicReport[]>('/civic', 5000);
  const canTriage = role === 'controller' || role === 'authority';
  const [filter, setFilter] = useState<Filter>('open');
  const [linkId, setLinkId] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const all = reports.data ?? [];
  const counts = useMemo(
    () => ({
      open: all.filter((r) => matches('open', r.status)).length,
      progress: all.filter((r) => r.status === 'in_progress').length,
      resolved: all.filter((r) => matches('resolved', r.status)).length,
      impact: all.filter((r) => r.impactApplied).length,
    }),
    [all],
  );
  const visible = all.filter((r) => matches(filter, r.status));
  const markers: MapMarker[] = all
    .filter((r) => OPEN.includes(r.status))
    .map((r) => ({ linkId: r.linkId, nodeId: r.nodeId, color: SEVERITY_COLOR[r.severity], title: `#${r.id} ${CIVIC_LABEL[r.category]} (${r.severity})` }));

  const updateStatus = async (r: CivicReport, status: CivicStatus) => {
    setBusy(r.id);
    try {
      const updated = await api<CivicReport>(`/civic/${r.id}`, { method: 'PATCH', body: { status } });
      toast(
        'success',
        updated.impactApplied && !r.impactApplied
          ? `Report #${r.id} verified. Routing and signals now account for it.`
          : `Report #${r.id} marked ${STATUS_META[status].label.toLowerCase()}.`,
      );
      await reports.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the report.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Civic reports"
        description="Citizens report road problems; once the control room verifies a report it feeds straight into routing and signal control, closing the loop between residents and traffic management."
      />

      {reports.loading && !reports.data ? (
        <SkeletonGroup label="Loading civic summary…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4).keys()].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-12" />
                </div>
                <Skeleton className="size-10 rounded-xl" />
              </div>
              <Skeleton className="mt-3 h-3 w-32" />
            </Card>
          ))}
        </SkeletonGroup>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Open reports" value={num(counts.open)} icon={MessageSquareExclamationPoint} tone="blue" sub="Reported or verified" />
          <Stat label="Work in progress" value={num(counts.progress)} icon={Wrench} tone="amber" sub="Crews on site" />
          <Stat label="Closed" value={num(counts.resolved)} icon={CircleCheck} tone="green" sub="Resolved or rejected" />
          <Stat label="Affecting traffic" value={num(counts.impact)} icon={TrafficCone} tone="red" sub="Applied to routing and signals" />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {network ? (
          <ReportForm network={network} snapMarkers={markers} linkId={linkId} onPick={setLinkId} snap={snap} onCreated={reports.refresh} />
        ) : (
          <SkeletonGroup label="Loading report form…">
            <Card>
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[...Array(7).keys()].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
                <MapSkeleton />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </Card>
          </SkeletonGroup>
        )}

        <Card className="min-w-0 self-start">
          <CardHeader
            title={canTriage ? 'Triage queue' : 'Reports'}
            subtitle={canTriage ? 'Verify reports to apply them to traffic control' : 'Track what has been reported and its progress'}
            icon={ShieldCheck}
          />
          <div className="border-b border-line px-5 py-3">
            <Segmented
              ariaLabel="Filter reports"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'open', label: `Open (${counts.open})` },
                { value: 'progress', label: `In progress (${counts.progress})` },
                { value: 'resolved', label: `Resolved (${counts.resolved})` },
                { value: 'all', label: `All (${all.length})` },
              ]}
            />
          </div>
          {reports.loading && !reports.data ? (
            <SkeletonGroup label="Loading reports…">
              <ul className="divide-y divide-line">
                {[...Array(4).keys()].map((i) => (
                  <li key={i} className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 rounded-xl" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="ml-auto h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="mt-3 h-3 w-full" />
                    <Skeleton className="mt-2 h-3 w-2/3" />
                    <Skeleton className="mt-4 h-2 w-full" />
                  </li>
                ))}
              </ul>
            </SkeletonGroup>
          ) : visible.length && network ? (
            <ul className="divide-y divide-line">
              {visible.map((r) => (
                <ReportItem key={r.id} network={network} report={r} canTriage={canTriage} busy={busy === r.id} onStatus={(s) => updateStatus(r, s)} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={MessageSquareExclamationPoint} title="Nothing here" description="No reports match this filter right now." />
          )}
        </Card>
      </div>
    </div>
  );
}

function ReportForm({
  network,
  snap,
  snapMarkers,
  linkId,
  onPick,
  onCreated,
}: {
  network: NetworkInfo;
  snap: ReturnType<typeof useLive>['snap'];
  snapMarkers: MapMarker[];
  linkId: number | null;
  onPick: (id: number) => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<CivicCategory>('pothole');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = linkId !== null ? network.links[linkId] : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (linkId === null) {
      setError('Tap the road segment on the map where the problem is.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api<CivicReport>('/civic', {
        method: 'POST',
        body: { category, description, linkId, severity, reporterName: name },
      });
      toast('success', `Report #${created.id} submitted. You can track it in the list.`);
      setDescription('');
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="min-w-0 self-start">
      <CardHeader title="Report an issue" subtitle="Pick the problem, tap the road on the map and send" icon={Send} />
      <CardBody>
        <form className="space-y-5" onSubmit={submit}>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink">What is the problem?</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(CIVIC_LABEL) as CivicCategory[]).map((c) => {
                const Icon = CATEGORY_ICON[c];
                const active = category === c;
                return (
                  <button
                    type="button"
                    key={c}
                    aria-pressed={active}
                    onClick={() => setCategory(c)}
                    className={clsx(
                      'flex flex-col items-start gap-2 rounded-xl border p-3 text-left text-[13px] font-medium transition-colors',
                      active ? 'border-brand-500 bg-brand-50 text-navy-900 ring-1 ring-brand-500' : 'border-line text-muted hover:border-navy-200 hover:text-ink',
                    )}
                  >
                    <Icon className={clsx('size-[18px]', active ? 'text-brand-600' : 'text-navy-500')} />
                    {CIVIC_LABEL[c]}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted">{CATEGORY_HINT[category]}</p>
          </fieldset>

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">Where is it?</p>
            <div className="overflow-hidden rounded-xl border border-line">
              <CityMap network={network} snap={snap} showVehicles={false} markers={snapMarkers} selectedLink={linkId} onLinkClick={onPick} ariaLabel="Pick the road segment" />
            </div>
            <div
              className={clsx(
                'mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ring-1 ring-inset',
                link ? 'bg-brand-50 text-navy-900 ring-brand-100' : 'bg-navy-50 text-muted ring-line',
              )}
            >
              <MapPin className={clsx('mt-0.5 size-4 shrink-0', link ? 'text-brand-600' : 'text-subtle')} />
              {link ? (
                <span>
                  <span className="font-semibold">{linkLabel(network, link)}</span>
                  <span className="block text-xs text-muted">
                    {linkWhere(network, link)}
                    {category === 'broken_signal' ? ` · signal at ${network.nodes[link.to].name}` : ''}
                  </span>
                </span>
              ) : (
                <span>Tap a road on the map. Each side of a road is a separate direction.</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">Severity</p>
              <Segmented
                ariaLabel="Severity"
                value={severity}
                onChange={setSeverity}
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </div>
            <Field label="Your name">
              <Input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoComplete="name" />
            </Field>
          </div>

          <Field label="Description" hint="What did you see? Landmarks help crews find it.">
            <Textarea required minLength={5} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Water above the kerb near the bus stop, cars slowing to a crawl" />
          </Field>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200 ring-inset">{error}</p>}
          <Button type="submit" className="w-full" icon={Send} loading={saving}>
            Submit report
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ReportItem({
  network,
  report: r,
  canTriage,
  busy,
  onStatus,
}: {
  network: NetworkInfo;
  report: CivicReport;
  canTriage: boolean;
  busy: boolean;
  onStatus: (s: CivicStatus) => void;
}) {
  const Icon = CATEGORY_ICON[r.category];
  const place = reportPlace(network, r);
  const status = STATUS_META[r.status];
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{CIVIC_LABEL[r.category]}</p>
            <span className="text-xs text-subtle">#{r.id}</span>
            <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
            {r.impactApplied && (
              <Badge tone="red" dot>
                Affects traffic
              </Badge>
            )}
            <Badge tone={status.tone} className="ml-auto">
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-ink">{r.description}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <MapPin className="size-3" />
            <span className="font-medium text-navy-700">{place.title}</span>
            {place.detail && <span>· {place.detail}</span>}
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {r.reporterName} · {timeAgo(r.createdAt)}
            {r.updatedAt !== r.createdAt ? ` · updated ${timeAgo(r.updatedAt)}` : ''}
          </p>
          <Stepper status={r.status} />
          {canTriage && <TriageActions status={r.status} busy={busy} onStatus={onStatus} />}
        </div>
      </div>
    </li>
  );
}

function Stepper({ status }: { status: CivicStatus }) {
  if (status === 'rejected') {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-red-700">
        <CircleX className="size-4" /> Closed without action
      </div>
    );
  }
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="mt-3 flex items-center" aria-label={`Status: ${STATUS_META[status].label}`}>
      {STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li key={step.status} className={clsx('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <div className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  'grid size-4 place-items-center rounded-full ring-2',
                  done ? 'bg-brand-600 ring-brand-600' : 'bg-white ring-line',
                  i === current && 'ring-offset-1 ring-offset-white',
                )}
              >
                {done && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span className={clsx('text-[10.5px] whitespace-nowrap', done ? 'font-semibold text-navy-900' : 'text-subtle')}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={clsx('mx-1 mb-4 h-0.5 flex-1 rounded-full', i < current ? 'bg-brand-600' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

function TriageActions({ status, busy, onStatus }: { status: CivicStatus; busy: boolean; onStatus: (s: CivicStatus) => void }) {
  if (status === 'resolved' || status === 'rejected') return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {status === 'reported' && (
        <Button size="sm" icon={ShieldCheck} loading={busy} onClick={() => onStatus('verified')} title="Verify and apply to routing and signals">
          Verify
        </Button>
      )}
      {(status === 'reported' || status === 'verified') && (
        <Button size="sm" variant="secondary" icon={Play} disabled={busy} onClick={() => onStatus('in_progress')}>
          Start work
        </Button>
      )}
      {(status === 'verified' || status === 'in_progress') && (
        <Button size="sm" variant="success" icon={CircleCheck} disabled={busy} onClick={() => onStatus('resolved')}>
          Resolve
        </Button>
      )}
      {status !== 'in_progress' && (
        <Button size="sm" variant="ghost" icon={CircleX} disabled={busy} onClick={() => onStatus('rejected')}>
          Reject
        </Button>
      )}
    </div>
  );
}
