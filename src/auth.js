// Accounts. Every page talks to `auth` only, so the sign-in service can be swapped without touching the pages.
//
// Flow: sign up with Google, or with email + password -> a 6-digit code is emailed -> enter it -> signed in.
// Log in with Google, or email + password (an account whose email isn't confirmed yet gets a new code first).
//
// shortcut: until a real sign-in service is connected, a stand-in keeps accounts in this browser and shows the
// code on screen instead of emailing it. It only runs on the dev server (npm run dev); a published build refuses
// to sign anyone in rather than pretend. Replace createDevAuth with the real service's client when it's chosen.

const CODE_TTL_MS = 10 * 60 * 1000;
export class AuthError extends Error {}

// storage: anything with getItem/setItem (localStorage in the browser, a stand-in in tests)
export function createDevAuth(storage, { onCode = () => {} } = {}) {
  const load = () => JSON.parse(storage.getItem('studio.devAuth') || '{"users":{},"session":null}');
  const save = db => storage.setItem('studio.devAuth', JSON.stringify(db));
  const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const cleanEmail = email => {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new AuthError('That doesn\'t look like an email address.');
    return e;
  };
  const checkPassword = pw => {
    if (String(pw || '').length < 8) throw new AuthError('Use at least 8 characters for the password.');
  };
  function sendCode(db, email) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
    db.users[email].code = { code, until: Date.now() + CODE_TTL_MS };
    onCode(email, code);
  }
  const userOf = (email, u) => ({ email, name: u.name || email.split('@')[0], via: u.via });

  return {
    kind: 'dev',
    async currentUser() {
      const db = load();
      return db.session && db.users[db.session]?.verified ? userOf(db.session, db.users[db.session]) : null;
    },
    async signUp(email, password) {
      email = cleanEmail(email);
      checkPassword(password);
      const db = load();
      if (db.users[email]?.verified) throw new AuthError('There\'s already an account with that email. Log in instead.');
      db.users[email] = { password: await hash(password), verified: false, via: 'email' };
      sendCode(db, email);
      save(db);
      return { needsCode: true, email };
    },
    async verifyCode(email, code) {
      email = cleanEmail(email);
      const db = load(), u = db.users[email];
      if (!u?.code || Date.now() > u.code.until) throw new AuthError('That code has expired. Send a new one.');
      if (String(code).trim() !== u.code.code) throw new AuthError('That code isn\'t right. Check the email and try again.');
      u.verified = true;
      delete u.code;
      db.session = email;
      save(db);
      return userOf(email, u);
    },
    async resendCode(email) {
      email = cleanEmail(email);
      const db = load();
      if (!db.users[email]) throw new AuthError('There\'s no account with that email yet. Sign up first.');
      sendCode(db, email);
      save(db);
    },
    async logIn(email, password) {
      email = cleanEmail(email);
      const db = load(), u = db.users[email];
      if (!u || u.password !== await hash(password)) throw new AuthError('Wrong email or password.');
      if (!u.verified) { sendCode(db, email); save(db); return { needsCode: true, email }; }
      db.session = email;
      save(db);
      return userOf(email, u);
    },
    async logInWithGoogle() {
      // shortcut: stands in for Google's sign-in window until the real service is connected
      const db = load(), email = 'google.tester@gmail.com';
      db.users[email] ??= { verified: true, via: 'google', name: 'Google tester' };
      db.session = email;
      save(db);
      return userOf(email, db.users[email]);
    },
    async logOut() {
      const db = load();
      db.session = null;
      save(db);
    },
  };
}

function notSetUp() {
  const no = async () => { throw new AuthError('Accounts aren\'t set up on this site yet.'); };
  return { kind: 'none', currentUser: async () => null, signUp: no, verifyCode: no, resendCode: no, logIn: no, logInWithGoogle: no, logOut: async () => {} };
}

// Shown on the account page while the stand-in is running, since it can't send real emails.
export const devCodes = new EventTarget();

export const auth = import.meta.env?.DEV
  ? createDevAuth(localStorage, { onCode: (email, code) => devCodes.dispatchEvent(new CustomEvent('code', { detail: { email, code } })) })
  : notSetUp();
