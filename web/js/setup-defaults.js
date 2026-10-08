import { sb, getUser, onUserChange } from './auth.js?v=33';
import { createMaterialDefaultsClient, STANDARD_MATERIALS, canonicalMaterials } from './material-defaults.js?v=4';
import { COMPONENT_LABELS } from './setup-model.js?v=7';

export const materialDefaults = createMaterialDefaultsClient({ getClient: sb, getIdentity: getUser, subscribeIdentity: onUserChange });
export const defaultsPanelHTML = () => `<section class="setup-defaults" aria-labelledby="setup-defaults-title">
  <h3 id="setup-defaults-title">Materials for future courses</h3>
  <p class="source-help">Changes above apply only to this course. Save them as defaults to use them in new courses too.</p>
  <p class="source-help" data-defaults-notice hidden></p>
  <p data-defaults-selection></p>
  <div class="setup-defaults-actions">
    <button type="button" class="home-button home-button--secondary" data-defaults="save" disabled>Save these materials as my defaults</button>
    <button type="button" class="home-button home-button--secondary" data-defaults="apply" hidden>Apply my defaults to this course</button>
    <button type="button" class="home-draft-link" data-defaults="reset" hidden>Reset future defaults</button>
    <button type="button" class="home-button home-button--secondary" data-defaults="reload" hidden>Reload defaults</button>
  </div><p class="source-help" data-defaults-message role="status" aria-live="polite" tabindex="-1"></p>
</section>`;

export function mountDefaultsPanel(host, { owner, client = materialDefaults, getComponents, apply, active, signal, notice = '', allowApply = true }) {
  let saved = null, working = false, failed = false, message = notice;
  const buttons = Object.fromEntries([...host.querySelectorAll('[data-defaults]')].map(button => [button.dataset.defaults, button]));
  const valid = () => active() && !signal.aborted;
  function update() {
    if (!valid()) return;
    let same = false, supported = true;
    try { same = JSON.stringify(canonicalMaterials(getComponents())) === JSON.stringify(saved?.components); } catch { supported = false; }
    host.querySelector('[data-defaults-selection]').textContent = saved ? `Saved defaults: ${saved.components.map(value => COMPONENT_LABELS[value]).join(', ')}.` : '';
    host.querySelector('[data-defaults-notice]').hidden = !notice;
    host.querySelector('[data-defaults-notice]').textContent = notice;
    buttons.save.disabled = working || failed || !saved || !supported || same;
    buttons.apply.hidden = !allowApply || !saved || same; buttons.apply.disabled = working || failed;
    buttons.reset.hidden = !saved?.custom || JSON.stringify(saved.components) === JSON.stringify(STANDARD_MATERIALS); buttons.reset.disabled = working || failed;
    buttons.reload.hidden = !failed; buttons.reload.disabled = working;
    buttons.save.textContent = same && !working && !failed ? 'These materials match your defaults' : 'Save these materials as my defaults';
    host.querySelector('[data-defaults-message]').textContent = message;
  }
  async function load() {
    working = true; message = 'Loading your account defaults…'; update();
    try { saved = await client.load(owner); failed = false; message = 'Defaults only affect new courses. Existing courses and setups stay unchanged.'; }
    catch (error) { failed = true; message = error.message; }
    finally { working = false; update(); }
  }
  host.addEventListener('click', async event => {
    const action = event.target.closest('[data-defaults]')?.dataset.defaults;
    if (!action || working || !valid()) return;
    if (action === 'reload') { await load(); return; }
    if (!saved || failed) return;
    if (action === 'apply') { apply([...saved.components]); message = 'Defaults applied to this course only. Your other setup details are unchanged.'; update(); host.querySelector('[data-defaults-message]').focus(); return; }
    const components = action === 'reset' ? [...STANDARD_MATERIALS] : [...getComponents()];
    working = true; message = 'Saving defaults to your account…'; update();
    try {
      saved = await client.save(owner, components, saved.revision);
      message = action === 'reset' ? 'Future courses will start with lessons, useful course images, quizzes and flashcards. This course is unchanged.' : 'Saved to your account for new courses. Lessons and useful images are part of course creation. Existing courses are unchanged.';
    } catch (error) { failed = true; message = error.message; }
    finally {
      working = false; update();
      if (valid() && (document.activeElement === buttons[action] || document.activeElement === document.body)) host.querySelector('[data-defaults-message]').focus();
    }
  }, { signal });
  void load();
  return { update };
}
