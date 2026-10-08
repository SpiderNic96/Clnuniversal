const { kv } = require('../lib/kv');

function filterTabs(data, visibilityKey, markReadOnly) {
  if (data.type !== 'all') return markReadOnly ? {...data, readOnly:true} : data;
  const d = JSON.parse(JSON.stringify(data));
  const selected = d.selectedTabs || Object.keys(d.tabs || {});
  const visible = selected.filter(t => d.tabs?.[t]?.[visibilityKey] !== false);
  d.selectedTabs = visible;
  const tabs = {};
  visible.forEach(t => {
    tabs[t] = {
      ...data.tabs[t],
      readOnly: markReadOnly || data.tabs[t]?.collabEditable === false,
    };
  });
  d.tabs = tabs;
  d.activeTab = visible.includes(d.activeTab) ? d.activeTab : (visible[0] || d.activeTab);
  return d;
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

      // Owner — full access or view-mode with owner password fallback
      if (auth === space.passwordHash && !isViewMode) {
        return res.status(200).json({ status:'ok', data: space.data, isOwner:true });
      }

      // View mode — requires viewHash (separate from owner password)
      if (isViewMode) {
        const viewHash = space.viewHash;
        if (!viewHash) return res.status(200).json({ status:'locked', hint:'view_not_set' });
        if (auth !== viewHash) return res.status(200).json({ status:'locked' });
        const filtered = filterTabs(space.data, 'viewVisible', true);
        return res.status(200).json({ status:'ok', data: filtered, isOwner:false, isView:true });
      }

      // Collaborator
      if (space.collabHash && auth === space.collabHash) {
        const filtered = filterTabs(space.data, 'collabVisible', false);
        return res.status(200).json({ status:'ok', data: filtered, isOwner:false, isCollab:true });
      }

      return res.status(200).json({ status:'locked' });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (body.action === 'setup') {
      try {
        const existing = await kv('GET', KEY);
        if (existing) return res.status(409).json({ error:'Already claimed' });
        await kv('SET', KEY, JSON.stringify({
          passwordHash: body.passwordHash,
          viewHash: null,
          collabHash: null,
          data: body.data,
          createdAt: Date.now(),
        }));
        return res.status(200).json({ ok:true });
      } catch(e) { return res.status(500).json({ error:e.message }); }
    }

    if (body.action === 'save') {
      try {
        const row = await kv('GETMETA', KEY);
        if (!row) return res.status(404).json({ error:'Space not found' });
        const space = JSON.parse(row.value);
        const isOwnerAuth  = auth === space.passwordHash;
        const isCollabAuth = !isOwnerAuth && space.collabHash && auth === space.collabHash;
        if (!isOwnerAuth && !isCollabAuth) return res.status(401).json({ error:'Wrong password' });

        const currentVersion = space.data?.version || 0;

        // The device's copy is out of date: send it the latest so it can merge its own changes and retry.
        const conflict = () => res.status(409).json({
          conflict: true,
          version: currentVersion,
          data: isCollabAuth ? filterTabs(space.data, 'collabVisible', false) : space.data,
        });
        if (body.baseVersion !== undefined && body.baseVersion !== currentVersion) return conflict();

        if (isCollabAuth) {
          const current = space.data;
          if (current.type === 'all') {
            const selected = current.selectedTabs || Object.keys(current.tabs || {});
            selected.forEach(t => {
              const tab = current.tabs?.[t];
              if (tab && tab.collabVisible !== false && tab.collabEditable !== false && body.data.tabs?.[t]) {
                tab.rooms = body.data.tabs[t].rooms;
              }
            });
          } else if (Array.isArray(body.data.rooms)) {
            current.rooms = body.data.rooms;   // single-template space: collaborators edit its rooms
          }
          space.data = current;
        } else {
          space.data = body.data;
        }

        // The server owns the version number
        const newVersion = currentVersion + 1;
        space.data.version = newVersion;

        // Only write if nobody else saved since we read (closes the race between two phones)
        const written = await kv('CAS', KEY, JSON.stringify(space), row.updated_at);
        if (!written) {
          const fresh = JSON.parse((await kv('GET', KEY)) || '{}');
          const v = fresh.data?.version || 0;
          return res.status(409).json({
            conflict: true, version: v,
            data: isCollabAuth ? filterTabs(fresh.data, 'collabVisible', false) : fresh.data,
          });
        }
        return res.status(200).json({ ok:true, version: newVersion });
      } catch(e) { return res.status(500).json({ error:e.message }); }
    }

    if (body.action === 'set_sharing') {
      try {
        // Only changes the passwords. The tab visibility flags travel with the normal
        // (conflict-checked) save the page sends straight after, so no list data is overwritten here.
        for (let attempt = 0; attempt < 3; attempt++) {
          const row = await kv('GETMETA', KEY);
          if (!row) return res.status(404).json({ error:'Space not found' });
          const space = JSON.parse(row.value);
          if (auth !== space.passwordHash) return res.status(401).json({ error:'Owner access required' });
          if (body.viewHash  !== undefined) space.viewHash  = body.viewHash  || null;
          if (body.collabHash !== undefined) space.collabHash = body.collabHash || null;
          if (await kv('CAS', KEY, JSON.stringify(space), row.updated_at)) return res.status(200).json({ ok:true });
        }
        return res.status(409).json({ error:'Busy, try again' });
      } catch(e) { return res.status(500).json({ error:e.message }); }
    }

    return res.status(400).json({ error:'Unknown action' });
  }

  return res.status(405).json({ error:'Method not allowed' });
};
