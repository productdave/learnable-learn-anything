import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

export function assertVaultKey(value) {
  // Do not include the submitted credential in assertion diagnostics.
  assert.ok(typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value), 'Staging vault key must be 32 bytes encoded as hex.');
  return value;
}
export function createVaultKey() { return assertVaultKey(randomBytes(32).toString('hex')); }
export function repairLegacyVaultEncoding(value) {
  assert.ok(typeof value === 'string', 'Missing staging vault key.');
  assert.ok(!/^[a-f0-9]{64}$/i.test(value), 'Vault already uses hex; no repair needed.');
  const bytes = Buffer.from(value, 'base64');
  assert.ok(bytes.length === 32 && bytes.toString('base64') === value, 'Refusing unknown staging vault encoding.');
  return assertVaultKey(bytes.toString('hex'));
}
