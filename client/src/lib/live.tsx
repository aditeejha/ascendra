import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LiveStatus, NetworkInfo, Snapshot } from '../../../shared/types';
import { api } from './api';

interface LiveValue {
  network: NetworkInfo | null;
  snap: Snapshot | null;
  connected: boolean;
  live: LiveStatus | null;
  refreshLive: () => void;
}

const LiveContext = createContext<LiveValue>({ network: null, snap: null, connected: false, live: null, refreshLive: () => {} });

export function timezoneAbbr(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? timezone;
  } catch {
    return timezone;
  }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<NetworkInfo>('/network')
        .then((n) => !cancelled && setNetwork(n))
        .catch(() => !cancelled && setTimeout(load, 2000));
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<LiveStatus>('/live')
        .then((s) => !cancelled && setLive(s))
        .catch(() => undefined);
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tick]);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      setSnap(JSON.parse(e.data) as Snapshot);
      setConnected(true);
    };
    return () => source.close();
  }, []);

  return <LiveContext.Provider value={{ network, snap, connected, live, refreshLive: () => setTick((t) => t + 1) }}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  return useContext(LiveContext);
}
