// One-time admin endpoint — reset a space's data while preserving its password
// Usage: /api/admin?id=3&secret=TASKADMIN2026&template=cleaning
const BASE_URL = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN    = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(...args) {
  const r = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function mk(name){ return { id: uid(), name, completed: false }; }
function mz(name, ...tasks){ return { id: uid(), name, tasks: tasks.map(mk) }; }
function mr(name, expanded, ...zones){ return { id: uid(), name, expanded, zones }; }

function genericCleaning() {
  return {
    version: 1, _seedVersion: 2,
    rooms: [
      mr('Living Room', true,
        mz('TV Area', 'Clear coffee table', 'Throw away trash', 'Wipe TV screen', 'Tidy remotes'),
        mz('General', 'Vaccum', 'Mop floors', 'Dust surfaces', 'Clean windows', 'Wipe light switches')),
      mr('Kitchen', false,
        mz('Benchtops', 'Wipe benchtops', 'Clean splashback', 'Wipe appliances'),
        mz('Sink & Dishes', 'Do dishes', 'Clean sink', 'Wipe tap'),
        mz('Oven & Stovetop', 'Clean stovetop', 'Wipe oven exterior', 'Clean rangehood filter'),
        mz('Fridge', 'Wipe shelves', 'Check expiry dates', 'Clean door seals'),
        mz('Floor', 'Sweep floor', 'Mop floor')),
      mr('Bathroom', false,
        mz('Shower', 'Clean shower glass', 'Scrub shower floor', 'Clean shower head'),
        mz('Toilet', 'Clean toilet bowl', 'Wipe seat & lid', 'Clean around base'),
        mz('Sink & Vanity', 'Clean sink', 'Wipe mirror', 'Wipe benchtop', 'Empty bin'),
        mz('Floor', 'Sweep floor', 'Mop floor')),
      mr('Bedroom', false,
        mz('Bed', 'Wash sheets', 'Make bed'),
        mz('Wardrobe', 'Put away clothes', 'Organise wardrobe'),
        mz('General', 'Vaccum', 'Dust surfaces', 'Wipe skirting boards')),
      mr('Laundry', false,
        mz('Washing', 'Do a load of washing', 'Hang washing out', 'Move to dryer'),
        mz('Folding', 'Fold clothes', 'Put away clothes'),
        mz('General', 'Clean lint trap', 'Wipe washing machine', 'Sweep floor')),
      mr('Hallway', false,
        mz('General', 'Vaccum', 'Wipe surfaces', 'Dust', 'Clean mirrors', 'Organise shoes & entry')),
      mr('Garage', false,
        mz('Storage', 'Organise shelves', 'Clear clutter', 'Wipe surfaces'),
        mz('Floor', 'Sweep floor', 'Mop floor'),
        mz('Bins', 'Take out bins', 'Clean bin area')),
      mr('Backyard', false,
        mz('Lawn', 'Mow lawn', 'Edge lawn', 'Rake leaves'),
        mz('Garden', 'Weed garden', 'Water plants', 'Sweep paths', 'Clear rubbish')),
      mr('Front Yard', false,
        mz('Lawn', 'Mow lawn', 'Edge lawn'),
        mz('Entry', 'Sweep driveway', 'Weed garden beds', 'Water plants', 'Clear rubbish')),
    ]
  };
}

module.exports = async function handler(req, res) {
  const { id, secret, action } = req.query;
  if (secret !== 'TASKADMIN2026') return res.status(401).json({ error: 'Unauthorized' });

  // List all claimed spaces
  if (action === 'list') {
    try {
      const results = [];
      for (let i = 1; i <= 50; i++) {
        const raw = await kv('GET', `space-${i}`);
        if (raw) {
          const space = JSON.parse(raw);
          const d = space.data || {};
          results.push({
            id: i,
            url: `/${i}`,
            type: d.type || 'single',
            template: d.template || 'unknown',
            tabs: d.selectedTabs || (d.type === 'all' ? Object.keys(d.tabs || {}) : null),
            rooms: d.type === 'all' ? null : (d.rooms?.length || 0),
            hasCollab: !!space.collabHash,
            createdAt: space.createdAt ? new Date(space.createdAt).toLocaleDateString() : '?'
          });
        }
      }
      return res.status(200).json({ claimed: results.length, spaces: results });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // Reset a space
  const spaceId = parseInt(id);
  if (!spaceId || spaceId < 1 || spaceId > 50) return res.status(400).json({ error: 'Invalid space' });

  try {
    const raw = await kv('GET', `space-${spaceId}`);
    if (!raw) return res.status(404).json({ error: 'Space not found' });

    const space = JSON.parse(raw);
    space.data = genericCleaning();
    await kv('SET', `space-${spaceId}`, JSON.stringify(space));

    return res.status(200).json({ ok: true, message: `Space /${spaceId} reset to generic cleaning template` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
