const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

// ============================================
// DOMAIN CONFIG — bioskopgratis.my.id primary
// ============================================
const PRIMARY_DOMAIN = 'bioskopgratis.my.id';
const LEGACY_DOMAINS = ['nontonfilmgratis.xyz', 'www.nontonfilmgratis.xyz'];
const ALL_DOMAINS = [PRIMARY_DOMAIN, `www.${PRIMARY_DOMAIN}`, ...LEGACY_DOMAINS];

// Security headers + HSTS + SEO headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    res.setHeader('X-DNS-Prefetch-Control', 'on');
    // CORS for API endpoints
    if (req.path.startsWith('/api/')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    next();
});

// Compression middleware (Node 18+ has built-in zlib; express handles it via res.write)
// We use the simple deflate/gzip via Express built-in compression if available
let compression;
try { compression = require('compression'); } catch (e) { compression = null; }
if (compression) {
    app.use(compression({
        level: 6,
        threshold: 1024,
        filter: (req, res) => {
            // Don't compress images or already-compressed content
            const ct = res.getHeader('Content-Type') || '';
            if (/image|video|audio|zip|gzip|wasm/.test(ct)) return false;
            return compression.filter(req, res);
        }
    }));
}

// 301 redirect legacy domain to primary
app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (LEGACY_DOMAINS.includes(host)) {
        const newUrl = `https://${PRIMARY_DOMAIN}${req.originalUrl}`;
        return res.redirect(301, newUrl);
    }
    next();
});

// JSON body parser (for /api/track-view etc)
app.use(express.json({ limit: '32kb' }));

// TMDB API
const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';

// Leaderboard: view tracking storage
const fs = require('fs');
const DATA_DIR = path.join(__dirname, 'data');
const VIEWS_FILE = path.join(DATA_DIR, 'views.jsonl');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Append view event to JSONL log (one JSON object per line)
function trackView(event) {
    try {
        fs.appendFileSync(VIEWS_FILE, JSON.stringify(event) + '\n');
    } catch (e) {
        console.error('[trackView] failed:', e.message);
    }
}

// Aggregate views into a leaderboard.
// Dedup: same (sessionId, type, id) counted once per day.
// Returns top N entries for given type and period.
// period: 'month' | 'year' | 'all' | 'custom'
// customOpts: { year: number, month: number (1-12) | null } for custom period
async function getLeaderboard(type, period = 'all', limit = 50, customOpts = {}) {
    let views = [];
    try {
        const content = fs.readFileSync(VIEWS_FILE, 'utf8');
        views = content.split('\n').filter(Boolean).map(line => {
            try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
    } catch (e) {
        if (e.code !== 'ENOENT') console.error('[getLeaderboard] read error:', e.message);
        return [];
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // Compute period window
    let periodStart = null, periodEnd = null;
    if (period === 'month') {
        periodStart = new Date(currentYear, currentMonth - 1, 1);
        periodEnd = new Date(currentYear, currentMonth, 1);
    } else if (period === 'year') {
        const y = customOpts.year || currentYear;
        periodStart = new Date(y, 0, 1);
        periodEnd = new Date(y + 1, 0, 1);
    } else if (period === 'custom') {
        const y = customOpts.year || currentYear;
        if (customOpts.month) {
            periodStart = new Date(y, customOpts.month - 1, 1);
            periodEnd = new Date(y, customOpts.month, 1);
        } else {
            periodStart = new Date(y, 0, 1);
            periodEnd = new Date(y + 1, 0, 1);
        }
    }
    // 'all' → no filter (periodStart, periodEnd stay null)

    // Filter by period window
    let filtered = views;
    if (periodStart && periodEnd) {
        const startMs = periodStart.getTime();
        const endMs = periodEnd.getTime();
        filtered = views.filter(v => {
            const t = new Date(v.ts).getTime();
            return t >= startMs && t < endMs;
        });
    }

    // Filter by type
    filtered = filtered.filter(v => v.type === type);
    if (filtered.length === 0) return [];

    // Dedup: same (sessionId, type, id, date) → 1 view
    const seen = new Set();
    const counts = new Map(); // key: type:id → { count, lastTs, sampleTitle }
    filtered.forEach(v => {
        const dateKey = new Date(v.ts).toISOString().split('T')[0];
        const dedupKey = `${v.sessionId || 'anon'}|${v.type}|${v.id}|${dateKey}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);

        const key = `${v.type}:${v.id}`;
        if (!counts.has(key)) {
            counts.set(key, { type: v.type, id: v.id, title: v.title || '', count: 0, lastTs: 0 });
        }
        const entry = counts.get(key);
        entry.count++;
        const tsMs = new Date(v.ts).getTime();
        if (tsMs > entry.lastTs) entry.lastTs = tsMs;
    });

    // Sort desc by count, then by lastTs desc
    return Array.from(counts.values())
        .sort((a, b) => b.count - a.count || b.lastTs - a.lastTs)
        .slice(0, limit);
}

// Helper: fetch from TMDB
function tmdbFetch(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${TMDB_BASE}${endpoint}`);
        url.searchParams.set('api_key', TMDB_KEY);
        url.searchParams.set('language', 'id-ID');
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== '') url.searchParams.set(k, v);
        });

        https.get(url.toString(), { headers: { 'User-Agent': 'Absolute Cinema/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// API: Trending
app.get('/api/trending', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const data = await tmdbFetch('/trending/all/week', { page });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Track view event (called from frontend on detail/watch page open)
app.post('/api/track-view', (req, res) => {
    try {
        const { type, id, title, ts, sessionId } = req.body || {};
        if (!type || !id) return res.status(400).json({ error: 'type and id required' });
        if (type !== 'movie' && type !== 'tv') return res.status(400).json({ error: 'invalid type' });

        trackView({
            type,
            id: String(id),
            title: (title || '').substring(0, 200),
            ts: ts || new Date().toISOString(),
            sessionId: (sessionId || '').substring(0, 64)
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Leaderboard — top viewed movies/TV
// Query: ?type=movie|tv&period=month|year|all|custom&month=YYYY-MM&year=YYYY&limit=50
app.get('/api/leaderboard', async (req, res) => {
    try {
        const type = req.query.type === 'tv' ? 'tv' : 'movie';
        const period = ['month', 'year', 'all', 'custom'].includes(req.query.period) ? req.query.period : 'all';
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);

        // Custom period: parse month=YYYY-MM and year=YYYY
        let customOpts = {};
        if (period === 'custom' || req.query.month || req.query.year) {
            if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
                const [y, m] = req.query.month.split('-').map(Number);
                customOpts.year = y;
                customOpts.month = m;
            } else if (req.query.year && /^\d{4}$/.test(req.query.year)) {
                customOpts.year = parseInt(req.query.year);
            }
        }

        let entries = await getLeaderboard(type, period, limit, customOpts);

        // Fallback to TMDB popular ONLY for "now" periods (no historical context).
        // For custom month/year in the past, empty data should stay empty —
        // showing current trending would be misleading.
        const isHistorical = (period === 'custom')
            || (period === 'year' && customOpts.year && customOpts.year < new Date().getFullYear());

        if (entries.length === 0 && !isHistorical) {
            const endpoint = type === 'tv' ? '/tv/popular' : '/movie/popular';
            const data = await tmdbFetch(endpoint, { page: 1 });
            entries = (data.results || []).slice(0, limit).map((item, i) => ({
                type,
                id: String(item.id),
                title: item.title || item.name || '',
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : '',
                rating: item.vote_average || 0,
                year: (item.release_date || item.first_air_date || '').substring(0, 4),
                count: 0,
                fallback: true,
                rank: i + 1
            }));
        } else {
            // Enrich local entries with TMDB poster/rating/year
            const enriched = await Promise.all(entries.map(async (e, i) => {
                try {
                    const endpoint = e.type === 'tv' ? `/tv/${e.id}` : `/movie/${e.id}`;
                    const data = await tmdbFetch(endpoint, {});
                    return {
                        ...e,
                        poster: data.poster_path ? `https://image.tmdb.org/t/p/w342${data.poster_path}` : '',
                        rating: data.vote_average || 0,
                        year: (data.release_date || data.first_air_date || '').substring(0, 4),
                        rank: i + 1
                    };
                } catch {
                    return { ...e, poster: '', rating: 0, year: '', rank: i + 1 };
                }
            }));
            entries = enriched;
        }

        // Build period label for client
        let periodLabel = 'all';
        if (period === 'month') {
            const now = new Date();
            const monthName = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][now.getMonth()];
            periodLabel = `Bulan Ini (${monthName} ${now.getFullYear()})`;
        } else if (period === 'year') {
            const y = customOpts.year || new Date().getFullYear();
            periodLabel = `Tahun ${y}`;
        } else if (period === 'custom') {
            if (customOpts.month) {
                const monthName = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][customOpts.month - 1];
                periodLabel = `${monthName} ${customOpts.year}`;
            } else if (customOpts.year) {
                periodLabel = `Tahun ${customOpts.year}`;
            } else {
                periodLabel = 'custom';
            }
        } else {
            periodLabel = 'Semua Waktu';
        }

        res.json({ type, period, periodLabel, customOpts, count: entries.length, entries });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Discover movies
app.get('/api/discover', async (req, res) => {
    try {
        const { type = 'movie', genre, page = 1, sort_by = 'popularity.desc', year, country } = req.query;
        const endpoint = type === 'tv' ? '/discover/tv' : '/discover/movie';
        const params = {
            page,
            sort_by,
            with_genres: genre || undefined,
            'vote_count.gte': 50
        };
        if (year) {
            params[type === 'tv' ? 'first_air_date_year' : 'primary_release_year'] = year;
        }
        if (country) {
            params.with_origin_country = country.toUpperCase();
        }
        const data = await tmdbFetch(endpoint, params);
        // Add media_type to results
        data.results = data.results.map(r => ({ ...r, media_type: type }));
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Search
app.get('/api/search', async (req, res) => {
    try {
        const { q, page = 1 } = req.query;
        const data = await tmdbFetch('/search/multi', { query: q, page });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Movie details
app.get('/api/movie/:id', async (req, res) => {
    try {
        const data = await tmdbFetch(`/movie/${req.params.id}`, {
            append_to_response: 'credits,videos,similar,recommendations'
        });
        data.media_type = 'movie';
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: TV details
app.get('/api/tv/:id', async (req, res) => {
    try {
        const data = await tmdbFetch(`/tv/${req.params.id}`, {
            append_to_response: 'credits,videos,similar,recommendations'
        });
        data.media_type = 'tv';
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: TV Seasons
app.get('/api/tv/:id/season/:season', async (req, res) => {
    try {
        const data = await tmdbFetch(`/tv/${req.params.id}/season/${req.params.season}`);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Genres
app.get('/api/genres', async (req, res) => {
    try {
        const type = req.query.type || 'movie';
        const endpoint = type === 'tv' ? '/genre/tv/list' : '/genre/movie/list';
        const data = await tmdbFetch(endpoint);
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Now Playing
app.get('/api/now-playing', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const params = { page };
        // Forward filter params (whitelist to prevent injection)
        const allowedKeys = ['with_genres', 'primary_release_date.gte', 'primary_release_date.lte', 'vote_count.gte', 'with_original_language'];
        for (const k of allowedKeys) {
            if (req.query[k]) params[k] = req.query[k];
        }
        const data = await tmdbFetch('/movie/now_playing', params);
        data.results = data.results.map(r => ({ ...r, media_type: 'movie' }));
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Latest Releases (sorted by release date desc)
app.get('/api/latest', async (req, res) => {
    try {
        const page = req.query.page || 1;
        const params = {
            page,
            sort_by: 'primary_release_date.desc',
            'primary_release_date.lte': new Date().toISOString().split('T')[0],
            'vote_count.gte': 50
        };
        // Forward filter params (whitelist to prevent injection)
        const allowedKeys = ['with_genres', 'primary_release_date.gte', 'primary_release_date.lte', 'vote_count.gte', 'with_original_language'];
        for (const k of allowedKeys) {
            if (req.query[k]) params[k] = req.query[k];
        }
        const data = await tmdbFetch('/discover/movie', params);
        data.results = data.results.map(r => ({ ...r, media_type: 'movie' }));
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Upcoming
app.get('/api/upcoming', async (req, res) => {
    try {
        const data = await tmdbFetch('/movie/upcoming', { page: 1 });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Popular
// Accepts filter query params (with_genres, primary_release_date.gte/lte for movies,
// first_air_date.gte/lte for TV) and forwards them to TMDB.
app.get('/api/popular', async (req, res) => {
    try {
        const type = req.query.type || 'movie';
        const endpoint = type === 'tv' ? '/discover/tv' : '/discover/movie';
        const params = { page: req.query.page || 1, sort_by: 'popularity.desc' };
        // Forward filter params (whitelist to prevent injection)
        const allowedKeys = ['with_genres', 'primary_release_date.gte', 'primary_release_date.lte', 'first_air_date.gte', 'first_air_date.lte', 'vote_count.gte', 'with_original_language'];
        for (const k of allowedKeys) {
            if (req.query[k]) params[k] = req.query[k];
        }
        const data = await tmdbFetch(endpoint, params);
        data.results = data.results.map(r => ({ ...r, media_type: type }));
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Get view count for a specific movie/TV (aggregated from views.jsonl)
app.get('/api/movie-views/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        if (type !== 'movie' && type !== 'tv') return res.status(400).json({ error: 'invalid type' });

        const entries = await getLeaderboard(type, 'all', 10000);
        const entry = entries.find(e => String(e.id) === String(id) && e.type === type);
        const count = entry ? entry.count : 0;
        res.json({ type, id, count, lastTs: entry?.lastTs || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Batch view counts (for movie cards on home/discover) — fast lookup
app.get('/api/bulk-view-counts', async (req, res) => {
    try {
        const idsParam = (req.query.ids || '').toString();
        if (!idsParam) return res.json({ counts: {} });
        const ids = idsParam.split(',').slice(0, 200); // safety cap
        const allMovie = await getLeaderboard('movie', 'all', 10000);
        const allTv = await getLeaderboard('tv', 'all', 10000);
        const map = {};
        [...allMovie, ...allTv].forEach(e => {
            const key = `${e.type}:${e.id}`;
            if (ids.includes(`${e.id}`) || ids.includes(key)) {
                map[key] = e.count;
            }
        });
        res.json({ counts: map });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Total view stats (homepage widget) — total, today, this week
app.get('/api/total-views', async (req, res) => {
    try {
        // 1. Aggregate count by item (uses leaderboard with dedup)
        const allMovie = await getLeaderboard('movie', 'all', 10000);
        const allTv = await getLeaderboard('tv', 'all', 10000);
        const all = [...allMovie, ...allTv];
        const total = all.reduce((sum, e) => sum + (e.count || 0), 0);

        // 2. Read raw views.jsonl to compute today + week (not deduped across sessions)
        let today = 0, week = 0;
        try {
            const content = fs.readFileSync(VIEWS_FILE, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            for (const line of lines) {
                let v; try { v = JSON.parse(line); } catch { continue; }
                const t = new Date(v.ts).getTime();
                if (!t) continue;
                const age = now - t;
                if (age <= dayMs)  today++;
                if (age <= 7 * dayMs) week++;
            }
        } catch (e) {}

        res.json({
            total,
            today,
            week,
            uniqueMovies: allMovie.length,
            uniqueTV: allTv.length
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: Track ad click (Download button, Server Cadangan, Alt Link, etc.)
const AD_CLICKS_FILE = path.join(DATA_DIR, 'ad-clicks.jsonl');
app.post('/api/ad-click', (req, res) => {
    try {
        const { source, url, ts } = req.body || {};
        const entry = {
            source: (source || 'unknown').substring(0, 32),
            url: (url || '').substring(0, 256),
            ts: ts || Date.now(),
            date: new Date().toISOString()
        };
        fs.appendFile(AD_CLICKS_FILE, JSON.stringify(entry) + '\n', () => {});
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false });
    }
});

// API: Film request — sends to Telegram (fallback: log to file)
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.jsonl');
app.post('/api/request', async (req, res) => {
    try {
        const { title, type, year, note } = req.body || {};
        if (!title || String(title).trim().length < 2) {
            return res.status(400).json({ error: 'Title required' });
        }
        const safeTitle = String(title).trim().substring(0, 200);
        const safeType = ['movie', 'tv'].includes(type) ? type : 'movie';
        const safeYear = year ? String(year).substring(0, 10) : '';
        const safeNote = note ? String(note).trim().substring(0, 500) : '';
        const ts = new Date().toISOString();
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();

        // Persist to JSONL (no contact field — user requested privacy)
        const event = { ts, title: safeTitle, type: safeType, year: safeYear, note: safeNote, ip };
        try { fs.appendFileSync(REQUESTS_FILE, JSON.stringify(event) + '\n'); } catch (e) {}

        // Send to Telegram (best-effort, non-blocking on failure)
        let telegramOk = false;
        try {
            const cfgPath = path.join(DATA_DIR, 'telegram-config.json');
            if (fs.existsSync(cfgPath)) {
                const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                if (cfg.botToken) {
                    // Film/series requests go to the channel's discussion group, NOT the channel itself.
                    // Falls back to chatId if discussionGroupId is not configured.
                    const destChatId = cfg.discussionGroupId || cfg.chatId;
                    const isDiscussion = destChatId === cfg.discussionGroupId;
                    const text = `🎬 Request Film Baru${isDiscussion ? ' (Diskusi)' : ''}\n\n` +
                        `Judul: ${safeTitle}\n` +
                        `Tipe: ${safeType === 'tv' ? 'Serial TV' : 'Film'}\n` +
                        (safeYear ? `Tahun: ${safeYear}\n` : '') +
                        (safeNote ? `Catatan: ${safeNote}\n` : '') +
                        `\n[${ts}] IP: ${ip}`;
                    const url = `https://api.telegram.org/bot${cfg.botToken}/sendMessage`;
                    const body = JSON.stringify({ chat_id: destChatId, text, disable_web_page_preview: true });
                    const tgRes = await new Promise((resolve) => {
                        const u = new URL(url);
                        const req2 = https.request({
                            method: 'POST',
                            hostname: u.hostname,
                            path: u.pathname,
                            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                        }, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d })); });
                        req2.on('error', () => resolve({ status: 0, body: '' }));
                        req2.write(body); req2.end();
                    });
                    telegramOk = tgRes.status >= 200 && tgRes.status < 300;
                }
            }
        } catch (e) { /* swallow — already persisted */ }

        res.json({ ok: true, telegram: telegramOk, persisted: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// SEO: robots.txt — with AI bot rules
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`# Absolute Cinema — bioskopgratis.my.id
User-agent: *
Allow: /
Disallow: /api/
Disallow: /img/
Disallow: /sw.js
Disallow: /manifest.json

# Major search engines — explicit allow
User-agent: Googlebot
Allow: /
Crawl-delay: 0

User-agent: Bingbot
Allow: /
Crawl-delay: 0

User-agent: Slurp
Allow: /
Crawl-delay: 1

User-agent: DuckDuckBot
Allow: /
Crawl-delay: 1

User-agent: Baiduspider
Allow: /
Crawl-delay: 1

User-agent: YandexBot
Allow: /
Crawl-delay: 1

# AI training bots — block scraping for training
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: PerplexityBot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: ImagesiftBot
Disallow: /

# Aggressive crawlers — block
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: PetalBot
Disallow: /

User-agent: BLEXBot
Disallow: /

Sitemap: https://${PRIMARY_DOMAIN}/sitemap-index.xml
Sitemap: https://${PRIMARY_DOMAIN}/sitemap-main.xml
Sitemap: https://${PRIMARY_DOMAIN}/sitemap-movies.xml
Sitemap: https://${PRIMARY_DOMAIN}/sitemap-tv.xml
Sitemap: https://${PRIMARY_DOMAIN}/sitemap-blog.xml
`);
});

// SEO: Dynamic sitemap (split: index + main + movies + tv + blog + news)
let sitemapCache = { main: null, movies: null, tv: null, blog: null, generatedAt: 0 };
const SITEMAP_TTL = 12 * 60 * 60 * 1000; // 12 hours

async function generateSitemapParts() {
    const BASE = `https://${PRIMARY_DOMAIN}`;
    const today = new Date().toISOString().split('T')[0];

    // Static SEO landing pages
    const seoPages = [
        { loc: '/', priority: '1.0', changefreq: 'daily' },
        { loc: '/movies', priority: '0.9', changefreq: 'daily' },
        { loc: '/tv', priority: '0.9', changefreq: 'daily' },
        { loc: '/leaderboard', priority: '0.8', changefreq: 'daily' },
        { loc: '/blog', priority: '0.9', changefreq: 'daily' },
        { loc: '/about', priority: '0.5', changefreq: 'monthly' },
        { loc: '/privacy', priority: '0.3', changefreq: 'monthly' },
        { loc: '/terms', priority: '0.3', changefreq: 'monthly' },
        { loc: '/contact', priority: '0.4', changefreq: 'monthly' },
        { loc: '/dmca', priority: '0.3', changefreq: 'yearly' }
    ];

    // Genre landing pages
    const genres = ['action','adventure','animation','comedy','crime','documentary','drama','family','fantasy','history','horror','music','mystery','romance','sci-fi','thriller','war','western'];
    genres.forEach(g => seoPages.push({ loc: `/genre/${g}`, priority: '0.8', changefreq: 'weekly' }));

    // Year landing pages (last 10 years)
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 10; y--) {
        seoPages.push({ loc: `/year/${y}`, priority: '0.7', changefreq: 'weekly' });
        seoPages.push({ loc: `/best/${y}`, priority: '0.7', changefreq: 'weekly' });
    }

    // Country landing pages (top film-producing countries)
    const countries = ['id','us','gb','kr','jp','cn','in','th','ph','my','sg','hk','tw','au','fr','de','es','it','tr'];
    countries.forEach(c => seoPages.push({ loc: `/country/${c}`, priority: '0.6', changefreq: 'weekly' }));

    const mainXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${seoPages.map(p => `<url><loc>${BASE}${p.loc}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`).join('')}</urlset>`;

    // Fetch TMDB content for movies + TV
    const moviePages = [];
    const tvPages = [];
    const seen = new Set();
    const endpoints = [
        { url: '/trending/all/week', type: 'auto' },
        { url: '/movie/popular', type: 'movie' },
        { url: '/movie/top_rated', type: 'movie' },
        { url: '/movie/now_playing', type: 'movie' },
        { url: '/movie/upcoming', type: 'movie' },
        { url: '/tv/popular', type: 'tv' },
        { url: '/tv/top_rated', type: 'tv' },
        { url: '/tv/on_the_air', type: 'tv' }
    ];
    const fetches = [];
    endpoints.forEach(e => { for (let p = 1; p <= 2; p++) fetches.push({ endpoint: e, page: p }); });
    const results = await Promise.allSettled(fetches.map(f => tmdbFetch(f.endpoint.url, { page: f.page })));
    results.forEach((result, idx) => {
        if (result.status !== 'fulfilled') return;
        const endpoint = fetches[idx].endpoint;
        const items = result.value.results || [];
        items.forEach(item => {
            const id = item.id;
            if (seen.has(id)) return;
            seen.add(id);
            const type = endpoint.type === 'auto' ? (item.media_type || 'movie') : endpoint.type;
            const title = item.title || item.name || '';
            if (!title) return;
            const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
            const img = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '';
            const releaseDate = item.release_date || item.first_air_date || today;
            const urlXml = `<url>
                <loc>${BASE}/${type}/${id}-${slug}</loc>
                <lastmod>${releaseDate}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
                ${img ? `<image:image><image:loc>${img}</image:loc><image:title>${title.replace(/[<>&"']/g, '')}</image:title></image:image>` : ''}
            </url>`;
            if (type === 'movie') moviePages.push(urlXml);
            else tvPages.push(urlXml);
        });
    });

    const moviesXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${moviePages.join('')}</urlset>`;

    const tvXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${tvPages.join('')}</urlset>`;

    // Blog (with news namespace)
    const blogPages = [];
    const blogDir = path.join(__dirname, 'public', 'blog');
    try {
        const blogFiles = require('fs').readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
        blogFiles.forEach(f => {
            const slug = f.replace('.html', '');
            const filePath = path.join(blogDir, f);
            let lastmod = today, title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            try {
                const stat = require('fs').statSync(filePath);
                lastmod = stat.mtime.toISOString().split('T')[0];
                const content = require('fs').readFileSync(filePath, 'utf8');
                const t = content.match(/<title>([^<]+)<\/title>/);
                if (t) title = t[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            } catch (e) {}
            blogPages.push(`<url>
                <loc>${BASE}/blog/${slug}</loc>
                <lastmod>${lastmod}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.7</priority>
                <news:news>
                    <news:publication>
                        <news:name>Absolute Cinema</news:name>
                        <news:language>id</news:language>
                    </news:publication>
                    <news:publication_date>${lastmod}</news:publication_date>
                    <news:title>${title.replace(/[<>&"']/g, '')}</news:title>
                    <news:keywords>film,streaming,movie,indonesia</news:keywords>
                </news:news>
            </url>`);
        });
    } catch (e) {}

    const blogXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${blogPages.join('')}</urlset>`;

    return { main: mainXml, movies: moviesXml, tv: tvXml, blog: blogXml };
}

app.get('/sitemap.xml', async (req, res) => {
    try {
        const now = Date.now();
        if (!sitemapCache.main || (now - sitemapCache.generatedAt) > SITEMAP_TTL) {
            console.log('[sitemap] regenerating parts...');
            sitemapCache = { ...await generateSitemapParts(), generatedAt: now };
            console.log(`[sitemap] regenerated at ${new Date(now).toISOString()}`);
        }
        res.type('application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(sitemapCache.main);
    } catch (e) {
        console.error('[sitemap] error:', e);
        res.send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
    }
});

// Sitemap index (points to all sitemap parts)
app.get('/sitemap-index.xml', async (req, res) => {
    try {
        const now = Date.now();
        if (!sitemapCache.main || (now - sitemapCache.generatedAt) > SITEMAP_TTL) {
            sitemapCache = { ...await generateSitemapParts(), generatedAt: now };
        }
        const BASE = `https://${PRIMARY_DOMAIN}`;
        const lastmod = new Date(sitemapCache.generatedAt).toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${BASE}/sitemap-main.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
<sitemap><loc>${BASE}/sitemap-movies.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
<sitemap><loc>${BASE}/sitemap-tv.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
<sitemap><loc>${BASE}/sitemap-blog.xml</loc><lastmod>${lastmod}</lastmod></sitemap>
</sitemapindex>`;
        res.type('application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(xml);
    } catch (e) {
        res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error/>');
    }
});

const sendCached = (key) => async (req, res) => {
    try {
        const now = Date.now();
        if (!sitemapCache[key] || (now - sitemapCache.generatedAt) > SITEMAP_TTL) {
            sitemapCache = { ...await generateSitemapParts(), generatedAt: now };
        }
        res.type('application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(sitemapCache[key]);
    } catch (e) { res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><error/>'); }
};

app.get('/sitemap-main.xml', sendCached('main'));
app.get('/sitemap-movies.xml', sendCached('movies'));
app.get('/sitemap-tv.xml', sendCached('tv'));
app.get('/sitemap-blog.xml', sendCached('blog'));

// Image proxy (redirect to TMDB CDN)
app.get('/img/:size/{*path}', (req, res) => {
    const size = req.params.size;
    const filePath = req.params.path;
    res.redirect(`${TMDB_IMG}/${size}/${filePath}`);
});

// Movie/TV detail routes (SEO-friendly URLs)
// Handles both /movie/123 and /movie/slug-name
app.get('/movie/:idOrSlug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/tv/:idOrSlug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Watch page (player view) — same SPA handler
// Handles /watch/movie/123, /watch/tv/123, plus optional season/episode
app.get('/watch/:type/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/watch/:type/:id/:season/:episode', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Also support ?type=movie&tmdb=123 query-style
app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SEO Landing pages (genre, year, best, movies/tv hub)
app.get('/movies', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/leaderboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/genre/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/year/:year', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/best/:year', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/country/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Trust & info pages (static HTML)
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

// Blog routes
app.get('/blog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
});
app.get('/blog/:slug', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'blog', `${req.params.slug}.html`);
    res.sendFile(filePath, (err) => {
        if (err) res.status(404).sendFile(path.join(__dirname, 'public', 'blog', 'index.html'));
    });
});

// RSS feed for blog
app.get('/rss.xml', (req, res) => {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    const blogDir = path.join(__dirname, 'public', 'blog');
    const articles = [];
    try {
        const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
        for (const f of files.slice(0, 30)) {
            const content = fs.readFileSync(path.join(blogDir, f), 'utf8');
            const titleMatch = content.match(/<title>([^<]+)<\/title>/);
            const descMatch = content.match(/<meta name="description" content="([^"]+)"/);
            const dateMatch = content.match(/<meta property="article:published_time" content="([^"]+)"/);
            articles.push({
                title: titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : f.replace('.html', ''),
                link: `https://bioskopgratis.my.id/blog/${f.replace('.html', '')}`,
                desc: descMatch ? descMatch[1] : '',
                date: dateMatch ? new Date(dateMatch[1]) : new Date()
            });
        }
        articles.sort((a, b) => b.date - a.date);
    } catch (e) {}
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Absolute Cinema Blog</title>
<link>https://bioskopgratis.my.id/blog</link>
<description>Update film terbaru, review, dan rekomendasi tontonan dari Absolute Cinema</description>
<language>id-ID</language>
<atom:link href="https://bioskopgratis.my.id/rss.xml" rel="self" type="application/rss+xml"/>
${articles.map(a => `<item>
<title>${a.title}</title>
<link>${a.link}</link>
<guid>${a.link}</guid>
<pubDate>${a.date.toUTCString()}</pubDate>
<description>${a.desc}</description>
</item>`).join('\n')}
</channel>
</rss>`;
    res.send(xml);
});

// DMCA page route
app.get('/dmca', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dmca.html'));
});

// Cache static assets aggressively
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        } else if (/\.(woff2?|ttf|svg|png|jpg|jpeg|webp|ico)$/.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
        } else if (/\.(js|css)$/.test(filePath)) {
            // JS/CSS: short cache so updates propagate fast (cache-bust with ?v=)
            res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
        }
    }
}));

// All other routes -> index.html
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Absolute Cinema running on http://0.0.0.0:${PORT}`);
});
