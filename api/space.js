const BASE_URL = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN    = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(...args) {
  const r = await fetch(BASE_URL, {
    method:'POST', headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
}

// Filter data for collaborator — remove private tabs
function filterForCollab(data) {
  if (data.type !== 'all') return data;
  const d = JSON.parse(JSON.stringify(data));
  const selected = d.selectedTabs || Object.keys(d.tabs || {});
  const pub = selected.filter(t => !d.tabs?.[t]?.private);
  d.selectedTabs = pub;
  d.tabs = {};
  pub.forEach(t => { d.tabs[t] = data.tabs[t]; });
  d.activeTab = pub.includes(d.activeTab) ? d.activeTab : (pub[0] || d.activeTab);
  return d;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if (req.method==='OPTIONS') return res.status(200).end();

  const id = parseInt(req.query.id);
  if (!id||id<1||id>50) return res.status(400).json({error:'Invalid space (1–50)'});
  const KEY  = `space-${id}`;
  const auth = (req.headers.authorization||'').replace('Bearer ','').trim();

  if (req.method==='GET') {
    try {
      const raw = await kv('GET', KEY);
      if (!raw) return res.status(200).json({status:'unclaimed'});
      const space = JSON.parse(raw);

      // Public view mode — no auth, filter private tabs
      if (req.query.view==='1') {
        return res.status(200).json({status:'ok', data: filterForCollab(space.data), isOwner:false});
      }

      // Owner access
      if (auth && auth === space.passwordHash) {
        return res.status(200).json({status:'ok', data: space.data, isOwner:true});
      }

      // Collaborator access
      if (space.collabHash && auth && auth === space.collabHash) {
        return res.status(200).json({status:'ok', data: filterForCollab(space.data), isOwner:false});
      }

      return res.status(200).json({status:'locked'});
    } catch(e){ return res.status(500).json({error:e.message}); }
  }

  if (req.method==='POST') {
    const body = typeof req.body==='string' ? JSON.parse(req.body) : req.body;

    // First-time setup
    if (body.action==='setup') {
      try {
        const existing = await kv('GET', KEY);
        if (existing) return res.status(409).json({error:'Already claimed'});
        await kv('SET', KEY, JSON.stringify({
          passwordHash: body.passwordHash,
          collabHash: null,
          data: body.data,
          createdAt: Date.now(),
        }));
        return res.status(200).json({ok:true});
      } catch(e){ return res.status(500).json({error:e.message}); }
    }

    // Save data (owner or collab)
    if (body.action==='save') {
      try {
        const raw = await kv('GET', KEY);
        if (!raw) return res.status(404).json({error:'Space not found'});
        const space = JSON.parse(raw);
        const isOwner = auth === space.passwordHash;
        const isCollab = space.collabHash && auth === space.collabHash;
        if (!isOwner && !isCollab) return res.status(401).json({error:'Wrong password'});

        // Collabs can only save non-private tab data — merge carefully
        if (isCollab && body.data.type === 'all') {
          const current = space.data;
          // Merge collab-visible tabs back, preserve private tabs untouched
          const selected = current.selectedTabs || Object.keys(current.tabs||{});
          selected.forEach(t => {
            if (!current.tabs[t]?.private && body.data.tabs?.[t]) {
              current.tabs[t].rooms = body.data.tabs[t].rooms;
            }
          });
          current.version = (current.version||0)+1;
          space.data = current;
        } else {
          space.data = body.data;
        }
        await kv('SET', KEY, JSON.stringify(space));
        return res.status(200).json({ok:true});
      } catch(e){ return res.status(500).json({error:e.message}); }
    }

    // Update sharing settings (owner only)
    if (body.action==='set_sharing') {
      try {
        const raw = await kv('GET', KEY);
        if (!raw) return res.status(404).json({error:'Space not found'});
        const space = JSON.parse(raw);
        if (auth !== space.passwordHash) return res.status(401).json({error:'Owner access required'});
        space.collabHash = body.collabHash || null;
        space.data = body.data; // includes updated tab privacy settings
        await kv('SET', KEY, JSON.stringify(space));
        return res.status(200).json({ok:true});
      } catch(e){ return res.status(500).json({error:e.message}); }
    }

    return res.status(400).json({error:'Unknown action'});
  }

  return res.status(405).json({error:'Method not allowed'});
};
