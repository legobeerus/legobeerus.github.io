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

// siteRoot will be set when the server starts
let siteRoot = null;

// Configure cookie security based on BASE_URL protocol
const isSecure = (BASE_URL||'').startsWith('https');

// Try to use Postgres-backed session store when DATABASE_URL is provided (Railway)
const envDatabaseUrl = process.env.DATABASE_URL;
const DATABASE_URL = envDatabaseUrl;
let pgPool = null;
let sessionStore = null;
let hasExamSessionsTable = false;
let examReviewsColumns = new Set();
let examReviewsMeta = {}; // column_name -> { is_nullable, column_default }
if(!envDatabaseUrl){
  console.warn('DATABASE_URL not set in environment; Postgres support is disabled.');
} else {
  try{
    const safeDb = DATABASE_URL.replace(/(postgresql:\/\/[^:]+:)[^@]+@/, '$1*****@');
    console.log('Attempting DB connect to:', safeDb);
    const { Pool } = require('pg');
    // create a temporary pool to test auth without exposing the app to a half-initialized pool
    const testPool = new Pool({ connectionString: DATABASE_URL, max: 2, idleTimeoutMillis: 1000 });
    testPool.connect().then(client=>{
      client.release();
      // connection succeeded, promote to main pool
      pgPool = testPool;
      try{
        const PgStore = require('connect-pg-simple')(session);
        sessionStore = new PgStore({ pool: pgPool, tableName: 'session', createTableIfMissing: true });
        console.log('Using Postgres session store (DATABASE_URL)');
      }catch(e){
        console.warn('Failed to initialize session store, continuing without DB sessions:', e && e.message);
        sessionStore = null;
      }

      // create helper tables if possible
      pgPool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, discriminator TEXT, avatar TEXT, updated_at TIMESTAMP DEFAULT NOW())`).catch(e=>{ console.warn('users table check failed', e && e.message) });
      pgPool.query(`CREATE TABLE IF NOT EXISTS exam_reviews (session_id TEXT PRIMARY KEY, reviewer_id TEXT, review JSONB, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`).catch(e=>{ console.warn('exam_reviews table check failed', e && e.message) });

      pgPool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='exams_sessions') AS exists`).then(r=>{
        hasExamSessionsTable = r.rows[0] && r.rows[0].exists;
        console.log('exams_sessions table exists:', hasExamSessionsTable);
        if(!hasExamSessionsTable){
          pgPool.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'`).then(list=>{
            console.log('Public tables:', list.rows.map(row=>row.tablename));
          }).catch(()=>{});
        }
      }).catch(e=>{ console.warn('Failed to check exams_sessions table existence:', e && e.message) });

      // discover exam_reviews columns and metadata so we can adapt inserts/updates to DB schema
      pgPool.query(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='exam_reviews'`).then(cols=>{
        if(cols && cols.rows){
          cols.rows.forEach(r=>{
            examReviewsColumns.add(r.column_name);
            examReviewsMeta[r.column_name] = { is_nullable: r.is_nullable, column_default: r.column_default };
          });
        }
        console.log('exam_reviews columns:', Array.from(examReviewsColumns));
        console.log('exam_reviews meta:', examReviewsMeta);
      }).catch(()=>{
        console.log('exam_reviews table not present or inaccessible');
      });
    }).catch(err=>{
      console.error('Database connection failed (auth or network). Postgres features disabled. Error:', err && err.message);
      testPool.end().catch(()=>{});
      pgPool = null;
      sessionStore = null;
    });
  }catch(e){
    console.warn('Postgres initialization error; Postgres features disabled:', e && e.message);
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
// Defer session middleware and the fatal session-store check until DB init completes.
// This prevents exiting prematurely while the async DB connect is still pending.
let dbInitPromise = Promise.resolve();
if(envDatabaseUrl){
  // If DATABASE_URL is set we have an async init path above; ensure we wait for it.
  dbInitPromise = new Promise((resolve)=>{
    // The async branch above will resolve by calling connect().then or catch; we resolve here
    // by polling for pgPool/sessionStore readiness at short intervals up to a timeout.
    const start = Date.now();
    const timeout = 10000; // 10s max wait
    const check = ()=>{
      if(sessionStore || (pgPool === null && Date.now()-start > timeout)) return resolve();
      setTimeout(check, 200);
    };
    check();
  });
}

dbInitPromise.then(()=>{
  if(envDatabaseUrl && !sessionStore){
    console.error('Fatal: session store is not configured (no Postgres session store).');
    console.error('DATABASE_URL provided but session store failed to initialize. Exiting.');
    process.exit(1);
  }

  app.use(session({
    store: sessionStore,
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
  // After session middleware and CORS/trust-proxy are configured, register routes and start server
  startApp();
});

function startApp(){
  // Serve static site. Try expected layout, fall back to parent folder when running in Docker.
  siteRoot = path.join(__dirname, '..', 'legobeerus.github.io');
  if (!require('fs').existsSync(siteRoot)) {
    // fallback: static files may already be copied into parent folder (e.g. Docker build context)
    siteRoot = path.join(__dirname, '..');
  }
  app.use(express.static(siteRoot));
  // Log useful startup info and check important static files
  const fs = require('fs');
  const checkFiles = [
    'index.html',
    'scripts/auth.js',
    'scripts/server-config.js',
    'styles.css',
    'media/bg.jpg'
  ];
  console.log('Serving static site from', siteRoot);
  console.log('Configured BASE_URL:', BASE_URL);
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
          await pgPool.query(`INSERT INTO users (id, username, discriminator, avatar, updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET username=EXCLUDED.username, discriminator=EXCLUDED.discriminator, avatar=EXCLUDED.avatar, updated_at=NOW()`, [req.session.user.id, req.session.user.username, req.session.user.discriminator, req.session.user.avatar]);
        }catch(e){ console.warn('Failed to upsert user', e && e.message) }
      }

      const dest = (req.session && req.session.next) ? req.session.next : '/';
      return res.redirect(dest);
    }catch(err){ console.error('OAuth callback failure', err); return res.status(500).send('OAuth failure'); }
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
    if(req.session) req.session.destroy(()=>{ res.redirect('/'); });
    else res.redirect('/');
  });

  // Register API endpoints that require session/DB access
  // List exams (from DB)
  app.get('/api/exams', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    if(!pgPool) return res.status(500).json({ error: 'server not configured to read DB' });
    const status = req.query.status || null;
    const phase = req.query.phase || null;
    const conditions = [];
    const params = [];
    let idx = 1;
    if(phase){ conditions.push(`(exam_id ILIKE $${idx} OR exam_id = $${idx})`); params.push(`%phase${phase}%`); idx++ }
    if(status){ conditions.push(`status = $${idx++}`); params.push(status) }
    const where = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';
    const sql = `SELECT id,
      exam_id,
      status,
      COALESCE(payload::jsonb->>'candidate_mention', payload::jsonb->>'candidateMention', payload::jsonb->>'candidate', payload::jsonb->>'candidate_name', payload::jsonb->>'userId') AS candidate_mention,
      COALESCE(payload::jsonb->>'createdAt', to_char(created_at, 'YYYYMMDDHH24MISS')) AS created_at
      FROM exams_sessions ${where} ORDER BY created_at DESC LIMIT 200`;
      try{
        const q = await pgPool.query(sql, params);
        return res.json(q.rows || []);
      }catch(e){ console.error('DB list exams failed', e && e.message); return res.status(502).json({ error: 'db_error' }); }
  });


  function normalizeExamPayload(payload, examId){
    const data = { id: examId, ...payload };
    data.candidateMention = payload.candidate_mention || payload.candidateMention || payload.candidate || payload.candidate_name || payload.userId || (payload.user && payload.user.username) || 'unknown';
    data.status = payload.status || payload.phase_status || payload.phase || 'pending';
    data.examId = payload.examId || payload.exam_id || payload.exam || examId || 'unknown';
    data.phase = payload.phase || (typeof data.examId === 'string' && data.examId.match(/phase\d+/i)?.[0]) || null;

    const toArray = value => {
      if(Array.isArray(value)) return value;
      if(value && typeof value === 'object'){
        return Object.keys(value)
          .sort((a,b)=>Number(a) - Number(b))
          .map(key=>value[key]);
      }
      return null;
    };

    const normalizeIndex = raw => {
      const index = typeof raw === 'number' ? raw : raw == null ? null : Number(raw);
      return Number.isInteger(index) ? index : null;
    };

    const rawQuestions = toArray(payload.questions);
    const rawAnswers = toArray(payload.answers) || toArray(payload.responses);

    if(rawQuestions){
      data.questions = rawQuestions.map((item, idx) => {
        if(typeof item === 'string') return { text: item };
        return item && typeof item === 'object' ? item : { text: `Question ${idx+1}` };
      });
    } else {
      data.questions = [];
    }

    if(rawAnswers){
      data.answers = rawAnswers.map((item, idx) => {
        if(typeof item === 'string') return { index: idx, answer: item };
        if(item && typeof item === 'object'){
          const index = normalizeIndex(item.index ?? item.questionIndex ?? item.question_id ?? idx);
          return {
            ...item,
            index: index == null ? idx : index,
            answer: item.answer ?? item.response ?? item.value ?? item.text ?? ''
          };
        }
        return { index: idx, answer: '' };
      });
    } else {
      data.answers = [];
    }

    return data;
  }

  // Fetch single exam: prefer DB row, fallback to bot
  app.get('/api/exams/:id', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    const examId = req.params.id;
    if(pgPool){
      try{
        let q = await pgPool.query('SELECT id, payload, created_at FROM exams_sessions WHERE id = $1 LIMIT 1', [examId]);
        if(q.rowCount === 0){
          q = await pgPool.query(`SELECT id, payload, created_at FROM exams_sessions
            WHERE payload::jsonb->>'examId' = $1
            OR payload::jsonb->>'exam_id' = $1
            OR payload::jsonb->>'exam' = $1
            LIMIT 1`, [examId]);
        }
        if(q.rowCount>0){
          const row = q.rows[0];
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          return res.json(normalizeExamPayload(payload, row.id));
        }
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
    const payload = req.body || {};
    const grades = Array.isArray(payload.grades) ? payload.grades : Array.isArray(payload.scores) ? payload.scores : null;
    if(!grades) return res.status(400).json({ error: 'missing grades array' });
    const reviewPayload = { grades, scores: grades, feedback: payload.feedback || '' };
    const shouldProxyBot = Boolean(botBase);
    const url = botBase ? `${botBase.replace(/\/$/,'')}/exams/${encodeURIComponent(req.params.id)}/grade` : null;
    if(shouldProxyBot) console.log('Proxy POST to bot:', url, 'from user', req.session.user.id);
    try{
      let bresp = { ok: true, status: 200 };
      let data = { success: true, saved: true };
      if(shouldProxyBot){
        bresp = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json', 'x-discord-token': req.session.accessToken }, body: JSON.stringify(reviewPayload) });
        const txt = await bresp.text().catch(()=>null);
        try{ data = txt ? JSON.parse(txt) : txt }catch(e){ data = txt }
        if(!bresp.ok){ console.log('Bot POST returned', bresp.status, data); }
      } else {
        console.warn('BOT_BASE_URL not configured; saving review locally only');
        data = { warning: 'BOT_BASE_URL not configured; review saved locally', review: reviewPayload };
      }
      // persist grades to DB when available, adapt to actual exam_reviews schema
      if(pgPool){
        console.log('Persisting review - detected exam_reviews columns:', Array.from(examReviewsColumns));
        try{
          const reviewer = { id: req.session.user.id, username: req.session.user.username, discriminator: req.session.user.discriminator };
          // If table has a `review` JSONB column, write the full object there
          if(examReviewsColumns.has('review')){
            const reviewObj = { grades, feedback: reviewPayload.feedback, reviewer };
            const upd = await pgPool.query(`UPDATE exam_reviews SET reviewer_id=$1, review=$2 WHERE session_id=$3`, [req.session.user.id, JSON.stringify(reviewObj), req.params.id]);
            if(upd.rowCount === 0){
              // if `id` column exists and is required without default, generate one
              let insParams = [req.params.id, req.session.user.id, JSON.stringify(reviewObj)];
              if(examReviewsColumns.has('id')){
                const meta = examReviewsMeta['id'];
                if(meta && meta.is_nullable === 'NO' && !meta.column_default){
                  const newId = require('crypto').randomUUID();
                  await pgPool.query(`INSERT INTO exam_reviews (id, session_id, reviewer_id, review) VALUES ($1,$2,$3,$4)`, [newId, ...insParams]);
                } else {
                  await pgPool.query(`INSERT INTO exam_reviews (session_id, reviewer_id, review) VALUES ($1,$2,$3)`, insParams);
                }
              } else {
                await pgPool.query(`INSERT INTO exam_reviews (session_id, reviewer_id, review) VALUES ($1,$2,$3)`, insParams);
              }
            }
          } else {
            // Otherwise try to write to `scores` and `feedback` columns if present
            const hasScores = examReviewsColumns.has('scores');
            const hasFeedback = examReviewsColumns.has('feedback');
            if(!hasScores && !hasFeedback){
              throw new Error('exam_reviews table missing writable review columns (scores|feedback|review)');
            }
            // Try update first
            const updParts = [];
            const updVals = [];
            let paramIdx = 1;
            if(examReviewsColumns.has('reviewer_id')){ updParts.push(`reviewer_id=$${paramIdx++}`); updVals.push(req.session.user.id) }
            if(hasScores){ updParts.push(`scores=$${paramIdx++}`); updVals.push(JSON.stringify(grades)) }
            if(hasFeedback){ updParts.push(`feedback=$${paramIdx++}`); updVals.push(reviewPayload.feedback || '') }
            // add session_id as last param for WHERE
            updVals.push(req.params.id);
            const updSql = `UPDATE exam_reviews SET ${updParts.join(', ')} WHERE session_id=$${paramIdx}`;
            const updRes = await pgPool.query(updSql, updVals);
            if(updRes.rowCount === 0){
              // Insert
              const insertCols = ['session_id'];
              const insertVals = ['$1'];
              const insertParams = [req.params.id];
              let nextIdx = 2;
              if(examReviewsColumns.has('reviewer_id')){ insertCols.push('reviewer_id'); insertVals.push(`$${nextIdx++}`); insertParams.push(req.session.user.id) }
              if(hasScores){ insertCols.push('scores'); insertVals.push(`$${nextIdx++}`); insertParams.push(JSON.stringify(grades)) }
              if(hasFeedback){ insertCols.push('feedback'); insertVals.push(`$${nextIdx++}`); insertParams.push(reviewPayload.feedback || '') }
              // if `id` column exists and is required without default, generate and include it
              if(examReviewsColumns.has('id')){
                const meta = examReviewsMeta['id'];
                if(meta && meta.is_nullable === 'NO' && !meta.column_default){
                  const newId = require('crypto').randomUUID();
                  // prepend id as first column and value
                  insertCols.unshift('id');
                  insertParams.unshift(newId);
                }
              }
              // build placeholder list matching insertParams length
              const finalPlaceholders = insertParams.map((_, i)=>`$${i+1}`);
              const insSql = `INSERT INTO exam_reviews (${insertCols.join(',')}) VALUES (${finalPlaceholders.join(',')})`;
              await pgPool.query(insSql, insertParams);
            }
          }
        }catch(e){ console.error('Failed to persist review to DB for session', req.params.id, e && e.message) }
        try{
          await pgPool.query(`UPDATE exams_sessions SET payload = payload::jsonb || $1 WHERE id = $2`, [JSON.stringify({ status: 'graded' }), req.params.id]);
        }catch(e){ console.error('Failed to mark exam graded for session', req.params.id, e && e.message) }
      }
      if(!shouldProxyBot){
        return res.status(200).json(data);
      }
      return res.status(bresp.status).json(data);
    }catch(err){ console.error('grade submission error for session', req.params.id, err); return res.status(502).json({ error: 'bad_gateway' }); }
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
}

// duplicate static logging and server start removed; startApp() already handles startup
