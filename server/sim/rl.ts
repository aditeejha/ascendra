const QUEUE_EDGES = [1, 4, 8, 15];
const ARRIVAL_EDGES = [1, 3];
const ELAPSED_EDGES = [15, 30, 45];
const DOWNSTREAM_EDGES = [0.4, 0.7];

const DIMS = [
  QUEUE_EDGES.length + 1,
  QUEUE_EDGES.length + 1,
  ARRIVAL_EDGES.length + 1,
  ELAPSED_EDGES.length + 1,
  DOWNSTREAM_EDGES.length + 1,
];

export const N_STATES = DIMS.reduce((a, b) => a * b, 1);
export const N_ACTIONS = 2;
export const ACTION_KEEP = 0;
export const ACTION_SWITCH = 1;
const MIN_VISITS = 6;

export interface PolicyFile {
  name: string;
  states: number;
  actions: number;
  q: number[];
  visits: number[];
  episodes: number;
  trainedAt: string;
  metrics: Record<string, number>;
}

export interface RlObservation {
  queueGreen: number;
  queueRed: number;
  arrivingGreen: number;
  greenElapsed: number;
  downstreamOcc: number;
}

function bucket(value: number, edges: number[]): number {
  let i = 0;
  while (i < edges.length && value >= edges[i]) i++;
  return i;
}

export function encodeState(o: RlObservation): number {
  const parts = [
    bucket(o.queueGreen, QUEUE_EDGES),
    bucket(o.queueRed, QUEUE_EDGES),
    bucket(o.arrivingGreen, ARRIVAL_EDGES),
    bucket(o.greenElapsed, ELAPSED_EDGES),
    bucket(o.downstreamOcc, DOWNSTREAM_EDGES),
  ];
  let s = 0;
  for (let i = 0; i < parts.length; i++) s = s * DIMS[i] + parts[i];
  return s;
}

export class QPolicy {
  readonly q: Float64Array;
  readonly visits: Uint32Array;
  episodes: number;
  meta: Partial<PolicyFile>;

  constructor(file?: PolicyFile) {
    this.q = new Float64Array(N_STATES * N_ACTIONS);
    this.visits = new Uint32Array(N_STATES);
    this.episodes = 0;
    this.meta = {};
    if (file && file.q.length === this.q.length) {
      this.q.set(file.q);
      this.visits.set(file.visits);
      this.episodes = file.episodes;
      this.meta = { name: file.name, trainedAt: file.trainedAt, metrics: file.metrics };
    }
  }

  known(state: number): boolean {
    return this.visits[state] >= MIN_VISITS;
  }

  greedy(state: number): number {
    const base = state * N_ACTIONS;
    return this.q[base + ACTION_SWITCH] > this.q[base + ACTION_KEEP] ? ACTION_SWITCH : ACTION_KEEP;
  }

  maxQ(state: number): number {
    const base = state * N_ACTIONS;
    return Math.max(this.q[base], this.q[base + 1]);
  }

  update(state: number, action: number, reward: number, next: number, alpha: number, gamma: number): void {
    const idx = state * N_ACTIONS + action;
    const target = reward + gamma * this.maxQ(next);
    this.q[idx] += alpha * (target - this.q[idx]);
    this.visits[state]++;
  }

  statesVisited(): number {
    let n = 0;
    for (const v of this.visits) if (v >= MIN_VISITS) n++;
    return n;
  }

  toFile(name: string, metrics: Record<string, number>): PolicyFile {
    return {
      name,
      states: N_STATES,
      actions: N_ACTIONS,
      q: Array.from(this.q, (v) => Math.round(v * 1e5) / 1e5),
      visits: Array.from(this.visits),
      episodes: this.episodes,
      trainedAt: new Date().toISOString(),
      metrics,
    };
  }
}
