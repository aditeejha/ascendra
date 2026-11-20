import { ArrowUpRight, Ban, Clock, DoorOpen, LoaderCircle, MapPin, Siren, TrafficCone, Users, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EvacuationStatus, NetworkInfo, Snapshot } from '../../../shared/types';
import { CityMap, MapLegend, MapSkeleton } from '../components/CityMap';
import { NodeSelect } from '../components/NodeSelect';
import { Badge, Button, Card, CardBody, CardHeader, Field, PageHeader, Segmented, Skeleton, SkeletonGroup, Stat } from '../components/ui';
import { api } from '../lib/api';
import { useLive } from '../lib/live';
import { useToast } from '../lib/toast';

function hopDistances(net: NetworkInfo, start: number): number[] {
  const dist = net.nodes.map(() => Infinity);
  const out: number[][] = net.nodes.map(() => []);
  for (const l of net.links) out[l.from].push(l.to);
  dist[start] = 0;
  const queue = [start];
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of out[n]) {
      if (dist[m] === Infinity) {
        dist[m] = dist[n] + 1;
        queue.push(m);
      }
    }
  }
  return dist;
}

function previewZone(net: NetworkInfo, center: number, radius: number) {
  const hop = hopDistances(net, center);
  const zone = net.nodes.filter((n) => hop[n.id] <= radius).map((n) => n.id);
  const inZone = new Set(zone);
  let closed = 0;
  let contraflow = 0;
  for (const l of net.links) {
    if (inZone.has(l.to) && hop[l.to] < hop[l.from]) closed++;
    else if (inZone.has(l.from) && hop[l.to] > hop[l.from]) contraflow++;
  }
  const exits = net.exits.filter((id) => !inZone.has(id));
  return { zone, closed, contraflow, exits };
}

function placeName(net: NetworkInfo, id: number): string {
  const n = net.nodes[id];
  return n.exit ?? n.poi?.name ?? n.name;
}

const EFFECTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Ban, title: 'Inbound roads close', text: 'Links leading into the zone stop accepting new traffic; only emergency vehicles may enter.' },
  { icon: ArrowUpRight, title: 'Contraflow exit corridors', text: 'Outbound links borrow the lanes of their closed inbound twin, doubling exit capacity.' },
  { icon: TrafficCone, title: 'Signals serve outbound flow', text: 'Junctions inside the zone switch to evacuation timing with long greens for outbound queues.' },
  { icon: DoorOpen, title: 'Residents routed to exits', text: 'Vehicles in the zone are rerouted to the nearest city exit; trips into the zone are turned away.' },
];

function EffectList() {
  return (
    <ul className="space-y-3">
      {EFFECTS.map((e) => (
        <li key={e.title} className="flex gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-50 text-jam">
            <e.icon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">{e.title}</p>
            <p className="text-[13px] text-muted">{e.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-navy-50 px-4 py-3">
      <p className="text-[11.5px] font-medium text-muted">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold text-navy-900">{value}</p>
    </div>
  );
}

function PlanView({ network, snap }: { network: NetworkInfo; snap: Snapshot | null }) {
  const toast = useToast();
  const defaultCenter = network.nodes.find((n) => n.poi?.kind === 'market')?.id ?? null;
  const [center, setCenter] = useState<number | null>(defaultCenter);
  const [radius, setRadius] = useState<1 | 2>(1);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const preview = useMemo(() => (center === null ? null : previewZone(network, center, radius)), [network, center, radius]);

  const activate = async () => {
    if (center === null) return;
    setSending(true);
    try {
      await api<EvacuationStatus>('/evacuation', { method: 'POST', body: { center, radius } });
      toast('success', `Evacuation activated around ${placeName(network, center)}.`);
      setConfirming(false);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not activate evacuation mode.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-1">
        <Card>
          <CardHeader title="Plan an evacuation" subtitle="Pick the incident location and how far the zone extends" icon={MapPin} />
          <CardBody className="space-y-4">
            <Field label="Zone centre" hint="You can also click a junction on the map.">
              <NodeSelect
                network={network}
                value={center}
                onChange={(id) => {
                  setCenter(id);
                  setConfirming(false);
                }}
                placeholder="Choose the incident location"
              />
            </Field>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink">Zone radius</p>
              <Segmented
                ariaLabel="Zone radius"
                value={radius}
                onChange={(r) => {
                  setRadius(r);
                  setConfirming(false);
                }}
                options={[
                  { value: 1, label: '1 junction' },
                  { value: 2, label: '2 junctions' },
                ]}
              />
            </div>
            {preview && (
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Junctions in zone" value={preview.zone.length} />
                <Metric label="Exit routes" value={preview.exits.length} />
                <Metric label="Inbound links closed" value={preview.closed} />
                <Metric label="Contraflow corridors" value={preview.contraflow} />
              </div>
            )}
            {confirming ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-800">Activate evacuation mode?</p>
                <p className="mt-1 text-[13px] text-red-700">All traffic in and around the zone will be rerouted immediately.</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="danger" icon={Siren} loading={sending} onClick={activate}>
                    Confirm activation
                  </Button>
                  <Button variant="secondary" disabled={sending} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="w-full" variant="danger" icon={Siren} disabled={center === null} onClick={() => setConfirming(true)}>
                Activate evacuation
              </Button>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What activation does" />
          <CardBody>
            <EffectList />
          </CardBody>
        </Card>
      </div>
      <Card className="lg:col-span-2 lg:self-start">
        <CardHeader
          title="Zone preview"
          subtitle={center !== null ? `Centred on ${placeName(network, center)}` : 'Select a centre to preview the zone'}
          icon={Siren}
          actions={preview ? <Badge tone="red">{preview.zone.length} junctions</Badge> : undefined}
        />
        <div className="p-3">
          <CityMap
            network={network}
            snap={snap}
            zone={preview?.zone ?? null}
            selectedNode={center}
            onNodeClick={(id) => {
              setCenter(id);
              setConfirming(false);
            }}
            ariaLabel="Evacuation zone preview"
          />
        </div>
        {preview && (
          <div className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Residents leave through{' '}
            <span className="font-medium text-ink">{preview.exits.map((id) => placeName(network, id)).join(', ') || 'the ring road'}</span>.
          </div>
        )}
      </Card>
    </div>
  );
}

function ActiveView({ network, snap, evac }: { network: NetworkInfo; snap: Snapshot | null; evac: EvacuationStatus }) {
  const toast = useToast();
  const [ending, setEnding] = useState(false);
  const total = evac.inZone + evac.evacuated;

  const end = async () => {
    setEnding(true);
    try {
      await api('/evacuation', { method: 'DELETE' });
      toast('success', 'Evacuation ended. Normal signal timing and routing restored.');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not end evacuation mode.');
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-red-600 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <span className="relative grid size-10 place-items-center rounded-xl bg-white/15">
            <Siren className="size-5" />
            <span className="absolute -top-0.5 -right-0.5 size-3 animate-pulse rounded-full bg-white" />
          </span>
          <div>
            <p className="text-sm font-semibold">Evacuation in progress around {placeName(network, evac.center)}</p>
            <p className="text-[13px] text-red-100">
              Activated at {evac.startedClock} · radius {evac.radius} {evac.radius === 1 ? 'junction' : 'junctions'}
            </p>
          </div>
        </div>
        <button
          onClick={end}
          disabled={ending}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-red-700 shadow-sm transition-colors hover:bg-red-50 disabled:opacity-60"
        >
          {ending && <LoaderCircle className="size-4 animate-spin" />}
          End evacuation
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Started at" value={evac.startedClock} icon={Clock} tone="navy" sub={`Sim clock now ${snap?.clock ?? '--:--'}`} />
        <Stat label="Vehicles still in zone" value={evac.inZone} icon={Users} tone="red" sub={total ? `${Math.round((evac.evacuated / total) * 100)}% cleared` : 'Counting vehicles'} />
        <Stat label="Evacuated" value={evac.evacuated} icon={DoorOpen} tone="green" sub="Reached a city exit" />
        <Stat
          label="Clearance ETA"
          value={evac.clearanceEtaMin === null ? 'Estimating' : `${evac.clearanceEtaMin} min`}
          icon={Clock}
          tone="amber"
          sub="Based on the current exit rate"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Evacuation zone" subtitle="Dashed red area is the zone; blue arrows are contraflow exit corridors" icon={Siren} />
          <div className="p-3">
            <CityMap network={network} snap={snap} zone={evac.zoneNodes} selectedNode={evac.center} ariaLabel="Active evacuation zone" />
          </div>
          <div className="border-t border-line px-5 py-3">
            <MapLegend />
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Exit corridors" subtitle="Where evacuees are being routed" icon={DoorOpen} />
            <CardBody>
              <ul className="space-y-2">
                {evac.exits.map((id) => (
                  <li key={id} className="flex items-center justify-between rounded-xl bg-navy-50 px-3 py-2.5 text-sm">
                    <span className="font-medium text-ink">{placeName(network, id)}</span>
                    <Badge tone="green" dot>
                      Open
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Network changes" icon={TrafficCone} />
            <CardBody className="grid grid-cols-2 gap-3">
              <Metric label="Inbound links closed" value={evac.closedLinks.length} />
              <Metric label="Contraflow corridors" value={evac.contraflowLinks.length} />
              <Metric label="Signals in evacuation mode" value={evac.zoneNodes.length} />
              <Metric label="Total vehicles moved" value={total} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EvacuationSkeleton() {
  return (
    <SkeletonGroup label="Loading evacuation controls…" className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="border-b border-line px-5 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-56" />
        </div>
        <div className="space-y-4 px-5 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4).keys()].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <div className="border-b border-line px-5 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-2 h-3 w-48" />
        </div>
        <div className="p-3">
          <MapSkeleton />
        </div>
      </Card>
    </SkeletonGroup>
  );
}

export function EvacuationPage() {
  const { network, snap } = useLive();
  return (
    <div>
      <PageHeader
        title="Disaster & evacuation mode"
        description="Macro-steer the network during a disaster: close roads into the affected area, open contraflow exit corridors and give outbound traffic the green."
      />
      {!network || !snap ? (
        <EvacuationSkeleton />
      ) : snap.evacuation ? (
        <ActiveView network={network} snap={snap} evac={snap.evacuation} />
      ) : (
        <PlanView network={network} snap={snap} />
      )}
    </div>
  );
}
