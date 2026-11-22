import { runEvaluation } from '../server/sim/evaluation';
import { loadForecaster, loadJunctionModel, loadPolicy, saveJson } from '../server/sim/models';
import { buildNetwork } from '../server/sim/network';

const net = buildNetwork();
const policy = loadPolicy();
const forecaster = loadForecaster();
const junctionModel = loadJunctionModel();
console.log(`Policy: ${policy ? 'loaded' : 'missing (max-pressure fallback)'}  Forecaster: ${forecaster ? 'loaded' : 'missing'}`);

const started = Date.now();
const result = await runEvaluation(net, policy, forecaster, {
  seeds: Number(process.env.SEEDS ?? 3),
  durationMin: 60,
  junctionModel,
  onProgress: (done, total) => process.stdout.write(`\rrun ${done}/${total}`),
});
process.stdout.write('\n');

for (const s of result.scenarios) {
  const cut = (1 - s.adaptive.avgDelayMin / s.fixed.avgDelayMin) * 100;
  console.log(
    `${s.label.padEnd(24)} delay ${s.fixed.avgDelayMin.toFixed(2)} -> ${s.adaptive.avgDelayMin.toFixed(2)} min (${cut.toFixed(1)}% less)  ` +
      `travel ${s.fixed.avgTravelMin.toFixed(2)} -> ${s.adaptive.avgTravelMin.toFixed(2)}  queue ${s.fixed.avgQueue} -> ${s.adaptive.avgQueue}  ` +
      `ambulance ${s.fixed.emergencyEtaMin} -> ${s.adaptive.emergencyEtaMin} min`,
  );
}
console.log(`Emergency ETA: ${result.emergency.withoutPriorityMin} -> ${result.emergency.withPriorityMin} min`);
console.log(`Saved ${saveJson('evaluation.json', result)} in ${Math.round((Date.now() - started) / 1000)} s`);
