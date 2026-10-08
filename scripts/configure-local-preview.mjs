// Generate ignored runtime credentials from this Docker-local stack only.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { validatePreviewConfig } from './dev-setup-server.mjs';

const file = new URL('../.env.preview.local', import.meta.url);
if (existsSync(file) && parseEnv(readFileSync(file, 'utf8')).LEARNABLE_PREVIEW_ENV !== 'local') throw new Error('Refusing to replace a non-local preview configuration.');
const projectConfig = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
if (!projectConfig.includes('project_id = "learnable-setup-local"')) throw new Error('Unexpected Supabase project.');
const raw = execFileSync('npx', ['--yes', 'supabase@2.117.0', 'status', '-o', 'json'], { cwd: new URL('../', import.meta.url), env: { ...process.env, DO_NOT_TRACK: '1' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const data = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
if (data.API_URL !== 'http://127.0.0.1:54321') throw new Error('Refusing non-local Supabase status.');
const values = { LEARNABLE_PREVIEW_ENV: 'local', SUPABASE_URL: data.API_URL, SUPABASE_ANON_KEY: data.PUBLISHABLE_KEY || data.ANON_KEY, SUPABASE_SECRET_KEY: data.SECRET_KEY || data.SERVICE_ROLE_KEY };
// Preserve the vault key across restarts; rotating it would orphan connections.
const previous = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
values.LEARNABLE_PROVIDER_VAULT_KEY = previous.LEARNABLE_PROVIDER_VAULT_KEY || randomBytes(32).toString('hex');
values.LEARNABLE_SETUP_GENERATION = '1';
const liveURL = readFileSync(new URL('../web/js/config.js', import.meta.url), 'utf8').match(/export const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
validatePreviewConfig(values, liveURL);
if (existsSync(file)) chmodSync(file, 0o600);
writeFileSync(file, '# Generated for the isolated local Docker stack. Never commit.\n' + Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
console.log('Local runtime configuration refreshed. Keys were not displayed; live configuration is unchanged.');
