import { supabaseAdmin } from '../../lib/supabase.js';
import { sendBasicEmail } from '../../lib/email.js';
import { DateTime } from 'luxon';

export default async function handler(req, res) {
  const version = 'reminders-debug';
  res.setHeader('Cache-Control', 'no-store');

  try {
    const tz = process.env.TIMEZONE || 'UTC';
    const now = DateTime.now().setZone(tz);

    // allow ?date=YYYY-MM-DD to force a test day
    const url = new URL(req.url, 'http://localhost');
    const forcedDate = url.searchParams.get('date'); // e.g., 2025-09-15

    const today = forcedDate || now.toISODate();
    const in3 =
      forcedDate
        ? DateTime.fromISO(forcedDate).plus({ days: 3 }).toISODate()
        : now.plus({ days: 3 }).toISODate();

    // 1) load ALL assignments for the date (no status filter in SQL)
    const loadByDate = async (dateISO) => {
      const { data, error } = await supabaseAdmin
        .from('assignments')
        .select('id,title,due_date,status, assignment_emails ( email )')
        .eq('due_date', dateISO);
      if (error) throw error;
      return data || [];
    };

    const [rawToday, rawIn3] = await Promise.all([loadByDate(today), loadByDate(in3)]);

    // 2) filter statuses case-insensitively to active ones
    const isActive = (s) => {
      const v = String(s || '').toLowerCase();
      return v === 'incomplete' || v === 'pending';
    };
    const dueToday = rawToday.filter((a) => isActive(a.status));
    const dueIn3 = rawIn3.filter((a) => isActive(a.status));

    // 3) queue emails
    const queue = [];
    const sendTo = (a, subject, html) => {
      const recips = (a.assignment_emails || []).map((x) => x.email).filter(Boolean);
      for (const to of recips) queue.push(sendBasicEmail({ to, subject, html }));
    };

    for (const a of dueIn3) {
      sendTo(
        a,
        `Reminder: "${a.title}" due ${a.due_date}`,
        `<p>Hello,</p><p>This is a friendly reminder that <strong>${a.title}</strong> is due on <strong>${a.due_date}</strong>.</p>`
      );
    }
    for (const a of dueToday) {
      sendTo(
        a,
        `Due today: "${a.title}"`,
        `<p>Hello,</p><p><strong>${a.title}</strong> is <strong>due today (${a.due_date})</strong>.</p>`
      );
    }

    const results = await Promise.allSettled(queue);

    // respond with helpful diagnostics
    res.status(200).json({
      ok: true,
      version,
      tz,
      today,
      in3,
      found_today_total: rawToday.length,
      found_today_ids: rawToday.map((a) => ({ id: a.id, status: a.status })),
      found_in3_total: rawIn3.length,
      found_in3_ids: rawIn3.map((a) => ({ id: a.id, status: a.status })),
      due_today: dueToday.length,
      due_in_3_days: dueIn3.length,
      attempted_sends: queue.length,
      successes: results.filter((r) => r.status === 'fulfilled').length,
      failures: results.filter((r) => r.status === 'rejected').length
    });
  } catch (e) {
    res.status(500).json({ ok: false, version: 'reminders-debug', error: String(e.message || e) });
  }
}
