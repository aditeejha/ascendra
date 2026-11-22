import { describe, expect, it } from 'vitest';
import { FEATURES, Forecaster, HORIZONS, matchesSimulator, TARGET_WINDOW_MIN, tailMean } from '../server/sim/forecaster';
import { JUNCTION_FEATURES, type JunctionModelFile } from '../server/sim/junction';
import { loadForecaster, loadJunctionModel } from '../server/sim/models';

describe('XGBoost road forecaster runtime', () => {
  const forecaster = loadForecaster();

  it('ships a trained model with the simulator feature order', () => {
    expect(forecaster).not.toBeNull();
    expect(forecaster!.file.features).toEqual([...FEATURES]);
    expect(forecaster!.treeCount).toBeGreaterThan(100);
  });

  it.each(HORIZONS)('reproduces XGBoost predictions for the +%i min model', (horizon) => {
    const checks = forecaster!.file.horizons[String(horizon)].checks ?? [];
    expect(checks.length).toBeGreaterThan(0);
    for (const check of checks) {
      expect(Math.abs(forecaster!.raw(horizon, check.x) - check.y)).toBeLessThan(1e-4);
    }
  });

  it('clamps predictions to the 0..1 congestion range and gives a confidence', () => {
    const extreme = FEATURES.map(() => 50);
    const p = forecaster!.predict(15, extreme);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
    const c = forecaster!.confidence(15, p);
    expect(c).toBeGreaterThanOrEqual(0.35);
    expect(c).toBeLessThanOrEqual(0.98);
  });

  it('recognises a model trained on another feature list instead of misreading its inputs', () => {
    expect(matchesSimulator(forecaster!.file)).toBe(true);
    const stale = { ...forecaster!.file, features: forecaster!.file.features.filter((f) => f !== 'score_mean5') };
    expect(matchesSimulator(stale)).toBe(false);
    expect(() => new Forecaster(stale)).toThrow();
  });

  it('averages the last five minutes of congestion for its target window', () => {
    expect(TARGET_WINDOW_MIN).toBe(5);
    expect(tailMean([0.9, 0.1, 0.2, 0.3, 0.4, 0.5], TARGET_WINDOW_MIN, 0)).toBeCloseTo(0.3);
    expect(tailMean([0.2, 0.4], TARGET_WINDOW_MIN, 0)).toBeCloseTo(0.3);
    expect(tailMean([], TARGET_WINDOW_MIN, 0.7)).toBe(0.7);
  });
});

describe('XGBoost junction model trained on the Kaggle dataset', () => {
  const model = loadJunctionModel();

  it('ships a model trained on real camera counts with the simulator feature order', () => {
    expect(model).not.toBeNull();
    expect(model!.file.dataset.url).toContain('kaggle.com');
    expect(model!.file.dataset.rows).toBeGreaterThan(5000);
    expect(model!.file.features).toEqual([...JUNCTION_FEATURES]);
  });

  it('reproduces XGBoost margins for every exported model', () => {
    const models = model!.file.models as JunctionModelFile['models'];
    for (const kind of ['count', 'situation'] as const) {
      for (const [horizon, m] of Object.entries(models[kind])) {
        expect(m.checks?.length).toBeGreaterThan(0);
        for (const check of m.checks!) {
          const got = model!.margins(kind, Number(horizon), check.x);
          got.forEach((v, i) => expect(Math.abs(v - check.margin[i])).toBeLessThan(1e-3 * (1 + Math.abs(check.margin[i]))));
        }
      }
    }
  });

  it('beats persistence on the held-out days and returns valid probabilities', () => {
    const m = model!.file.metrics as Record<string, number>;
    expect(m.countMae15).toBeLessThan(m.countMaePersistence15);
    expect(m.situationAcc15).toBeGreaterThan(m.situationAccPersistence15);
    const x = JUNCTION_FEATURES.map((f) => (f === 'total' ? 150 : 1));
    const { probs } = model!.situation(15, x);
    expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});
