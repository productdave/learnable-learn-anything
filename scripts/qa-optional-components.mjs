// Real guest setup + IndexedDB; isolated readiness service doubles, no AI/accounts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readBrowserGraph } from './browser-contract.mjs';
import { richComponentCombinations } from './fixtures/component-course.mjs';
const cli = process.env.PLAYWRIGHT_CLI, session = process.argv[2] || 'rich-component-setup';
assert.ok(cli, 'Set PLAYWRIGHT_CLI to the installed skill wrapper.');
const graph = readBrowserGraph(), modules = {};
for (const [key, name] of [['draft','draft-store'],['create','setup-create'],['model','setup-model']]) modules[key] = `/js/${name}.js?${graph.imports.get(resolve(graph.web, `js/${name}.js`))[0].query}`;
function command(args) {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: 'utf8', timeout: 240000 });
  const output = result.stdout?.split('### Ran Playwright code')[0] || '';
  if (result.status || result.error || result.stdout?.includes('### Error')) throw new Error(output + (result.stderr || '') + (result.error?.message || ''));
  return output;
}
try {
  console.log(command(['open','http://127.0.0.1:4173/?experience=workspace'])); command(['snapshot']);
  const source = readFileSync(new URL('./qa-optional-components.browser.js', import.meta.url), 'utf8').replace('__COMPONENT_SETUP_QA__', JSON.stringify({ combinations: richComponentCombinations, modules }));
  console.log(command(['run-code',source]));
} finally { command(['close']); }
