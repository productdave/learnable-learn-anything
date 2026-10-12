import { escapeHome as esc } from './home-model.js?v=7';

const messages = {
  included: ['Complimentary credits', 'Credit-based course creation is coming soon. You won’t need to connect an API key.'],
  empty: ['No credits available', 'Your account has no complimentary credits yet. Credit purchases are not available yet.'],
  not_invited: ['Credit access is not enabled', 'This account has not been invited to the credits pilot yet.'],
  paused: ['Credit access is paused', 'Your balance is retained. New credit-based creation is paused for this account.'],
  revoked: ['Credit access is unavailable', 'New credit-based creation is unavailable for this account.'],
  expired: ['Credit access has expired', 'Your previous balance is shown below. It cannot be used while access is expired.'],
};
export function fundedAccessHTML(access) {
  const [title, description] = messages[access?.status] || ['Account status unavailable', 'We couldn’t confirm your access or balance. Try again.'];
  const b = access?.balance;
  const known = b && ['available','reserved','used'].every(key => Number.isSafeInteger(b[key]) && b[key] >= 0);
  const usable = ['included','empty'].includes(access?.status);
  return `<section class="funded-access" aria-label="Course credits">
    <h3>${esc(title)}</h3><p class="auth-note">${esc(description)}</p>
    ${known ? `<dl class="funded-balance"><div><dt>${usable ? 'Available' : 'Unspent'}</dt><dd>${b.available.toLocaleString('en-US')}</dd></div><div><dt>Reserved</dt><dd>${b.reserved.toLocaleString('en-US')}</dd></div><div><dt>Used</dt><dd>${b.used.toLocaleString('en-US')}</dd></div></dl><p class="auth-note">Learnable credits · separate from model tokens.</p>` : '<p class="auth-note">Balance unavailable</p>'}
    <p class="auth-note">Saved courses and manual editing remain available.</p>
  </section>`;
}
