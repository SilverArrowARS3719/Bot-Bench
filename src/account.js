// Sign up / log in page: Google, or email + password; new accounts confirm the email with a 6-digit code.
import '@fontsource-variable/geist';
import { auth, AuthError, devCodes } from './auth.js';

const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
// only go on to a page on this site (a crafted link mustn't send people elsewhere after they log in)
const next = /^\/(?!\/)[\w./-]*$/.test(params.get('next') || '') ? params.get('next') : '/studio.html';
let mode = params.get('mode') === 'login' ? 'login' : 'signup';
let email = '';

const user = await auth.currentUser().catch(() => null);
if (user) location.replace(next); // already signed in

function showMode() {
  const signup = mode === 'signup';
  document.title = `${signup ? 'Sign up' : 'Log in'} · Robot Studio`;
  $('#title').textContent = signup ? 'Create your account' : 'Welcome back';
  $('#subtitle').textContent = signup ? 'To save your robots and use the studio.' : 'Log in to open the studio.';
  $('#submit').textContent = signup ? 'Create account' : 'Log in';
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#pw-hint').hidden = !signup;
  $('#switch').innerHTML = signup
    ? 'Already have an account? <a href="#" data-mode="login">Log in</a>'
    : 'New here? <a href="#" data-mode="signup">Create an account</a>';
  $('#error').textContent = '';
}
$('#switch').addEventListener('click', e => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (!m) return;
  e.preventDefault();
  mode = m;
  history.replaceState(null, '', `?mode=${m}${params.get('next') ? `&next=${encodeURIComponent(next)}` : ''}`);
  showMode();
});
showMode();

const fail = (where, err) => {
  where.textContent = err instanceof AuthError ? err.message : 'Something went wrong. Check your connection and try again.';
  if (!(err instanceof AuthError)) console.error(err);
};
async function busy(button, fn) {
  button.disabled = true;
  try { await fn(); } finally { button.disabled = false; }
}
function askForCode(to) {
  email = to;
  $('#sent-to').textContent = to;
  $('#start').hidden = true;
  $('#verify').hidden = false;
  $('#code').value = '';
  $('#verify-error').textContent = '';
  $('#code').focus();
}

$('#show').addEventListener('click', () => {
  const pw = $('#password'), shown = pw.type === 'text';
  pw.type = shown ? 'password' : 'text';
  $('#show').textContent = shown ? 'Show' : 'Hide';
  $('#show').setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
});

$('#google').addEventListener('click', () => busy($('#google'), async () => {
  try { await auth.logInWithGoogle(next); location.replace(next); } catch (err) { fail($('#error'), err); }
}));

$('#start').addEventListener('submit', e => {
  e.preventDefault();
  busy($('#submit'), async () => {
    $('#error').textContent = '';
    try {
      const result = mode === 'signup' ? await auth.signUp($('#email').value, $('#password').value) : await auth.logIn($('#email').value, $('#password').value);
      if (result?.needsCode) askForCode(result.email);
      else location.replace(next);
    } catch (err) { fail($('#error'), err); }
  });
});

$('#code').addEventListener('input', () => {
  $('#code').value = $('#code').value.replace(/\D/g, '').slice(0, 6);
  if ($('#code').value.length === 6) $('#verify').requestSubmit(); // no need to press the button
});
$('#verify').addEventListener('submit', e => {
  e.preventDefault();
  busy($('#verify button.primary'), async () => {
    try { await auth.verifyCode(email, $('#code').value); location.replace(next); } catch (err) { fail($('#verify-error'), err); }
  });
});

// a new code at most every 30 s, so a double click doesn't send two emails
let wait = 0;
$('#resend').addEventListener('click', async () => {
  if (wait > Date.now()) return;
  try {
    await auth.resendCode(email);
    $('#verify-error').textContent = '';
    wait = Date.now() + 30000;
    const b = $('#resend'), tick = () => {
      const s = Math.ceil((wait - Date.now()) / 1000);
      b.textContent = s > 0 ? `New code sent (again in ${s} s)` : 'Send a new code';
      b.disabled = s > 0;
      if (s > 0) setTimeout(tick, 1000);
    };
    tick();
  } catch (err) { fail($('#verify-error'), err); }
});
$('#back').addEventListener('click', () => { $('#verify').hidden = true; $('#start').hidden = false; $('#email').focus(); });

// the stand-in can't send email: show the code on the page instead
if (auth.kind === 'dev') {
  $('#dev-note').hidden = false;
  devCodes.addEventListener('code', e => {
    $('#dev-code').hidden = false;
    $('#dev-code').textContent = `Test mode code for ${e.detail.email}: ${e.detail.code}`;
  });
}
if (auth.kind === 'none') $('#error').textContent = 'Accounts aren\'t set up on this site yet.';
