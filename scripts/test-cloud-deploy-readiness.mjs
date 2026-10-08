import assert from 'node:assert/strict';
import {
  productionAliasesFromVercelAliasOutput,
  productionAliasesFromVercelInspectOutput,
  productionEnvNamesFromVercelOutput,
  urlsFromVercelOutput
} from './check-cloud-deploy-readiness.mjs';

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET'
];

const output = `
Vercel CLI 54.6.1
 name                       value               environments              created
 SUPABASE_URL               Encrypted           Production                18d ago
 SUPABASE_ANON_KEY          Encrypted           Preview                   18d ago
 SUPABASE_SECRET_KEY        Encrypted           Production                1h ago
 SUPABASE_SERVICE_ROLE_KEY  Encrypted           Development, Preview      2h ago
 CRON_SECRET                Encrypted           Preview, Production       21h ago
 OTHER_SECRET               Encrypted           Production                1h ago
`;

const present = productionEnvNamesFromVercelOutput(output, required);

assert.equal(present.has('SUPABASE_URL'), true);
assert.equal(present.has('CRON_SECRET'), true);
assert.equal(present.has('SUPABASE_SECRET_KEY'), true);
assert.equal(present.has('SUPABASE_ANON_KEY'), false);
assert.equal(present.has('SUPABASE_SERVICE_ROLE_KEY'), false);
assert.equal(present.has('OTHER_SECRET'), false);

const inspectOutput = `
  General
    url   https://learnable-abc-team.vercel.app

  Aliases
    ╶ https://learnable-tau.vercel.app
    ╶ https://learnable-team.vercel.app
`;

assert.deepEqual(urlsFromVercelOutput('see https://one.vercel.app and https://two.vercel.app.'), [
  'https://one.vercel.app',
  'https://two.vercel.app'
]);
assert.deepEqual(productionAliasesFromVercelInspectOutput(inspectOutput), [
  'https://learnable-tau.vercel.app',
  'https://learnable-team.vercel.app'
]);
assert.deepEqual(
  productionAliasesFromVercelAliasOutput(
    'learnable-abc-team.vercel.app  learnable-tau.vercel.app  1m\nother.vercel.app  other-alias.vercel.app  1m',
    'https://learnable-abc-team.vercel.app'
  ),
  ['https://learnable-tau.vercel.app']
);

console.log('cloud deploy readiness parser tests passed');
