import { StrictMode, Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Restricted, Skeleton, SkeletonGroup } from './components/ui';
import { LiveProvider } from './lib/live';
import { ROLE_META, RoleProvider, useRole, type NavKey } from './lib/role';
import { ToastProvider } from './lib/toast';
import './styles.css';

function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}

const DashboardPage = page(() => import('./pages/Dashboard'), 'DashboardPage');
const LiveMapPage = page(() => import('./pages/LiveMap'), 'LiveMapPage');
const SignalsPage = page(() => import('./pages/Signals'), 'SignalsPage');
const EmergencyPage = page(() => import('./pages/Emergency'), 'EmergencyPage');
const EvacuationPage = page(() => import('./pages/Evacuation'), 'EvacuationPage');
const RoutingPage = page(() => import('./pages/Routing'), 'RoutingPage');
const VehiclesPage = page(() => import('./pages/Vehicles'), 'VehiclesPage');
const CivicPage = page(() => import('./pages/Civic'), 'CivicPage');
const AlertsPage = page(() => import('./pages/Alerts'), 'AlertsPage');
const AnalyticsPage = page(() => import('./pages/Analytics'), 'AnalyticsPage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');

function PageFallback() {
  return (
    <SkeletonGroup label="Loading page">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-[min(520px,100%)]" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (item, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-96 rounded-2xl" />
    </SkeletonGroup>
  );
}

function Guard({ nav, what, children }: { nav: NavKey; what: string; children: ReactNode }) {
  const { can } = useRole();
  return <Suspense fallback={<PageFallback />}>{can(nav) ? children : <Restricted what={what} />}</Suspense>;
}

function Home() {
  const { role, can } = useRole();
  if (!can('dashboard')) return <Navigate to={ROLE_META[role].home} replace />;
  return (
    <Suspense fallback={<PageFallback />}>
      <DashboardPage />
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RoleProvider>
      <LiveProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="map" element={<Guard nav="map" what="The live map"><LiveMapPage /></Guard>} />
                <Route path="signals" element={<Guard nav="signals" what="Signal control"><SignalsPage /></Guard>} />
                <Route path="emergency" element={<Guard nav="emergency" what="Emergency priority"><EmergencyPage /></Guard>} />
                <Route path="evacuation" element={<Guard nav="evacuation" what="Evacuation mode"><EvacuationPage /></Guard>} />
                <Route path="routes" element={<Guard nav="routes" what="Route planning"><RoutingPage /></Guard>} />
                <Route path="vehicles" element={<Guard nav="vehicles" what="The vehicle registry"><VehiclesPage /></Guard>} />
                <Route path="civic" element={<Guard nav="civic" what="Civic reports"><CivicPage /></Guard>} />
                <Route path="alerts" element={<Guard nav="alerts" what="Overspeeding alerts"><AlertsPage /></Guard>} />
                <Route path="analytics" element={<Guard nav="analytics" what="Reports & analytics"><AnalyticsPage /></Guard>} />
                <Route path="settings" element={<Guard nav="settings" what="Settings"><SettingsPage /></Guard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </LiveProvider>
    </RoleProvider>
  </StrictMode>,
);
