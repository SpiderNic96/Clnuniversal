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
function mk(name){ return { id: uid(), name: name||'', completed: false, note: '' }; }
function mz(name, ...tasks){ return { id: uid(), name, tasks: tasks.map(mk) }; }
function mr(name, expanded, ...zones){ return { id: uid(), name, expanded, zones }; }

// Build the new per-game gaming seed
function gamingSeed() {
  const mrgz = (name, status, ...zones) => ({
    id: uid(), name, expanded: false, gameStatus: status,
    zones: zones.map(([zn, ...tasks]) => ({ id: uid(), name: zn, tasks: tasks.map(mk) }))
  });
  return [
    mrgz('My Current Game', 'playing',
      ['📖 Main Story', 'Act 1', 'Act 2', 'Final boss'],
      ['🗺️ Side Quests', 'Side quest 1', 'Side quest 2'],
      ['🏆 Trophies', 'Platinum target']),
    mrgz('Another Game', 'playing',
      ['📖 Story', 'Chapter 1', 'Chapter 2'],
      ['💎 Collectibles', 'Set A', 'Set B']),
    mrgz('Game on hold', 'paused',
      ['📖 Progress', 'Where I left off']),
    mrgz('Want to buy', 'wishlist', []),
    mrgz('Finished game', 'done',
      ['🏆 Trophies', 'Platinum ✓']),
  ];
}

function genericCleaning() {
  return {
    version: 1, _seedVersion: 2,
    rooms: [
      mr('Living Room', true,
        mz('TV Area', 'Clear coffee table', 'Vaccum', 'Mop floors', 'Dust surfaces')),
      mr('Kitchen', false,
        mz('Benchtops', 'Wipe benchtops', 'Clean splashback'),
        mz('Sink & Dishes', 'Do dishes', 'Clean sink')),
      mr('Bathroom', false,
        mz('Shower', 'Clean shower glass', 'Scrub shower floor'),
        mz('Toilet', 'Clean toilet bowl', 'Wipe seat & lid')),
      mr('Bedroom', false, mz('General', 'Vaccum', 'Dust', 'Make bed')),
      mr('Laundry', false, mz('Washing', 'Do washing', 'Fold clothes')),
    ]
  };
}

module.exports = async function handler(req, res) {
  const { id, secret, action, tab } = req.query;
  if (secret !== 'TASKADMIN2026') return res.status(401).json({ error: 'Unauthorized' });

  // LIST all claimed spaces
  if (action === 'list') {
    try {
      const results = [];
      for (let i = 1; i <= 50; i++) {
        const raw = await kv('GET', `space-${i}`);
        if (raw) {
          const space = JSON.parse(raw);
          const d = space.data || {};
          results.push({
            id: i, url: `/${i}`,
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

  const spaceId = parseInt(id);
  if (!spaceId || spaceId < 1 || spaceId > 50) return res.status(400).json({ error: 'Invalid space' });

  // RESET a single tab's rooms to its default seed
  // Usage: /api/admin?secret=...&action=reset_tab&id=33&tab=gaming
  if (action === 'reset_tab') {
    if (!tab) return res.status(400).json({ error: 'tab param required' });
    try {
      const raw = await kv('GET', `space-${spaceId}`);
      if (!raw) return res.status(404).json({ error: 'Space not found' });
      const space = JSON.parse(raw);
      const d = space.data;

      if (d.type !== 'all') return res.status(400).json({ error: 'Space is not multi-tab' });
      if (!d.tabs[tab]) return res.status(404).json({ error: `Tab "${tab}" not found in space` });

      // Seed the tab with fresh rooms
      let newRooms = [];
      if (tab === 'gaming') newRooms = gamingSeed();
      else return res.status(400).json({ error: `No seed defined for tab "${tab}" in admin — add it to admin.js` });

      d.tabs[tab].rooms = newRooms;
      d.version = (d.version || 0) + 1;
      space.data = d;
      await kv('SET', `space-${spaceId}`, JSON.stringify(space));
      return res.status(200).json({ ok: true, message: `Tab "${tab}" in space /${spaceId} reset — ${newRooms.length} game rooms seeded` });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // ADD a new tab to an existing multi-tab space
  // Usage: /api/admin?secret=...&action=add_tab&id=33&tab=gaming
  if (action === 'add_tab') {
    if (!tab) return res.status(400).json({ error: 'tab param required' });
    try {
      const raw = await kv('GET', `space-${spaceId}`);
      if (!raw) return res.status(404).json({ error: 'Space not found' });
      const space = JSON.parse(raw);
      const d = space.data;

      if (d.type !== 'all') return res.status(400).json({ error: 'Space is not multi-tab — can only add tabs to multi-tab spaces' });

      let newRooms = [];
      if (tab === 'gaming') newRooms = gamingSeed();
      else return res.status(400).json({ error: `No seed defined for tab "${tab}"` });

      const newTabKey = `${tab}2`; // e.g. gaming2
      d.tabs[newTabKey] = { rooms: newRooms, private: false, viewVisible: true, collabVisible: true, collabEditable: true };
      if (!d.selectedTabs.includes(newTabKey)) d.selectedTabs.push(newTabKey);
      d.version = (d.version || 0) + 1;
      space.data = d;
      await kv('SET', `space-${spaceId}`, JSON.stringify(space));
      return res.status(200).json({ ok: true, message: `Added tab "${newTabKey}" to space /${spaceId} with ${newRooms.length} game rooms` });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  // RESET full space to generic cleaning
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
