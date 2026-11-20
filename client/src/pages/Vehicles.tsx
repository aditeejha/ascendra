import clsx from 'clsx';
import { Ambulance, Bike, Car, CircleCheck, CircleX, Plus, Search, ShieldCheck, Truck, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { CLASS_LABEL, type RegisteredVehicle, type RegistrationStatus, type VehicleClass } from '../../../shared/types';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Segmented, Select, Skeleton, SkeletonGroup, Stat, TD, TH, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { usePoll } from '../lib/hooks';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';
import { CLASS_COLOR, num, timeAgo } from '../lib/format';

const CLASS_ICON: Record<VehicleClass, LucideIcon> = { private: Car, two_wheeler: Bike, cargo: Truck, emergency: Ambulance };

const STATUS_META: Record<RegistrationStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'green' },
  verified: { label: 'Verified', tone: 'green' },
  pending_verification: { label: 'Pending verification', tone: 'amber' },
  rejected: { label: 'Rejected', tone: 'red' },
};

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const EMPTY_FORM = { plate: '', vehicleClass: 'private' as VehicleClass, ownerName: '', phone: '', weightT: '', agency: '' };

export function VehiclesPage() {
  const { role } = useRole();
  const toast = useToast();
  const registry = usePoll<RegisteredVehicle[]>('/vehicles', 8000);
  const [classFilter, setClassFilter] = useState<'all' | VehicleClass>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const canRegister = role === 'driver' || role === 'controller' || role === 'authority' || role === 'emergency';
  const canVerify = role === 'authority' || role === 'controller';

  const all = registry.data ?? [];
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((v) => {
      if (classFilter !== 'all' && v.vehicleClass !== classFilter) return false;
      if (statusFilter === 'pending' && v.status !== 'pending_verification') return false;
      if (statusFilter === 'approved' && v.status !== 'active' && v.status !== 'verified') return false;
      if (statusFilter === 'rejected' && v.status !== 'rejected') return false;
      if (q && !`${v.plate} ${v.ownerName} ${v.agency ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, classFilter, statusFilter, query]);

  const stats = useMemo(() => {
    const cargo = all.filter((v) => v.vehicleClass === 'cargo' && v.status !== 'rejected');
    return {
      total: all.length,
      emergencyVerified: all.filter((v) => v.vehicleClass === 'emergency' && v.status === 'verified').length,
      pending: all.filter((v) => v.status === 'pending_verification').length,
      cargo: cargo.length,
      tonnage: cargo.reduce((a, v) => a + (v.weightT ?? 0), 0),
    };
  }, [all]);

  const setStatus = async (v: RegisteredVehicle, status: 'verified' | 'rejected') => {
    setBusy(v.id);
    try {
      await api<RegisteredVehicle>(`/vehicles/${v.id}`, { method: 'PATCH', body: { status } });
      toast('success', status === 'verified' ? `${v.plate} verified for green-wave priority.` : `${v.plate} registration rejected.`);
      await registry.refresh();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not update the vehicle.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Vehicle registry"
        description="Every vehicle is registered with its class so the platform can route it appropriately. Emergency vehicles get green-wave priority only after the traffic authority verifies them."
      />

      {registry.loading && !registry.data ? (
        <SkeletonGroup label="Loading vehicle registry…" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[...Array(4).keys()].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-3 h-7 w-14" />
                </div>
                <Skeleton className="size-10 rounded-xl" />
              </div>
              <Skeleton className="mt-3 h-3 w-32" />
            </Card>
          ))}
        </SkeletonGroup>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Registered vehicles" value={num(stats.total)} icon={Car} tone="navy" sub="All classes in the registry" />
          <Stat label="Verified emergency" value={num(stats.emergencyVerified)} icon={ShieldCheck} tone="green" sub="Eligible for green-wave priority" />
          <Stat label="Pending verification" value={num(stats.pending)} icon={Ambulance} tone="amber" sub={canVerify ? 'Waiting for your review' : 'Waiting for the traffic authority'} />
          <Stat label="Cargo fleet" value={num(stats.cargo)} icon={Truck} tone="sky" sub={`${num(stats.tonnage, 1)} t combined gross weight`} />
        </div>
      )}

      <div className={clsx('mt-6 grid gap-6', canRegister && 'xl:grid-cols-[380px_minmax(0,1fr)]')}>
        {canRegister && <RegisterForm onRegistered={registry.refresh} />}

        <Card className="min-w-0">
          <CardHeader title="Registry" subtitle={`${rows.length} of ${all.length} vehicles`} icon={ShieldCheck} />
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input className="pl-9" placeholder="Search plate, owner or agency" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search registry" />
            </div>
            <Select className="w-auto min-w-40" value={classFilter} onChange={(e) => setClassFilter(e.target.value as 'all' | VehicleClass)} aria-label="Filter by class">
              <option value="all">All classes</option>
              {(Object.keys(CLASS_LABEL) as VehicleClass[]).map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABEL[c]}
                </option>
              ))}
            </Select>
            <Segmented
              ariaLabel="Filter by status"
              size="sm"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: `Pending${stats.pending ? ` (${stats.pending})` : ''}` },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          </div>
          {registry.loading && !registry.data ? (
            <SkeletonGroup label="Loading vehicles…">
              <div className="divide-y divide-line">
                {[...Array(6).keys()].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            </SkeletonGroup>
          ) : rows.length ? (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="bg-navy-50/60">
                  <tr>
                    <th className={TH}>Plate</th>
                    <th className={TH}>Class</th>
                    <th className={TH}>Owner / agency</th>
                    <th className={TH}>Weight</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Registered</th>
                    {canVerify && <th className={clsx(TH, 'text-right')}>Review</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((v) => (
                    <VehicleRow key={v.id} vehicle={v} canVerify={canVerify} busy={busy === v.id} onStatus={(s) => setStatus(v, s)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Search} title="No vehicles match" description="Try a different class, status or search term." />
          )}
          {registry.error && <p className="border-t border-line px-5 py-3 text-[13px] text-red-700">{registry.error}</p>}
        </Card>
      </div>
    </div>
  );
}

function VehicleRow({
  vehicle: v,
  canVerify,
  busy,
  onStatus,
}: {
  vehicle: RegisteredVehicle;
  canVerify: boolean;
  busy: boolean;
  onStatus: (s: 'verified' | 'rejected') => void;
}) {
  const Icon = CLASS_ICON[v.vehicleClass];
  const status = STATUS_META[v.status];
  return (
    <tr className="hover:bg-navy-50/40">
      <td className={TD}>
        <span className="tabular rounded-md bg-navy-50 px-2 py-1 font-mono text-[13px] font-semibold tracking-wide text-navy-900 ring-1 ring-line ring-inset">{v.plate}</span>
      </td>
      <td className={TD}>
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4" style={{ color: CLASS_COLOR[v.vehicleClass] }} />
          {CLASS_LABEL[v.vehicleClass]}
        </span>
      </td>
      <td className={TD}>
        <p className="font-medium">{v.ownerName}</p>
        {(v.agency || v.phone) && <p className="text-xs text-muted">{[v.agency, v.phone].filter(Boolean).join(' · ')}</p>}
      </td>
      <td className={clsx(TD, 'tabular text-muted')}>{v.weightT ? `${v.weightT} t` : '—'}</td>
      <td className={TD}>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </td>
      <td className={clsx(TD, 'text-muted')}>{timeAgo(v.createdAt)}</td>
      {canVerify && (
        <td className={clsx(TD, 'text-right')}>
          {v.status === 'pending_verification' ? (
            <div className="inline-flex gap-2">
              <Button size="sm" variant="success" icon={CircleCheck} loading={busy} onClick={() => onStatus('verified')}>
                Verify
              </Button>
              <Button size="sm" variant="secondary" icon={CircleX} disabled={busy} onClick={() => onStatus('rejected')}>
                Reject
              </Button>
            </div>
          ) : (
            <span className="text-xs text-subtle">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

function RegisterForm({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const cargo = form.vehicleClass === 'cargo';
  const emergency = form.vehicleClass === 'emergency';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const weight = Number(form.weightT);
    if (cargo && (!form.weightT || !Number.isFinite(weight) || weight <= 0)) {
      setError('Cargo vehicles need a gross weight in tonnes.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api<RegisteredVehicle>('/vehicles', {
        method: 'POST',
        body: {
          plate: form.plate,
          vehicleClass: form.vehicleClass,
          ownerName: form.ownerName,
          phone: form.phone.trim() || null,
          weightT: cargo ? weight : null,
          agency: emergency ? form.agency.trim() || null : null,
        },
      });
      toast(
        'success',
        created.status === 'pending_verification'
          ? `${created.plate} registered. It needs authority verification before priority routing.`
          : `${created.plate} registered.`,
      );
      setForm(EMPTY_FORM);
      await onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="self-start">
      <CardHeader title="Register a vehicle" subtitle="Class decides routing rules and priority" icon={Plus} />
      <CardBody>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Registration number" hint="Indian format, e.g. JH 15 AB 1234">
            <Input required value={form.plate} onChange={(e) => set('plate', e.target.value.toUpperCase())} placeholder="JH 15 AB 1234" autoComplete="off" className="font-mono tracking-wide" />
          </Field>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink">Vehicle class</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CLASS_LABEL) as VehicleClass[]).map((c) => {
                const Icon = CLASS_ICON[c];
                const active = form.vehicleClass === c;
                return (
                  <button
                    type="button"
                    key={c}
                    onClick={() => set('vehicleClass', c)}
                    aria-pressed={active}
                    className={clsx(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors',
                      active ? 'border-brand-500 bg-brand-50 text-navy-900 ring-1 ring-brand-500' : 'border-line text-muted hover:border-navy-200 hover:text-ink',
                    )}
                  >
                    <Icon className="size-4 shrink-0" style={{ color: CLASS_COLOR[c] }} />
                    {CLASS_LABEL[c]}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label={emergency ? 'Operator / hospital' : 'Owner name'}>
            <Input required minLength={2} value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder={emergency ? 'Sadar Hospital' : 'Full name or company'} />
          </Field>
          <Field label="Contact phone">
            <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="Optional" />
          </Field>
          {cargo && (
            <Field label="Gross weight (tonnes)" hint="Used to keep heavy cargo off lanes and weight-limited bridges.">
              <Input type="number" min={0.1} max={60} step={0.5} required value={form.weightT} onChange={(e) => set('weightT', e.target.value)} placeholder="18" />
            </Field>
          )}
          {emergency && (
            <>
              <Field label="Service type" hint="e.g. Ambulance - 108, Fire tender, Police PCR">
                <Input value={form.agency} onChange={(e) => set('agency', e.target.value)} placeholder="Ambulance - 108" />
              </Field>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800 ring-1 ring-amber-200 ring-inset">
                Emergency vehicles are held as pending until the traffic authority verifies them. Only verified vehicles can request a green wave.
              </p>
            </>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200 ring-inset">{error}</p>}
          <Button type="submit" className="w-full" icon={Plus} loading={saving}>
            Register vehicle
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
