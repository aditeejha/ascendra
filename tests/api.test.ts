import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../server/app';
import { connectDb } from '../server/db';
import { Repo } from '../server/repo';
import { Simulation } from '../server/sim/engine';
import { buildNetwork } from '../server/sim/network';

let server: Server;
let base: string;
let ctx: AppContext;

async function call(path: string, role: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const net = buildNetwork();
  const repo = new Repo(await connectDb(''));
  await repo.seed();
  const sim = new Simulation(net, { seed: 1, startT: 8 * 3600 });
  sim.run(300);
  const counters = { openCivic: 0, openAlerts: 0, pendingVerification: 0 };
  ctx = {
    net,
    sim,
    repo,
    policy: null,
    forecaster: null,
    evaluation: { result: null, running: false, done: 0, total: 0 },
    civicIncidents: new Map(),
    counters,
    refreshCounters: async () => {
      Object.assign(counters, await repo.counters());
    },
    clients: new Set<Response>(),
  };
  server = createApp(ctx).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe('API', () => {
  it('serves the network and a live snapshot', async () => {
    const network = await call('/network', 'citizen');
    expect(network.body.nodes).toHaveLength(35);
    const state = await call('/state', 'citizen');
    expect(state.body.vehicles.length).toBeGreaterThan(0);
  });

  it('only lets controllers change signal plans', async () => {
    expect((await call('/signals/3', 'citizen', 'PATCH', { mode: 'fixed' })).status).toBe(403);
    const ok = await call('/signals/3', 'controller', 'PATCH', { mode: 'fixed', greenNS: 40 });
    expect(ok.status).toBe(200);
    expect(ok.body.plan.greenNS).toBe(40);
  });

  it('validates vehicle registrations and holds emergency vehicles for verification', async () => {
    expect((await call('/vehicles', 'driver', 'POST', { plate: 'nope', vehicleClass: 'private', ownerName: 'Test' })).status).toBe(400);
    const amb = await call('/vehicles', 'emergency', 'POST', { plate: 'JH 15 AM 9001', vehicleClass: 'emergency', ownerName: 'Test Hospital', agency: 'Ambulance' });
    expect(amb.status).toBe(201);
    expect(amb.body.status).toBe('pending_verification');
    const blocked = await call('/emergency/dispatch', 'controller', 'POST', { vehicleId: amb.body.id, from: 24, to: 6 });
    expect(blocked.status).toBe(403);
    expect((await call(`/vehicles/${amb.body.id}`, 'authority', 'PATCH', { status: 'verified' })).status).toBe(200);
    const dispatch = await call('/emergency/dispatch', 'controller', 'POST', { vehicleId: amb.body.id, from: 24, to: 6 });
    expect(dispatch.status).toBe(201);
    expect(dispatch.body.plan.feasible).toBe(true);
  });

  it('feeds verified civic reports into traffic control and clears them on resolve', async () => {
    const created = await call('/civic', 'citizen', 'POST', {
      category: 'road_blockage',
      description: 'Fallen tree across the road',
      linkId: 20,
      severity: 'high',
      reporterName: 'Resident',
    });
    expect(created.status).toBe(201);
    const verified = await call(`/civic/${created.body.id}`, 'controller', 'PATCH', { status: 'verified' });
    expect(verified.body.impactApplied).toBe(true);
    expect(ctx.sim.snapshot().linkFlags[20] & 2).toBe(2);
    const resolved = await call(`/civic/${created.body.id}`, 'authority', 'PATCH', { status: 'resolved' });
    expect(resolved.body.impactApplied).toBe(false);
    expect(ctx.sim.snapshot().linkFlags[20] & 2).toBe(0);
  });

  it('writes an audit trail for controller actions', async () => {
    const audit = await call('/audit', 'controller');
    expect(audit.body.length).toBeGreaterThan(0);
    expect((await call('/audit', 'citizen')).status).toBe(403);
  });
});
