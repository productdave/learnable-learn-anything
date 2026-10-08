import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const wrapper = fileURLToPath(new URL('./local-docker', import.meta.url));
const project = 'learnable-setup-local';
if (!readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8').includes(`project_id = "${project}"`)) throw new Error('Unexpected local Supabase project.');
const docker = execFileSync('/bin/zsh', ['-c', 'command -v docker'], { encoding: 'utf8' }).trim();
const existing = execFileSync(docker, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).trim().split('\n');
if (!existing.includes('learnable-local')) execFileSync(docker, ['network', 'create', '-o', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', 'learnable-local'], { stdio: 'ignore' });
const processEnv = { ...process.env, DO_NOT_TRACK: '1', LEARNABLE_REAL_DOCKER: docker, PATH: `${wrapper}:${process.env.PATH}` };
console.log('Starting isolated local Supabase with explicit loopback-only published ports…');
const child = spawn('npx', ['--yes', 'supabase@2.117.0', 'start', '--network-id', 'learnable-local'], { cwd: root, env: processEnv, stdio: ['ignore', 'pipe', 'pipe'] });
// Supabase prints local secrets at completion. Keep all subprocess output private.
let diagnostic = '';
child.stdout.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16384); });
child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-16384); });
const timer = setInterval(() => console.log('Local Supabase is still starting; first-run image downloads can take several minutes.'), 30000);
const code = await new Promise(resolve => { child.on('error', () => resolve(1)); child.on('close', resolve); });
clearInterval(timer);
if (code !== 0) {
  // Do not dump SDK/CLI diagnostics that may include environment secrets.
  console.error(`Local Supabase did not start${/health/i.test(diagnostic) ? ' (service health check)' : ''}. Inspect the named local containers; no credentials were printed.`);
  process.exitCode = 1;
} else {
  const ids = execFileSync(docker, ['ps', '--filter', `label=com.supabase.cli.project=${project}`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (!ids.length) throw new Error('No local project containers found.');
  const containers = JSON.parse(execFileSync(docker, ['inspect', ...ids], { encoding: 'utf8' }));
  const ports = containers.flatMap(container => Object.values(container.NetworkSettings.Ports || {}).flat().filter(Boolean));
  if (!ports.length || ports.some(port => port.HostIp !== '127.0.0.1')) {
    execFileSync('npx', ['--yes', 'supabase@2.117.0', 'stop'], { cwd: root, env: processEnv, stdio: 'ignore' });
    throw new Error('Unsafe port binding detected. Stopped only the local Learnable stack, preserving its volumes.');
  }
  console.log('Local Supabase is ready. All published ports are bound to 127.0.0.1. Test inbox: http://127.0.0.1:54324');
}
