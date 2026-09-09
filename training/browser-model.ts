import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/');
try {
  const result = await page.evaluate(async () => {
    const root = '/@fs/Users/arikko/Developer/vibecode/gpu-time-rewrite/src';
    const { GPUModel } = await import(root + '/model/gpu.ts');
    const { inferCPU } = await import(root + '/model/cpu.ts');
    const { tokenize } = await import(root + '/tokenizer.ts');
    const texts = ['Sat Sun 1pm-8pm Mon 10pm-12am', 'last Friday', 'last Friday of every month', 'from 9 to 5', 'every Monday from October', 'May I have your second opinion?'];
    const inputs = texts.map(tokenize);
    const gpu = await GPUModel.create();
    const started = performance.now();
    const actual = await gpu.inferMany(inputs, true);
    const gpuMs = performance.now() - started;
    let maxError = 0;
    let labelMismatches = 0;
    let boundaryMismatches = 0;
    for (let index = 0; index < inputs.length; index++) {
      const expected = inferCPU(inputs[index], true);
      for (let token = 0; token < inputs[index].length; token++) {
        if (inputs[index][token].kind === 3) continue;
        labelMismatches += Number(actual[index].labels[token] !== expected.labels[token]);
        boundaryMismatches += Number(actual[index].clauseStarts[token] !== expected.clauseStarts[token]);
        for (let label = 0; label < 40; label++) maxError = Math.max(maxError, Math.abs(actual[index].logits[token * 40 + label] - expected.logits[token * 40 + label]));
      }
    }
    const submissions = gpu.stats.submissions;
    gpu.dispose();
    return { texts, gpuMs, submissions, maxError, labelMismatches, boundaryMismatches };
  });
  writeFileSync('training/parity-gpu-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
