CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE,
  vehicle_class TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  phone TEXT,
  weight_t DOUBLE PRECISION,
  agency TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS civic_reports (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  link_id INTEGER,
  node_id INTEGER,
  severity TEXT NOT NULL DEFAULT 'medium',
  reporter_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported',
  impact_applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS overspeed_alerts (
  id SERIAL PRIMARY KEY,
  plate TEXT NOT NULL,
  vehicle_class TEXT NOT NULL,
  speed_kmh INTEGER NOT NULL,
  limit_kmh INTEGER NOT NULL,
  link_id INTEGER NOT NULL,
  sim_clock TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  fine_amount INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emergency_dispatches (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL,
  plate TEXT NOT NULL,
  label TEXT NOT NULL,
  origin_node INTEGER NOT NULL,
  dest_node INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_route',
  eta_initial_s INTEGER NOT NULL DEFAULT 0,
  est_no_priority_s INTEGER NOT NULL DEFAULT 0,
  actual_s INTEGER,
  preempted INTEGER NOT NULL DEFAULT 0,
  started_clock TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signal_plan_changes (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  green_ns INTEGER NOT NULL,
  green_ew INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
