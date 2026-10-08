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
    for (const figure of figures) { figure.querySelector('img')?.removeAttribute('src'); }
  };
  disposeCurrent = dispose;
  if (!figures.length) return dispose;
  unwatch = watchIdentity?.(() => { if (getIdentity()?.id !== owner) { dispose(); for (const figure of figures) figure.querySelector('[role="status"]').textContent = 'Sign in to the course’s owning account to view this private image.'; } });
  const load = async figure => {
    const status = figure.querySelector('[role="status"]'), button = figure.querySelector('button'), img = figure.querySelector('img');
    button.disabled = true; status.textContent = 'Loading your saved image…';
    try {
      const blob = await client.asset(owner,courseId,figure.dataset.privateImage);
      if (disposed || !figure.isConnected || getIdentity()?.id !== owner) return;
      const old = img.getAttribute('src'); if (urls.has(old)) { URL.revokeObjectURL(old); urls.delete(old); }
      const url = URL.createObjectURL(blob); urls.add(url);
      img.onload = () => { if (!disposed) { img.hidden = false; figure.querySelector('[data-private-image-description]').hidden = true; status.textContent = ''; button.hidden = true; } };
      img.onerror = () => { if (!disposed) { img.hidden = true; figure.querySelector('[data-private-image-description]').hidden = false; status.textContent = 'The saved image could not be displayed. Retry loading; this does not generate a new image.'; button.hidden = false; button.disabled = false; } };
      img.src = url;
    } catch (error) { if (!disposed) { status.textContent = error.message; button.hidden = false; button.disabled = false; } }
  };
  for (const figure of figures) { figure.querySelector('button').onclick = () => load(figure); load(figure); }
  return dispose;
}
