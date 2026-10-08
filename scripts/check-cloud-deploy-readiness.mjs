import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const webRoot = join(root, 'web');
const requiredProductionEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'CRON_SECRET'
];
const requiredProductionEnvGroups = [
  ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
];

export function productionEnvNamesFromVercelOutput(output, requiredNames = [...requiredProductionEnv, ...requiredProductionEnvGroups.flat()]) {
  const present = new Set();
  for (const line of String(output || '').split('\n')) {
    const trimmed = line.trim();
    for (const name of requiredNames) {
      if (trimmed.startsWith(`${name} `) && /\bProduction\b/.test(trimmed)) {
        present.add(name);
      }
    }
  }
  return present;
}

export function urlsFromVercelOutput(output) {
  return [...String(output || '').matchAll(/https:\/\/[^\s]+/g)].map(match => match[0].replace(/[),.]+$/, ''));
}

export function productionAliasesFromVercelInspectOutput(output) {
  return String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('╶ https://') || line.startsWith('- https://'))
    .flatMap(urlsFromVercelOutput);
}

export function productionAliasesFromVercelAliasOutput(output, deploymentUrl) {
  const deploymentHost = String(deploymentUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!deploymentHost) return [];
  return String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith(`${deploymentHost} `))
    .map(line => line.split(/\s+/)[1])
    .filter(Boolean)
    .map(host => `https://${host}`);
}

function fail(message) {
  console.log(`not ready - ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`ok - ${message}`);
}

async function main() {
  if (!existsSync(join(webRoot, '.vercel', 'project.json'))) {
    fail('web/.vercel/project.json is missing; link the Vercel project from the web/ deploy root.');
  } else {
    const project = JSON.parse(readFileSync(join(webRoot, '.vercel', 'project.json'), 'utf8'));
    ok(`web/ is linked to Vercel project ${project.projectName || project.projectId}`);
  }

  checkVercelCron();

  let output = '';
  try {
    output = execFileSync('npx', ['vercel', 'env', 'ls'], {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    fail(`could not read Vercel env vars: ${err.stderr || err.message}`);
  }

  const present = productionEnvNamesFromVercelOutput(output);
  const missing = [];
  for (const name of requiredProductionEnv) {
    if (present.has(name)) ok(`Vercel production env has ${name}`);
    else {
      missing.push(name);
      fail(`Vercel production env is missing ${name}`);
    }
  }
  for (const group of requiredProductionEnvGroups) {
    const found = group.find(name => present.has(name));
    if (found) ok(`Vercel production env has ${found}`);
    else {
      missing.push(group[0]);
      fail(`Vercel production env is missing one of ${group.join(' or ')}`);
    }
  }

  if (process.exitCode) {
    console.log('\nAdd missing values from the web deploy root, for example:');
    console.log('  cd web');
    for (const name of missing) {
      console.log(`  vercel env add ${name} production`);
    }
  } else {
    const project = JSON.parse(readFileSync(join(webRoot, '.vercel', 'project.json'), 'utf8'));
    await checkProductionHealth(project);
    if (!process.exitCode) console.log('cloud deploy readiness checks passed');
  }
}

async function checkProductionHealth(project) {
  const hosts = productionHealthHosts(project);
  if (!hosts.length) {
    fail('could not infer production URL from web/.vercel/project.json');
    return;
  }

  const failures = [];
  for (const host of hosts) {
    let resp, data;
    try {
      resp = await fetch(`${host}/api/health/cloud`, { cache: 'no-store' });
      data = await resp.json();
    } catch (err) {
      failures.push(`${host}: ${err.message || err}`);
      continue;
    }

    if (!resp.ok || data?.ok !== true) {
      const missing = Array.isArray(data?.missing) ? data.missing.join(', ') : `HTTP ${resp.status}`;
      fail(`production cloud health is not ready at ${host}/api/health/cloud: ${missing}`);
      return;
    }

    if (data.schema && data.schema.ok !== true) {
      const missing = Array.isArray(data.schema.missing) ? data.schema.missing.join(', ') : 'unknown schema check';
      fail(`production Supabase schema health is not ready at ${host}/api/health/cloud: ${missing}`);
      return;
    }

    ok(`production cloud health passed at ${host}/api/health/cloud`);
    return;
  }

  fail(`could not read production cloud health: ${failures.join('; ')}`);
}

function productionHealthHosts(project) {
  const hosts = [];
  try {
    const deployments = execFileSync('npx', ['vercel', 'ls', project.projectName], {
      cwd: webRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const latestDeployment = urlsFromVercelOutput(deployments)[0];
    if (latestDeployment) {
      const aliasList = execFileSync('npx', ['vercel', 'alias', 'ls'], {
        cwd: webRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      hosts.push(...productionAliasesFromVercelAliasOutput(aliasList, latestDeployment));
      const inspect = execFileSync('npx', ['vercel', 'inspect', latestDeployment], {
        cwd: webRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      hosts.push(...productionAliasesFromVercelInspectOutput(inspect));
    }
  } catch {}

  if (project.projectName) hosts.push(`https://${project.projectName}.vercel.app`);
  const seen = new Set();
  return hosts.filter(host => {
    if (seen.has(host)) return false;
    seen.add(host);
    return true;
  });
}

function checkVercelCron() {
  const configPath = join(webRoot, 'vercel.json');
  if (!existsSync(configPath)) {
    fail('web/vercel.json is missing; cloud timeout recovery cron is not configured.');
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    fail(`web/vercel.json is not valid JSON: ${err.message}`);
    return;
  }

  const sweepCron = (config.crons || []).find(cron => cron?.path === '/api/gen/sweep');
  if (!sweepCron) {
    fail('web/vercel.json is missing the /api/gen/sweep cron for automatic cloud recovery.');
    return;
  }
  if (sweepCron.schedule !== '0 0 * * *') {
    fail(`/api/gen/sweep cron should use the Hobby-compatible daily schedule, found "${sweepCron.schedule || 'missing'}".`);
    return;
  }
  ok('web/vercel.json runs /api/gen/sweep once daily (Vercel Hobby compatible)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
