import { supabaseAdmin } from '../../lib/supabase.js';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { assignment_id, patch = {}, emails } = body;
    if (!assignment_id) return res.status(400).json({ error: 'assignment_id required' });

    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from('assignments').update(patch).eq('id', assignment_id);
      if (error) throw error;
    }
    if (Array.isArray(emails)) {
      const { error: delErr } = await supabaseAdmin.from('assignment_emails').delete().eq('assignment_id', assignment_id);
      if (delErr) throw delErr;
      if (emails.length) {
        const rows = emails.map(e => ({ assignment_id, email: e }));
        const { error: insErr } = await supabaseAdmin.from('assignment_emails').insert(rows);
        if (insErr) throw insErr;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
