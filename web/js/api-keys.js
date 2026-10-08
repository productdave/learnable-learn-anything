export const API_KEY_PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    status: 'Required now',
    placeholder: 'sk-ant-...',
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    guideUrl: 'https://docs.anthropic.com/en/api/getting-started',
    help: 'Used today for curriculum design, research, lesson writing, and tutor chat.'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    status: 'Future image + multimodal adapter',
    placeholder: 'sk-...',
    dashboardUrl: 'https://platform.openai.com/api-keys',
    guideUrl: 'https://platform.openai.com/docs/quickstart',
    help: 'Reserved for future image generation, multimodal models, and evaluation experiments.'
  },
  {
    id: 'google',
    label: 'Google Gemini',
    status: 'Future search + multimodal adapter',
    placeholder: 'AIza...',
    dashboardUrl: 'https://aistudio.google.com/apikey',
    guideUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    help: 'Reserved for future Gemini search, grounding, and multimodal workflows.'
  }
];

export const LEGACY_ANTHROPIC_KEY_STORE = 'gametheory-api-key';

function keyStore(providerId) {
  return providerId === 'anthropic'
    ? LEGACY_ANTHROPIC_KEY_STORE
    : `learnable-api-key-${providerId}`;
}

export function getProviderKey(providerId) {
  return localStorage.getItem(keyStore(providerId)) || '';
}

export function setProviderKey(providerId, value) {
  const key = (value || '').trim();
  const store = keyStore(providerId);
  if (key) localStorage.setItem(store, key);
  else localStorage.removeItem(store);
}

export function getAllProviderKeys() {
  return Object.fromEntries(
    API_KEY_PROVIDERS
      .map(provider => [provider.id, getProviderKey(provider.id)])
      .filter(([, key]) => !!key)
  );
}

export function setAllProviderKeys(keys = {}) {
  for (const provider of API_KEY_PROVIDERS) {
    const value = keys?.[provider.id];
    if (value) setProviderKey(provider.id, value);
  }
}

export function clearAllProviderKeys() {
  for (const provider of API_KEY_PROVIDERS) setProviderKey(provider.id, '');
}

export function getAnthropicKey() {
  return getProviderKey('anthropic');
}

export function setAnthropicKey(value) {
  setProviderKey('anthropic', value);
}

export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 14) return '••••••••';
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}
