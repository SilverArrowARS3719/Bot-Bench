// The website pages (home, about): show Log in / Sign up or Open the studio / Log out, and send
// "Start building" to sign-up first when nobody is signed in.
import '@fontsource-variable/geist';
import { auth } from './auth.js';

const user = await auth.currentUser().catch(() => null);
document.querySelectorAll('[data-signed-in]').forEach(el => { el.hidden = !user; });
document.querySelectorAll('[data-signed-out]').forEach(el => { el.hidden = !!user; });
document.querySelectorAll('[data-start]').forEach(a => {
  a.href = user ? '/studio.html' : `/account.html?mode=signup&next=${encodeURIComponent('/studio.html')}`;
});
document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
  await auth.logOut();
  location.href = '/';
}));
