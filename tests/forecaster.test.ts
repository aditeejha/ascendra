import { describe, expect, it } from 'vitest';
import { FEATURES, HORIZONS } from '../server/sim/forecaster';
import { loadForecaster } from '../server/sim/models';

describe('XGBoost forecaster runtime', () => {
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
});
