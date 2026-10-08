import { store } from '../store.js?v=5';
import { flushSync } from '../sync.js?v=27';

// Only show a call to action when preservation actually needs attention.
export function renderLearningStatus(container) {
  let node = container.querySelector('.learning-save-warning');
  const state = store.getSaveStatus();
  if (state.persisted) for (const message of container.querySelectorAll('[data-save-failed="true"]')) {
    message.dataset.saveFailed = 'false';
    message.textContent = state.signedIn && state.sync === 'saved' ? 'Progress saved to your account.' : 'Progress saved on this device.';
  }
  const recovering = !!node && state.signedIn && ['pending', 'saving'].includes(state.sync);
  if (state.persisted && state.sync !== 'error' && !recovering) { node?.remove(); return; }
  if (!node) {
    node = document.createElement('div'); node.className = 'learning-save-warning';
    node.setAttribute('role', 'status');
    node.innerHTML = '<p></p><button type="button">Retry saving progress</button>';
    (container.querySelector('.topic-complete-section') || container).appendChild(node);
    node.querySelector('button').addEventListener('click', async () => {
      const button = node.querySelector('button'); button.disabled = true;
      store.retryLocalSave();
      try { await flushSync(); } catch {}
      button.disabled = false; renderLearningStatus(container);
    });
  }
  node.querySelector('p').textContent = !state.persisted
    ? 'Progress is held on this page but could not be saved on this device. Keep the page open and retry.'
    : recovering ? 'Saving your progress to your account… Your work is still available here.'
    : 'Progress is saved on this device, but account sync failed. Reconnect and retry to use it on another device.';
  node.querySelector('button').disabled = state.sync === 'saving';
}
