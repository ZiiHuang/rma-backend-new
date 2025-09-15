export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, version: 'ping-v1', ts: Date.now() });
}
