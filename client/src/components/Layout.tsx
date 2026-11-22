import clsx from 'clsx';
import {
  Ambulance,
  Car,
  ChartColumn,
  CloudFog,
  CloudRain,
  CloudRainWind,
  Gauge,
  LayoutDashboard,
  Map,
  Menu,
  MessageSquareExclamationPoint,
  Route,
  Settings,
  Siren,
  Sun,
  TrafficCone,
  Upload,
  UserRoundCheck,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { WEATHER_LABEL, type Role, type Weather } from '../../../shared/types';
import { timezoneAbbr, useLive } from '../lib/live';
import { ROLE_META, useRole, type NavKey } from '../lib/role';
import { Logo } from './Logo';

interface NavItem {
  key: NavKey;
  to: string;
  label: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { key: 'dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { key: 'map', to: '/map', label: 'Live Map', icon: Map },
      { key: 'signals', to: '/signals', label: 'Traffic Signals', icon: TrafficCone },
      { key: 'emergency', to: '/emergency', label: 'Emergency Vehicles', icon: Ambulance },
      { key: 'evacuation', to: '/evacuation', label: 'Evacuation Mode', icon: Siren },
    ],
  },
  {
    title: 'Mobility',
    items: [
      { key: 'routes', to: '/routes', label: 'Routing & Freight', icon: Route },
      { key: 'vehicles', to: '/vehicles', label: 'Vehicle Registry', icon: Car },
    ],
  },
  {
    title: 'Enforcement & Civic',
    items: [
      { key: 'civic', to: '/civic', label: 'Civic Reports', icon: MessageSquareExclamationPoint },
      { key: 'alerts', to: '/alerts', label: 'Overspeeding', icon: Gauge },
      { key: 'authority', to: '/authority', label: 'Authority Desk', icon: UserRoundCheck },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'analytics', to: '/analytics', label: 'Reports & Analytics', icon: ChartColumn },
      { key: 'replay', to: '/replay', label: 'Data Replay', icon: Upload },
      { key: 'settings', to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const WEATHER_ICON: Record<Weather, LucideIcon> = { clear: Sun, rain: CloudRain, heavy_rain: CloudRainWind, fog: CloudFog };

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { role, can } = useRole();
  const { snap } = useLive();
  const counters = snap?.counters;
  const badges: Partial<Record<NavKey, number>> = {
    civic: counters?.openCivic,
    alerts: counters?.openAlerts,
    vehicles: role === 'authority' || role === 'controller' ? counters?.pendingVerification : undefined,
    emergency: snap?.kpis.emergencyEnRoute,
  };
  const meta = ROLE_META[role];
  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="px-5 pt-6 pb-5">
        <Logo />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => can(i.key));
          if (!items.length) return null;
          return (
            <div key={group.title}>
              <p className="px-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-navy-300/80 uppercase">{group.title}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const badge = badges[item.key];
                  return (
                    <li key={item.key}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          clsx(
                            'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors',
                            isActive ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-100/85 hover:bg-white/8 hover:text-white',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <item.icon className={clsx('size-[18px]', isActive ? 'text-brand-600' : 'text-navy-300 group-hover:text-white')} />
                            <span className="flex-1">{item.label}</span>
                            {badge ? (
                              <span
                                className={clsx(
                                  'tabular min-w-5 rounded-full px-1.5 py-px text-center text-[11px] font-semibold',
                                  isActive ? 'bg-brand-600 text-white' : 'bg-white/12 text-white',
                                )}
                              >
                                {badge > 99 ? '99+' : badge}
                              </span>
                            ) : null}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl bg-white/6 p-3 ring-1 ring-white/10">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {meta.label
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-white">{meta.person}</p>
            <p className="truncate text-[11.5px] text-navy-300">{meta.label}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { snap, connected, live } = useLive();
  const { role, setRole } = useRole();
  const WeatherIcon = snap ? WEATHER_ICON[snap.weather] : Sun;
  const reading = live?.weather.mode === 'live' ? live.weather.reading : null;
  const tz = live ? timezoneAbbr(live.city.timezone) : '';
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
      <button className="grid size-9 place-items-center rounded-lg text-navy-700 hover:bg-navy-50 lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="hidden items-baseline gap-2 sm:flex">
          {live && <span className="text-sm font-semibold text-navy-900">{live.city.name}</span>}
          <span className="tabular text-xl font-semibold tracking-tight text-navy-900">{snap?.clock ?? '--:--'}</span>
          <span className="text-[13px] text-muted">
            {snap?.day ?? ''}
            {snap?.liveClock && tz ? ` · ${tz}` : ''}
          </span>
        </div>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
            !connected ? 'bg-red-50 text-red-700 ring-red-200' : snap?.paused ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-green-50 text-green-700 ring-green-200',
          )}
        >
          <span className={clsx('size-1.5 rounded-full', !connected ? 'bg-jam' : snap?.paused ? 'bg-moderate' : 'animate-pulse bg-free')} />
          {!connected ? 'Reconnecting' : snap?.paused ? 'Paused' : snap?.liveClock ? 'Live' : `Fast-forward · ${snap?.speed ?? 1}×`}
        </span>
        {snap && (
          <span
            className="hidden items-center gap-1.5 rounded-full bg-navy-50 px-2.5 py-1 text-xs font-medium text-navy-700 ring-1 ring-line ring-inset md:inline-flex"
            title={reading ? `Live weather from Open-Meteo, updated ${new Date(reading.fetchedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Weather set manually in Settings'}
          >
            <WeatherIcon className="size-3.5" />
            {reading ? `${Math.round(reading.temperatureC)}°C · ${reading.description}` : `${WEATHER_LABEL[snap.weather]} (manual)`}
          </span>
        )}
        {snap && (
          <span
            className={clsx(
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset md:inline-flex',
              snap.adaptive ? 'bg-brand-50 text-brand-700 ring-brand-100' : 'bg-navy-50 text-muted ring-line',
            )}
          >
            {snap.adaptive ? 'Adaptive control' : 'Fixed-time control'}
          </span>
        )}
        {live && (
          <span
            className={clsx(
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset xl:inline-flex',
              live.traffic.status === 'ok' ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-navy-50 text-muted ring-line',
            )}
            title={live.traffic.error ?? (live.traffic.configured ? 'Live speeds and incidents from TomTom' : 'Add TOMTOM_API_KEY to .env for live traffic')}
          >
            {live.traffic.status === 'ok' ? 'Live traffic · TomTom' : live.traffic.configured ? 'TomTom connecting' : 'Simulated traffic'}
          </span>
        )}
        {snap?.evacuation && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
            <Siren className="size-3.5" /> Evacuation active
          </span>
        )}
      </div>
      <label className="flex items-center gap-2">
        <span className="hidden text-xs font-medium text-muted sm:inline">Viewing as</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] font-medium text-navy-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none"
          aria-label="Switch role"
        >
          {(Object.keys(ROLE_META) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_META[r].label}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button className="absolute top-5 right-3 grid size-8 place-items-center rounded-lg text-white hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <Topbar onMenu={() => setOpen(true)} />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <footer className="border-t border-line px-6 py-4 text-center text-xs text-subtle">
          ASCENDRA · Smart Traffic Intelligence & City Traffic Control · Simulation prototype, figures come from the live traffic model
        </footer>
      </div>
    </div>
  );
}
