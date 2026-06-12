Grading UI — initial skeleton

This folder contains a minimal static frontend for the web grading UI.

Files added:
- grade.html — frontend page for graders. Use query param `?session=<sessionId>`.
- scripts/grade.js — client logic that calls server proxy endpoints under `/api/exams/:id` and `/api/exams/:id/grade`.

Next steps (recommended):
1. Add a small Express server (separate service) that serves this static site and implements the routes:
   - GET /auth/discord -> redirect to Discord OAuth authorize URL
   - GET /oauth/discord/callback -> exchange code for token, fetch user, create session
   - GET /api/exams/:id -> proxy to `${BOT_BASE_URL}/exams/:id` including header `x-discord-token: <access_token>` from session
   - POST /api/exams/:id/grade -> validate and forward to `${BOT_BASE_URL}/exams/:id/grade`

2. Environment variables the server should require:
   - DISCORD_CLIENT_ID
   - DISCORD_CLIENT_SECRET
   - BOT_BASE_URL
   - SESSION_SECRET

3. Secure notes:
   - Perform token exchange server-side only. Store access token in server session only.
   - Use HTTPS and secure SameSite cookies.

If you want, I can scaffold the Express server now (routes, session, and proxy). Tell me whether to proceed with server code now or adjust the frontend first.