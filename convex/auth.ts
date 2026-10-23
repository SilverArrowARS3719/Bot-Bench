import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';
import Google from '@auth/core/providers/google';
import { ResendOTP } from './ResendOTP';

// Email + password (new accounts confirm the email with a code), or Google.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ verify: ResendOTP }), Google],
});
