const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function cleanSlug(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?kick\.com\//i, '')
    .split(/[/?#]/)[0]
    .replace(/^@/, '')
    .toLowerCase();
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeChannel(raw, requestedSlug) {
  const livestream = raw?.livestream || raw?.live_stream || null;
  const user = raw?.user || {};
  const category = first(
    livestream?.categories?.[0]?.name,
    livestream?.category?.name,
    livestream?.category?.title,
    raw?.recent_categories?.[0]?.name,
    raw?.category?.name
  );

  const viewerCount = first(
    livestream?.viewer_count,
    livestream?.viewers,
    raw?.viewer_count,
    raw?.viewers
  );

  const isLive = Boolean(
    first(livestream?.is_live, raw?.is_live, livestream && viewerCount !== undefined)
  );

  const thumbnail = first(
    livestream?.thumbnail?.url,
    livestream?.thumbnail,
    raw?.livestream?.thumbnail?.url,
    raw?.thumbnail?.url,
    raw?.thumbnail
  );

  return {
    slug: first(raw?.slug, requestedSlug),
    username: first(user?.username, raw?.username, raw?.name, requestedSlug),
    channelId: first(raw?.id, raw?.channel_id),
    userId: first(raw?.user_id, user?.id),
    profilePicture: first(user?.profile_pic, user?.profile_picture, raw?.profile_pic, raw?.profile_picture),
    bio: first(user?.bio, raw?.bio),
    verified: Boolean(first(user?.is_verified, raw?.verified, raw?.is_verified, false)),
    followers: first(raw?.followers_count, raw?.followersCount, raw?.follower_count, raw?.followers),
    subscriptionEnabled: Boolean(first(raw?.subscription_enabled, raw?.subscriptions_enabled, false)),
    vodEnabled: Boolean(first(raw?.vod_enabled, false)),
    isLive,
    viewers: viewerCount ?? null,
    title: first(livestream?.session_title, livestream?.title, raw?.stream_title, raw?.title),
    category: category || null,
    startedAt: first(livestream?.created_at, livestream?.started_at, livestream?.start_time),
    thumbnail: thumbnail || null,
    playbackUrl: first(raw?.playback_url, livestream?.playback_url),
    chatroomId: first(raw?.chatroom?.id, raw?.chatroom_id),
    url: `https://kick.com/${first(raw?.slug, requestedSlug)}`
  };
}

function curlRequest(endpoint, slug) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS', '-L', '--compressed',
      '--max-time', '12',
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-GB,en;q=0.9',
      '-H', `Referer: https://kick.com/${encodeURIComponent(slug)}`,
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '-w', '\n__BIISVIEWS_STATUS__:%{http_code}',
      endpoint
    ];

    execFile('curl', args, { timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        const e = new Error(`Curl request failed: ${stderr || error.message}`);
        e.status = 502;
        return reject(e);
      }

      const marker = '\n__BIISVIEWS_STATUS__:';
      const idx = stdout.lastIndexOf(marker);
      const body = idx >= 0 ? stdout.slice(0, idx) : stdout;
      const httpStatus = idx >= 0 ? Number(stdout.slice(idx + marker.length).trim()) : 0;

      let data;
      try { data = JSON.parse(body); } catch { data = null; }

      if (httpStatus < 200 || httpStatus >= 300) {
        const e = new Error(`Kick returned HTTP ${httpStatus || 'unknown'}`);
        e.status = httpStatus === 404 ? 404 : 502;
        e.details = data || body.slice(0, 500);
        return reject(e);
      }

      if (!data || typeof data !== 'object') {
        const e = new Error('Kick did not return JSON.');
        e.status = 502;
        e.details = body.slice(0, 500);
        return reject(e);
      }

      resolve(data);
    });
  });
}

async function fetchKickChannel(slug) {
  const endpoints = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`
  ];

  let lastError;
  for (const endpoint of endpoints) {
    try {
      const data = await curlRequest(endpoint, slug);
      return { data, endpoint, transport: 'curl' };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || Object.assign(new Error('Unable to fetch Kick channel.'), { status: 502 });
}

async function handleApi(req, res, url) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });

  const slug = cleanSlug(url.searchParams.get('slug'));
  if (!slug || !/^[a-z0-9_.-]{1,80}$/i.test(slug)) {
    return sendJson(res, 400, { error: 'Enter a valid Kick username or channel URL.' });
  }

  try {
    const { data, endpoint, transport } = await fetchKickChannel(slug);
    return sendJson(res, 200, {
      ok: true,
      source: 'unofficial-kick-website-endpoint',
      endpoint,
      transport,
      fetchedAt: new Date().toISOString(),
      channel: normalizeChannel(data, slug),
      raw: data
    });
  } catch (error) {
    return sendJson(res, error.status || 502, {
      ok: false,
      error: error.message || 'Unable to fetch Kick channel.',
      details: error.details || undefined
    });
  }
}

function serveStatic(res, pathname) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.normalize(path.join(PUBLIC_DIR, relative));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) filePath = path.join(PUBLIC_DIR, 'index.html');
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(content);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/channel') return handleApi(req, res, url);
  serveStatic(res, decodeURIComponent(url.pathname));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BiisViews running on http://localhost:${PORT}`);
});
