import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevAuth, auth } from '../src/auth.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('sign up: email + password, then the 6-digit code; wrong codes are refused', async () => {
  const codes = [];
  const a = createDevAuth(memory(), { onCode: (email, code) => codes.push(code) });
  await assert.rejects(a.signUp('not-an-email', 'longenough'), /email address/);
  await assert.rejects(a.signUp('kid@gmail.com', 'short'), /8 characters/);
  assert.deepEqual(await a.signUp('Kid@Gmail.com ', 'robots4ever'), { needsCode: true, email: 'kid@gmail.com' });
  assert.equal(await a.currentUser(), null, 'not signed in until the code is entered');
  assert.match(codes[0], /^\d{6}$/);
  await assert.rejects(a.verifyCode('kid@gmail.com', codes[0] === '000000' ? '111111' : '000000'), /isn't right/);
  const user = await a.verifyCode('kid@gmail.com', codes[0]);
  assert.equal(user.email, 'kid@gmail.com');
  assert.equal((await a.currentUser()).email, 'kid@gmail.com');
  await assert.rejects(a.signUp('kid@gmail.com', 'another1'), /already an account/);
});

test('log in: wrong password fails; an unconfirmed account gets a new code first; log out', async () => {
  const codes = [];
  const a = createDevAuth(memory(), { onCode: (e, c) => codes.push(c) });
  await a.signUp('a@b.co', 'password1');
  await assert.rejects(a.logIn('a@b.co', 'password2'), /Wrong email or password/);
  assert.deepEqual(await a.logIn('a@b.co', 'password1'), { needsCode: true, email: 'a@b.co' });
  await a.verifyCode('a@b.co', codes.at(-1));
  await a.logOut();
  assert.equal(await a.currentUser(), null);
  assert.equal((await a.logIn('a@b.co', 'password1')).email, 'a@b.co', 'confirmed: straight in');
});

test('an expired code is refused', async () => {
  const codes = [], store = memory();
  const a = createDevAuth(store, { onCode: (e, c) => codes.push(c) });
  await a.signUp('late@x.io', 'password1');
  const db = JSON.parse(store.getItem('studio.devAuth'));
  db.users['late@x.io'].code.until = Date.now() - 1;
  store.setItem('studio.devAuth', JSON.stringify(db));
  await assert.rejects(a.verifyCode('late@x.io', codes[0]), /expired/);
});

test('outside the dev server the stand-in is off: nobody can sign in until a real service is connected', async () => {
  assert.equal(auth.kind, 'none');
  await assert.rejects(auth.signUp('a@b.co', 'password1'), /aren't set up/);
  assert.equal(await auth.currentUser(), null);
});
