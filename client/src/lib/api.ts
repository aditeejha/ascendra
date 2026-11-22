import type { Role } from '../../../shared/types';

let currentRole: Role = 'controller';

export function setApiRole(role: Role): void {
  currentRole = role;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'x-role': currentRole },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export function withRole(path: string): string {
  return `/api${path}${path.includes('?') ? '&' : '?'}role=${currentRole}`;
}
