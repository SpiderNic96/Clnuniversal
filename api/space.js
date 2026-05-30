const BASE_URL = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN    = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(...args) {
  const r = await fetch(BASE_URL, {
    method:'POST', headers:{'Authorization':`Bearer ${TOKEN}`,'Content-Type':'application/json'},
    body: JSON.stringify(args),
  });
  return (await r.json()).result;
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
      const raw = await kv('GET',KEY);
      if (!raw) return res.status(200).json({status:'unclaimed'});
      const space = JSON.parse(raw);
      // Public view mode — no auth required
      if (req.query.view==='1') return res.status(200).json({status:'ok',data:space.data});
      if (!auth||auth!==space.passwordHash) return res.status(200).json({status:'locked'});
      return res.status(200).json({status:'ok',data:space.data});
    } catch(e){ return res.status(500).json({error:e.message}); }
  }

  if (req.method==='POST') {
    const body = typeof req.body==='string'?JSON.parse(req.body):req.body;
    if (body.action==='setup') {
      try {
        const existing = await kv('GET',KEY);
        if (existing) return res.status(409).json({error:'Already claimed'});
        await kv('SET',KEY,JSON.stringify({passwordHash:body.passwordHash,data:body.data,createdAt:Date.now()}));
        return res.status(200).json({ok:true});
      } catch(e){ return res.status(500).json({error:e.message}); }
    }
    if (body.action==='save') {
      try {
        const raw = await kv('GET',KEY);
        if (!raw) return res.status(404).json({error:'Space not found'});
        const space = JSON.parse(raw);
        if (auth!==space.passwordHash) return res.status(401).json({error:'Wrong password'});
        space.data = body.data;
        await kv('SET',KEY,JSON.stringify(space));
        return res.status(200).json({ok:true});
      } catch(e){ return res.status(500).json({error:e.message}); }
    }
    return res.status(400).json({error:'Unknown action'});
  }
  return res.status(405).json({error:'Method not allowed'});
};
