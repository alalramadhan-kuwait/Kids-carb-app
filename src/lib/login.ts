// Sign-in names: a short username («rawan») or a real email. The sign-in system needs an email, so a username is kept
// as «rawan@layan.local» and shown without that tail. The shift app (Timekeeper) shares the system with its own
// «…@manpower-control.local» accounts. Pure.
export const LAYAN_DOMAIN = 'layan.local';
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,23}$/;

/** What was typed → the email to sign in with (a username gets the app's own tail); null when it is neither. */
export function loginEmail(typed: string): string | null {
  const s = typed.trim().toLowerCase();
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
  return USERNAME.test(s) ? `${s}@${LAYAN_DOMAIN}` : null;
}
/** How an account is shown: its username for app accounts, else the email. */
export const shownLogin = (email: string | null | undefined) => (email ?? '').replace(new RegExp(`@${LAYAN_DOMAIN.replace('.', '\\.')}$`, 'i'), '');
/** An account of the shift app (its email cannot be changed here; a password change changes it there too). */
export const isShiftAccount = (email: string | null | undefined) => /\.local$/i.test(email ?? '') && !new RegExp(`@${LAYAN_DOMAIN.replace('.', '\\.')}$`, 'i').test(email ?? '');
