/**
 * index.js — NRLDC Express Server entry point
 * Port: 3001 (proxied from Vite frontend at /api)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { apiLimiter, authLimiter } = require('./middleware/rateLimit');
const { requestContext } = require('./utils/requestContext');
const { refresh: refreshRegions } = require('./utils/regionRegistry');
const pool = require('./db');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { checkSchema, reportSchemaProblem } = require('./schemaCheck');
const { originalFilename } = require('./utils/filenames');

const authRoutes          = require('./routes/auth');
const usersRoutes         = require('./routes/users');
const discrepanciesRoutes = require('./routes/discrepancies');
const outagesRoutes       = require('./routes/outages');
const cycleDataRoutes     = require('./routes/cycleData');
const configRoutes        = require('./routes/config');
const logsRoutes          = require('./routes/logs');
const regionsRoutes       = require('./routes/regions');

const app = express();
const PORT = process.env.PORT || 3001;

// Behind a reverse proxy (nginx, a load balancer) Express needs to be told how
// many hops to trust before req.ip is meaningful. 0 means "no proxy".
app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '1'));

// Middleware
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// In production the API and the app are served from the same origin, so no
// cross-origin requests happen at all. In development Vite runs on its own
// port, so those origins have to be allowed. Set CORS_ORIGINS (comma
// separated) to serve the frontend from somewhere else.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);
const devOrigins = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
const allowedOrigins = corsOrigins.length > 0 ? corsOrigins : (IS_PRODUCTION ? [] : devOrigins);

app.use(helmet({
  // The built frontend is plain static assets served from this origin; the
  // default CSP would block its own stylesheet and Google Fonts.
  contentSecurityPolicy: IS_PRODUCTION ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  } : false,
  // Only meaningful over HTTPS; harmless otherwise, and a reminder to
  // terminate TLS in front of this.
  hsts: IS_PRODUCTION,
}));

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// A body that is not valid JSON is the caller's mistake, not ours. Without
// this the parser's SyntaxError fell through to the global handler and became
// a 500 — which says "the server broke" to whoever is watching the error rate,
// and is trivially triggerable by anyone who can reach the API.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That request is too large.' });
  }
  return next(err);
});

// ─── Which backend served this? ─────────────────────────────────────────────
// Behind a load balancer, a response is anonymous: nothing in it says which
// node produced it, so an uneven distribution, a single sick node, or a
// session that breaks when the client is moved are all invisible. Every
// response carries the node's identity, so any request — not just a health
// check — can be attributed during a load test or an incident.
//
// It is a hostname and pid, deliberately not a public address: it identifies
// the node to whoever already has access to the logs, and tells an outsider
// nothing about the topology.
const os = require('os');
const NODE_ID = `${os.hostname()}/${process.pid}`;

app.use((req, res, next) => {
  res.setHeader('X-Served-By', NODE_ID);
  next();
});

// Health first: uptime monitors poll it and must never be throttled. It is
// also the load test's probe, so it reports enough to tell the nodes apart
// and to show what the proxy in front is passing through.
app.get('/api/health', async (req, res) => {
  const identity = {
    node: NODE_ID,
    host: os.hostname(),
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    // What the app believes the caller's address is, and what the proxy said.
    // If these disagree, TRUST_PROXY_HOPS is wrong and the rate limiter is
    // throttling the proxy rather than the client.
    clientIp: req.ip,
    forwardedFor: req.get('x-forwarded-for') || null,
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS || '1'),
    // Whether *this process* has the production hardening on. Already
    // observable from the CSP and HSTS headers, and it lets the readiness
    // check report on the running server rather than on its own shell.
    production: IS_PRODUCTION,
  };
  try {
    const started = Date.now();
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      db: 'connected',
      dbLatencyMs: Date.now() - started,
      ...identity,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message, ...identity });
  }
});

// Login and password recovery are throttled hard; everything else is keyed
// on the signed-in user, so one busy dashboard cannot lock out a colleague.
app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// ─── Secure file downloads ───────────────────────────────────────────────────
// Filenames are reduced to their basename and the resolved path is verified to
// stay inside the upload directory, so "../" traversal cannot escape it.
const fs = require('fs');
const uploadDir = path.join(__dirname, 'upload');

function sendUpload(req, res) {
  const safeName = path.basename(decodeURIComponent(req.params.filename || ''));
  if (!safeName || safeName === '.' || safeName === '..') {
    return res.status(400).json({ error: 'Invalid filename.' });
  }

  const filePath = path.resolve(uploadDir, safeName);
  if (filePath !== path.join(uploadDir, safeName) || !filePath.startsWith(uploadDir + path.sep)) {
    return res.status(400).json({ error: 'Invalid filename.' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }

  // Hand back the name the uploader chose, not the stored unique one.
  res.download(filePath, originalFilename(safeName));
}

app.get('/api/upload/:filename', requireAuth, sendUpload);
app.get('/api/uploads/:filename', requireAuth, sendUpload);

// Routes
// Only /api/auth/logout needs an identity; the rest (login, verify-otp,
// forgot-password) must stay reachable to signed-out users.
// Carries the caller's region for the rest of the request, so log entries can
// be attributed without every writer being handed it. Annotation only —
// authorisation always reads req.auth. See utils/requestContext.js.
app.use('/api', requestContext);

app.use('/api/auth/logout',   requireAuth);
app.use('/api/auth',          authRoutes);                       // public (rate-limited)
app.use('/api/users',         requireAuth, usersRoutes);
app.use('/api/discrepancies', requireAuth, discrepanciesRoutes);
app.use('/api/outages',       requireAuth, outagesRoutes);
app.use('/api/cycle-data',    requireAuth, cycleDataRoutes);
app.use('/api/config',        requireAuth, configRoutes);
app.use('/api/logs',          requireAuth, requireAdmin, logsRoutes);
app.use('/api/regions',       requireAuth, regionsRoutes);   // national level only

// ─── Serving the built frontend ─────────────────────────────────────────────
// In production this process serves the app as well as the API, from one
// origin and one port — no Vite, no CORS, nothing else to deploy. Build it
// with `npm run build` in the project root first.
const distDir = path.join(__dirname, '..', 'dist');
const hasBuild = fs.existsSync(path.join(distDir, 'index.html'));

if (hasBuild) {
  // Hashed asset filenames can be cached hard; index.html must not be, or
  // browsers keep loading the previous release after a deploy.
  app.use(express.static(distDir, {
    index: false,
    maxAge: '1y',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
}

// Anything unmatched under /api is a genuine 404.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

if (hasBuild) {
  // The app has no router, but a refresh on any path should still load it.
  // index.html must always be revalidated, or browsers keep serving the
  // previous release's asset references after a deploy.
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.use((req, res) => {
    res.status(404).json({
      error: 'No frontend build found. Run "npm run build" in the project root, or use the Vite dev server.',
    });
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

/**
 * Top up any setting that has no row yet.
 *
 * Settings are keyed on (key, region): the SMTP ones live under the reserved
 * GLOBAL region because one mail account serves everybody, and the rest belong
 * to each region separately. This used to insert with ON CONFLICT (key), which
 * stopped matching an index the moment the key widened — and because the error
 * was logged rather than thrown, nothing said so.
 */
async function ensureDefaultConfig() {
  const globalDefaults = {
    smtpHost: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    smtpPort: process.env.SMTP_PORT || '587',
    smtpSecure: process.env.SMTP_SECURE || 'false',
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
    smtpFrom: process.env.SMTP_FROM || 'NRLDC Schedule Portal <noreply@example.invalid>',
  };
  const regionalDefaults = { maxDays: '5', lockoutAttempts: '3' };

  try {
    for (const [key, value] of Object.entries(globalDefaults)) {
      await pool.query(
        `INSERT INTO config (key, region, value) VALUES ($1, 'GLOBAL', $2)
         ON CONFLICT (key, region) DO NOTHING`, [key, value]
      );
    }
    // Every region gets its own row, including any created after this ran last.
    for (const [key, value] of Object.entries(regionalDefaults)) {
      await pool.query(
        `INSERT INTO config (key, region, value)
         SELECT $1, r.acronym, $2 FROM regions r
         ON CONFLICT (key, region) DO NOTHING`, [key, value]
      );
    }
    console.log('[CONFIG] Default system and SMTP parameters verified in DB.');
  } catch (err) {
    console.error('[CONFIG ERROR] Failed to ensure default configs:', err.message);
  }
}
let server;

/**
 * Verify the database schema, then start listening.
 *
 * Starting against an out-of-date schema produced an opaque 500 on every
 * authenticated request; failing here instead says exactly what to run.
 */
async function start() {
  try {
    const result = await checkSchema();
    if (!result.ok) {
      reportSchemaProblem(result);
      process.exit(1);
    }
  } catch (err) {
    console.error('');
    console.error('  Could not reach the database to verify the schema.');
    console.error(`  ${err.message}`);
    console.error('');
    console.error('  Check that PostgreSQL is running and that server/.env is correct.');
    console.error('');
    process.exit(1);
  }

  await ensureDefaultConfig();
  // The region list is consulted on nearly every request. The foreign keys are
  // what enforce it; this is the cache that validation and menus read.
  await refreshRegions();

  server = app.listen(PORT, () => {
    console.log('');
    console.log('  NRLDC Schedule Discrepancy Portal — backend');
    console.log(`  mode        : ${IS_PRODUCTION ? 'production' : 'development'}`);
    console.log(`  listening   : http://localhost:${PORT}`);
    console.log(`  database    : ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`);
    console.log(`  frontend    : ${hasBuild ? `served from ${path.relative(process.cwd(), distDir)}` : 'not built (use the Vite dev server)'}`);
    if (!IS_PRODUCTION && allowedOrigins.length) {
      console.log(`  cors origins: ${allowedOrigins.join(', ')}`);
    }
    console.log('');
  });
}

start();

/**
 * Shut down cleanly: stop accepting connections, let in-flight requests
 * finish, then close the database pool. Without this a restart can cut a
 * request off mid-write and leaves pool connections for Postgres to reap.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SERVER] ${signal} received — finishing in-flight requests...`);

  if (!server) {          // signalled before the listener was created
    process.exit(0);
  }

  const forceExit = setTimeout(() => {
    console.error('[SERVER] Shutdown timed out after 10s — exiting anyway.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pool.end();
      console.log('[SERVER] Database pool closed. Goodbye.');
    } catch (err) {
      console.error('[SERVER] Error closing the pool:', err.message);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[SERVER] Unhandled promise rejection:', reason);
});

module.exports = app;
