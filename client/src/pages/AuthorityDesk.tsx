import clsx from 'clsx';
import { Ambulance, CircleCheck, CircleX, Gauge, IdCard, Mail, MapPin, MessageSquareExclamationPoint, Phone, Search, ShieldCheck, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CLASS_LABEL, type CivicReport, type Dispatch, type OverspeedAlert, type RegisteredVehicle } from '../../../shared/types';
import { CaseCard, OPEN_STATUSES } from '../components/CivicCase';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Segmented, Skeleton, SkeletonGroup, Stat, TD, TH } from '../components/ui';
import { api, withRole } from '../lib/api';
import { num, rupees, seconds, timeAgo } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';

type Tab = 'people' | 'cases' | 'speeding' | 'dispatches';
type CaseView = 'open' | 'unassigned' | 'late' | 'progress' | 'done' | 'all';

interface Person {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  licenceNo: string | null;
  photoOf: number | null;
  vehicles: RegisteredVehicle[];
}

function groupPeople(vehicles: RegisteredVehicle[]): Person[] {
  const map = new Map<string, Person>();
  for (const v of vehicles) {
    const key = `${v.ownerName.toLowerCase()}|${v.phone ?? ''}`;
    let p = map.get(key);
    if (!p) {
      p = { key, name: v.ownerName, phone: v.phone, email: v.email, address: v.address, licenceNo: v.licenceNo, photoOf: null, vehicles: [] };
      map.set(key, p);
    }
    p.vehicles.push(v);
    p.email ??= v.email;
    p.address ??= v.address;
    p.licenceNo ??= v.licenceNo;
    if (v.hasPhoto && p.photoOf === null) p.photoOf = v.id;
  }
  return [...map.values()];
}

export function AuthorityDeskPage() {
  const { network } = useLive();
  const toast = useToast();
  const vehicles = usePoll<RegisteredVehicle[]>('/vehicles', 8000);
  const civic = usePoll<CivicReport[]>('/civic', 5000);
  const alerts = usePoll<OverspeedAlert[]>('/alerts', 6000);
  const emergency = usePoll<{ dispatches: Dispatch[] }>('/emergency', 8000);
  const [tab, setTab] = useState<Tab>('people');
  const [view, setView] = useState<CaseView>('open');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const people = useMemo(() => groupPeople(vehicles.data ?? []), [vehicles.data]);
  const byPlate = useMemo(() => new Map((vehicles.data ?? []).map((v) => [v.plate, v])), [vehicles.data]);
  const alertList = alerts.data ?? [];
  const fines = useMemo(() => {
    const m = new Map<string, { count: number; amount: number }>();
    for (const a of alertList) {
      const cur = m.get(a.plate) ?? { count: 0, amount: 0 };
      cur.count++;
      cur.amount += a.fineAmount ?? 0;
      m.set(a.plate, cur);
    }
    return m;
  }, [alertList]);
  const cases = civic.data ?? [];
  const caseMatch = (r: CivicReport, v: CaseView) =>
    v === 'open'
      ? OPEN_STATUSES.includes(r.status) && r.status !== 'in_progress'
      : v === 'unassigned'
        ? OPEN_STATUSES.includes(r.status) && !r.assignedTo
        : v === 'late'
          ? r.late
          : v === 'progress'
            ? r.status === 'in_progress'
            : v === 'done'
              ? ['resolved', 'closed', 'rejected'].includes(r.status)
              : true;
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  const visibleCases = cases.filter((r) => caseMatch(r, view)).sort((a, b) => Number(b.late) - Number(a.late) || severityRank[a.severity] - severityRank[b.severity] || b.id - a.id);
  const q = query.trim().toLowerCase();
  const visiblePeople = people.filter((p) => !q || `${p.name} ${p.phone ?? ''} ${p.email ?? ''} ${p.licenceNo ?? ''} ${p.vehicles.map((v) => v.plate).join(' ')}`.toLowerCase().includes(q));

  const verify = async (v: RegisteredVehicle, status: 'verified' | 'rejected') => {
    setBusy(`v${v.id}`);
    try {
      await api(`/vehicles/${v.id}`, { method: 'PATCH', body: { status } });
      toast('success', `${v.plate} ${status === 'verified' ? 'verified' : 'rejected'}.`);
      await vehicles.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the vehicle.');
    } finally {
      setBusy(null);
    }
  };

  const act = async (a: OverspeedAlert, action: 'fine' | 'dismiss') => {
    setBusy(`a${a.id}`);
    try {
      await api(`/alerts/${a.id}`, { method: 'PATCH', body: { action } });
      toast('success', action === 'fine' ? `Challan issued to ${a.plate}.` : `Alert for ${a.plate} dismissed.`);
      await alerts.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the alert.');
    } finally {
      setBusy(null);
    }
  };

  const loading = vehicles.loading && !vehicles.data;
  const openCases = cases.filter((r) => OPEN_STATUSES.includes(r.status));
  const pending = (vehicles.data ?? []).filter((v) => v.status === 'pending_verification').length;
  const openAlerts = alertList.filter((a) => a.status === 'open').length;
  const collected = alertList.reduce((s, a) => s + (a.fineAmount ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Authority desk"
        description="Everything the traffic authority handles in one place: registered citizens and vehicles with their photos and contact details, civic cases with deadlines, overspeeding linked to owners, and emergency dispatches."
      />
      {loading ? (
        <SkeletonGroup label="Loading authority desk…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <Stat label="Registered people" value={num(people.length)} icon={Users} tone="navy" sub={`${num(vehicles.data?.length ?? 0)} vehicles · ${pending} awaiting verification`} />
          <Stat label="Open civic cases" value={num(openCases.length)} icon={MessageSquareExclamationPoint} tone="blue" sub={`${cases.filter((r) => r.late).length} overdue · ${openCases.filter((r) => !r.assignedTo).length} unassigned`} />
          <Stat label="Overspeed alerts open" value={num(openAlerts)} icon={Gauge} tone="amber" sub={`${rupees(collected)} in challans issued`} />
          <Stat label="Emergency dispatches" value={num(emergency.data?.dispatches.length ?? 0)} icon={Ambulance} tone="red" sub={`${(emergency.data?.dispatches ?? []).filter((d) => d.status === 'en_route').length} en route now`} />
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <Segmented
            ariaLabel="Section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'people', label: 'People & vehicles' },
              { value: 'cases', label: `Civic cases (${openCases.length})` },
              { value: 'speeding', label: `Overspeeding (${openAlerts})` },
              { value: 'dispatches', label: 'Dispatches' },
            ]}
          />
          {tab === 'people' && (
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input className="pl-9" placeholder="Name, phone, plate or licence" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
            </div>
          )}
          {tab === 'cases' && (
            <Segmented
              ariaLabel="Case view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'unassigned', label: 'Unassigned' },
                { value: 'late', label: 'Overdue' },
                { value: 'progress', label: 'In progress' },
                { value: 'done', label: 'Fixed' },
                { value: 'all', label: 'All' },
              ]}
            />
          )}
        </div>

        {tab === 'people' &&
          (visiblePeople.length ? (
            <ul className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 2xl:grid-cols-3">
              {visiblePeople.map((p) => (
                <li key={p.key} className="rounded-2xl p-4 ring-1 ring-line">
                  <div className="flex items-start gap-3">
                    {p.photoOf !== null ? (
                      <a href={withRole(`/vehicles/${p.photoOf}/photo`)} target="_blank" rel="noreferrer">
                        <img src={withRole(`/vehicles/${p.photoOf}/photo`)} alt={`Photo of ${p.name}`} className="size-16 rounded-full object-cover ring-2 ring-white shadow" loading="lazy" />
                      </a>
                    ) : (
                      <span className="grid size-16 shrink-0 place-items-center rounded-full bg-navy-100 text-lg font-semibold text-navy-800">{p.name.slice(0, 2).toUpperCase()}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-ink">{p.name}</p>
                      <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted">
                        {p.phone && (
                          <li className="flex items-center gap-1.5">
                            <Phone className="size-3.5" /> {p.phone}
                          </li>
                        )}
                        {p.email && (
                          <li className="flex items-center gap-1.5 truncate">
                            <Mail className="size-3.5" /> {p.email}
                          </li>
                        )}
                        {p.licenceNo && (
                          <li className="flex items-center gap-1.5">
                            <IdCard className="size-3.5" /> DL {p.licenceNo}
                          </li>
                        )}
                        {p.address && (
                          <li className="flex items-center gap-1.5 truncate">
                            <MapPin className="size-3.5" /> {p.address}
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {p.vehicles.map((v) => {
                      const f = fines.get(v.plate);
                      return (
                        <li key={v.id} className="rounded-xl bg-navy-50 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-white px-2 py-0.5 font-mono text-[12.5px] font-semibold text-navy-900 ring-1 ring-line">{v.plate}</span>
                            <span className="text-xs text-muted">{CLASS_LABEL[v.vehicleClass]}</span>
                            <Badge tone={v.status === 'pending_verification' ? 'amber' : v.status === 'rejected' ? 'red' : 'green'} className="ml-auto">
                              {v.status === 'pending_verification' ? 'Pending' : v.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11.5px] text-muted">
                            Registered {timeAgo(v.createdAt)}
                            {v.agency ? ` · ${v.agency}` : ''}
                            {f ? ` · ${f.count} speeding alert${f.count === 1 ? '' : 's'}, ${rupees(f.amount)} fined` : ''}
                          </p>
                          {v.status === 'pending_verification' && (
                            <div className="mt-2 flex gap-2">
                              <Button size="sm" variant="success" icon={CircleCheck} loading={busy === `v${v.id}`} onClick={() => verify(v, 'verified')}>
                                Verify
                              </Button>
                              <Button size="sm" variant="secondary" icon={CircleX} disabled={busy === `v${v.id}`} onClick={() => verify(v, 'rejected')}>
                                Reject
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Users} title="Nobody matches" description="Try another name, number, plate or licence." />
          ))}

        {tab === 'cases' &&
          (visibleCases.length && network ? (
            <ul className="divide-y divide-line">
              {visibleCases.map((r) => (
                <CaseCard key={r.id} network={network} report={r} staff onChanged={civic.refresh} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={ShieldCheck} title="No cases here" description="Nothing matches this view right now." />
          ))}

        {tab === 'speeding' &&
          (alertList.length ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-navy-50/60">
                  <tr>
                    <th className={TH}>Vehicle</th>
                    <th className={TH}>Registered owner</th>
                    <th className={TH}>Speed</th>
                    <th className={TH}>Where</th>
                    <th className={TH}>Status</th>
                    <th className={clsx(TH, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {alertList.slice(0, 80).map((a) => {
                    const owner = byPlate.get(a.plate);
                    return (
                      <tr key={a.id}>
                        <td className={TD}>
                          <span className="rounded-md bg-navy-50 px-2 py-0.5 font-mono text-[12.5px] font-semibold ring-1 ring-line">{a.plate}</span>
                          <p className="mt-1 text-xs text-muted">{CLASS_LABEL[a.vehicleClass]}</p>
                        </td>
                        <td className={TD}>
                          {owner ? (
                            <div className="flex items-center gap-2">
                              {owner.hasPhoto && <img src={withRole(`/vehicles/${owner.id}/photo`)} alt="" className="size-8 rounded-full object-cover" />}
                              <div>
                                <p className="font-medium">{owner.ownerName}</p>
                                <p className="text-xs text-muted">{owner.phone ?? 'No phone on record'}</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Not in the ASCENDRA registry; trace through the RTO (VAHAN)</span>
                          )}
                        </td>
                        <td className={clsx(TD, 'tabular')}>
                          <span className="font-semibold text-jam">{a.speedKmh} km/h</span>
                          <span className="text-xs text-muted"> / {a.limitKmh}</span>
                        </td>
                        <td className={clsx(TD, 'text-[13px]')}>
                          {network?.links[a.linkId]?.road ?? `Link ${a.linkId}`}
                          <p className="text-xs text-muted">at {a.simClock}</p>
                        </td>
                        <td className={TD}>
                          <Badge tone={a.status === 'open' ? 'amber' : a.status === 'fined' ? 'red' : 'neutral'}>{a.status === 'fined' ? `Fined ${rupees(a.fineAmount)}` : a.status}</Badge>
                        </td>
                        <td className={clsx(TD, 'text-right')}>
                          {a.status === 'open' ? (
                            <div className="inline-flex gap-2">
                              <Button size="sm" loading={busy === `a${a.id}`} onClick={() => act(a, 'fine')}>
                                Issue challan
                              </Button>
                              <Button size="sm" variant="ghost" disabled={busy === `a${a.id}`} onClick={() => act(a, 'dismiss')}>
                                Dismiss
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-subtle">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Gauge} title="No detections" description="Overspeeding detected by the camera sites appears here." />
          ))}

        {tab === 'dispatches' &&
          (emergency.data?.dispatches.length ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-navy-50/60">
                  <tr>
                    <th className={TH}>Vehicle</th>
                    <th className={TH}>Operator</th>
                    <th className={TH}>Route</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Time saved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {emergency.data.dispatches.map((d) => {
                    const v = (vehicles.data ?? []).find((x) => x.id === d.vehicleId);
                    return (
                      <tr key={d.id}>
                        <td className={TD}>
                          <span className="font-mono text-[12.5px] font-semibold">{d.plate}</span>
                          <p className="text-xs text-muted">{d.label}</p>
                        </td>
                        <td className={TD}>
                          {v?.ownerName ?? '—'}
                          {v?.phone && <p className="text-xs text-muted">{v.phone}</p>}
                        </td>
                        <td className={clsx(TD, 'text-[13px]')}>
                          {network ? `${network.nodes[d.originNode]?.poi?.name ?? network.nodes[d.originNode]?.name} → ${network.nodes[d.destNode]?.poi?.name ?? network.nodes[d.destNode]?.name}` : '—'}
                          <p className="text-xs text-muted">started {d.startedClock}</p>
                        </td>
                        <td className={TD}>
                          <Badge tone={d.status === 'arrived' ? 'green' : d.status === 'en_route' ? 'red' : 'neutral'}>{d.status.replace('_', ' ')}</Badge>
                        </td>
                        <td className={clsx(TD, 'tabular')}>{d.actualS !== null && d.estNoPriorityS ? seconds(Math.max(0, d.estNoPriorityS - d.actualS)) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Ambulance} title="No dispatches yet" description="Green-wave dispatches appear here with their operator and time saved." />
          ))}
      </Card>
    </div>
  );
}
