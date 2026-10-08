// Read-only diagnostic of a packaged reader. No network or provider calls.
// A longer per-call PDF sample is diagnostic only, never acceptance evidence.
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';

const artifact = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(join(artifact, 'packaging-report.json')));
const group = report.groups.find(g => g.id === 'generation');
assert.ok(group?.files['api/_lib/document-reader.mjs']);
const isolated = mkdtempSync(join(tmpdir(), 'learnable-parser-timing-'));
cpSync(join(artifact, '.vercel/output/functions/_functions/generation.func'), isolated, { recursive: true });
const reader = join(isolated, 'api/_lib/document-reader.mjs');
assert.equal(createHash('sha256').update(readFileSync(reader)).digest('hex'), group.files['api/_lib/document-reader.mjs']);
console.log(JSON.stringify({ phase: 'environment', platform: process.platform, arch: process.arch, node: process.version, readerHash: group.files['api/_lib/document-reader.mjs'] }));
const started = performance.now();
const { readDocument, DOCUMENT_LIMITS } = await import(pathToFileURL(reader));
console.log(JSON.stringify({ phase: 'main-import', ms: Math.round(performance.now() - started), limitMs: DOCUMENT_LIMITS.timeoutMs }));
assert.equal(DOCUMENT_LIMITS.timeoutMs, 8000);
for (const [kind, bytes] of [['txt', Buffer.from('Timing fixture')], ['docx', docxFixture(['Timing fixture'])], ['pdf', pdfFixture(['First page', 'Second page'])]]) {
  const start = performance.now();
  try {
    const value = await readDocument(bytes, kind);
    console.log(JSON.stringify({ phase: 'default-read', kind, passed: true, ms: Math.round(performance.now() - start), characters: value.characters }));
  } catch (error) {
    console.log(JSON.stringify({ phase: 'default-read', kind, passed: false, ms: Math.round(performance.now() - start), code: error.code }));
    if (kind === 'pdf') {
      const retry = performance.now();
      try {
        const value = await readDocument(bytes, kind, { timeoutMs: 30000 });
        console.log(JSON.stringify({ phase: 'diagnostic-only-long-read', passed: true, ms: Math.round(performance.now() - retry), characters: value.characters, acceptance: false }));
      } catch (failure) {
        console.log(JSON.stringify({ phase: 'diagnostic-only-long-read', passed: false, ms: Math.round(performance.now() - retry), code: failure.code, acceptance: false }));
      }
    }
  }
}
const boot = performance.now();
await new Promise((resolveWorker, reject) => {
  const worker = new Worker(`const { parentPort } = require('node:worker_threads'); parentPort.postMessage('ready');`, { eval: true, execArgv: [] });
  worker.once('message', () => {
    console.log(JSON.stringify({ phase: 'empty-worker-start', ms: Math.round(performance.now() - boot) }));
    worker.terminate().then(resolveWorker, reject);
  });
  worker.once('error', reject);
});
