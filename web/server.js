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
app.use(session({
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

// Provide a small dynamic config JS so clients always get correct AUTH_SERVER value
app.get('/scripts/server-config.js', (req, res)=>{
  res.type('application/javascript');
  const js = `window.__AUTH_SERVER__ = '${BASE_URL}';`;
  console.log('Serving dynamic /scripts/server-config.js ->', BASE_URL);
  res.send(js);
});

// Ensure /scripts/auth.js is served from the static site root if present
app.get('/scripts/auth.js', (req, res, next)=>{
  const p = path.join(siteRoot, 'scripts', 'auth.js');
  if(require('fs').existsSync(p)){
    console.log('Serving static scripts/auth.js from', p);
    return res.sendFile(p);
  }
  console.log('scripts/auth.js not found at', p);
  next();
});

// Serve index.html explicitly for root
app.get('/', (req, res)=>{
  res.sendFile(path.join(siteRoot, 'index.html'));
});

// Fallback: serve index.html for any other unmatched GET (SPA-style)
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  const filePath = path.join(siteRoot, req.path);
  // if the file exists, let static middleware handle it
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

const port = process.env.PORT || 3000;
app.listen(port, ()=>{ console.log(`Server listening on http://localhost:${port}`); });
