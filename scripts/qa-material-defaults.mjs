import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
const cli = process.env.PLAYWRIGHT_CLI; assert.ok(cli);
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [], session = process.argv[2] || 'material-defaults';
const graph = readBrowserGraph(), modules = {};
for (const name of ['auth', 'draft-store', 'setup-defaults', 'store', 'sync']) modules[name] = `/js/${name}.js?${graph.imports.get(resolve(graph.web, `js/${name}.js`))[0].query}`;
function command(args) {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: 'utf8', timeout: 180000 });
  const out = result.stdout?.split('### Ran Playwright code')[0] || '';
  if (result.status || result.error || result.stdout?.includes('### Error')) throw new Error(out + (result.stderr || '') + (result.error?.message || ''));
  return out;
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `defaults-browser-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    accounts.push({ email, password, owner: made.data.user.id });
  }
  assert.ok(!(await admin.from('user_state').insert({ user_id: accounts[0].owner, state: { _courseMaterialDefaults: { version: 1, revision: randomUUID(), components: ['lessons', 'flashcards'] } } })).error);
  console.log(command(['open', 'http://127.0.0.1:4173/?experience=workspace'])); command(['snapshot']);
  const script = readFileSync(new URL('./qa-material-defaults.browser.js', import.meta.url), 'utf8').replace('__MATERIAL_DEFAULTS_QA__', JSON.stringify({ accounts, modules }));
  console.log(command(['run-code', script]));
  const report = command(['eval', '() => window.__materialDefaultsReport']);
  assert.ok(report.includes('"total"'), 'Browser run did not reach its completion report.');
  console.log(report);
} finally {
  try { command(['close']); } catch {}
  for (const account of accounts) {
    for (const table of ['learning_events', 'user_state']) await admin.from(table).delete().eq('user_id', account.owner);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
}
