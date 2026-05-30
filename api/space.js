const BASE_URL = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN    = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(...args) {
  const r = await fetch(BASE_URL, {
    method:'POST', headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
}

// Filter tabs for view mode — owner password required, read-only
function filterForView(data) {
  if (data.type !== 'all') return data;
  const d = JSON.parse(JSON.stringify(data));
  const selected = d.selectedTabs || Object.keys(d.tabs || {});
  const visible = selected.filter(t => d.tabs?.[t]?.viewVisible !== false);
  d.selectedTabs = visible;
  const tabs = {};
  visible.forEach(t => { tabs[t] = { ...data.tabs[t], readOnly: true }; });
  d.tabs = tabs;
  d.activeTab = visible.includes(d.activeTab) ? d.activeTab : (visible[0] || d.activeTab);
  return d;
}

// Filter tabs for collaborator mode — collab password required
function filterForCollab(data) {
  if (data.type !== 'all') return data;
  const d = JSON.parse(JSON.stringify(data));
  const selected = d.selectedTabs || Object.keys(d.tabs || {});
  const visible = selected.filter(t => d.tabs?.[t]?.collabVisible !== false);
  d.selectedTabs = visible;
  const tabs = {};
  visible.forEach(t => {
    tabs[t] = {
      ...data.tabs[t],
      readOnly: data.tabs[t]?.collabEditable === false,
    };
  });
  d.tabs = tabs;
  d.activeTab = visible.includes(d.activeTab) ? d.activeTab : (visible[0] || d.activeTab);
  return d;
}

// For single-template (non-all) spaces in collab/view — return as-is or readOnly
function withReadOnly(data, readOnly) {
  return readOnly ? { ...data, readOnly: true } : data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = parseInt(req.query.id);
  if (!id || id < 1 || id > 50) return res.status(400).json({ error: 'Invalid space (1–50)' });

  const KEY  = `space-${id}`;
  const auth = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const isViewMode = req.query.view === '1';

  if (req.method === 'GET') {
    try {
      const raw = await kv('GET', KEY);
      if (!raw) return res.status(200).json({ status: 'unclaimed' });
      const space = JSON.parse(raw);

      if (!auth) return res.status(200).json({ status: 'locked' });

      // Owner auth — works for both regular and view mode
      if (auth === space.passwordHash) {
        if (isViewMode) {
          const filtered = space.data.type === 'all'
            ? filterForView(space.data)
            : withReadOnly(space.data, true);
          return res.status(200).json({ status: 'ok', data: filtered, isOwner: false, isView: true });
        }
        return res.status(200).json({ status: 'ok', data: space.data, isOwner: true });
      }

      // Collaborator auth
      if (space.collabHash && auth === space.collabHash) {
        const filtered = space.data.type === 'all'
          ? filterForCollab(space.data)
          : withReadOnly(space.data, false);
        return res.status(200).json({ status: 'ok', data: filtered, isOwner: false, isCollab: true });
      }

      return res.status(200).json({ status: 'locked' });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (body.action === 'setup') {
      try {
        const existing = await kv('GET', KEY);
        if (existing) return res.status(409).json({ error: 'Already claimed' });
        await kv('SET', KEY, JSON.stringify({
          passwordHash: body.passwordHash,
          collabHash: null,
          data: body.data,
          createdAt: Date.now(),
        }));
        return res.status(200).json({ ok: true });
      } catch(e) { return res.status(500).json({ error: e.message }); }
    }

    if (body.action === 'save') {
      try {
        const raw = await kv('GET', KEY);
        if (!raw) return res.status(404).json({ error: 'Space not found' });
        const space = JSON.parse(raw);
        const isOwnerAuth  = auth === space.passwordHash;
        const isCollabAuth = space.collabHash && auth === space.collabHash;
        if (!isOwnerAuth && !isCollabAuth) return res.status(401).json({ error: 'Wrong password' });

        if (isCollabAuth && body.data.type === 'all') {
          // Collab: only write back non-readOnly tabs, preserve owner data for hidden/readOnly tabs
          const current = space.data;
          const selected = current.selectedTabs || Object.keys(current.tabs || {});
          selected.forEach(t => {
            const tab = current.tabs?.[t];
            if (tab && tab.collabVisible !== false && tab.collabEditable !== false && body.data.tabs?.[t]) {
              tab.rooms = body.data.tabs[t].rooms;
            }
          });
          current.version = (current.version || 0) + 1;
          space.data = current;
        } else if (isOwnerAuth) {
          space.data = body.data;
        }

        await kv('SET', KEY, JSON.stringify(space));
        return res.status(200).json({ ok: true });
      } catch(e) { return res.status(500).json({ error: e.message }); }
    }

    if (body.action === 'set_sharing') {
      try {
        const raw = await kv('GET', KEY);
        if (!raw) return res.status(404).json({ error: 'Space not found' });
        const space = JSON.parse(raw);
        if (auth !== space.passwordHash) return res.status(401).json({ error: 'Owner access required' });
        space.collabHash = body.collabHash || null;
        space.data = body.data;
        await kv('SET', KEY, JSON.stringify(space));
        return res.status(200).json({ ok: true });
      } catch(e) { return res.status(500).json({ error: e.message }); }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
