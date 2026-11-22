import clsx from 'clsx';
import { CircleCheck, MapPin, MessageSquareExclamationPoint, Send, ShieldCheck, TrafficCone, TriangleAlert, Wrench } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { CIVIC_LABEL, type CivicCategory, type CivicReport, type NetworkInfo, type Severity } from '../../../shared/types';
import { CaseCard, CATEGORY_ICON, OPEN_STATUSES, reportPlace, SEVERITY_COLOR } from '../components/CivicCase';
import { CityMap, MapSkeleton, type MapMarker } from '../components/CityMap';
import { PhotoInput } from '../components/PhotoInput';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Segmented, Skeleton, SkeletonGroup, Stat, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { linkLabel, linkWhere, num } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

const CATEGORY_HINT: Record<CivicCategory, string> = {
  pothole: 'Slows traffic on the road once verified; a crew is assigned to fill it.',
  waterlogging: 'Cuts speed; severe flooding also closes a lane.',
  accident: 'Blocks a lane on the reported direction until cleared.',
  broken_signal: 'Puts the junction signal on its fallback plan.',
  road_blockage: 'High severity closes the road to through traffic.',
  illegal_parking: 'Narrows the carriageway and slows traffic.',
  streetlight: 'Sent to maintenance; no traffic impact.',
};

type Filter = 'open' | 'progress' | 'done' | 'all';

function matches(filter: Filter, r: CivicReport): boolean {
  if (filter === 'open') return ['reported', 'verified', 'assigned', 'reopened'].includes(r.status);
  if (filter === 'progress') return r.status === 'in_progress';
  if (filter === 'done') return ['resolved', 'closed', 'rejected'].includes(r.status);
  return true;
}

function distanceM(net: NetworkInfo, a: number, b: number): number {
  const p = net.nodes[a];
  const q = net.nodes[b];
  const r = Math.PI / 180;
  const h = Math.sin(((q.lat - p.lat) * r) / 2) ** 2 + Math.cos(p.lat * r) * Math.cos(q.lat * r) * Math.sin(((q.lon - p.lon) * r) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function reportNode(net: NetworkInfo, r: Pick<CivicReport, 'linkId' | 'nodeId'>): number | null {
  if (r.nodeId !== null) return r.nodeId;
  return r.linkId !== null && net.links[r.linkId] ? net.links[r.linkId].to : null;
}

export function CivicPage() {
  const { network, snap } = useLive();
  const { role } = useRole();
  const reports = usePoll<CivicReport[]>('/civic', 5000);
  const staff = role === 'controller' || role === 'authority';
  const [filter, setFilter] = useState<Filter>('open');
  const [linkId, setLinkId] = useState<number | null>(null);

  const all = reports.data ?? [];
  const counts = useMemo(
    () => ({
      open: all.filter((r) => matches('open', r)).length,
      progress: all.filter((r) => matches('progress', r)).length,
      done: all.filter((r) => matches('done', r)).length,
      impact: all.filter((r) => r.impactApplied).length,
      late: all.filter((r) => r.late).length,
    }),
    [all],
  );
  const visible = all.filter((r) => matches(filter, r));
  const markers: MapMarker[] = all
    .filter((r) => OPEN_STATUSES.includes(r.status))
    .map((r) => ({ linkId: r.linkId, nodeId: r.nodeId, color: SEVERITY_COLOR[r.severity], title: `#${r.id} ${CIVIC_LABEL[r.category]} (${r.severity})` }));

  return (
    <div>
      <PageHeader
        title="Civic reports"
        description="Citizens report potholes, accidents and other road problems with a photo. The traffic authority verifies, assigns a crew and marks it fixed with proof; the citizen confirms or reopens. Verified problems feed straight into routing and signals."
      />

      {reports.loading && !reports.data ? (
        <SkeletonGroup label="Loading civic summary…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4).keys()].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-12" />
              <Skeleton className="mt-3 h-3 w-32" />
            </Card>
          ))}
        </SkeletonGroup>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Open reports" value={num(counts.open)} icon={MessageSquareExclamationPoint} tone="blue" sub={counts.late ? `${counts.late} overdue` : 'Reported, verified or assigned'} />
          <Stat label="Work in progress" value={num(counts.progress)} icon={Wrench} tone="amber" sub="Crews on site" />
          <Stat label="Fixed or closed" value={num(counts.done)} icon={CircleCheck} tone="green" sub="Fixed, confirmed or rejected" />
          <Stat label="Affecting traffic" value={num(counts.impact)} icon={TrafficCone} tone="red" sub="Applied to routing and signals" />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {network ? (
          <ReportForm network={network} reports={all} markers={markers} linkId={linkId} onPick={setLinkId} snap={snap} onCreated={reports.refresh} />
        ) : (
          <SkeletonGroup label="Loading report form…">
            <Card>
              <div className="space-y-4 px-5 py-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[...Array(7).keys()].map((i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
                <MapSkeleton />
              </div>
            </Card>
          </SkeletonGroup>
        )}

        <Card className="min-w-0 self-start">
          <CardHeader
            title={staff ? 'Case queue' : 'Reports'}
            subtitle={staff ? 'Verify, assign a crew, mark fixed with a photo' : 'Track your reports; confirm the fix or reopen it'}
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
                { value: 'done', label: `Fixed (${counts.done})` },
                { value: 'all', label: `All (${all.length})` },
              ]}
            />
          </div>
          {reports.loading && !reports.data ? (
            <SkeletonGroup label="Loading reports…">
              <ul className="divide-y divide-line">
                {[...Array(4).keys()].map((i) => (
                  <li key={i} className="px-5 py-4">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="mt-3 h-3 w-full" />
                    <Skeleton className="mt-4 h-2 w-full" />
                  </li>
                ))}
              </ul>
            </SkeletonGroup>
          ) : visible.length && network ? (
            <ul className="divide-y divide-line">
              {visible.map((r) => (
                <CaseCard key={r.id} network={network} report={r} staff={staff} onChanged={reports.refresh} />
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
  reports,
  snap,
  markers,
  linkId,
  onPick,
  onCreated,
}: {
  network: NetworkInfo;
  reports: CivicReport[];
  snap: ReturnType<typeof useLive>['snap'];
  markers: MapMarker[];
  linkId: number | null;
  onPick: (id: number) => void;
  onCreated: () => Promise<void>;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<CivicCategory>('pothole');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = linkId !== null ? network.links[linkId] : null;

  const nearby = useMemo(() => {
    if (linkId === null) return [];
    const here = network.links[linkId].to;
    return reports.filter((r) => {
      if (!OPEN_STATUSES.includes(r.status)) return false;
      const n = reportNode(network, r);
      return n !== null && distanceM(network, here, n) <= 300;
    });
  }, [linkId, reports, network]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (linkId === null) {
      setError('Tap the road on the map where the problem is.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api<CivicReport>('/civic', {
        method: 'POST',
        body: { category, description, linkId, severity, reporterName: name, reporterPhone: phone || undefined, photo: photo ?? undefined },
      });
      toast('success', `Report #${created.id} sent to the traffic authority. You can track it in the list.`);
      setDescription('');
      setPhoto(null);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the report.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="min-w-0 self-start">
      <CardHeader title="Report an issue" subtitle="Pick the problem, tap the road, add a photo and send" icon={Send} />
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
              <CityMap network={network} snap={snap} showVehicles={false} markers={markers} selectedLink={linkId} onLinkClick={onPick} ariaLabel="Pick the road" />
            </div>
            <div className={clsx('mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] ring-1 ring-inset', link ? 'bg-brand-50 text-navy-900 ring-brand-100' : 'bg-navy-50 text-muted ring-line')}>
              <MapPin className={clsx('mt-0.5 size-4 shrink-0', link ? 'text-brand-600' : 'text-subtle')} />
              {link ? (
                <span>
                  <span className="font-semibold">{linkLabel(network, link)}</span>
                  <span className="block text-xs text-muted">{linkWhere(network, link)}</span>
                </span>
              ) : (
                <span>Tap a road on the map. Each side of a two-way road is a separate direction.</span>
              )}
            </div>
            {nearby.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-amber-200 ring-inset">
                <p className="flex items-center gap-1.5 font-semibold">
                  <TriangleAlert className="size-4" /> {nearby.length} open {nearby.length === 1 ? 'report' : 'reports'} within 300 m
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {nearby.slice(0, 3).map((r) => (
                    <li key={r.id}>
                      #{r.id} {CIVIC_LABEL[r.category]} on {reportPlace(network, r).title} ({r.status.replace('_', ' ')})
                    </li>
                  ))}
                </ul>
                <p className="mt-1">If it is the same problem, there is no need to report it again.</p>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-[13px] font-medium text-ink">Photo</p>
            <PhotoInput value={photo} onChange={setPhoto} label="Take or upload a photo of the problem" />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">Severity</p>
              <Segmented
                ariaLabel="Severity"
                size="sm"
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
            <Field label="Phone (optional)">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" autoComplete="tel" maxLength={15} />
            </Field>
          </div>

          <Field label="Description" hint="What did you see? Landmarks help crews find it.">
            <Textarea required minLength={5} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Deep pothole in the left lane near the temple gate" />
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
