// ============================================================================
// bioskop crawler — sync TMDB → local cache, alert on new items via Telegram
// Runs every 6h via cron. Detects new movies/TV since last crawl.
// ============================================================================
const fs = require('fs');
const https = require('https');
const path = require('path');

const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const SITE_URL = 'https://bioskopgratis.my.id';
const SITE_NAME = 'Absolute Cinema';

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_PATH = path.join(DATA_DIR, 'crawler_cache.json');
const STATE_PATH = path.join(DATA_DIR, 'crawler_state.json');
const TG_CONFIG_PATH = path.join(DATA_DIR, 'telegram-config.json');
const CRON_LOG = path.join(DATA_DIR, 'crawler.log');

// Endpoints to crawl — keep list small to stay under TMDB rate limit
const ENDPOINTS = [
    { url: '/trending/all/week',        type: 'auto',  pages: 2 },
    { url: '/movie/now_playing',        type: 'movie', pages: 1 },
    { url: '/movie/upcoming',           type: 'movie', pages: 1 },
    { url: '/movie/popular',            type: 'movie', pages: 1 },
    { url: '/tv/popular',               type: 'tv',    pages: 1 },
    { url: '/tv/airing_today',          type: 'tv',    pages: 1 },
    { url: '/tv/on_the_air',            type: 'tv',    pages: 1 }
];

const MAX_ALERT_ITEMS = 8;  // per crawl — keep TG message short

// ----- helpers -----

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(CRON_LOG, line);
    process.stdout.write(line);
}

function loadJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function saveJson(p, data) {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function tmdbFetch(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${TMDB_BASE}${endpoint}`);
        url.searchParams.set('api_key', TMDB_KEY);
        url.searchParams.set('language', 'id-ID');
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== '') url.searchParams.set(k, v);
        });
        const req = https.get(url.toString(), {
            headers: { 'User-Agent': 'AbsoluteCinema-Crawler/1.0' }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.success === false) reject(new Error(j.status_message || 'TMDB error'));
                    else resolve(j);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(new Error('TMDB timeout')); });
    });
}

function tgSend(botToken, chatId, text) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
        const url = new URL(`https://api.telegram.org/bot${botToken}/sendMessage`);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const j = JSON.parse(data);
                    if (j.ok) resolve(j);
                    else reject(new Error(j.description || 'TG error'));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(new Error('TG timeout')); });
        req.write(body);
        req.end();
    });
}

// ----- main -----

async function main() {
    log('═'.repeat(60));
    log('🎬 BIOSKOP CRAWLER — START');
    const startedAt = Date.now();

    // Load state
    const cache = loadJson(CACHE_PATH, { items: {} });   // items: { "movie:123": {...}, "tv:456": {...} }
    const state = loadJson(STATE_PATH, { lastRun: null, totalItems: 0, alertsSent: 0 });
    const tgCfg = loadJson(TG_CONFIG_PATH, null);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    log(`Cache loaded: ${Object.keys(cache.items).length} items`);

    // Build all fetch tasks (endpoint × page)
    const tasks = [];
    ENDPOINTS.forEach(ep => {
        for (let p = 1; p <= ep.pages; p++) {
            tasks.push({ endpoint: ep, page: p });
        }
    });
    log(`Tasks: ${tasks.length} TMDB requests`);

    // Parallel fetch (Promise.allSettled so one failure doesn't kill the rest)
    const results = await Promise.allSettled(tasks.map(t =>
        tmdbFetch(t.endpoint.url, { page: t.page })
    ));

    let fetchedItems = [];
    let failed = 0;
    results.forEach((res, idx) => {
        if (res.status !== 'fulfilled') {
            failed++;
            log(`  ❌ ${tasks[idx].endpoint.url} p${tasks[idx].page}: ${res.reason?.message || 'err'}`);
            return;
        }
        const ep = tasks[idx].endpoint;
        const items = res.value.results || [];
        items.forEach(item => {
            const id = item.id;
            if (!id) return;
            const type = ep.type === 'auto' ? (item.media_type || 'movie') : ep.type;
            const title = item.title || item.name || '';
            if (!title) return;
            fetchedItems.push({
                id,
                type,
                title,
                originalTitle: item.original_title || item.original_name || '',
                year: (item.release_date || item.first_air_date || '').substring(0, 4),
                rating: item.vote_average ? Math.round(item.vote_average * 10) / 10 : null,
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
                overview: (item.overview || '').substring(0, 200),
                releaseDate: item.release_date || item.first_air_date || null,
                popularity: item.popularity || 0,
                source: ep.url.split('?')[0]
            });
        });
    });
    log(`Fetched: ${fetchedItems.length} items (${failed} failed)`);

    // Dedupe by id+type
    const seen = new Set();
    fetchedItems = fetchedItems.filter(it => {
        const key = `${it.type}:${it.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Detect new items (not in cache)
    const newItems = [];
    fetchedItems.forEach(it => {
        const key = `${it.type}:${it.id}`;
        if (!cache.items[key]) newItems.push(it);
        else cache.items[key] = { ...cache.items[key], ...it, lastSeen: new Date().toISOString() };
    });

    log(`New items: ${newItems.length}`);

    // Add new items to cache
    newItems.forEach(it => {
        const key = `${it.type}:${it.id}`;
        cache.items[key] = { ...it, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() };
    });

    // Trim cache to last 1500 items (keep recent + popular)
    const allKeys = Object.keys(cache.items);
    if (allKeys.length > 1500) {
        const sorted = allKeys
            .map(k => cache.items[k])
            .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''))
            .slice(0, 1500);
        const trimmed = {};
        sorted.forEach(it => { trimmed[`${it.type}:${it.id}`] = it; });
        cache.items = trimmed;
        log(`Cache trimmed to 1500 items`);
    }

    // Save cache + state
    saveJson(CACHE_PATH, cache);
    state.lastRun = new Date().toISOString();
    state.totalItems = Object.keys(cache.items).length;
    saveJson(STATE_PATH, state);
    log(`Cache saved: ${state.totalItems} total items`);

    // Telegram alert (only if new items > 0)
    if (newItems.length > 0 && tgCfg && tgCfg.enabled && tgCfg.botToken && tgCfg.chatId) {
        try {
            // Sort by popularity, take top N
            const topNew = [...newItems].sort((a, b) => b.popularity - a.popularity).slice(0, MAX_ALERT_ITEMS);

            // Group by type
            const movies = topNew.filter(i => i.type === 'movie');
            const tvs    = topNew.filter(i => i.type === 'tv');

            const lines = [];
            lines.push(`🆕 <b>Update TMDB — ${SITE_NAME}</b>`);
            lines.push(`📅 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' })} WIB`);
            lines.push('');

            if (movies.length) {
                lines.push(`🎬 <b>Film Baru (${movies.length})</b>`);
                movies.forEach(m => {
                    const star = m.rating ? ` ⭐${m.rating}` : '';
                    lines.push(`  • <b>${m.title}</b> (${m.year || '—'})${star}`);
                });
                lines.push('');
            }
            if (tvs.length) {
                lines.push(`📺 <b>Series Baru (${tvs.length})</b>`);
                tvs.forEach(t => {
                    const star = t.rating ? ` ⭐${t.rating}` : '';
                    lines.push(`  • <b>${t.title}</b> (${t.year || '—'})${star}`);
                });
                lines.push('');
            }

            lines.push(`🔗 <a href="${SITE_URL}">${SITE_URL.replace('https://', '')}</a>`);

            const text = lines.join('\n');
            await tgSend(tgCfg.botToken, tgCfg.chatId, text);
            state.alertsSent = (state.alertsSent || 0) + 1;
            saveJson(STATE_PATH, state);
            log(`✈️ TG alert sent: ${topNew.length} items (${movies.length}M + ${tvs.length}TV)`);
        } catch (e) {
            log(`❌ TG alert failed: ${e.message}`);
        }
    } else if (newItems.length === 0) {
        log('ℹ️ No new items — TG alert skipped');
    } else if (!tgCfg || !tgCfg.enabled) {
        log('ℹ️ TG not enabled — alert skipped');
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`✅ DONE in ${elapsed}s — new=${newItems.length} total=${state.totalItems}`);
    log('═'.repeat(60));
}

main().catch(e => {
    log(`💥 FATAL: ${e.message}\n${e.stack}`);
    process.exit(1);
});
