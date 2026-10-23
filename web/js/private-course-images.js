import { getUser, onUserChange } from './auth.js?v=33';
import { createCourseImageClient } from './course-image-client.js?v=5';

// Blob URLs live only for the currently mounted lesson and account. The course
// record always retains the stable asset ID, never an expiring URL or PNG bytes.
let disposeCurrent = () => {};
export function disposePrivateCourseImages() { disposeCurrent(); }
export function mountPrivateCourseImages(container, courseId, { client = createCourseImageClient(), getIdentity = getUser, watchIdentity = onUserChange } = {}) {
  disposeCurrent();
  const owner = getIdentity()?.id, urls = new Set(); let disposed = false;
  const figures = [...container.querySelectorAll('[data-private-image]')];
  let unwatch;
  const dispose = () => {
    if (disposed) return; disposed = true; unwatch?.();
    for (const url of urls) URL.revokeObjectURL(url); urls.clear();
    for (const figure of figures) {
      const img = figure.querySelector('img');
      img.onload = null; img.onerror = null; img.hidden = true; img.removeAttribute('src');
      figure.querySelector('button').onclick = null;
    }
  };
  disposeCurrent = dispose;
  if (!figures.length) return dispose;
  const state = (figure, value, message = '') => {
    figure.dataset.imageState = value;
    figure.querySelector('.private-image-frame').setAttribute('aria-busy', String(value === 'loading'));
    figure.querySelector('[data-private-image-placeholder]').hidden = value === 'ready';
    figure.querySelector('[role="status"]').textContent = message;
    figure.querySelector('img').hidden = value !== 'ready';
    const button = figure.querySelector('button');
    button.hidden = value !== 'error'; button.disabled = value !== 'error';
  };
  unwatch = watchIdentity?.(() => { if (getIdentity()?.id !== owner) {
    dispose(); for (const figure of figures) state(figure, 'account', 'Sign in to the course’s owning account to view this private image.');
  } });
  const load = async figure => {
    if (disposed) return;
    const img = figure.querySelector('img');
    state(figure, 'loading', 'Loading image…');
    try {
      const blob = await client.asset(owner,courseId,figure.dataset.privateImage);
      if (disposed || !figure.isConnected || getIdentity()?.id !== owner) return;
      const old = img.getAttribute('src'); if (urls.has(old)) { URL.revokeObjectURL(old); urls.delete(old); }
      const url = URL.createObjectURL(blob); urls.add(url);
      img.onload = () => { if (!disposed) state(figure, 'ready'); };
      img.onerror = () => { if (!disposed) {
        URL.revokeObjectURL(url); urls.delete(url); img.removeAttribute('src');
        state(figure, 'error', 'The saved image could not be displayed. Retry loading; this does not generate a new image.');
      } };
      img.src = url;
    } catch (error) { if (!disposed) state(figure, 'error', error?.message || 'The saved image could not be loaded. Retry loading the same image.'); }
  };
  for (const figure of figures) {
    figure.querySelector('button').onclick = () => { if (figure.dataset.imageState === 'error') load(figure); };
    load(figure);
  }
  return dispose;
}
