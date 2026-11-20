import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Role } from '../../../shared/types';
import { setApiRole } from './api';

export type NavKey =
  | 'dashboard'
  | 'map'
  | 'signals'
  | 'emergency'
  | 'routes'
  | 'vehicles'
  | 'civic'
  | 'alerts'
  | 'evacuation'
  | 'analytics'
  | 'settings';

export const ROLE_META: Record<Role, { label: string; person: string; description: string; nav: NavKey[]; home: string }> = {
  controller: {
    label: 'Traffic Controller',
    person: 'City Traffic Control Room',
    description: 'Monitors the network, manages signals, emergencies and evacuation.',
    nav: ['dashboard', 'map', 'signals', 'emergency', 'routes', 'vehicles', 'civic', 'alerts', 'evacuation', 'analytics', 'settings'],
    home: '/',
  },
  authority: {
    label: 'Traffic Authority',
    person: 'Traffic Police HQ',
    description: 'Verifies emergency vehicles, acts on overspeeding and civic issues.',
    nav: ['dashboard', 'map', 'alerts', 'vehicles', 'civic', 'analytics'],
    home: '/',
  },
  emergency: {
    label: 'Emergency Driver',
    person: 'Ambulance Crew',
    description: 'Requests green-wave priority and follows the clear path.',
    nav: ['emergency', 'map', 'routes'],
    home: '/emergency',
  },
  driver: {
    label: 'Driver / Owner',
    person: 'Registered Driver',
    description: 'Registers vehicles and gets class-aware routes.',
    nav: ['routes', 'vehicles', 'map', 'civic'],
    home: '/routes',
  },
  citizen: {
    label: 'Citizen',
    person: 'Resident',
    description: 'Reports civic issues and tracks their status.',
    nav: ['civic', 'map', 'routes'],
    home: '/civic',
  },
};

const STORAGE_KEY = 'ascendra.role';

function initialRole(): Role {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Role | null;
    if (stored && stored in ROLE_META) return stored;
  } catch {
    return 'controller';
  }
  return 'controller';
}

const RoleContext = createContext<{ role: Role; setRole: (r: Role) => void; can: (key: NavKey) => boolean }>({
  role: 'controller',
  setRole: () => {},
  can: () => true,
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    const r = initialRole();
    setApiRole(r);
    return r;
  });
  const setRole = (r: Role) => {
    setApiRole(r);
    setRoleState(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {
      return;
    }
  };
  const can = (key: NavKey) => ROLE_META[role].nav.includes(key);
  return <RoleContext.Provider value={{ role, setRole, can }}>{children}</RoleContext.Provider>;
}

export function useRole() {
  return useContext(RoleContext);
}
