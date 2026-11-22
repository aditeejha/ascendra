export const FEATURES = [
  'score',
  'score_mean5',
  'score_lag5',
  'score_lag10',
  'score_lag15',
  'trend5',
  'inflow5',
  'queue',
  'upstream',
  'downstream',
  'tod_sin',
  'tod_cos',
  'weekend',
  'weather',
  'incident',
  'incident_near',
  'kind',
  'lanes',
  'cargo_share',
  'tw_share',
  'network_load',
] as const;

export const HORIZONS = [15, 30] as const;
export type Horizon = (typeof HORIZONS)[number];
export const TARGET_WINDOW_MIN = 5;

export function tailMean(values: ArrayLike<number>, count: number, fallback: number): number {
  const from = Math.max(0, values.length - count);
  if (from === values.length) return fallback;
  let sum = 0;
  for (let i = from; i < values.length; i++) sum += values[i];
  return sum / (values.length - from);
}

export interface TreeArrays {
  left: number[];
  right: number[];
  feature: number[];
  threshold: number[];
  defaultLeft: number[];
}

export interface HorizonModel {
  baseScore: number;
  trees: TreeArrays[];
  calibration: { edges: number[]; mae: number[] };
  checks?: { x: number[]; y: number }[];
}

export interface ForecasterFile {
  name: string;
  trainedAt: string;
  features: string[];
  horizons: Record<string, HorizonModel>;
  metrics: Record<string, number>;
}

export interface CompiledTree {
  left: Int32Array;
  right: Int32Array;
  feature: Int32Array;
  threshold: Float32Array;
  defaultLeft: Uint8Array;
}

export function compile(tree: TreeArrays): CompiledTree {
  return {
    left: Int32Array.from(tree.left),
    right: Int32Array.from(tree.right),
    feature: Int32Array.from(tree.feature),
    threshold: Float32Array.from(tree.threshold),
    defaultLeft: Uint8Array.from(tree.defaultLeft),
  };
}

export function evalTree(tree: CompiledTree, x: Float32Array): number {
  let node = 0;
  while (tree.left[node] !== -1) {
    const v = x[tree.feature[node]];
    if (Number.isNaN(v)) node = tree.defaultLeft[node] ? tree.left[node] : tree.right[node];
    else node = v < tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.threshold[node];
}

export function matchesSimulator(file: ForecasterFile): boolean {
  return file.features.join(',') === FEATURES.join(',');
}

export class Forecaster {
  readonly file: ForecasterFile;
  private compiled: Record<string, CompiledTree[]>;

  constructor(file: ForecasterFile) {
    if (!matchesSimulator(file)) {
      throw new Error('Forecaster feature list does not match the simulator');
    }
    this.file = file;
    this.compiled = Object.fromEntries(Object.entries(file.horizons).map(([h, m]) => [h, m.trees.map(compile)]));
  }

  get treeCount(): number {
    return Object.values(this.file.horizons).reduce((n, h) => n + h.trees.length, 0);
  }

  raw(horizon: Horizon, features: ArrayLike<number>): number {
    const x = Float32Array.from(features as ArrayLike<number>);
    let sum = this.file.horizons[String(horizon)].baseScore;
    for (const tree of this.compiled[String(horizon)]) sum += evalTree(tree, x);
    return sum;
  }

  predict(horizon: Horizon, features: ArrayLike<number>): number {
    return Math.min(1, Math.max(0, this.raw(horizon, features)));
  }

  confidence(horizon: Horizon, prediction: number): number {
    const { edges, mae } = this.file.horizons[String(horizon)].calibration;
    let i = 0;
    while (i < edges.length - 2 && prediction >= edges[i + 1]) i++;
    return Math.min(0.98, Math.max(0.35, 1 - 2.5 * mae[i]));
  }
}
