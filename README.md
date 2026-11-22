# ASCENDRA — Smart Traffic Intelligence & City Traffic Control

ASCENDRA is an adaptive traffic management platform for an Indian city, set up for **Deoghar, Jharkhand**. It runs on the real Deoghar road network from OpenStreetMap, follows the live Indian clock and live weather, and can take live traffic from TomTom. On top of that it forecasts congestion 15 and 30 minutes ahead, retimes signals with a reinforcement-learning agent, opens green corridors for ambulances, routes each vehicle class differently, runs a civic-issue workflow between citizens and the authority, and reroutes traffic around a disaster zone. Any traffic-count CSV can be uploaded and replayed so every feature responds to that dataset.

Project I (MO/26) · B.Tech Computer Science & Engineering, BIT Deoghar
Team: Aditee Jha (B.Tech/60078/24), Sumedha Dubey (B.Tech/60077/24) · Guide: Dr. Praveen Kumar Sharma

## What is real and what is simulated

| Part | Source |
|---|---|
| Road network | Real: OpenStreetMap, 3.5 km around Deoghar centre. 1,344 junctions, 4,148 directed road links, 22 bridge links, 7 city exits, 25 hospitals, 2 railway stations |
| Clock | Real: Indian Standard Time. Weekly off (Sunday), freight ban hours (08–11, 17–20) and number-plate prefix (JH 15) come from `config/city.json` |
| Weather | Real: Open-Meteo, refreshed every 15 minutes. Rain, heavy rain and fog slow traffic in the simulation |
| Live traffic | Real when a TomTom key is set: measured speeds on 20 roads every 15 minutes and live incidents every 10 minutes. They calibrate the simulated demand and score the forecasts |
| Junction forecaster | Trained on real counts from the Kaggle *Traffic Prediction Dataset* (5,952 rows of 15-minute counts) |
| Vehicles and queues | Simulated: a microscopic simulation runs on the real network, so decisions can be tested and measured |
| Signals | Inferred: OpenStreetMap does not record Deoghar's signals, so 28 are placed at the busiest main-road junctions. The rest run as give-way junctions |
| Per-road forecaster and signal agent | Trained on simulated Deoghar traffic |

Without a TomTom key the traffic itself is simulated, and the top bar says so.

## Results

All traffic figures come from the simulation running on the real Deoghar road network, so they show how the methods compare under the same demand, not measurements from Deoghar's streets.

### Fixed-time signals vs ASCENDRA

`npm run evaluate`: 3 random seeds per scenario, one simulated hour each after a 30-minute warm-up, with 6 ambulance dispatches per run. *Fixed* is fixed-time signal plans with no forecasting and no ambulance priority. *ASCENDRA* is the signal agent, forecast-aware routing and the ambulance green corridor together.

| Scenario | Delay per trip | Travel time per trip | Vehicles queued (average) | Ambulance trip |
|---|---|---|---|---|
| Morning peak, 08:00–09:00 | 2.70 → 2.07 min (23% less) | 8.60 → 7.90 min | 121 → 62 | 5.55 → 4.98 min |
| Evening peak, 17:30–18:30 | 2.79 → 2.05 min (27% less) | 8.71 → 7.93 min | 136 → 61 | 5.75 → 4.92 min |
| Heavy rain, morning peak | 6.84 → 5.71 min (17% less) | 12.78 → 11.59 min | 195 → 96 | 7.83 → 7.13 min |
| Accidents on NH 333 and NH 114A, morning peak | 2.74 → 2.12 min (23% less) | 8.68 → 8.00 min | 120 → 62 | 5.69 → 5.00 min |

Averaged over the four scenarios, an ambulance trip falls from 6.21 to 5.51 minutes (11% faster).

### Signal agent

`npm run train:rl`: 80 training episodes, then the average of four one-hour test runs on unseen seeds (two morning peaks, an evening peak and midday). Signal control only, with no forecasting or ambulance priority:

| Control | Delay per trip | Vehicles queued (average) |
|---|---|---|
| Fixed-time plans | 2.51 min | 105 |
| Max-pressure | 2.15 min | 67 |
| Q-learning agent | 1.98 min (21% less than fixed) | 53 |

### Per-road congestion forecaster

Held-out simulated days 13–14 (250,630 road samples). Congestion runs from 0 (free) to 1 (jammed). *Persistence* assumes congestion stays at its average over the last 5 minutes. *Busy roads* are samples where the actual or the persistence value is at least 0.35.

| Metric | +15 min (model / persistence) | +30 min (model / persistence) |
|---|---|---|
| Mean absolute error | 0.029 / 0.035 | 0.029 / 0.035 |
| Mean absolute error on busy roads | 0.154 / 0.192 | 0.153 / 0.196 |
| Congestion level accuracy | 98.7% / 98.1% | 98.7% / 98.1% |
| R² | 0.66 | 0.66 |

Level accuracy is high for both because most roads are free-flowing most of the time. The busy-road error, 20% lower than persistence, is the more telling figure.

### Junction forecaster (real Kaggle counts)

Tested on the last 9 days of the dataset (862 intervals of 15 minutes), never seen in training. *Persistence* assumes the count or situation stays as it is now.

| Metric | +15 min (model / persistence) | +30 min (model / persistence) |
|---|---|---|
| Vehicle count, mean absolute error | 19.9 / 24.6 vehicles | 20.3 / 28.8 vehicles |
| Vehicle count, R² | 0.81 | 0.80 |
| Situation accuracy | 70.9% / 64.7% | 68.1% / 59.9% |
| Situation macro F1 | 0.56 / 0.53 | 0.52 / 0.47 |
| Heavy traffic caught (recall) | 89% | 91% |

The current situation is classified with 92.9% accuracy (macro F1 0.90). The middle classes are the hard part: about 10% of "high" intervals and 44% of "low" intervals are classified correctly 15 minutes ahead. Most of the misses are labelled "normal". The count forecast is the more reliable output.

## Features

| Feature | Where |
|---|---|
| Congestion forecast 15 and 30 minutes ahead for every road (XGBoost), with confidence | Dashboard, Live Map, Analytics |
| Junction outlook: vehicle count and traffic situation (low / normal / high / heavy) for the next 15 and 30 minutes at the busiest junctions, from the Kaggle-trained model | Dashboard, Traffic Signals, Analytics |
| Adaptive signals: Q-learning agent with a safety layer (yellow, all-red, minimum and maximum green), manual fixed plans | Traffic Signals |
| Proactive interventions: forecast hotspots get more green downstream and connected vehicles are rerouted before the queue forms | Dashboard |
| Green corridor for ambulances: signals ahead turn green and the route avoids queues. Emergency vehicles are verified by the authority first | Emergency Vehicles |
| Class-wise routing: cargo trucks keep off lanes, weight-limited roads and the core at peak hours and weigh queues heavily, so they take the least congested legal road. Buses keep to main roads. Two-wheelers may use lanes. Emergency vehicles get priority | Routing & Freight |
| Disaster mode (earthquake, flood, fire, other): inbound roads into the zone close, outbound roads run contraflow, bridges near an earthquake or in a flood zone close, damaged lanes slow down, and every vehicle is sent to its nearest safe exit | Disaster & Evacuation |
| Civic reports with photos: potholes, accidents, waterlogging and more. The authority verifies, assigns a crew, starts work and marks it fixed with a proof photo. The citizen confirms and rates the fix, or reopens it. Deadlines follow severity (24, 72 or 168 hours). Verified reports slow or close the road in the simulation | Civic Reports, Authority Desk |
| Citizen and vehicle registration: plate, class, owner name, phone, email, licence number, address and photo. Other citizens never see someone's contact details | Vehicle Registry |
| Authority desk: everyone registered with photo and details, searchable by name, phone, plate or licence; civic cases with deadlines; overspeeding linked to owners with e-challans; emergency dispatches | Authority Desk |
| Data replay: upload a traffic-count CSV, or use the Kaggle sample, and the city runs on it at 16–128× speed. Forecasts made 15 minutes earlier are scored against the real counts as they arrive | Data Replay |
| Overspeed detection from speed cameras, with e-challans | Overspeeding |
| Live sources panel, live clock and weather switches, audit log | Settings |

Roles: Traffic Controller, Traffic Authority, Emergency Driver, Driver / Owner, Citizen. Switch between them from the top bar. Each role sees only its own pages and data.

## Architecture

```
 React + Vite client  ──REST + Server-Sent Events──▶  Node.js / Express API
  (white & navy UI)                                      │
                                                         ├─ Simulation engine on the real Deoghar network (1 s ticks)
                                                         │    signals · vehicles · incidents · disasters · replay
                                                         ├─ Live sources: IST clock, Open-Meteo weather, TomTom traffic (optional)
                                                         ├─ Q-learning signal policy        server/models/signal-policy.json
                                                         ├─ Per-road XGBoost forecaster      server/models/forecaster.json
                                                         ├─ Junction XGBoost forecaster      server/models/junction-forecaster.json
                                                         └─ PostgreSQL: registry, photos, civic cases and timeline, alerts, audit log

 OpenStreetMap (Overpass API) ──npm run fetch:city──▶ server/data/deoghar-osm.json
 Python ML pipeline (ml/) ──XGBoost──▶ server/models/*.json  (trees evaluated natively in Node)
```

- **Road network:** `scripts/fetch-city.ts` geocodes the city with Nominatim and downloads roads, bridges, hospitals, stations, bus stands and colleges from the Overpass API. The server turns this into a routable graph: ways split at junctions, nearby junction nodes merged, chains of short segments joined, and only the largest strongly connected part kept, so every junction can reach every other. OSM road types map to highway, arterial, street and residential lane.
- **Simulation:** vehicles drive on the left, queue at stop lines and discharge at saturation flow. Demand follows the hour of the day and the day of the week, and trips start near homes, workplaces, hospitals, stations and city exits. Weather changes speeds and saturation flow.
- **Per-road forecaster:** XGBoost regression on 21 features: current, 5-minute average and lagged congestion, inflow, queue, upstream and downstream state, time of day, weather, incidents, road type and vehicle mix. It predicts the average congestion over the 5 minutes up to +15 and +30 minutes, since a single instant on a short road swings with every vehicle that passes. The trained trees are exported to JSON and evaluated in Node with float32 split comparisons, so predictions match XGBoost to within 1e-5.
- **Junction forecaster:** XGBoost on the Kaggle counts. Features are the current car, two-wheeler and heavy-vehicle counts, the last four totals, their mean, spread and change, the vehicle shares, time of day and day of week. Two regressors predict the count 15 and 30 minutes ahead. Three classifiers give the traffic situation now, in 15 and in 30 minutes. "Low" and "high" are rarer than "normal" and "heavy", so the classifiers weight each class by the square root of its inverse frequency; without this they never predict "high". In the live city the model reads the simulated counts at each signalised junction every 15 minutes.
- **Signal agent:** tabular Q-learning shared across junctions. The state covers queues on green and red approaches, arrivals, green time and downstream occupancy. The reward is network-level: local queue plus downstream queue. In states it has not learned, it falls back to max-pressure control.

## Getting started

Requirements: Node.js 20+ (Python 3.10+ only to retrain the models).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:4000. Without a `DATABASE_URL` the server uses an in-memory PostgreSQL, so nothing else needs installing. The Deoghar map data is in the repository, so no download is needed to start.

### Live traffic from TomTom (optional)

1. Create a free account at https://developer.tomtom.com and copy the API key from the dashboard.
2. `cp .env.example .env` and set `TOMTOM_API_KEY=your-key`.
3. Restart `npm run dev`. The top bar shows "Live traffic" and Settings shows the measured roads and requests used today.

The free tier allows 2,500 requests a day. ASCENDRA uses at most 2,300 and keeps count in `.cache/tomtom-usage.json`.

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

## Replaying a dataset

Open **Data Replay** as the Traffic Controller or Traffic Authority, upload a CSV (up to 6 MB), choose a speed and press Start. The file needs a time column (`08:15` or `8:15:00 AM`) and either per-class counts or a total. Recognised columns:

| Column | Example header | Required |
|---|---|---|
| Time of each 15-minute interval | `Time`, `timestamp` | Yes |
| Counts per class | `CarCount`, `BikeCount`, `BusCount`, `TruckCount` | One of these or a total |
| Total vehicles | `Total`, `vehicles`, `count` | One of these or the classes |
| Day of the week | `Day of the week` | No: days are numbered from Monday in row order |
| Traffic situation label | `Traffic Situation` (low, normal, high, heavy) | No: needed only to score situation accuracy |

The Kaggle file `TrafficTwoMonth.csv` has exactly this layout. The page explains any assumption it had to make about your file.

## Using another city

Edit `config/city.json` (city name, geocoding query, timezone, radius, rules and demand), then:

```bash
npm run fetch:city      # downloads the new city from OpenStreetMap
npm run train:rl        # retrains the signal agent on the new network
npm run sim:history && npm run train:forecaster
npm run evaluate
```

## Training and evaluation

The trained models are committed, so this is only needed to reproduce them.

```bash
pip install -r ml/requirements.txt
npm run train:junction       # downloads the Kaggle dataset, trains the junction model -> server/models/junction-forecaster.json
npm run train:rl             # Q-learning signal agent -> server/models/signal-policy.json
npm run sim:history          # 14 simulated days on the Deoghar network -> ml/data/link_history.csv (about 12 min)
npm run train:forecaster     # per-road XGBoost -> server/models/forecaster.json
npm run evaluate             # ASCENDRA vs fixed-time plans -> server/models/evaluation.json
```

`npm run train:all` runs all five steps in this order (about 35 minutes). Restart `npm run dev` afterwards so the server loads the new models.

| Step | Script |
|---|---|
| Junction model on the Kaggle counts | `ml/train_junction_model.py` |
| Q-learning signal agent | `scripts/train-rl.ts`, using `server/sim/rl.ts` |
| Simulated history for the road forecaster | `scripts/generate-history.ts` |
| Per-road XGBoost forecaster | `ml/train_forecaster.py` |
| Evaluation against fixed-time plans | `scripts/evaluate.ts`, using `server/sim/evaluation.ts` |

The per-road forecaster is trained on days 1–10, early-stopped on days 11–12 and reported on held-out days 13–14 (`ml/reports/forecaster_metrics.json`). The junction model keeps the last days of the Kaggle data for testing, in time order, so it never sees the future (`ml/reports/junction_model_metrics.json`).

## Tests

```bash
npm test          # simulator, routing, class rules, disasters, replay, forecaster parity and API tests
npm run typecheck
```

## Project structure

```
client/          React app (pages, city map, UI components)
server/          Express API, simulation engine, models, database layer
  sim/           OSM network builder, engine, routing, RL policy, forecaster runtimes, evaluation
  live/          weather, TomTom traffic and dataset replay
  models/        trained models and evaluation results
  data/          cached OpenStreetMap extract
config/          city settings: rules, demand, live sources
shared/          types shared by client and server
ml/              XGBoost training pipelines and reports
scripts/         map download, RL training, history generation, evaluation
db/              PostgreSQL schema
tests/           Vitest suites
```

## Limitations and future work

- Without a TomTom key the traffic is simulated. With a key, only 20 roads are measured at a time, and the rest of the city is calibrated from them.
- Signal locations are inferred because Deoghar's signals are not in OpenStreetMap. Signals have two phases and no turning conflicts.
- The Kaggle dataset does not say where it was recorded, so the junction model has learned general traffic patterns, not Deoghar's own.
- The per-road forecaster and the signal agent are trained on simulated Deoghar traffic. Real loop-detector or camera counts would make them more accurate.
- Future work: real signal timings from the district traffic police, camera-based counting at junctions, V2X (DSRC / C-V2X) so vehicles and signals talk directly.
