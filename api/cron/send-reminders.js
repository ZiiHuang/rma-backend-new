import { supabaseAdmin } from '../../lib/supabase.js';
import { sendBasicEmail } from '../../lib/email.js';
import { DateTime } from 'luxon';

async function reserveSend({ assignment_id, email, kind, reminder_date }) {
  // Try to insert a unique row; if it already exists, skip.
  const { error } = await supabaseAdmin
    .from('reminder_sends')
    .insert([{ assignment_id, email, kind, reminder_date }]);
  if (!error) return true;

  // Unique violation -> we've already sent/reserved it today.
  // Postgres code is 23505; Supabase masks codes, so we just treat any error on insert as "already reserved".
  return false;
}

export default async function handler(req, res) {
  const version = 'reminders-idempotent-v1';
  res.setHeader('Cache-Control', 'no-store');

  try {
    const tz = process.env.TIMEZONE || 'UTC';
    const now = DateTime.now().setZone(tz);

    // Optional manual test override: ?date=YYYY-MM-DD
    const url = new URL(req.url, 'http://localhost');
    const paramDate = url.searchParams.get('date');

    const today = (paramDate || now.toISODate());
    const in3 = DateTime.fromISO(today).plus({ days: 3 }).toISODate();

    const loadByDate = async (dateISO) => {
      const { data, error } = await supabaseAdmin
        .from('assignments')
        .select('id,title,due_date,status, assignment_emails ( email )')
        .eq('due_date', dateISO);
      if (error) throw error;
      return (data || []).filter(a => {
        const s = String(a.status || '').toLowerCase();
        return s === 'incomplete' || s === 'pending';
      });
    };

    const [dueToday, dueIn3] = await Promise.all([loadByDate(today), loadByDate(in3)]);

    // In-run de-dupe as extra safety
    const inMemory = new Set();
    const queue = [];

    const enqueue = async (a, kind, subject, html) => {
      const recipients = (a.assignment_emails || []).map(x => String(x.email || '').trim()).filter(Boolean);
      for (const to of recipients) {
        const key = `${a.id}::${to.toLowerCase()}::${kind}::${kind === 'due_today' ? today : in3}`;
        if (inMemory.has(key)) continue;                 // avoid dupes within the same run
        const reserved = await reserveSend({
          assignment_id: a.id,
          email: to.toLowerCase(),
          kind,
          reminder_date: kind === 'due_today' ? today : in3
        });
        if (!reserved) continue;                         // already sent/reserved today -> skip
        inMemory.add(key);
        queue.push(sendBasicEmail({ to, subject, html }));
      }
    };

    for (const a of dueIn3) {
      await enqueue(
        a,
        'due_in_3_days',
        `Reminder: "${a.title}" due ${a.due_date}`,
        `<p>Hello,</p><p>This is a friendly reminder that <strong>${a.title}</strong> is due on <strong>${a.due_date}</strong>.</p>`
      );
    }

    for (const a of dueToday) {
      await enqueue(
        a,
        'due_today',
        `Due today: "${a.title}"`,
        `<p>Hello,</p><p><strong>${a.title}</strong> is <strong>due today (${a.due_date})</strong>.</p>`
      );
    }

    const results = await Promise.allSettled(queue);

    res.status(200).json({
      ok: true, version, tz,
      today, in3,
      due_today: dueToday.length,
      due_in_3_days: dueIn3.length,
      attempted_sends: queue.length,
      successes: results.filter(r => r.status === 'fulfilled').length,
      failures: results.filter(r => r.status === 'rejected').length
    });
  } catch (e) {
    res.status(500).json({ ok: false, version: 'reminders-idempotent-v1', error: String(e.message || e) });
  }
}
