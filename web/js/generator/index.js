// Course generation now has one production runner: the account-owned cloud
// generation_jobs pipeline. This browser module only manages the shared
// Anthropic key slot used by chat, sync, and the cloud generation APIs.

// The slot name is legacy from the original app. Keep it so existing saved
// keys migrate without ceremony.
import { getAnthropicKey, setAnthropicKey } from '../api-keys.js?v=1';

export function hasApiKey() {
  return !!getAnthropicKey();
}

export function getApiKey() {
  return getAnthropicKey();
}

export function setApiKey(k) {
  setAnthropicKey(k || '');
}
