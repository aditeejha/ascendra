import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../server/app';
import { Replay } from '../server/live/replay';
import { connectDb } from '../server/db';
import { Repo } from '../server/repo';
import { Simulation } from '../server/sim/engine';
import type { LiveStatus } from '../shared/types';
import { loadJunctionModel } from '../server/sim/models';
import { buildNetwork, distanceM } from '../server/sim/network';

let server: Server;
let base: string;
let ctx: AppContext;
const net = buildNetwork();
const junction = loadJunctionModel();
const signalNode = net.nodes.find((n) => n.signal)!.id;
const hospital = net.stations[0];
const destination = net.nodes.find((n) => distanceM(net, hospital, n.id) > 1500)!.id;
const twoWay = net.links.find((l) => l.kind === 'arterial' && l.reverse >= 0)!.id;

async function call(path: string, role: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const repo = new Repo(await connectDb(''));
  await repo.seed({ city: 'Test City', platePrefix: 'JH 15', outOfStatePlate: 'BR 01', hospitals: ['Test Hospital'], reportLinks: [twoWay] });
  const sim = new Simulation(net, { seed: 1, startT: 8 * 3600 });
  sim.run(300);
  const counters = { openCivic: 0, openAlerts: 0, pendingVerification: 0 };
  ctx = {
    net,
    sim,
    repo,
    policy: null,
    forecaster: null,
    junctionModel: null,
    evaluation: { result: null, running: false, done: 0, total: 0 },
    civicIncidents: new Map(),
    counters,
    refreshCounters: async () => {
      Object.assign(counters, await repo.counters());
    },
    clients: new Set<Response>(),
    frame: () => ({ ...ctx.sim.snapshot(), counters }),
    liveStatus: () => ({ city: { name: 'Test City' }, traffic: { status: 'no_key' }, weather: { mode: 'manual' } }) as LiveStatus,
    resync: async () => {},
    applyLiveWeather: () => {},
    replay: new Replay(() => junction),
    startReplay: async () => {},
    stopReplay: async () => {},
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
    expect(network.body.nodes.length).toBe(net.nodes.length);
    expect(network.body.meta.source).toContain('OpenStreetMap');
    const state = await call('/state', 'citizen');
    expect(state.body.vehicles.length).toBeGreaterThan(0);
  });

  it('only lets controllers change signal plans', async () => {
    expect((await call(`/signals/${signalNode}`, 'citizen', 'PATCH', { mode: 'fixed' })).status).toBe(403);
    const ok = await call(`/signals/${signalNode}`, 'controller', 'PATCH', { mode: 'fixed', greenNS: 40 });
    expect(ok.status).toBe(200);
    expect(ok.body.plan.greenNS).toBe(40);
  });

  it('validates vehicle registrations and holds emergency vehicles for verification', async () => {
    expect((await call('/vehicles', 'driver', 'POST', { plate: 'nope', vehicleClass: 'private', ownerName: 'Test' })).status).toBe(400);
    const amb = await call('/vehicles', 'emergency', 'POST', { plate: 'JH 15 AM 9001', vehicleClass: 'emergency', ownerName: 'Test Hospital', agency: 'Ambulance' });
    expect(amb.status).toBe(201);
    expect(amb.body.status).toBe('pending_verification');
    const blocked = await call('/emergency/dispatch', 'controller', 'POST', { vehicleId: amb.body.id, from: hospital, to: destination });
    expect(blocked.status).toBe(403);
    expect((await call(`/vehicles/${amb.body.id}`, 'authority', 'PATCH', { status: 'verified' })).status).toBe(200);
    const dispatch = await call('/emergency/dispatch', 'controller', 'POST', { vehicleId: amb.body.id, from: hospital, to: destination });
    expect(dispatch.status).toBe(201);
    expect(dispatch.body.plan.feasible).toBe(true);
  });

  it('feeds verified civic reports into traffic control and clears them on resolve', async () => {
    const created = await call('/civic', 'citizen', 'POST', {
      category: 'road_blockage',
      description: 'Fallen tree across the road',
      linkId: twoWay,
      severity: 'high',
      reporterName: 'Resident',
    });
    expect(created.status).toBe(201);
    const verified = await call(`/civic/${created.body.id}`, 'controller', 'PATCH', { status: 'verified' });
    expect(verified.body.impactApplied).toBe(true);
    expect(ctx.sim.snapshot().linkFlags[twoWay] & 2).toBe(2);
    const resolved = await call(`/civic/${created.body.id}`, 'authority', 'PATCH', { status: 'resolved' });
    expect(resolved.body.impactApplied).toBe(false);
    expect(ctx.sim.snapshot().linkFlags[twoWay] & 2).toBe(0);
  });

  it('writes an audit trail for controller actions', async () => {
    const audit = await call('/audit', 'controller');
    expect(audit.body.length).toBeGreaterThan(0);
    expect((await call('/audit', 'citizen')).status).toBe(403);
  });
});

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('civic case workflow', () => {
  it('takes a photo report from citizen to confirmed fix, with a full timeline', async () => {
    const pothole = net.links.find((l) => l.kind === 'street' && l.reverse >= 0)!.id;
    const created = await call('/civic', 'citizen', 'POST', {
      category: 'pothole',
      description: 'Deep pothole near the temple gate',
      linkId: pothole,
      severity: 'high',
      reporterName: 'Asha',
      reporterPhone: '9876543210',
      photo: PIXEL,
    });
    expect(created.status).toBe(201);
    expect(created.body.hasPhoto).toBe(true);
    expect(created.body.dueAt).not.toBeNull();
    const id = created.body.id;

    const photo = await fetch(`${base}/api/civic/${id}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');

    expect((await call(`/civic/${id}`, 'citizen', 'PATCH', { action: 'verify' })).status).toBe(403);
    expect((await call(`/civic/${id}`, 'citizen', 'PATCH', { action: 'close' })).status).toBe(409);
    expect((await call(`/civic/${id}`, 'authority', 'PATCH', { action: 'verify' })).body.status).toBe('verified');
    expect((await call(`/civic/${id}`, 'authority', 'PATCH', { action: 'assign' })).status).toBe(400);
    const assigned = await call(`/civic/${id}`, 'authority', 'PATCH', { action: 'assign', assignee: 'PWD Road Crew 3' });
    expect(assigned.body).toMatchObject({ status: 'assigned', assignedTo: 'PWD Road Crew 3', impactApplied: true });
    expect((await call(`/civic/${id}`, 'authority', 'PATCH', { action: 'start' })).body.status).toBe('in_progress');
    const fixed = await call(`/civic/${id}`, 'authority', 'PATCH', { action: 'resolve', note: 'Filled and levelled', photo: PIXEL });
    expect(fixed.body).toMatchObject({ status: 'resolved', resolutionNote: 'Filled and levelled', hasResolutionPhoto: true, impactApplied: false });
    expect((await call(`/civic/${id}`, 'citizen', 'PATCH', { action: 'reopen' })).status).toBe(400);
    const closed = await call(`/civic/${id}`, 'citizen', 'PATCH', { action: 'close', rating: 5 });
    expect(closed.body).toMatchObject({ status: 'closed', rating: 5 });

    const events = await call(`/civic/${id}/events`, 'citizen');
    expect(events.body.map((e: { status: string }) => e.status)).toEqual(['reported', 'verified', 'assigned', 'in_progress', 'resolved', 'closed']);
    expect(events.body.find((e: { status: string }) => e.status === 'resolved').hasPhoto).toBe(true);

    const asCitizen = await call('/civic', 'citizen');
    expect(asCitizen.body.find((r: { id: number }) => r.id === id).reporterPhone).toBeNull();
    const asAuthority = await call('/civic', 'authority');
    expect(asAuthority.body.find((r: { id: number }) => r.id === id).reporterPhone).toBe('9876543210');
  });
});

describe('citizen registration', () => {
  it('stores the owner photo and details and shows them only to the authority', async () => {
    const created = await call('/vehicles', 'citizen', 'POST', {
      plate: 'JH 15 CZ 4242',
      vehicleClass: 'two_wheeler',
      ownerName: 'Ravi Kumar',
      phone: '9431012345',
      email: 'ravi@example.com',
      address: 'Castair Town, Deoghar',
      licenceNo: 'jh15 2020 0012345',
      ownerPhoto: PIXEL,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ hasPhoto: true, licenceNo: 'JH15 2020 0012345', status: 'active' });
    expect((await call('/vehicles', 'citizen', 'POST', { plate: 'JH 15 CZ 4243', vehicleClass: 'private', ownerName: 'X Y', ownerPhoto: 'data:text/plain;base64,aGk=' })).status).toBe(400);

    const asCitizen = (await call('/vehicles', 'citizen')).body.find((v: { id: number }) => v.id === created.body.id);
    expect(asCitizen).toMatchObject({ email: null, address: null, licenceNo: null });
    expect(asCitizen.phone).not.toBe('9431012345');
    const asAuthority = (await call('/vehicles', 'authority')).body.find((v: { id: number }) => v.id === created.body.id);
    expect(asAuthority).toMatchObject({ phone: '9431012345', email: 'ravi@example.com', address: 'Castair Town, Deoghar' });

    expect((await fetch(`${base}/api/vehicles/${created.body.id}/photo?role=citizen`)).status).toBe(403);
    const photo = await fetch(`${base}/api/vehicles/${created.body.id}/photo?role=authority`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
  });
});

describe('dataset predictions', () => {
  it('predicts every row of an uploaded file, pages the results and serves them as CSV', async () => {
    expect((await call('/replay/predictions', 'controller')).status).toBe(404);
    const rows = Array.from({ length: 8 }, (_, i) => `${8 + Math.floor(i / 4)}:${String((i % 4) * 15).padStart(2, '0')},${100 + i * 10}`);
    const csv = ['Time,Total', ...rows].join('\n');
    expect((await call('/replay/dataset', 'citizen', 'POST', { name: 'counts.csv', csv })).status).toBe(403);
    expect((await call('/replay/dataset', 'controller', 'POST', { name: 'counts.csv', csv })).status).toBe(201);

    const page = await call('/replay/predictions?offset=2&limit=3', 'controller');
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ dataset: 'counts.csv', rows: 8, situation15: null });
    expect(page.body.count15.n).toBe(7);
    expect(page.body.page.rows.map((r: { row: number }) => r.row)).toEqual([3, 4, 5]);
    expect(page.body.page.rows[0].actual15).toBe(130);
    expect((await call('/replay/predictions?limit=500', 'controller')).status).toBe(400);

    const file = await fetch(`${base}/api/replay/predictions.csv?role=authority`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('text/csv');
    expect(file.headers.get('content-disposition')).toContain('counts-predictions.csv');
    expect((await file.text()).trim().split('\n')).toHaveLength(9);
  });
});
