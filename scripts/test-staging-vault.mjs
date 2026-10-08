import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVaultKey, assertVaultKey, repairLegacyVaultEncoding } from './packaging/staging-vault.mjs';
import { sealProviderKey, openProviderKey } from '../web/api/_lib/provider-vault.mjs';
let checks = 0;
function check(fn) { fn(); checks++; }
check(() => assert.match(createVaultKey(), /^[a-f0-9]{64}$/));
check(() => assert.notEqual(createVaultKey(), createVaultKey()));
const bytes = Buffer.alloc(32, 42), legacy = bytes.toString('base64');
check(() => assert.throws(() => assertVaultKey(legacy), /encoded as hex/));
check(() => assert.deepEqual(Buffer.from(repairLegacyVaultEncoding(legacy), 'hex'), bytes));
for (const bad of [undefined, '', 'abc', legacy + '\n', bytes.toString('hex')]) {
  check(() => assert.throws(() => repairLegacyVaultEncoding(bad)));
}
const previous = process.env.LEARNABLE_PROVIDER_VAULT_KEY;
try {
  process.env.LEARNABLE_PROVIDER_VAULT_KEY = legacy;
  check(() => assert.throws(() => sealProviderKey('non-billable-fixture', 'qa-owner'), /not configured/));
  process.env.LEARNABLE_PROVIDER_VAULT_KEY = repairLegacyVaultEncoding(legacy);
  const sealed = sealProviderKey('non-billable-fixture', 'qa-owner');
  check(() => assert.equal(openProviderKey(sealed, 'qa-owner'), 'non-billable-fixture'));
  check(() => assert.throws(() => openProviderKey(sealed, 'another-owner')));
  check(() => assert.throws(() => openProviderKey(sealed, 'qa-owner', 'openai')));
} finally {
  if (previous === undefined) delete process.env.LEARNABLE_PROVIDER_VAULT_KEY;
  else process.env.LEARNABLE_PROVIDER_VAULT_KEY = previous;
}
check(() => assert.match(readFileSync(new URL('./provision-learnable-staging.mjs', import.meta.url), 'utf8'), /secrets\.vaultKey \|\|= createVaultKey\(\)/));
check(() => assert.match(readFileSync(new URL('./deploy-learnable-staging.mjs', import.meta.url), 'utf8'), /assertVaultKey\(secret\.vaultKey\)/));
console.log(`Staging vault contracts passed (${checks} checks; no network or credentials printed).`);
