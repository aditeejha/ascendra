import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvaluationResult } from '../../shared/types';
import { Forecaster, matchesSimulator, type ForecasterFile } from './forecaster';
import { JunctionForecaster, type JunctionModelFile } from './junction';
import { QPolicy, type PolicyFile } from './rl';

export const MODELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../models');

function readJson<T>(name: string): T | null {
  const file = path.join(MODELS_DIR, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function saveJson(name: string, data: unknown): string {
  mkdirSync(MODELS_DIR, { recursive: true });
  const file = path.join(MODELS_DIR, name);
  writeFileSync(file, JSON.stringify(data));
  return file;
}

export function loadPolicy(): QPolicy | null {
  const file = readJson<PolicyFile>('signal-policy.json');
  return file ? new QPolicy(file) : null;
}

export function loadForecaster(): Forecaster | null {
  const file = readJson<ForecasterFile>('forecaster.json');
  if (!file) return null;
  if (!matchesSimulator(file)) {
    console.warn('forecaster.json was trained on a different feature list. Run npm run sim:history && npm run train:forecaster.');
    return null;
  }
  return new Forecaster(file);
}

export function loadEvaluation(): EvaluationResult | null {
  return readJson<EvaluationResult>('evaluation.json');
}

export function loadJunctionModel(): JunctionForecaster | null {
  const file = readJson<JunctionModelFile>('junction-forecaster.json');
  return file ? new JunctionForecaster(file) : null;
}
