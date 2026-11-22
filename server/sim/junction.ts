import type { JunctionSituation } from '../../shared/types';
import { compile, evalTree, type CompiledTree, type TreeArrays } from './forecaster';

export const JUNCTION_FEATURES = [
  'car',
  'bike',
  'heavy',
  'total',
  'total_lag1',
  'total_lag2',
  'total_lag3',
  'total_lag4',
  'total_mean4',
  'total_std4',
  'diff1',
  'heavy_share',
  'bike_share',
  'tod_sin',
  'tod_cos',
  'dow',
  'weekend',
] as const;

export const SITUATIONS: JunctionSituation[] = ['low', 'normal', 'high', 'heavy'];

interface ClassModel {
  baseScore: number[];
  numClass: number;
  trees: TreeArrays[];
  treeClass: number[];
  checks?: { x: number[]; margin: number[] }[];
}

export interface JunctionModelFile {
  name: string;
  dataset: { name: string; url: string; file: string; rows: number; days: number; intervalMin: number; classes: string[] };
  trainedAt: string;
  features: string[];
  classes: string[];
  models: { count: Record<string, ClassModel>; situation: Record<string, ClassModel> };
  metrics: Record<string, number | null>;
}

interface Compiled {
  base: number[];
  numClass: number;
  trees: CompiledTree[];
  treeClass: number[];
}

export class JunctionForecaster {
  readonly file: JunctionModelFile;
  private compiled: { count: Record<string, Compiled>; situation: Record<string, Compiled> };

  constructor(file: JunctionModelFile) {
    if (file.features.join(',') !== JUNCTION_FEATURES.join(',')) throw new Error('Junction model feature list does not match the simulator');
    this.file = file;
    const build = (m: ClassModel): Compiled => ({ base: m.baseScore, numClass: m.numClass, trees: m.trees.map(compile), treeClass: m.treeClass });
    this.compiled = {
      count: Object.fromEntries(Object.entries(file.models.count).map(([h, m]) => [h, build(m)])),
      situation: Object.fromEntries(Object.entries(file.models.situation).map(([h, m]) => [h, build(m)])),
    };
  }

  margins(kind: 'count' | 'situation', horizon: number, features: ArrayLike<number>): number[] {
    const m = kind === 'count' ? this.compiled.count[String(horizon)] : this.compiled.situation[String(horizon)];
    const x = Float32Array.from(features as ArrayLike<number>);
    const out = [...m.base];
    m.trees.forEach((tree, i) => {
      out[m.treeClass[i] ?? 0] += evalTree(tree, x);
    });
    return out;
  }

  count(horizon: 15 | 30, features: ArrayLike<number>): number {
    return Math.max(0, this.margins('count', horizon, features)[0]);
  }

  situation(horizon: 0 | 15 | 30, features: ArrayLike<number>): { label: JunctionSituation; probs: number[] } {
    const z = this.margins('situation', horizon, features);
    const max = Math.max(...z);
    const e = z.map((v) => Math.exp(v - max));
    const sum = e.reduce((a, b) => a + b, 0);
    const probs = e.map((v) => v / sum);
    return { label: SITUATIONS[probs.indexOf(Math.max(...probs))], probs };
  }
}
