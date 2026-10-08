// Drop-in replacement for the old Upstash kv() helper.
// Stores each key as one row in a Supabase table (kv_store), via the REST API.
// Supports the two commands the app uses: kv('GET', key) and kv('SET', key, value).

const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const TABLE = 'kv_store';

function headers(extra) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  // Legacy service_role keys are JWTs (eyJ...) and also go in Authorization.
  // New sb_secret_ keys must only be sent as apikey.
  if (KEY && KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function kv(cmd, key, value) {
  if (!URL || !KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var');

  if (cmd === 'GET') {
    const r = await fetch(`${URL}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(key)}&select=value`, { headers: headers() });
    if (!r.ok) throw new Error(`DB read failed (${r.status}): ${await r.text()}`);
    const rows = await r.json();
    return rows.length ? rows[0].value : null;
  }

  if (cmd === 'SET') {
    const r = await fetch(`${URL}/rest/v1/${TABLE}?on_conflict=key`, {
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error(`DB write failed (${r.status}): ${await r.text()}`);
    return 'OK';
  }

  throw new Error(`Unsupported command: ${cmd}`);
}

module.exports = { kv };
