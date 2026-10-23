// Emails the 6-digit code that confirms a new account, through Resend (free plan: 3,000 emails a month).
import Resend from '@auth/core/providers/resend';
import { Resend as ResendAPI } from 'resend';
import { generateRandomString, type RandomReader } from '@oslojs/crypto/random';

export const ResendOTP = Resend({
  id: 'resend-otp',
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 10 * 60, // the code works for 10 minutes
  async generateVerificationToken() {
    const random: RandomReader = { read: bytes => crypto.getRandomValues(bytes) };
    return generateRandomString(random, '0123456789', 6);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const { error } = await new ResendAPI(provider.apiKey).emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? 'Bot Bench <onboarding@resend.dev>',
      to: [email],
      subject: `Your Bot Bench code: ${token}`,
      text: `Your Bot Bench code is ${token}\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email.`,
    });
    if (error) throw new Error('Could not send the code email');
  },
});
