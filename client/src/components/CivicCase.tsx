import clsx from 'clsx';
import {
  Ban,
  CircleCheck,
  CircleX,
  Construction,
  Droplets,
  History,
  Lightbulb,
  MapPin,
  ParkingMeter,
  Play,
  RotateCcw,
  ShieldCheck,
  Star,
  TrafficCone,
  TriangleExclamationPoint,
  UserCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CIVIC_LABEL, type CivicAction, type CivicCategory, type CivicEvent, type CivicReport, type CivicStatus, type NetworkInfo, type Severity } from '../../../shared/types';
import { api, withRole } from '../lib/api';
import { linkLabel, linkWhere, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { PhotoInput } from './PhotoInput';
import { Badge, Button, Input, Textarea, type Tone } from './ui';

export const CATEGORY_ICON: Record<CivicCategory, LucideIcon> = {
  pothole: Construction,
  waterlogging: Droplets,
  accident: TriangleExclamationPoint,
  broken_signal: TrafficCone,
  road_blockage: Ban,
  illegal_parking: ParkingMeter,
  streetlight: Lightbulb,
};

export const SEVERITY_TONE: Record<Severity, Tone> = { high: 'red', medium: 'orange', low: 'amber' };
export const SEVERITY_COLOR: Record<Severity, string> = { high: '#dc2626', medium: '#f97316', low: '#eab308' };

export const STATUS_META: Record<CivicStatus, { label: string; tone: Tone }> = {
  reported: { label: 'Reported', tone: 'blue' },
  verified: { label: 'Verified', tone: 'navy' },
  assigned: { label: 'Crew assigned', tone: 'sky' },
  in_progress: { label: 'Work in progress', tone: 'amber' },
  resolved: { label: 'Fixed', tone: 'green' },
  closed: { label: 'Closed', tone: 'green' },
  reopened: { label: 'Reopened', tone: 'orange' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export const OPEN_STATUSES: CivicStatus[] = ['reported', 'verified', 'assigned', 'in_progress', 'reopened'];

const STEPS: { label: string; reached: CivicStatus[] }[] = [
  { label: 'Reported', reached: ['reported', 'verified', 'assigned', 'in_progress', 'resolved', 'closed', 'reopened'] },
  { label: 'Verified', reached: ['verified', 'assigned', 'in_progress', 'resolved', 'closed', 'reopened'] },
  { label: 'Assigned', reached: ['assigned', 'in_progress', 'resolved', 'closed'] },
  { label: 'In progress', reached: ['in_progress', 'resolved', 'closed'] },
  { label: 'Fixed', reached: ['resolved', 'closed'] },
  { label: 'Confirmed', reached: ['closed'] },
];

export function reportPlace(network: NetworkInfo, r: CivicReport): { title: string; detail: string } {
  if (r.linkId !== null && network.links[r.linkId]) {
    const link = network.links[r.linkId];
    return { title: linkLabel(network, link), detail: linkWhere(network, link) };
  }
  if (r.nodeId !== null && network.nodes[r.nodeId]) return { title: network.nodes[r.nodeId].name, detail: 'Junction' };
  return { title: 'Unknown location', detail: '' };
}

export function CaseStepper({ status }: { status: CivicStatus }) {
  if (status === 'rejected') {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-red-700">
        <CircleX className="size-4" /> Closed without action
      </div>
    );
  }
  return (
    <ol className="mt-3 flex items-center" aria-label={`Status: ${STATUS_META[status].label}`}>
      {STEPS.map((step, i) => {
        const done = step.reached.includes(status);
        const nextDone = STEPS[i + 1]?.reached.includes(status);
        return (
          <li key={step.label} className={clsx('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <div className="flex flex-col items-center gap-1">
              <span className={clsx('grid size-4 place-items-center rounded-full ring-2', done ? 'bg-brand-600 ring-brand-600' : 'bg-white ring-line')}>
                {done && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span className={clsx('text-[10px] whitespace-nowrap', done ? 'font-semibold text-navy-900' : 'text-subtle')}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className={clsx('mx-1 mb-4 h-0.5 flex-1 rounded-full', nextDone ? 'bg-brand-600' : 'bg-line')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function CasePhoto({ report, kind = 'report', className }: { report: CivicReport; kind?: 'report' | 'resolution'; className?: string }) {
  const has = kind === 'report' ? report.hasPhoto : report.hasResolutionPhoto;
  if (!has) return null;
  const src = withRole(`/civic/${report.id}/photo${kind === 'resolution' ? '?kind=resolution' : ''}`);
  return (
    <a href={src} target="_blank" rel="noreferrer" className={clsx('block overflow-hidden rounded-lg ring-1 ring-line', className)}>
      <img src={src} alt={kind === 'report' ? 'Photo from the citizen' : 'Photo after the fix'} className="h-full w-full object-cover" loading="lazy" />
    </a>
  );
}

export function CaseTimeline({ reportId, refreshKey }: { reportId: number; refreshKey: string }) {
  const [events, setEvents] = useState<CivicEvent[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<CivicEvent[]>(`/civic/${reportId}/events`)
      .then((e) => !cancelled && setEvents(e))
      .catch(() => !cancelled && setEvents([]));
    return () => {
      cancelled = true;
    };
  }, [reportId, refreshKey]);
  if (!events) return <p className="mt-3 text-xs text-muted">Loading timeline…</p>;
  return (
    <ol className="mt-3 space-y-2.5 border-l-2 border-line pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative text-[12.5px]">
          <span className="absolute top-1 -left-[21px] size-2.5 rounded-full bg-brand-600 ring-2 ring-white" />
          <p>
            <span className="font-semibold text-ink">{STATUS_META[e.status].label}</span>
            <span className="text-muted">
              {' '}
              · {e.actorName ?? e.actorRole} · {timeAgo(e.createdAt)}
            </span>
          </p>
          {e.note && <p className="text-muted">{e.note}</p>}
          {e.hasPhoto && (
            <a href={withRole(`/civic-events/${e.id}/photo`)} target="_blank" rel="noreferrer" className="mt-1 inline-block overflow-hidden rounded-md ring-1 ring-line">
              <img src={withRole(`/civic-events/${e.id}/photo`)} alt="Photo attached to this update" className="h-16 w-24 object-cover" loading="lazy" />
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}

type Draft = { action: CivicAction; note: string; assignee: string; photo: string | null; rating: number };

export function CaseActions({ report, staff, onDone }: { report: CivicReport; staff: boolean; onDone: () => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const s = report.status;
  const can = (a: CivicAction) => {
    const from: Record<CivicAction, CivicStatus[]> = {
      verify: ['reported', 'reopened'],
      reject: ['reported', 'verified', 'reopened'],
      assign: ['verified', 'assigned', 'reopened'],
      start: ['verified', 'assigned', 'reopened'],
      resolve: ['verified', 'assigned', 'in_progress', 'reopened'],
      close: ['resolved'],
      reopen: ['resolved', 'closed'],
    };
    const staffOnly = ['verify', 'reject', 'assign', 'start', 'resolve'].includes(a);
    return from[a].includes(s) && (staffOnly ? staff : true);
  };

  const send = async (d: Draft) => {
    setBusy(true);
    try {
      await api<CivicReport>(`/civic/${report.id}`, {
        method: 'PATCH',
        body: {
          action: d.action,
          note: d.note || undefined,
          assignee: d.action === 'assign' ? d.assignee : undefined,
          photo: d.photo ?? undefined,
          rating: d.action === 'close' ? d.rating : undefined,
        },
      });
      toast('success', `Report #${report.id}: ${STATUS_META[({ verify: 'verified', reject: 'rejected', assign: 'assigned', start: 'in_progress', resolve: 'resolved', close: 'closed', reopen: 'reopened' } as const)[d.action]].label.toLowerCase()}.`);
      setDraft(null);
      onDone();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the report.');
    } finally {
      setBusy(false);
    }
  };

  const open = (action: CivicAction) => setDraft({ action, note: '', assignee: report.assignedTo ?? '', photo: null, rating: 5 });
  const quick: CivicAction[] = ['verify', 'start'];

  if (draft) {
    const title = { verify: 'Verify', reject: 'Reject report', assign: 'Assign a crew', start: 'Start work', resolve: 'Mark as fixed', close: 'Confirm the fix', reopen: 'Reopen: not fixed' }[draft.action];
    return (
      <div className="mt-3 space-y-2.5 rounded-xl bg-navy-50 p-3">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {draft.action === 'assign' && (
          <Input value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} placeholder="Crew or officer, e.g. PWD Road Crew 3" maxLength={80} />
        )}
        {draft.action === 'close' && (
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rate the fix">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={draft.rating === n} onClick={() => setDraft({ ...draft, rating: n })} className="p-0.5">
                <Star className={clsx('size-5', n <= draft.rating ? 'fill-amber-400 text-amber-400' : 'text-navy-200')} />
              </button>
            ))}
          </div>
        )}
        <Textarea
          rows={2}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          placeholder={draft.action === 'reopen' ? 'What is still wrong? (required)' : draft.action === 'resolve' ? 'What was done, e.g. pothole filled and levelled' : 'Note (optional)'}
          maxLength={500}
        />
        {(draft.action === 'resolve' || draft.action === 'reopen' || draft.action === 'start') && (
          <PhotoInput value={draft.photo} onChange={(photo) => setDraft({ ...draft, photo })} label={draft.action === 'resolve' ? 'Add a photo of the fix' : 'Add a photo'} />
        )}
        <div className="flex gap-2">
          <Button size="sm" loading={busy} onClick={() => send(draft)} disabled={(draft.action === 'assign' && draft.assignee.trim().length < 2) || (draft.action === 'reopen' && !draft.note.trim())}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const buttons: { action: CivicAction; label: string; icon: LucideIcon; variant?: 'secondary' | 'success' | 'ghost' }[] = [
    { action: 'verify', label: 'Verify', icon: ShieldCheck },
    { action: 'assign', label: report.assignedTo ? 'Reassign' : 'Assign crew', icon: UserCheck, variant: 'secondary' },
    { action: 'start', label: 'Start work', icon: Play, variant: 'secondary' },
    { action: 'resolve', label: 'Mark fixed', icon: Wrench, variant: 'success' },
    { action: 'reject', label: 'Reject', icon: CircleX, variant: 'ghost' },
    { action: 'close', label: 'Confirm fix', icon: CircleCheck, variant: 'success' },
    { action: 'reopen', label: 'Not fixed', icon: RotateCcw, variant: 'ghost' },
  ];
  const visible = buttons.filter((b) => can(b.action));
  if (!visible.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {visible.map((b) => (
        <Button key={b.action} size="sm" variant={b.variant} icon={b.icon} disabled={busy} loading={busy && quick.includes(b.action)} onClick={() => (quick.includes(b.action) ? send({ action: b.action, note: '', assignee: '', photo: null, rating: 5 }) : open(b.action))}>
          {b.label}
        </Button>
      ))}
    </div>
  );
}

export function CaseCard({ network, report: r, staff, onChanged }: { network: NetworkInfo; report: CivicReport; staff: boolean; onChanged: () => void }) {
  const Icon = CATEGORY_ICON[r.category];
  const place = reportPlace(network, r);
  const [showTimeline, setShowTimeline] = useState(false);
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        {r.hasPhoto ? (
          <CasePhoto report={r} className="size-16 shrink-0" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">
            <Icon className="size-[18px]" />
          </span>
        )}
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
            {r.late && <Badge tone="red">Overdue</Badge>}
            <Badge tone={STATUS_META[r.status].tone} className="ml-auto">
              {STATUS_META[r.status].label}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-ink">{r.description}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <MapPin className="size-3" />
            <span className="font-medium text-navy-700">{place.title}</span>
            {place.detail && <span>· {place.detail}</span>}
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {r.reporterName}
            {r.reporterPhone ? ` · ${r.reporterPhone}` : ''} · {timeAgo(r.createdAt)}
            {r.assignedTo ? ` · crew: ${r.assignedTo}` : ''}
            {r.dueAt && OPEN_STATUSES.includes(r.status) ? ` · due ${new Date(r.dueAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
            {r.rating ? ` · rated ${r.rating}/5` : ''}
          </p>
          {r.resolutionNote && (
            <div className="mt-2 flex gap-2 rounded-lg bg-green-50 px-3 py-2 text-[12.5px] text-green-900 ring-1 ring-green-100">
              <CasePhoto report={r} kind="resolution" className="size-12 shrink-0" />
              <span>
                <span className="font-semibold">Fix: </span>
                {r.resolutionNote}
              </span>
            </div>
          )}
          <CaseStepper status={r.status} />
          <CaseActions report={r} staff={staff} onDone={onChanged} />
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => setShowTimeline((v) => !v)}>
            <History className="size-3.5" />
            {showTimeline ? 'Hide timeline' : 'Show timeline'}
          </button>
          {showTimeline && <CaseTimeline reportId={r.id} refreshKey={`${r.status}-${r.updatedAt}`} />}
        </div>
      </div>
    </li>
  );
}
