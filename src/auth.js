// Accounts. Every page talks to `auth` only, so the sign-in service can be swapped without touching the pages.
//
// Flow: sign up with Google, or with email + password -> a 6-digit code is emailed -> enter it -> signed in.
// Log in with Google, or email + password (an account whose email isn't confirmed yet gets a new code first).
//
// Real accounts run on Convex (createConvexAuth). Without a Convex address, the dev server uses a stand-in that keeps
// accounts in this browser and shows the code on screen; a published build without Convex signs nobody in.

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

// The real thing: Convex Auth (convex/auth.ts), called the way its React helper does, from plain JavaScript.
// Tokens live in localStorage under Convex Auth's own key names; the access token is refreshed when it runs out.
const FRIENDLY = [
  [/InvalidSecret|InvalidAccountId|Invalid credentials/i, 'Wrong email or password.'],
  [/already exists/i, 'There\'s already an account with that email. Log in instead.'],
  [/Invalid code|Could not verify code|verification/i, 'That code isn\'t right or has expired. Check the email, or send a new one.'],
  [/Could not send/i, 'We couldn\'t send the code email. Try again in a minute.'],
  [/TooManyFailedAttempts|rate/i, 'Too many tries. Wait a few minutes, then try again.'],
];
export function createConvexAuth(url, { storage = localStorage, Client, api } = {}) {
  const client = new Client(url);
  const ns = url.replace(/[^a-zA-Z0-9]/g, '');
  const KEY = { jwt: `__convexAuthJWT_${ns}`, refresh: `__convexAuthRefreshToken_${ns}`, verifier: `__convexAuthOAuthVerifier_${ns}` };
  let pendingPassword = null; // kept in memory only, to send a new code without asking again
  const keep = tokens => {
    if (tokens) { storage.setItem(KEY.jwt, tokens.token); storage.setItem(KEY.refresh, tokens.refreshToken); }
    else { storage.removeItem(KEY.jwt); storage.removeItem(KEY.refresh); }
    if (tokens) client.setAuth(tokens.token); else client.clearAuth();
  };
  async function signIn(args) {
    client.clearAuth(); // signing in never needs (or should send) an old token
    try { return await client.action(api.auth.signIn, args); } catch (err) {
      const msg = String(err?.data ?? err?.message ?? err);
      const known = FRIENDLY.find(([re]) => re.test(msg));
      throw known ? new AuthError(known[1]) : err;
    }
  }
  async function refresh() {
    const refreshToken = storage.getItem(KEY.refresh);
    if (!refreshToken) return false;
    try { const r = await signIn({ refreshToken }); keep(r.tokens); return !!r.tokens; } catch { keep(null); return false; }
  }
  // run a call as the signed-in person, refreshing the token once if it has run out
  async function asUser(fn) {
    const jwt = storage.getItem(KEY.jwt);
    if (!jwt && !(await refresh())) return null;
    if (jwt) client.setAuth(jwt);
    try { const out = await fn(); if (out !== null) return out; } catch { /* expired: refresh below */ }
    return (await refresh()) ? fn() : null;
  }
  const password = (params, flow) => signIn({ provider: 'password', params: { ...params, flow } });
  const user = () => asUser(() => client.query(api.saves.me, {}));

  return {
    kind: 'convex',
    async currentUser() {
      // back from Google: swap the one-time ?code= for tokens
      const code = typeof location !== 'undefined' && new URLSearchParams(location.search).get('code');
      const verifier = storage.getItem(KEY.verifier);
      if (code && verifier) {
        storage.removeItem(KEY.verifier);
        const u = new URL(location.href);
        u.searchParams.delete('code');
        history.replaceState(null, '', u);
        keep((await signIn({ params: { code }, verifier })).tokens);
      }
      return user();
    },
    async signUp(email, pw) {
      if (String(pw || '').length < 8) throw new AuthError('Use at least 8 characters for the password.');
      email = String(email || '').trim().toLowerCase();
      const r = await password({ email, password: pw }, 'signUp');
      if (r.tokens) { keep(r.tokens); return user(); }
      pendingPassword = pw;
      return { needsCode: true, email };
    },
    async verifyCode(email, code) {
      const r = await password({ email: String(email).trim().toLowerCase(), code: String(code).trim() }, 'email-verification');
      if (!r.tokens) throw new AuthError('That code isn\'t right or has expired. Check the email, or send a new one.');
      pendingPassword = null;
      keep(r.tokens);
      return user();
    },
    async resendCode(email) {
      if (!pendingPassword) throw new AuthError('Go back and enter your email and password again to get a new code.');
      await password({ email, password: pendingPassword }, 'signIn'); // an unconfirmed account gets a fresh code
    },
    async logIn(email, pw) {
      email = String(email || '').trim().toLowerCase();
      const r = await password({ email, password: pw }, 'signIn');
      if (r.tokens) { keep(r.tokens); return user(); }
      pendingPassword = pw;
      return { needsCode: true, email };
    },
    async logInWithGoogle(next = '/studio.html') {
      const r = await signIn({ provider: 'google', params: { redirectTo: `/account.html?next=${encodeURIComponent(next)}` } });
      storage.setItem(KEY.verifier, r.verifier);
      location.href = r.redirect;
      await new Promise(() => {}); // leaving for Google
    },
    async logOut() {
      await asUser(() => client.action(api.auth.signOut, {})).catch(() => {});
      keep(null);
    },
    // your saved work: { key: text } (convex/saves.ts)
    load: () => asUser(() => client.query(api.saves.get, {})),
    save: data => asUser(() => client.mutation(api.saves.put, { data }).then(() => true)),
  };
}

function notSetUp() {
  const no = async () => { throw new AuthError('Accounts aren\'t set up on this site yet.'); };
  return { kind: 'none', currentUser: async () => null, signUp: no, verifyCode: no, resendCode: no, logIn: no, logInWithGoogle: no, logOut: async () => {} };
}

// Shown on the account page while the stand-in is running, since it can't send real emails.
export const devCodes = new EventTarget();

// VITE_CONVEX_URL (written to .env.local by `npx convex dev`) switches on real accounts, here and when published.
const CONVEX_URL = import.meta.env?.VITE_CONVEX_URL;
export const auth = CONVEX_URL
  ? createConvexAuth(CONVEX_URL, { Client: (await import('convex/browser')).ConvexHttpClient, api: (await import('convex/server')).anyApi })
  : import.meta.env?.DEV
    ? createDevAuth(localStorage, { onCode: (email, code) => devCodes.dispatchEvent(new CustomEvent('code', { detail: { email, code } })) })
    : notSetUp();
