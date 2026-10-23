import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConvexAuth } from '../src/auth.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const api = { auth: { signIn: 'auth:signIn', signOut: 'auth:signOut' }, saves: { me: 'saves:me', get: 'saves:get', put: 'saves:put' } };

// A pretend Convex backend with Convex Auth's answers.
function fakeConvex() {
  const state = { code: '123456', valid: new Set(), saved: {}, calls: [] };
  class Client {
    setAuth(t) { this.t = t; } clearAuth() { this.t = null; }
    async action(fn, args) {
      state.calls.push([fn, args]);
      if (fn === 'auth:signOut') { state.valid.delete(this.t); return null; }
      if (args.refreshToken) { if (args.refreshToken !== 'r1') throw new Error('bad refresh'); state.valid.add('t2'); return { tokens: { token: 't2', refreshToken: 'r1' } }; }
      const p = args.params;
      if (p.flow === 'signUp' || (p.flow === 'signIn' && !state.verified)) { if (p.password === 'wrongpass1') throw new Error('InvalidSecret'); return { tokens: null }; }
      if (p.flow === 'email-verification') { if (p.code !== state.code) throw new Error('Could not verify code'); state.verified = true; state.valid.add('t1'); return { tokens: { token: 't1', refreshToken: 'r1' } }; }
      if (p.flow === 'signIn') { if (p.password === 'wrongpass1') throw new Error('InvalidSecret'); state.valid.add('t1'); return { tokens: { token: 't1', refreshToken: 'r1' } }; }
    }
    async query(fn) { if (!state.valid.has(this.t)) return null; return fn === 'saves:me' ? { email: 'kid@gmail.com', name: 'kid' } : state.saved; }
    async mutation(fn, { data }) { if (!state.valid.has(this.t)) throw new Error('Not signed in'); state.saved = data; }
  }
  return { Client, state };
}

test('sign up -> code -> signed in; saves go to the account; an expired token refreshes; log out', async () => {
  const { Client, state } = fakeConvex(), storage = memory();
  const a = createConvexAuth('https://x.convex.cloud', { storage, Client, api });
  assert.deepEqual(await a.signUp(' Kid@Gmail.com', 'robots4ever'), { needsCode: true, email: 'kid@gmail.com' });
  await assert.rejects(a.verifyCode('kid@gmail.com', '000000'), /isn't right/);
  assert.equal((await a.verifyCode('kid@gmail.com', '123456')).email, 'kid@gmail.com');
  assert.equal((await a.currentUser()).email, 'kid@gmail.com');
  assert.equal(await a.save({ 'studio.model': '1 0 0 0 0' }), true);
  assert.deepEqual(await a.load(), { 'studio.model': '1 0 0 0 0' });
  state.valid.delete('t1'); // the access token runs out
  assert.equal((await a.currentUser()).email, 'kid@gmail.com', 'refreshed with the refresh token');
  await a.logOut();
  assert.equal(await a.currentUser(), null);
  assert.equal(storage.m.size, 0, 'tokens removed');
});

test('wrong password gets a plain message', async () => {
  const { Client } = fakeConvex();
  const a = createConvexAuth('https://x.convex.cloud', { storage: memory(), Client, api });
  await assert.rejects(a.logIn('kid@gmail.com', 'wrongpass1'), /Wrong email or password/);
});
