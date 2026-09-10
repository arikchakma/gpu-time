import { createParser } from '../../src/index.ts';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const parser = await createParser({ backend: 'cpu' });
const context = { reference: '2026-10-24T12:00:00Z', timeZone: 'America/New_York', limit: 3 };
const texts = [
  'Every Monday from 8pm to 10pm',
  'Friday at 10pm until Saturday at 2am',
  'in half an hour',
  'ASAP',
];
const examples = [];
for (const text of texts) examples.push({ text, result: await parser.parse(text, context) });
parser.dispose();
const model = JSON.parse(readFileSync('training/export-report.json', 'utf8'));
const hash = createHash('sha256');
for (const file of readdirSync('src', { recursive: true }).map(String).sort()) {
  if (/\.(ts|wgsl)$/.test(file)) hash.update(file).update(readFileSync(`src/${file}`));
}
writeFileSync('video/current/data.json', JSON.stringify({
  provenance: { source: 'src/index.ts', sourceSha256: hash.digest('hex'), checkpointSha256: model.checkpointSha256, artifactSha256: model.artifactSha256 },
  parameters: model.parameters, context, examples,
}, null, 2) + '\n');
