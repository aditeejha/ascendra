# ASCENDRA — Smart Traffic Intelligence & City Traffic Control

ASCENDRA is an adaptive traffic management platform. It forecasts congestion 15–30 minutes ahead, retimes signals with a reinforcement-learning agent, gives emergency vehicles green waves, routes each vehicle class differently, turns citizen reports into traffic-control actions and runs an evacuation mode. Everything runs on a live microscopic simulation of a city road network, so the effect of each decision can be seen and measured.

Project I (MO/26) · B.Tech Computer Science & Engineering, BIT Deoghar
Team: Aditee Jha (B.Tech/60078/24), Sumedha Dubey (B.Tech/60077/24) · Guide: Dr. Praveen Kumar Sharma

## Results (simulation)

Same demand and random seeds for both controllers, 3 seeds × 60 min per scenario after a 30 min warm-up (`npm run evaluate`).

| Scenario | Delay per trip (fixed → ASCENDRA) | Avg queue | Ambulance trip |
|---|---|---|---|
| Morning peak | 1.41 → 1.04 min (−26%) | 187 → 118 | 3.90 → 2.76 min |
| Evening peak | 1.36 → 1.14 min (−16%) | 183 → 139 | 4.40 → 2.84 min |
| Heavy rain | 2.93 → 2.38 min (−19%) | 209 → 125 | 5.00 → 4.07 min |
| Accidents on arterials | 1.74 → 1.16 min (−33%) | 226 → 127 | 4.32 → 2.82 min |

- Emergency vehicles reach their destination 29% faster on average with the green wave (4.41 → 3.12 min).
- The congestion forecaster beats a persistence baseline (assume nothing changes) on held-out days, as the table below shows.

| Horizon | MAE (model) | MAE (persistence) | MAE on busy links (model / persistence) | Level accuracy (model / persistence) |
|---|---|---|---|---|
| +15 min | 0.068 | 0.089 | 0.130 / 0.191 | 90.4% / 86.4% |
| +30 min | 0.068 | 0.091 | 0.129 / 0.196 | 90.3% / 86.2% |

- The Q-learning signal agent cuts delay by about 25% against fixed-time plans. It performs on par with a max-pressure heuristic (1.008 vs 1.013 min per trip), which it also uses as a fallback in traffic states it has not learned.

These figures come from the simulator, not from real city data.

## Features

| Feature | Where |
|---|---|
| 15–30 min congestion prediction (XGBoost) with confidence | Dashboard, Live Map, Analytics |
| Dynamic signal control: RL agent, safety layer (yellow, all-red, minimum/maximum green), manual fixed plans | Traffic Signals |
| Proactive interventions: forecast hotspots raise downstream green priority and reroute connected vehicles | Dashboard |
| Emergency green waves with authority-verified vehicles | Emergency Vehicles |
| Vehicle registration by class (private, two-wheeler, cargo, emergency) | Vehicle Registry |
| Class-aware routing: freight corridor on the Ring Road, peak-hour core restriction, weight limits, lane filtering | Routing & Freight |
| Evacuation mode: inbound closures, contraflow exit corridors, evacuation signal timing | Evacuation Mode |
| Civic reports that feed into routing and signals once verified | Civic Reports |
| Overspeed detection from speed cameras and e-challans | Overspeeding |
| Simulation evaluation vs fixed-time baselines, live forecast accuracy | Reports & Analytics |
| Role-based views, audit log | Role switcher in the top bar, Settings |

Roles: Traffic Controller, Traffic Authority, Emergency Driver, Driver / Owner, Citizen. Switch between them from the top bar.

## Architecture

```
 React + Vite client  ──REST + Server-Sent Events──▶  Node.js / Express API
  (white & navy UI)                                      │
                                                         ├─ Simulation engine (1 s ticks, 35 junctions, 116 links)
                                                         │    signals · vehicles · incidents · evacuation
                                                         ├─ RL signal policy (Q-table, server/models/signal-policy.json)
                                                         ├─ XGBoost forecaster (trees evaluated natively, server/models/forecaster.json)
                                                         └─ PostgreSQL (registry, civic reports, alerts, dispatches, audit log)

 Python ML pipeline (ml/)  ──trains on simulated history──▶  server/models/forecaster.json
```

- **Simulation:** a 5 × 7 grid city with a ring road, arterials, streets, narrow old-town lanes and a weight-limited bridge. Vehicles drive on the left, queue at stop lines and discharge at saturation flow. Rush-hour demand is directional, and weather changes speeds and saturation flow.
- **Forecaster:** XGBoost regression on 20 features: current and lagged congestion, inflow, queue, upstream and downstream state, time of day, weather, incidents and vehicle mix. The trained trees are exported to JSON and evaluated in Node with float32 split comparisons, so predictions match XGBoost exactly.
- **Signal agent:** tabular Q-learning shared across junctions. The state covers queues on green and red approaches, arrivals, green time and downstream occupancy. The reward is network-level: local queue plus downstream queue. A safety layer enforces yellow and all-red intervals and minimum and maximum greens.

## Getting started

Requirements: Node.js 20+ (Python 3.10+ only if you want to retrain the forecaster).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:4000. Without a `DATABASE_URL` the server uses an in-memory PostgreSQL, so nothing else needs installing.

### Using a real PostgreSQL

```bash
docker compose up -d
cp .env.example .env
npm run dev
```

The schema in `db/schema.sql` is applied on start-up and demo data is seeded on the first run.

### Production build

```bash
npm run build
npm start
```

`npm start` serves the built client and the API from http://localhost:4000.

## Training and evaluation

The trained models are committed, so this is only needed to reproduce them.

```bash
npm run train:rl                              # Q-learning signal agent  -> server/models/signal-policy.json
npm run sim:history                           # 14 simulated days of link history -> ml/data/link_history.csv
pip install -r ml/requirements.txt
npm run train:forecaster                      # XGBoost forecaster -> server/models/forecaster.json
npm run evaluate                              # ASCENDRA vs fixed-time -> server/models/evaluation.json
```

The forecaster is trained on days 1–10, early-stopped on days 11–12 and reported on held-out days 13–14. Metrics and feature importance are written to `ml/reports/forecaster_metrics.json`.

## Tests

```bash
npm test          # simulator, routing, forecaster parity and API tests
npm run typecheck
```

## Project structure

```
client/          React app (pages, city map, UI components)
server/          Express API, simulation engine, models, database layer
  sim/           network, engine, routing, RL policy, forecaster runtime, evaluation
  models/        trained signal policy, forecaster and evaluation results
shared/          types shared by client and server
ml/              XGBoost training pipeline and reports
scripts/         RL training, history generation, evaluation
db/              PostgreSQL schema
tests/           Vitest suites
```

## Limitations and future work

- The road network and demand are simulated; real-time city or government data feeds are future work.
- The signal model has two phases per junction and no turning conflicts.
- Future work: V2X (DSRC / C-V2X) so vehicles and signals talk directly, weather-aware signal timing, and better model accuracy with real data.
