const express = require('express');
const session = require('express-session');
const path = require('path');
const fetch = global.fetch || require('node-fetch');
const bodyParser = require('body-parser');
require('dotenv').config();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'devsecret';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

if(!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET){
  console.warn('Warning: DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set. OAuth will not work until configured.');
}

const app = express();
app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, sameSite: 'lax' }
}));

// If BASE_URL is HTTPS (production behind a proxy like Railway), enable trust proxy
try{
  if((BASE_URL||'').startsWith('https')){
    app.set('trust proxy', 1);
    // mark cookies as secure when running over HTTPS
    app.use((req, res, next)=>{
      if(req.session) req.session.cookie.secure = true;
      next();
    });
  }
}catch(e){ /* ignore */ }

// Serve static site from parent folder
const siteRoot = path.join(__dirname, '..', 'legobeerus.github.io');
app.use(express.static(siteRoot));

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

    const next = req.session.next || '/';
    delete req.session.next;
    res.redirect(next);
  }catch(err){ console.error(err); res.status(500).send('OAuth error') }
});

app.get('/api/me', (req, res)=>{
  if(req.session && req.session.user){ res.json(req.session.user); }
  else res.status(204).json(null);
});

app.get('/logout', (req, res)=>{
  req.session.destroy(()=>{
    res.redirect('/');
  });
});

const port = process.env.PORT || 3000;
app.listen(port, ()=>{ console.log(`Server listening on http://localhost:${port}`); });
