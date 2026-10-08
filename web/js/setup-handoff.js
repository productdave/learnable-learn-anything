import { setupIdentifier } from './setup-account-model.js?v=7';
export const HANDOFF_TTL = 30 * 60 * 1000;
const prefix = 'learnable-setup-handoff:';
export function createSetupHandoffs({ storage, now = Date.now } = {}) {
  if (!storage) { try { storage = globalThis.localStorage; } catch {} }
  const memory = new Map();
  return {
    begin(id, guest) {
      setupIdentifier(id);
      const marker = { id, guest: !!guest, expiresAt: now() + HANDOFF_TTL };
      memory.set(id, marker);
      try { storage.setItem(prefix + id, JSON.stringify(marker)); return true; } catch { return false; }
    },
    read(id) {
      let marker;
      try { marker = JSON.parse(storage.getItem(prefix + id)); } catch {}
      marker ||= memory.get(id);
      return marker?.id === id && typeof marker.guest === 'boolean' && Number.isFinite(marker.expiresAt) && marker.expiresAt > now() && marker.expiresAt <= now() + HANDOFF_TTL ? marker : null;
    },
    clear(id) { memory.delete(id); try { storage.removeItem(prefix + id); } catch {} }
  };
}
export function accountSetupURL(id) { return `?${new URLSearchParams({ draft: setupIdentifier(id), step: 'account' })}`; }
export function setupReturnURL(id, origin) {
  const url = new URL(origin); url.pathname = '/'; url.search = accountSetupURL(id); url.hash = '';
  return url.href;
}
