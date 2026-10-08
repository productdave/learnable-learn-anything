// Run in Linux with --network none. Remap imports only: existing assertions are
// unchanged and execute the actual packaged handlers, writer and spending guard.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { moduleReferences } from './browser-contract.mjs';

assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
const artifact = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(join(artifact, 'packaging-report.json')));
assert.equal(report.continuationOverlay.namespace, 'js-workspace-recovery-20260930');
const scriptRoot = new URL('.', import.meta.url).pathname;
const qa = mkdtempSync(join(tmpdir(), 'learnable-continuation-package-'));
const bundle = group => join(artifact, '.vercel/output/functions/_functions', group + '.func');
const browser = join(artifact, '.vercel/output/static', report.continuationOverlay.namespace);
const hash = value => createHash('sha256').update(value).digest('hex');
const results = [], testDependencyMappings = [], environment = { PATH: process.env.PATH };

function execute(name, file, env = environment, expectedTests) {
  const result = spawnSync(process.execPath, ['--test', file], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, name + ': ' + output.slice(-6000));
  const tests = Number(output.match(/^# tests (\d+)$/m)?.[1]);
  assert.equal(tests, expectedTests, name + ': unchanged test count');
  assert.match(output, /^# fail 0$/m);
  results.push({ name, tests, outputSha256: hash(output), status: 'passed' });
}

function remap(testName, writerGroup) {
  const original = readFileSync(join(scriptRoot, testName), 'utf8');
  assert.ok(!original.includes('import.meta.url'), 'Review relative runtime file reads before remapping');
  let source = original;
  for (const specifier of new Set(moduleReferences(original))) {
    if (specifier.startsWith('node:')) continue;
    let target;
    if (specifier.startsWith('../web/api/')) {
      const path = specifier.slice('../web/'.length);
      const group = report.groups.find(g => g.id === 'generation' && g.files[path]) || report.groups.find(g => g.files[path]);
      assert.ok(group, 'Missing packaged API: ' + path); target = join(bundle(group.id), path);
    } else if (specifier.startsWith('../web/js/')) {
      const path = specifier.slice('../web/js/'.length);
      target = writerGroup && path.startsWith('generator/')
        ? join(bundle(writerGroup), 'js-workspace-20260918-candidate3', path) : join(browser, path);
      // The courses bundle imports topicToolFor, not a tone preset. runTopic's
      // tone is an explicit test input, so use the actual generation-bundle
      // preset rather than inventing an unused courses runtime dependency.
      if (writerGroup === 'courses' && path === 'generator/tones/conversational.mjs') {
        assert.ok(!existsSync(target), 'Review changed courses tone dependency');
        target = join(bundle('generation'), 'js-workspace-20260918-candidate3', path);
        testDependencyMappings.push({ test: testName, writerGroup, input: path,
          sourceGroup: 'generation', reason: 'Explicit tone input; not a courses runtime import' });
      }
    } else if (specifier === './packaging/grouped-router.mjs') target = join(bundle('generation'), 'api/_lib/grouped-router.mjs');
    else if (specifier.startsWith('./fixtures/')) target = join(scriptRoot, specifier);
    else if (specifier === '@supabase/supabase-js') target = createRequire(join(bundle('generation'), 'api/_lib/supabase-server.mjs')).resolve(specifier);
    else throw Error('Unreviewed test dependency: ' + specifier);
    assert.ok(existsSync(target), 'Missing actual test dependency: ' + target);
    const literal = `'${specifier}'`;
    const importCount = moduleReferences(original).filter(p => p === specifier).length;
    assert.equal(source.split(literal).length - 1, importCount, 'Only import literals may be remapped: ' + specifier);
    source = source.replaceAll(literal, JSON.stringify(pathToFileURL(target).href));
  }
  const file = join(qa, (writerGroup || 'all') + '-' + testName);
  writeFileSync(file, source, { flag: 'wx' });
  return file;
}

execute('actual packaged entry deadlines', remap('test-generation-entry-deadline.mjs'), environment, 69);
execute('actual packaged continuation and recovery', remap('test-generation-continuation.mjs'), environment, 33);
for (const group of ['generation', 'sources', 'courses']) {
  execute(group + ': actual packaged lesson output', remap('test-topic-output-recovery.mjs', group), environment, 23);
}
for (const group of ['generation', 'sources']) {
  execute(group + ': actual packaged spending guard', join(scriptRoot, 'test-staging-spend-guard.mjs'), {
    ...environment, GUARD_MODULE: join(bundle(group), 'js-workspace-20260918-candidate3/generator/anthropic-fetch.js')
  }, 13);
}
const receipt = { at: new Date().toISOString(), status: 'passed-packaged-continuation-not-hosted-acceptance',
  artifact, platform: process.platform, architecture: process.arch, node: process.version,
  assertions: 'unchanged; import specifiers remapped only', testCount: results.reduce((n, r) => n + r.tests, 0), results, testDependencyMappings,
  artifactReportSha256: hash(readFileSync(join(artifact, 'packaging-report.json'))),
  verifierSha256: hash(readFileSync(new URL(import.meta.url))),
  limitations: ['Container networking disabled by operator; providers, Auth, database and storage are synthetic.',
    'Not a real hosted self-delivery, model output or physical-device acceptance test.',
    'The 43 runner timing cases were run against source, not remapped by this verifier. Actual packaged runner/guard has its separate 8-case integration test.'] };
writeFileSync(join(artifact, 'continuation-qa.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
