import { Resend } from 'resend';
export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendBasicEmail({ to, subject, html, from }) {
  const sender = from || process.env.MAIL_FROM; // allow override if needed
  if (!sender) throw new Error('Missing MAIL_FROM');
  return resend.emails.send({ from: sender, to, subject, html });
}
