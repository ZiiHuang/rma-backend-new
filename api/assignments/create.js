import { supabaseAdmin } from '../../lib/supabase.js';
import { DateTime } from 'luxon';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // tighten later
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getProjectId({ project_id, project_name }) {
  if (project_id) return project_id;
  if (!project_name) throw new Error('Either project_id or project_name is required');

  let { data: found, error: findErr } = await supabaseAdmin
    .from('projects').select('id').eq('name', project_name).maybeSingle();
  if (findErr) throw findErr;
  if (found) return found.id;

  let { data: created, error: insErr } = await supabaseAdmin
    .from('projects').insert([{ name: project_name }]).select('id').single();
  if (insErr) throw insErr;
  return created.id;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const tz = process.env.TIMEZONE || 'UTC';
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { project_id, project_name, title, start_date, due_date, status = 'incomplete', emails = [] } = body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const pid = await getProjectId({ project_id, project_name });
    const startDate = start_date || DateTime.now().setZone(tz).toISODate();

    const { data: assign, error } = await supabaseAdmin
      .from('assignments')
      .insert([{ project_id: pid, title, start_date: startDate, due_date, status }])
      .select()
      .single();
    if (error) throw error;

    if (emails.length) {
      const rows = emails.map(e => ({ assignment_id: assign.id, email: e }));
      const { error: e2 } = await supabaseAdmin.from('assignment_emails').insert(rows);
      if (e2) throw e2;
    }

    return res.status(200).json({ assignment: assign });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
