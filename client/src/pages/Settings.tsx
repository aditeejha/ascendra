import clsx from 'clsx';
import { Brain, Camera, CircleCheck, CircleX, CloudFog, CloudRain, CloudRainWind, CloudSun, Cpu, Database, Gauge, Map as MapIcon, Pause, Play, Radio, ScrollText, Server, SlidersHorizontal, Sun } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuditEntry, Role, SimSettings, Weather } from '../../../shared/types';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Segmented, Skeleton, SkeletonGroup, TD, TH, Toggle, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { timeAgo, titleCase } from '../lib/format';
import { usePoll } from '../lib/hooks';
import { timezoneAbbr, useLive } from '../lib/live';
import { useRole } from '../lib/role';
import { useToast } from '../lib/toast';

interface Health {
  ok: boolean;
  database: 'postgres' | 'in-memory';
  forecaster: boolean;
  signalPolicy: boolean;
  junctionModel?: boolean;
  simClock: string;
}

function LiveSources() {
  const { live } = useLive();
  if (!live) {
    return (
      <SkeletonGroup label="Loading live data sources…" className="divide-y divide-line">
        {[...Array(3).keys()].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-64" />
            </div>
          </div>
        ))}
      </SkeletonGroup>
    );
  }
  const w = live.weather.reading;
  const t = live.traffic;
  const trafficDetail = !t.configured
    ? 'No key configured. Add TOMTOM_API_KEY=your-key to .env and restart the server to use live road speeds and incidents; until then traffic is simulated.'
    : t.status === 'ok'
      ? `${t.samples.length} roads measured, ${t.incidents.length} live incidents. ${t.requestsToday} of ${t.dailyBudget} requests used today. Demand calibrated ×${t.calibration.toFixed(2)} to match measured speeds.`
      : t.error ?? 'Connecting to TomTom…';
  return (
    <div className="divide-y divide-line">
      <StatusLine
        ok
        icon={<MapIcon className="size-4" />}
        label={`Road network · ${live.city.name}, ${live.city.region}`}
        detail={`${live.network.nodes.toLocaleString('en-IN')} junctions and ${live.network.links.toLocaleString('en-IN')} links from ${live.network.source}, downloaded ${new Date(live.network.fetchedAt).toLocaleDateString('en-IN')} via ${live.network.via}. ${live.network.signalsOsm} signals mapped in OpenStreetMap, ${live.network.signalsInferred} inferred at major crossings.`}
      />
      <StatusLine
        ok={Boolean(w) && !live.weather.error}
        icon={<CloudSun className="size-4" />}
        label={`Weather · ${live.weather.source}${live.weather.mode === 'manual' ? ' (overridden manually)' : ''}`}
        detail={
          w
            ? `${w.description}, ${w.temperatureC.toFixed(1)}°C, ${w.precipitationMm} mm rain, visibility ${w.visibilityM !== null ? `${(w.visibilityM / 1000).toFixed(1)} km` : 'n/a'} → simulated as ${WEATHER_TEXT[w.condition]}. Observed ${w.observedAt.slice(11, 16)} ${timezoneAbbr(live.city.timezone)}.`
            : live.weather.error ?? 'Waiting for the first reading…'
        }
      />
      <StatusLine ok={t.status === 'ok'} icon={<Radio className="size-4" />} label={`Traffic · ${t.provider}`} detail={trafficDetail} />
      <StatusLine
        ok
        icon={<Gauge className="size-4" />}
        label={`Clock · ${live.clock.mode === 'live' ? `live ${timezoneAbbr(live.city.timezone)}` : 'fast-forward'}`}
        detail={`Local time ${live.city.localDay} ${live.city.localTime}; the simulation shows ${live.clock.simDay} ${live.clock.simClock}.`}
      />
    </div>
  );
}

const WEATHER_TEXT: Record<Weather, string> = { clear: 'clear', rain: 'rain', heavy_rain: 'heavy rain', fog: 'fog' };

const ROLE_TONE: Record<Role, Tone> = {
  controller: 'navy',
  authority: 'blue',
  citizen: 'green',
  driver: 'sky',
  emergency: 'red',
};

const SPEEDS = [1, 2, 4, 8, 16] as const;

const WEATHER_OPTIONS: { value: Weather; label: ReactNode }[] = [
  { value: 'clear', label: <WeatherLabel icon={<Sun className="size-3.5" />} text="Clear" /> },
  { value: 'rain', label: <WeatherLabel icon={<CloudRain className="size-3.5" />} text="Rain" /> },
  { value: 'heavy_rain', label: <WeatherLabel icon={<CloudRainWind className="size-3.5" />} text="Heavy rain" /> },
  { value: 'fog', label: <WeatherLabel icon={<CloudFog className="size-3.5" />} text="Fog" /> },
];

function WeatherLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {text}
    </span>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <SkeletonGroup label={label} className="divide-y divide-line">
      {[...Array(rows).keys()].map((i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-4">
          <div>
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-2 h-3 w-60" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

function DemandSlider({ value, onCommit, disabled }: { value: number; onCommit: (v: number) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const change = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onCommit(v), 450);
  };
  return (
    <div className="flex w-full items-center gap-3 sm:w-72">
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.05}
        value={draft}
        disabled={disabled}
        onChange={(e) => change(Number(e.target.value))}
        className="flex-1"
        aria-label="Traffic demand"
      />
      <span className="tabular w-14 rounded-md bg-navy-50 px-2 py-1 text-center text-xs font-semibold text-navy-800">{Math.round(draft * 100)}%</span>
    </div>
  );
}

function StatusLine({ ok, label, detail, icon }: { ok: boolean; label: string; detail: string; icon: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="text-[13px] text-muted">{detail}</p>
      </div>
      {ok ? <CircleCheck className="mt-1 size-5 shrink-0 text-free" /> : <CircleX className="mt-1 size-5 shrink-0 text-heavy" />}
    </div>
  );
}

function summarise(details: Record<string, unknown> | null): string {
  if (!details) return '—';
  const parts = Object.entries(details).map(([k, v]) => `${titleCase(k)}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) {
    return <EmptyState icon={ScrollText} title="No actions recorded yet" description="Every change made through the platform is written to the audit log." />;
  }
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full min-w-[720px]">
        <thead className="sticky top-0 border-b border-line bg-navy-50">
          <tr>
            <th className={TH}>When</th>
            <th className={TH}>Role</th>
            <th className={TH}>Action</th>
            <th className={TH}>Entity</th>
            <th className={TH}>Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((e) => (
            <tr key={e.id}>
              <td className={clsx(TD, 'whitespace-nowrap text-muted')} title={new Date(e.createdAt).toLocaleString('en-IN')}>
                {timeAgo(e.createdAt)}
              </td>
              <td className={TD}>
                <Badge tone={ROLE_TONE[e.actorRole] ?? 'neutral'}>{titleCase(e.actorRole)}</Badge>
              </td>
              <td className={clsx(TD, 'font-medium whitespace-nowrap')}>{titleCase(e.action)}</td>
              <td className={clsx(TD, 'whitespace-nowrap text-muted')}>
                {titleCase(e.entity)}
                {e.entityId ? ` #${e.entityId}` : ''}
              </td>
              <td className={clsx(TD, 'max-w-[360px] truncate text-[13px] text-muted')} title={summarise(e.details)}>
                {summarise(e.details)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsPage() {
  const { role } = useRole();
  const toast = useToast();
  const canEdit = role === 'controller';
  const { data: settings, setData } = usePoll<SimSettings>('/settings', 5000);
  const { data: health } = usePoll<Health>('/health', 10000);
  const { data: audit } = usePoll<AuditEntry[]>('/audit', 8000);
  const { refreshLive } = useLive();

  const patch = async (update: Partial<SimSettings>, success?: string) => {
    if (!settings) return;
    const previous = settings;
    setData({ ...settings, ...update });
    try {
      const next = await api<SimSettings>('/settings', { method: 'PATCH', body: update });
      setData(next);
      refreshLive();
      if (success) toast('success', success);
    } catch (e) {
      setData(previous);
      toast('error', e instanceof Error ? e.message : 'Could not save the setting.');
    }
  };

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Run the city simulation, choose the control strategy and review every action recorded in the audit log."
        actions={
          settings && (
            <Button
              variant={settings.paused ? 'primary' : 'secondary'}
              icon={settings.paused ? Play : Pause}
              disabled={!canEdit}
              onClick={() => patch({ paused: !settings.paused }, settings.paused ? 'Simulation resumed.' : 'Simulation paused.')}
            >
              {settings.paused ? 'Resume simulation' : 'Pause simulation'}
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Simulation" subtitle="Clock, weather and demand of the live city model" icon={Gauge} />
          <CardBody className="py-0">
            {settings ? (
              <div className="divide-y divide-line">
                <div className="py-1">
                  <Toggle
                    checked={settings.liveClock}
                    onChange={(liveClock) => patch({ liveClock }, liveClock ? 'Clock synced to live local time.' : 'Fast-forward mode: the clock no longer follows real time.')}
                    disabled={!canEdit}
                    label="Live clock"
                    description="Run the city on real local time so demand, weather and live traffic line up. Turn off to fast-forward for demonstrations."
                  />
                </div>
                {!settings.liveClock && (
                  <SettingRow label="Fast-forward speed" description="Simulated seconds per real second.">
                    <Segmented
                      ariaLabel="Simulation speed"
                      value={settings.speed}
                      onChange={(speed) => patch({ speed })}
                      options={SPEEDS.map((s) => ({ value: s as number, label: `${s}×` }))}
                    />
                  </SettingRow>
                )}
                <div className="py-1">
                  <Toggle
                    checked={settings.liveWeather}
                    onChange={(liveWeather) => patch({ liveWeather }, liveWeather ? 'Weather now follows Open-Meteo.' : 'Weather set manually.')}
                    disabled={!canEdit}
                    label="Live weather"
                    description="Use current conditions from Open-Meteo. Choosing a weather below switches this off."
                  />
                </div>
                <SettingRow label="Weather" description="Rain and fog lower speeds and saturation flow.">
                  <Segmented ariaLabel="Weather" value={settings.weather} onChange={(weather) => patch({ weather })} options={WEATHER_OPTIONS} size="sm" />
                </SettingRow>
                <SettingRow label="Traffic demand" description="Scales trip generation against the daily profile.">
                  <DemandSlider value={settings.demand} disabled={!canEdit} onCommit={(demand) => patch({ demand })} />
                </SettingRow>
                <div className="py-1">
                  <Toggle
                    checked={settings.randomIncidents}
                    onChange={(randomIncidents) => patch({ randomIncidents })}
                    disabled={!canEdit}
                    label="Random incidents"
                    description="Simulated lane-blocking accidents that clear after 15–40 minutes. Switched off automatically when live TomTom incidents are available."
                  />
                </div>
              </div>
            ) : (
              <SettingsSkeleton rows={4} label="Loading simulation settings…" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Control strategy" subtitle="How ASCENDRA acts on the network" icon={SlidersHorizontal} />
          <CardBody className="py-0">
            {settings ? (
              <div className="divide-y divide-line">
                <Toggle
                  checked={settings.adaptive}
                  onChange={(adaptive) => patch({ adaptive }, adaptive ? 'Adaptive control enabled.' : 'Fixed-time plans in effect.')}
                  disabled={!canEdit}
                  label="Adaptive signal control"
                  description="The reinforcement-learning agent times every adaptive junction, with forecast hotspots given extra green priority. Off means all signals run fixed-time plans."
                />
                <Toggle
                  checked={settings.emergencyPriority}
                  onChange={(emergencyPriority) => patch({ emergencyPriority }, emergencyPriority ? 'Emergency green waves enabled.' : 'Emergency priority switched off.')}
                  disabled={!canEdit}
                  label="Emergency vehicle priority"
                  description="Signals ahead of an emergency vehicle switch to its approach before it arrives, creating a green wave."
                />
                <Toggle
                  checked={settings.forecastRouting}
                  onChange={(forecastRouting) => patch({ forecastRouting })}
                  disabled={!canEdit}
                  label="Forecast-aware routing"
                  description="Route costs use the 15–30 minute congestion forecast for links the vehicle will reach later in its trip."
                />
              </div>
            ) : (
              <SettingsSkeleton rows={3} label="Loading control strategy…" />
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Live data sources" subtitle="Where every input comes from" icon={Radio} />
          <CardBody className="py-1">
            <LiveSources />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="System status" subtitle="Services behind the platform" icon={Server} />
          <CardBody className="py-1">
            {health ? (
              <div className="divide-y divide-line">
                <StatusLine
                  ok
                  icon={<Database className="size-4" />}
                  label="Database"
                  detail={health.database === 'postgres' ? 'PostgreSQL server (DATABASE_URL)' : 'In-memory PostgreSQL — data resets on restart. Set DATABASE_URL to persist.'}
                />
                <StatusLine
                  ok={health.forecaster}
                  icon={<Brain className="size-4" />}
                  label="Congestion forecaster"
                  detail={health.forecaster ? 'XGBoost model loaded, predicting 15 and 30 minutes ahead' : 'Not trained — run npm run train:forecaster'}
                />
                <StatusLine
                  ok={health.signalPolicy}
                  icon={<Cpu className="size-4" />}
                  label="Signal control policy"
                  detail={health.signalPolicy ? 'Q-learning policy loaded' : 'Not trained — falling back to queue pressure control'}
                />
                <StatusLine
                  ok={Boolean(health.junctionModel)}
                  icon={<Camera className="size-4" />}
                  label="Junction forecaster"
                  detail={health.junctionModel ? 'XGBoost trained on the Kaggle Traffic Prediction Dataset (real camera counts)' : 'Not trained — run npm run train:junction'}
                />
              </div>
            ) : (
              <SkeletonGroup label="Loading system status…" className="divide-y divide-line">
                {[...Array(3).keys()].map((i) => (
                  <div key={i} className="flex items-center gap-3 py-3">
                    <Skeleton className="size-9 rounded-xl" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="mt-2 h-3 w-64" />
                    </div>
                  </div>
                ))}
              </SkeletonGroup>
            )}
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Audit log" subtitle="Every change to signals, settings, registrations, reports and dispatches" icon={ScrollText} />
          {audit ? (
            <AuditTable entries={audit} />
          ) : (
            <SkeletonGroup label="Loading audit log…" className="divide-y divide-line">
              {[...Array(6).keys()].map((i) => (
                <div key={i} className="flex items-center gap-6 px-4 py-3.5">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-60" />
                </div>
              ))}
            </SkeletonGroup>
          )}
        </Card>
      </div>
    </div>
  );
}
