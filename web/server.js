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
const BOT_BASE_URL = process.env.BOT_BASE_URL || '';
const BOT_API_TOKEN = process.env.BOT_API_TOKEN || process.env.DISCORD_BOT_TOKEN || '';
const BOT_GUILD_ID = process.env.BOT_GUILD_ID || process.env.GUILD_ID || process.env.BOT_API_DEFAULT_GUILD_ID || '';
const LOCAL_ALLOWED_ROLE_IDS = new Set(String(process.env.ALLOWED_ROLE_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
const REVIEW_LOCK_WINDOW_SECONDS = Number(process.env.REVIEW_LOCK_WINDOW_SECONDS || 120);

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
let hasSubmissionEventsTable = false;
let hasReviewLocksTable = false;
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
      pgPool.query(`CREATE TABLE IF NOT EXISTS exam_submission_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        exam_id TEXT,
        exam_type TEXT,
        score INTEGER,
        max_score INTEGER,
        percent INTEGER,
        passed BOOLEAN,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`).catch(e=>{ console.warn('exam_submission_events table check failed', e && e.message) });
      pgPool.query(`CREATE TABLE IF NOT EXISTS exam_review_locks (
        session_id TEXT PRIMARY KEY,
        reviewer_id TEXT NOT NULL,
        reviewer_name TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`).catch(e=>{ console.warn('exam_review_locks table check failed', e && e.message) });

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

      pgPool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='exam_submission_events') AS exists`).then(r=>{
        hasSubmissionEventsTable = r.rows[0] && r.rows[0].exists;
        console.log('exam_submission_events table exists:', hasSubmissionEventsTable);
      }).catch(e=>{ console.warn('Failed to check exam_submission_events table existence:', e && e.message) });
      pgPool.query(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='exam_review_locks') AS exists`).then(r=>{
        hasReviewLocksTable = r.rows[0] && r.rows[0].exists;
        console.log('exam_review_locks table exists:', hasReviewLocksTable);
      }).catch(e=>{ console.warn('Failed to check exam_review_locks table existence:', e && e.message) });
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

  app.use(async (req, res, next)=>{
    const protectedPages = new Set(['/exams.html', '/grade.html']);
    if(!protectedPages.has(req.path)) return next();
    if(!req.session || !req.session.user) return res.redirect('/');
    try{
      const access = await verifyGuildRoleAccess(req.session.user.id);
      if(access.allowed) return next();
      console.warn('Blocked protected page', req.path, 'for user', req.session.user.id, access.status, access.error || 'forbidden');
      if(access.status >= 500) return res.status(access.status).send('Role verification unavailable');
      return res.redirect('/?access=denied');
    }catch(e){
      console.error('Protected page access check failed', e && e.message);
      return res.status(503).send('Role verification unavailable');
    }
  });

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
      return res.json(req.session.user);
    } else {
      console.log('/api/me - no session');
      res.status(204).json(null);
    }
  });

  app.get('/api/profile', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    const roleLookup = await fetchGuildRolePayload(req.session.user.id).catch(e=>({ ok: false, status: 502, payload: null, error: e && e.message }));
    const guildRoles = roleEntriesFromPayload(roleLookup && roleLookup.payload);
    const displayRoles = toDisplayRoles(guildRoles);
    if(!roleLookup.ok){
      console.warn('Profile role lookup failed', {
        userId: req.session.user.id,
        status: roleLookup.status,
        error: roleLookup.error,
        url: roleLookup.url
      });
    }
    console.log('Profile role extraction', {
      userId: req.session.user.id,
      roleCount: guildRoles.length,
      displayRoleCount: displayRoles.length,
      lookupOk: roleLookup.ok,
      lookupStatus: roleLookup.status
    });
    if(!pgPool) return res.json({ user: req.session.user, stats: null, recentSubmissions: [], roles: displayRoles });
    try{
      const user = req.session.user;
      const statsRes = await pgPool.query(`
        SELECT
          COUNT(*)::int AS total_submissions,
          COALESCE(SUM(CASE WHEN passed THEN 1 ELSE 0 END),0)::int AS passed_submissions,
          COALESCE(AVG(percent),0)::numeric(10,2) AS average_percent,
          COALESCE(MAX(created_at), NOW()) AS last_submitted_at,
          COALESCE(SUM(CASE WHEN exam_type = 'phase1' THEN 1 ELSE 0 END),0)::int AS phase1_submissions,
          COALESCE(SUM(CASE WHEN exam_type = 'phase4' THEN 1 ELSE 0 END),0)::int AS phase4_submissions
        FROM exam_submission_events
        WHERE user_id = $1
      `, [user.id]);

      const recentRes = await pgPool.query(`
        SELECT session_id, exam_id, exam_type, score, max_score, percent, passed, created_at
        FROM exam_submission_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5
      `, [user.id]);

      const stats = statsRes.rows[0] || {};

      return res.json({
        user,
        stats: {
          totalSubmissions: Number(stats.total_submissions || 0),
          passedSubmissions: Number(stats.passed_submissions || 0),
          averagePercent: Number(stats.average_percent || 0),
          lastSubmittedAt: stats.last_submitted_at || null,
          phase1Submissions: Number(stats.phase1_submissions || 0),
          phase4Submissions: Number(stats.phase4_submissions || 0)
        },
        roles: displayRoles,
        recentSubmissions: recentRes.rows || []
      });
    }catch(e){
      console.error('profile fetch failed', e && e.message)
      return res.status(502).json({ error: 'db_error' })
    }
  });

  app.get('/logout', (req, res)=>{
    if(req.session) req.session.destroy(()=>{ res.redirect('/'); });
    else res.redirect('/');
  });

  async function getActiveReviewLock(sessionId){
    if(!pgPool || !hasReviewLocksTable || !sessionId) return null;
    try{
      const q = await pgPool.query(`
        SELECT session_id, reviewer_id, reviewer_name, updated_at
        FROM exam_review_locks
        WHERE session_id = $1
          AND updated_at > NOW() - ($2::text || ' seconds')::interval
        LIMIT 1
      `, [sessionId, String(REVIEW_LOCK_WINDOW_SECONDS)]);
      return (q.rows && q.rows[0]) || null;
    }catch(e){
      console.warn('Failed to read review lock for session', sessionId, e && e.message);
      return null;
    }
  }

  async function upsertReviewLock(sessionId, reviewer){
    if(!pgPool || !hasReviewLocksTable || !sessionId || !reviewer || !reviewer.id) return null;
    const reviewerName = reviewer.username ? `${reviewer.username}${reviewer.discriminator ? `#${reviewer.discriminator}` : ''}` : reviewer.id;
    await pgPool.query(`
      INSERT INTO exam_review_locks (session_id, reviewer_id, reviewer_name, updated_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT (session_id)
      DO UPDATE SET reviewer_id=EXCLUDED.reviewer_id, reviewer_name=EXCLUDED.reviewer_name, updated_at=NOW()
    `, [sessionId, reviewer.id, reviewerName]);
    return { reviewer_id: reviewer.id, reviewer_name: reviewerName };
  }

  async function clearReviewLockIfOwned(sessionId, reviewerId){
    if(!pgPool || !hasReviewLocksTable || !sessionId || !reviewerId) return;
    try{
      await pgPool.query(`DELETE FROM exam_review_locks WHERE session_id=$1 AND reviewer_id=$2`, [sessionId, reviewerId]);
    }catch(e){
      console.warn('Failed to clear review lock for session', sessionId, e && e.message);
    }
  }

  app.post('/api/exams/:id/lock', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    const access = await verifyGuildRoleAccess(req.session.user.id);
    if(!access.allowed) return res.status(access.status >= 500 ? access.status : 403).json({ error: access.status >= 500 ? 'role_check_unavailable' : 'forbidden' });
    if(!pgPool || !hasReviewLocksTable) return res.status(503).json({ error: 'lock_service_unavailable' });

    const sessionId = req.params.id;
    const action = String((req.body && req.body.action) || 'claim').toLowerCase();
    const me = req.session.user;

    const current = await getActiveReviewLock(sessionId);
    if(action === 'release'){
      await clearReviewLockIfOwned(sessionId, me.id);
      return res.json({ ok: true, released: true });
    }

    if(current && current.reviewer_id !== me.id){
      return res.status(409).json({
        error: 'under_review',
        reviewerId: current.reviewer_id,
        reviewerName: current.reviewer_name || 'Another reviewer'
      });
    }

    const lock = await upsertReviewLock(sessionId, me);
    return res.json({ ok: true, lock: { reviewerId: lock.reviewer_id, reviewerName: lock.reviewer_name } });
  });

  // Register API endpoints that require session/DB access
  // List exams (from DB)
  app.get('/api/exams', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    const access = await verifyGuildRoleAccess(req.session.user.id);
    if(!access.allowed) return res.status(access.status >= 500 ? access.status : 403).json({ error: access.status >= 500 ? 'role_check_unavailable' : 'forbidden' });
    if(!pgPool) return res.status(500).json({ error: 'server not configured to read DB' });
    const status = req.query.status || null;
    const phase = req.query.phase || null;
    const conditions = [];
    const params = [];
    let idx = 1;
    if(status){ conditions.push(`es.status = $${idx++}`); params.push(status) }
    const where = conditions.length ? ('WHERE ' + conditions.join(' AND ')) : '';
    const lockJoin = hasReviewLocksTable
      ? `LEFT JOIN exam_review_locks rl
          ON rl.session_id = es.id::text
         AND rl.updated_at > NOW() - ('${REVIEW_LOCK_WINDOW_SECONDS} seconds')::interval`
      : '';
    const lockSelect = hasReviewLocksTable
      ? `, rl.reviewer_id AS under_review_by_id, rl.reviewer_name AS under_review_by`
      : '';
    const sql = `SELECT es.id,
      es.exam_id,
      es.status,
      COALESCE(es.payload::jsonb->>'candidate_mention', es.payload::jsonb->>'candidateMention', es.payload::jsonb->>'candidate', es.payload::jsonb->>'candidate_name', es.payload::jsonb->>'userId') AS candidate_mention,
      COALESCE(es.payload::jsonb->>'createdAt', to_char(es.created_at, 'YYYYMMDDHH24MISS')) AS created_at
      ${lockSelect}
      FROM exams_sessions es
      ${lockJoin}
      ${where} ORDER BY es.created_at DESC LIMIT 200`;
      try{
        const q = await pgPool.query(sql, params);
        const rows = q.rows || [];
        if(phase){
          const phaseText = String(phase).toLowerCase().replace(/[^a-z0-9]+/g, '');
          return res.json(rows.filter(row => String(row.exam_id || '').toLowerCase().replace(/[^a-z0-9]+/g, '').includes(`phase${phaseText}`) || String(row.exam_id || '').toLowerCase().includes(`phase ${phaseText}`)));
        }
        return res.json(rows);
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

  function normalizeExamType(examId){
    const text = String(examId || '').toLowerCase();
    if(text.includes('phase1') || text.includes('phase 1') || text.includes('phase-1') || text.includes('phase_1')) return 'phase1';
    if(text.includes('phase4') || text.includes('phase 4') || text.includes('phase-4') || text.includes('phase_4')) return 'phase4';
    return text.replace(/[^a-z0-9]+/g, '') || 'unknown';
  }

  function getExamMaxScoreFromPayload(payload){
    const questions = Array.isArray(payload && payload.questions) ? payload.questions : [];
    return questions.reduce((sum, q)=> sum + (Number(q && q.maxScore != null ? q.maxScore : 1) || 1), 0);
  }

  function roleEntriesFromPayload(payload){
    const results = [];
    const roleIndex = new Map();

    const normalizeRoleColor = value=>{
      if(value == null) return null;
      if(typeof value === 'number' && Number.isFinite(value)){
        if(value <= 0) return null;
        const hex = value.toString(16).padStart(6, '0').slice(-6);
        return `#${hex}`;
      }
      const text = String(value).trim();
      if(!text) return null;
      if(/^0x[0-9a-f]{6}$/i.test(text)) return `#${text.slice(2)}`;
      if(/^#?[0-9a-f]{6}$/i.test(text)) return text.startsWith('#') ? text : `#${text}`;
      if(/^\d+$/.test(text)){
        const num = Number(text);
        if(Number.isFinite(num) && num > 0){
          const hex = num.toString(16).padStart(6, '0').slice(-6);
          return `#${hex}`;
        }
      }
      return null;
    };

    const addRole = (id, name, color)=>{
      const cleanId = id != null ? String(id).trim() : '';
      const cleanName = name != null ? String(name).trim() : '';
      const cleanColor = normalizeRoleColor(color);
      const key = cleanId || cleanName;
      if(!key) return;

      const existingIndex = roleIndex.get(key);
      if(existingIndex != null){
        const existing = results[existingIndex];
        // Prefer a human-readable role name over a snowflake fallback.
        if(cleanName){
          const existingName = String(existing.name || '').trim();
          const incomingIsReadable = !isSnowflakeId(cleanName);
          const existingIsMissingOrId = !existingName || isSnowflakeId(existingName);
          if(incomingIsReadable && existingIsMissingOrId){
            existing.name = cleanName;
          }
        }
        if(!existing.color && cleanColor) existing.color = cleanColor;
        return;
      }

      const entry = { id: cleanId || cleanName, name: cleanName || cleanId };
      if(cleanColor) entry.color = cleanColor;
      roleIndex.set(key, results.length);
      results.push(entry);
    };

    const collect = (value, fromRoleContainer=false)=>{
      if(!value) return;
      if(Array.isArray(value)){
        value.forEach(entry=>collect(entry, fromRoleContainer));
        return;
      }
      if(typeof value === 'string' || typeof value === 'number'){
        const text = String(value).trim();
        if(text) addRole(text, text);
        return;
      }
      if(typeof value === 'object'){
        const id = value.id ?? value.roleId ?? value.role_id ?? value.value ?? value.discordRoleId ?? null;
        const name = value.name ?? value.roleName ?? value.label ?? value.title ?? value.displayName ?? value.text ?? null;
        const color = value.color ?? value.hexColor ?? value.colorHex ?? value.colour ?? value.roleColor ?? value.role_colour ?? value.rgb ?? null;
        if(id || name) addRole(id, name, color);
        // Support map-style role containers only when keys look like Discord IDs and values are names.
        if(fromRoleContainer && !id && !name){
          for(const [k, v] of Object.entries(value)){
            if(v == null) continue;
            if(typeof v === 'string' && /^\d{16,22}$/.test(String(k).trim())){
              const key = String(k).trim();
              const val = String(v).trim();
              if(key && val) addRole(key, val);
            }
          }
        }
      }
    };

    const memberFirst = [];
    const fallback = [];
    const pushIfPresent = (arr, value)=>{ if(value) arr.push(value); };

    pushIfPresent(memberFirst, payload && payload.memberRoles);
    pushIfPresent(memberFirst, payload && payload.memberRoleIds);
    pushIfPresent(memberFirst, payload && payload.roleIds);
    pushIfPresent(memberFirst, payload && payload.member && payload.member.roles);
    pushIfPresent(memberFirst, payload && payload.member && payload.member.roleIds);
    pushIfPresent(memberFirst, payload && payload.data && payload.data.member && payload.data.member.roles);

    pushIfPresent(fallback, payload && payload.roles);
    pushIfPresent(fallback, payload && payload.userRoles);
    pushIfPresent(fallback, payload && payload.data && payload.data.roles);
    pushIfPresent(fallback, payload && payload.guildRoles);

    // Collect member-specific role ids first, then enrich from named role containers.
    memberFirst.forEach(value=>collect(value, true));
    fallback.forEach(value=>collect(value, true));

    return results;
  }

  function isSnowflakeId(value){
    return /^\d{16,22}$/.test(String(value == null ? '' : value).trim());
  }

  function toDisplayRoles(roles){
    const list = Array.isArray(roles) ? roles : [];
    return list.filter(role => {
      if(!role || !role.name) return false;
      const name = String(role.name).trim();
      if(!name) return false;
      return !isSnowflakeId(name);
    });
  }

  async function fetchGuildRolePayload(userId){
    if(!userId){
      console.warn('Role lookup skipped: missing userId');
      return { ok: false, status: 401, payload: null, error: 'unauthenticated' };
    }
    if(!BOT_BASE_URL){
      console.warn('Role lookup skipped: BOT_BASE_URL not configured');
      return { ok: false, status: 503, payload: null, error: 'BOT_BASE_URL not configured' };
    }
    if(!BOT_API_TOKEN){
      console.warn('Role lookup skipped: BOT_API_TOKEN not configured');
      return { ok: false, status: 503, payload: null, error: 'BOT_API_TOKEN not configured' };
    }
    if(!BOT_GUILD_ID){
      console.warn('Role lookup note: BOT_GUILD_ID/GUILD_ID not configured, using /api/guild-members fallback route');
    }

    const base = BOT_BASE_URL.replace(/\/$/, '');
    const url = BOT_GUILD_ID
      ? `${base}/api/guilds/${encodeURIComponent(BOT_GUILD_ID)}/members/${encodeURIComponent(userId)}/roles`
      : `${base}/api/guild-members/${encodeURIComponent(userId)}/roles`;

    console.log('Role lookup request', { userId, url, hasGuildId: Boolean(BOT_GUILD_ID) });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BOT_API_TOKEN}`,
        Accept: 'application/json'
      }
    });
    const text = await response.text().catch(()=> '');
    let payload = null;
    if(text){
      try{ payload = JSON.parse(text); }catch(e){ payload = text; }
    }
    console.log('Role lookup response', {
      userId,
      url,
      status: response.status,
      payload
    });
    return { ok: response.ok, status: response.status, payload, url };
  }

  async function verifyGuildRoleAccess(userId){
    const lookup = await fetchGuildRolePayload(userId);
    if(!lookup.ok){
      return {
        allowed: false,
        status: lookup.status === 401 || lookup.status === 403 ? 403 : 502,
        error: 'bot_role_lookup_failed',
        details: lookup.payload,
        url: lookup.url
      };
    }

    const roles = roleEntriesFromPayload(lookup.payload);
    const allowed = typeof (lookup.payload && lookup.payload.allowed) === 'boolean'
      ? lookup.payload.allowed
      : typeof (lookup.payload && lookup.payload.isAllowed) === 'boolean'
        ? lookup.payload.isAllowed
        : LOCAL_ALLOWED_ROLE_IDS.size
          ? roles.some(role => LOCAL_ALLOWED_ROLE_IDS.has(role.id) || LOCAL_ALLOWED_ROLE_IDS.has(role.name))
          : false;

    return { allowed, status: allowed ? 200 : 403, roles, details: lookup.payload, url: lookup.url };
  }

  // Fetch single exam: prefer DB row, fallback to bot
  app.get('/api/exams/:id', async (req, res)=>{
    if(!req.session || !req.session.user) return res.status(401).json({ error: 'unauthenticated' });
    const access = await verifyGuildRoleAccess(req.session.user.id);
    if(!access.allowed) return res.status(access.status >= 500 ? access.status : 403).json({ error: access.status >= 500 ? 'role_check_unavailable' : 'forbidden' });
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
    const access = await verifyGuildRoleAccess(req.session.user.id);
    if(!access.allowed) return res.status(access.status >= 500 ? access.status : 403).json({ error: access.status >= 500 ? 'role_check_unavailable' : 'forbidden' });
    const activeLock = await getActiveReviewLock(req.params.id);
    if(activeLock && activeLock.reviewer_id !== req.session.user.id){
      return res.status(409).json({
        error: 'under_review',
        reviewerId: activeLock.reviewer_id,
        reviewerName: activeLock.reviewer_name || 'Another reviewer'
      });
    }
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

      if(pgPool && (!shouldProxyBot || bresp.ok)){
        try{
          const examRow = await pgPool.query(`SELECT payload FROM exams_sessions WHERE id = $1 LIMIT 1`, [req.params.id]);
          const payloadRow = examRow.rows && examRow.rows[0] ? examRow.rows[0].payload : null;
          const examPayload = typeof payloadRow === 'string' ? JSON.parse(payloadRow) : payloadRow;
          const examId = examPayload && (examPayload.examId || examPayload.exam_id || examPayload.exam || req.params.id) || req.params.id;
          const examType = normalizeExamType(examId);
          const maxScore = getExamMaxScoreFromPayload(examPayload);
          const totalScore = Array.isArray(grades) ? grades.reduce((sum, value)=> sum + (Number(value) || 0), 0) : 0;
          const percent = maxScore ? Math.round((totalScore / maxScore) * 100) : 0;
          const passed = percent >= 75;
          await pgPool.query(`
            INSERT INTO exam_submission_events (id, user_id, session_id, exam_id, exam_type, score, max_score, percent, passed)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `, [require('crypto').randomUUID(), req.session.user.id, req.params.id, examId, examType, totalScore, maxScore, percent, passed]);
        }catch(e){
          console.error('Failed to persist exam submission event', req.params.id, e && e.message)
        }
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
        await clearReviewLockIfOwned(req.params.id, req.session.user.id);
        return res.status(200).json(data);
      }

      if(bresp.ok){
        await clearReviewLockIfOwned(req.params.id, req.session.user.id);
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
