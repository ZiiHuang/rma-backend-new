import { supabaseAdmin } from '../../lib/supabase.js';
import { sendBasicEmail } from '../../lib/email.js';
import { DateTime } from 'luxon';

export default async function handler(req, res) {
  const version = 'reminders-fresh';
  res.setHeader('Cache-Control', 'no-store');
  try {
    const tz = process.env.TIMEZONE || 'UTC';
    const now = DateTime.now().setZone(tz);
    const today = now.toISODate();
    const in3 = now.plus({ days: 3 }).toISODate();
    const ACTIVE = ['incomplete', 'pending'];

    async function loadDue(dateISO) {
      const { data, error } = await supabaseAdmin
        .from('assignments')
        .select('id,title,due_date,status, assignment_emails ( email )')
        .eq('due_date', dateISO)
        .in('status', ACTIVE);
      if (error) throw error;
      return data || [];
    }

    const [dueToday, dueIn3] = await Promise.all([loadDue(today), loadDue(in3)]);

    const queue = [];
    const sendTo = (a, subject, html) => {
      const recips = (a.assignment_emails || []).map(x => x.email).filter(Boolean);
      for (const to of recips) queue.push(sendBasicEmail({ to, subject, html }));
    };

    for (const a of dueIn3) {
      sendTo(a, `Reminder: "${a.title}" due ${a.due_date}`,
        `<p>Hello,</p><p>This is a friendly reminder that <strong>${a.title}</strong> is due on <strong>${a.due_date}</strong>.</p>`);
    }
    for (const a of dueToday) {
      sendTo(a, `Due today: "${a.title}"`,
        `<p>Hello,</p><p><strong>${a.title}</strong> is <strong>due today (${a.due_date})</strong>.</p>`);
    }

    const results = await Promise.allSettled(queue);
    res.status(200).json({
      ok: true, version, tz,
      today, due_today: dueToday.length, due_in_3_days: dueIn3.length,
      attempted_sends: queue.length,
      successes: results.filter(r => r.status === 'fulfilled').length,
      failures: results.filter(r => r.status === 'rejected').length
    });
  } catch (e) {
    res.status(500).json({ ok: false, version, error: String(e.message || e) });
  }
}
