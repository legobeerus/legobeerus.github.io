const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fetch = global.fetch || require('node-fetch');
const bodyParser = require('body-parser');
// dotenv is optional in some deployment setups; try to load if available
try{
  require('dotenv').config();
}catch(e){
  console.warn('dotenv not available; continuing without loading .env file');
}

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'devsecret';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

if(!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET){
  console.warn('Warning: DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set. OAuth will not work until configured.');
}

const app = express();
app.use(bodyParser.json());

// Configure cookie security based on BASE_URL protocol
const isSecure = (BASE_URL||'').startsWith('https');

// Try to use Postgres-backed session store when DATABASE_URL is provided (Railway)
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:qSqlBEBelbTrColIMGzrUXfAYcJFYqEu@postgres.railway.internal:5432/railway";
let pgPool = null;
let sessionStore = null;
if(DATABASE_URL){
  try{
    const PgStore = require('connect-pg-simple')(session);
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: DATABASE_URL });
    sessionStore = new PgStore({ pool: pgPool, tableName: 'session', createTableIfMissing: true });
    console.log('Using Postgres session store (DATABASE_URL)');
    // ensure a simple users table exists for optional user persistence
    pgPool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, discriminator TEXT, avatar TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(e=>{ console.warn('users table check failed', e && e.message) });
  }catch(e){
    console.warn('Postgres session store not available:', e && e.message);
    pgPool = null; sessionStore = null;
  }
}

// If we have a pgPool, periodically ping it to keep the connection alive
const DB_PING_INTERVAL_MS = Number(process.env.DB_PING_INTERVAL_MS) || 120000; // default 2 minutes
let dbPingInterval = null;
if(pgPool){
  dbPingInterval = setInterval(async ()=>{
    try{
      await pgPool.query('SELECT 1');
      console.log('DB ping OK');
    }catch(err){
      console.warn('DB ping failed', err && err.message);
    }
  }, DB_PING_INTERVAL_MS);
}

app.use(session({
  store: sessionStore || undefined,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: isSecure, sameSite: isSecure ? 'none' : 'lax' }
}));

// Enable CORS for the static site origin so the frontend can call /api endpoints
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://legobeerus.github.io';
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));

// If BASE_URL is HTTPS (production behind a proxy like Railway), enable trust proxy
try{
  if(isSecure){
    app.set('trust proxy', 1);
    // ensure session cookie appears as secure
    app.use((req, res, next)=>{
      if(req.session) req.session.cookie.secure = true;
      next();
    });
  }
}catch(e){ /* ignore */ }

// Serve static site. Try expected layout, fall back to parent folder when running in Docker.
let siteRoot = path.join(__dirname, '..', 'legobeerus.github.io');
if (!require('fs').existsSync(siteRoot)) {
  // fallback: static files may already be copied into parent folder (e.g. Docker build context)
  siteRoot = path.join(__dirname, '..');
}
app.use(express.static(siteRoot));

// Log useful startup info
console.log('Serving static site from', siteRoot);
console.log('Configured BASE_URL:', BASE_URL);

// Log existence of important static files for debugging
const fs = require('fs');
const checkFiles = [
  'index.html',
  'scripts/auth.js',
  'scripts/server-config.js',
  'styles.css',
  'media/bg.jpg'
];
checkFiles.forEach(f=>{
  const p = path.join(siteRoot, f);
  console.log('STATIC CHECK:', f, fs.existsSync(p) ? 'FOUND' : 'MISSING', p);
});

// Health endpoint to list critical files
app.get('/__filelist', (req, res)=>{
  const info = {};
  checkFiles.forEach(f=>{ info[f] = fs.existsSync(path.join(siteRoot, f)); });
  res.json({ siteRoot, files: info });
});

// Provide a small dynamic config JS so clients always get correct AUTH_SERVER value
app.get('/scripts/server-config.js', (req, res)=>{
  res.type('application/javascript');
  const js = `window.__AUTH_SERVER__ = '${BASE_URL}';`;
  console.log('Serving dynamic /scripts/server-config.js ->', BASE_URL);
  res.send(js);
});

// Ensure /scripts/auth.js is served from the static site root if present
app.get('/scripts/auth.js', (req, res)=>{
  const p = path.join(siteRoot, 'scripts', 'auth.js');
  if(fs.existsSync(p)){
    console.log('Serving static scripts/auth.js from', p);
    return res.sendFile(p);
  }
  console.log('scripts/auth.js not found at', p, '-> returning 404 (avoid serving index.html)');
  res.status(404).send('Not found');
});

// Serve index.html explicitly for root
app.get('/', (req, res)=>{
  res.sendFile(path.join(siteRoot, 'index.html'));
});

// OAuth start
app.get('/auth/discord', (req, res)=>{
  const next = req.query.next || '/';
  const redirectUri = `${BASE_URL}/oauth/discord/callback`;
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID || '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  // store next in session
  req.session.next = next;
  console.log('/auth/discord hit; next=', next, ' -> redirecting to Discord URL:', url.toString());
  res.redirect(url.toString());
});

// Callback
app.get('/oauth/discord/callback', async (req, res)=>{
  const code = req.query.code;
  if(!code){ return res.status(400).send('Missing code'); }
  const redirectUri = `${BASE_URL}/oauth/discord/callback`;
  try{
    const params = new URLSearchParams();
    params.append('client_id', DISCORD_CLIENT_ID);
    params.append('client_secret', DISCORD_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    const tokenResp = await fetch('https://discord.com/api/oauth2/token',{
      method: 'POST', headers: {'Content-Type':'application/x-www-form-urlencoded'}, body: params
    });
    const tokenData = await tokenResp.json();
    if(!tokenResp.ok){ console.error('token error', tokenData); return res.status(500).send('Token exchange failed'); }
    const accessToken = tokenData.access_token;

    const userResp = await fetch('https://discord.com/api/users/@me',{ headers: { Authorization: `Bearer ${accessToken}` } });
    const userData = await userResp.json();
    if(!userResp.ok){ console.error('user fetch failed', userData); return res.status(500).send('Failed to fetch user'); }

    // store minimal user in session
    req.session.user = { id: userData.id, username: userData.username, discriminator: userData.discriminator, avatar: userData.avatar };
    req.session.accessToken = accessToken; // kept only in session

    console.log('/oauth/discord/callback - logged in user', req.session.user.id, req.session.user.username);

    // Persist minimal user record when using Postgres so logins survive deployments
    if(pgPool){
      try{
        await pgPool.query(
          `INSERT INTO users (id, username, discriminator, avatar, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, discriminator=EXCLUDED.discriminator, avatar=EXCLUDED.avatar, updated_at=NOW()`,
          [userData.id, userData.username, userData.discriminator, userData.avatar]
        );
      }catch(e){ console.warn('Failed to upsert user record', e && e.message); }
    }

    let next = req.session.next || '/';
    delete req.session.next;
    // Validate `next` to avoid open redirects. Only allow same-origin paths starting with '/'
    if (typeof next !== 'string' || !next.startsWith('/') ) {
      next = '/';
    }
    res.redirect(next);
  }catch(err){ console.error(err); res.status(500).send('OAuth error') }
});

app.get('/api/me', (req, res)=>{
  if(req.session && req.session.user){
    console.log('/api/me - returning user', req.session.user.id);
    res.json(req.session.user);
  }
  else {
    console.log('/api/me - no session');
    res.status(204).json(null);
  }
});

app.get('/logout', (req, res)=>{
  req.session.destroy(()=>{
    res.redirect('/');
  });
});

// Proxy: fetch an exam's completed responses from the bot
// List exams (from DB)
app.get('/api/exams', async (req, res)=>{
  if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  if(!pgPool) return res.status(500).json({ error: 'server not configured to read DB' });
  const phase = req.query.phase ? Number(req.query.phase) : null;
  const status = req.query.status || null;
  const conditions = [];
  const params = [];
  let idx = 1;
  if(phase!=null){ conditions.push(`phase = $${idx++}`); params.push(phase) }
  if(status){ conditions.push(`status = $${idx++}`); params.push(status) }
  const where = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';
  const sql = `SELECT id, phase, status, candidate_mention, created_at FROM exams ${where} ORDER BY created_at DESC LIMIT 200`;
  try{
    const q = await pgPool.query(sql, params);
    return res.json(q.rows || []);
  }catch(e){ console.error('DB list exams failed', e && e.message); return res.status(502).json({ error: 'db_error' }); }
});


// Fetch single exam: prefer DB row, fallback to bot
app.get('/api/exams/:id', async (req, res)=>{
  if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  const examId = req.params.id;
  if(pgPool){
    try{
      const q = await pgPool.query('SELECT * FROM exams WHERE id = $1 LIMIT 1', [examId]);
      if(q.rowCount>0){ return res.json(q.rows[0]) }
    }catch(e){ console.warn('DB fetch exam failed', e && e.message) }
  }
  // fallback to bot proxy
  const botBase = process.env.BOT_BASE_URL;
  if(!botBase) return res.status(500).json({ error: 'BOT_BASE_URL not configured on server' });
  const url = `${botBase.replace(/\/$/,'')}/exams/${encodeURIComponent(examId)}`;
  console.log('Proxy GET to bot:', url, 'for user', req.session.user.id);
  try{
    const bresp = await fetch(url, { headers: { 'x-discord-token': req.session.accessToken, 'accept':'application/json' } });
    const txt = await bresp.text().catch(()=>null);
    let data = null;
    try{ data = txt ? JSON.parse(txt) : null }catch(e){ data = txt }
    if(!bresp.ok){
      console.log('Bot returned', bresp.status, txt);
    }
    return res.status(bresp.status).json(data);
  }catch(err){ console.error('proxy GET error', err); return res.status(502).json({ error: 'bad_gateway' }); }
});

// Proxy: submit grading results to the bot
app.post('/api/exams/:id/grade', async (req, res)=>{
  if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
  const botBase = process.env.BOT_BASE_URL;
  if(!botBase) return res.status(500).json({ error: 'BOT_BASE_URL not configured on server' });
  const payload = req.body || {};
  // basic validation
  if(!Array.isArray(payload.grades)) return res.status(400).json({ error: 'missing grades array' });
  const url = `${botBase.replace(/\/$/,'')}/exams/${encodeURIComponent(req.params.id)}/grade`;
  console.log('Proxy POST to bot:', url, 'from user', req.session.user.id);
  try{
    const bresp = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json', 'x-discord-token': req.session.accessToken }, body: JSON.stringify(payload) });
    const txt = await bresp.text().catch(()=>null);
    let data = null;
    try{ data = txt ? JSON.parse(txt) : null }catch(e){ data = txt }
    if(!bresp.ok){ console.log('Bot POST returned', bresp.status, txt); }
    // persist grades to DB when available
    if(bresp.ok && pgPool){
      try{
        await pgPool.query('UPDATE exams SET grades = $1, status = $2, graded_by = $3, graded_at = NOW() WHERE id = $4', [JSON.stringify(payload), 'graded', req.session.user.id, req.params.id]);
      }catch(e){ console.warn('Failed to persist grades to DB', e && e.message) }
    }
    return res.status(bresp.status).json(data);
  }catch(err){ console.error('proxy POST error', err); return res.status(502).json({ error: 'bad_gateway' }); }
});

// Fallback: serve index.html for any other unmatched GET (SPA-style)
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  // do not handle API or auth routes here
  const skipPrefixes = ['/api', '/auth', '/oauth', '/scripts', '/__filelist'];
  for(const p of skipPrefixes) if(req.path.startsWith(p)) return next();
  res.sendFile(path.join(siteRoot, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>{ console.log(`Server listening on http://localhost:${port}`); });
