import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { NetworkInfo, Snapshot } from '../../../shared/types';
import { api } from './api';

interface LiveValue {
  network: NetworkInfo | null;
  snap: Snapshot | null;
  connected: boolean;
}

const LiveContext = createContext<LiveValue>({ network: null, snap: null, connected: false });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);

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
    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e) => {
      setSnap(JSON.parse(e.data) as Snapshot);
      setConnected(true);
    };
    return () => source.close();
  }, []);

  return <LiveContext.Provider value={{ network, snap, connected }}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  return useContext(LiveContext);
}
