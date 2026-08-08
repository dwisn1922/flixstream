// Telegram Auto-Push — push new film releases to a Telegram channel
// Runs daily via cron. Fetches TMDB "now playing" + "airing today" + "upcoming"
// and pushes any film/TV that hasn't been pushed before.
//
// Setup:
//   1. Create a bot via @BotFather, copy token
//   2. Create a public/private Telegram channel
//   3. Add the bot to channel as ADMIN
//   4. Fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in /home/ubuntu/flixstream/data/telegram-config.json
//   5. Test: node scripts/telegram-push.js
//   6. Add cron: 0 7 * * * cd /home/ubuntu/flixstream && node scripts/telegram-push.js

const fs = require('fs');
const https = require('https');
const path = require('path');

const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const SITE_URL = 'https://bioskopgratis.my.id';

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'telegram-config.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'telegram-pushed.json');

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        return null;
    }
}

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch (e) {
        return { pushed: {} };
    }
}

function saveState(state) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function tmdbFetch(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${TMDB_BASE}${endpoint}`);
        url.searchParams.set('api_key', TMDB_KEY);
        url.searchParams.set('language', 'id-ID');
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== '') url.searchParams.set(k, v);
        });
        https.get(url.toString(), { headers: { 'User-Agent': 'AbsoluteCinema-Telegram/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function telegramSend(token, chatId, text) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: false
        });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) resolve(parsed);
                    else reject(new Error(`Telegram API error: ${parsed.description || data}`));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// Send photo with caption + inline keyboard buttons.
// Telegram photo caption limit is 1024 chars; we trim overview to fit.
function telegramSendPhoto(token, chatId, photoUrl, caption, replyMarkup) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${token}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) resolve(parsed);
                    else reject(new Error(`Telegram API error: ${parsed.description || data}`));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
}

function formatMessage(item, type) {
    const title = item.title || item.name || 'Tanpa Judul';
    const year = (item.release_date || item.first_air_date || '').substring(0, 4) || '?';
    const rating = item.vote_average ? `⭐ ${item.vote_average.toFixed(1)}/10` : '';
    const genres = (item.genre_ids || []).slice(0, 2).map(g => GENRE_MAP[g] || '').filter(Boolean).join(', ');
    const overview = (item.overview || 'Film/serial TV terbaru tersedia di Absolute Cinema.');
    const url = `${SITE_URL}/${type}/${item.id}-${slugify(title)}`;
    const emoji = type === 'tv' ? '📺' : '🎬';
    const typeLabel = type === 'tv' ? 'Serial TV' : 'Film';
    const tag = `#${type === 'tv' ? 'SerialTV' : 'Film'}`;
    const genreTag = genres ? ` #${genres.replace(/[^A-Za-z]/g, '')}` : '';
    const yearTag = year !== '?' ? ` #${year}` : '';

    // Build caption; trim overview so total <= 1024 chars (Telegram photo caption limit)
    const header = `${emoji} <b>${typeLabel}: ${title}</b> (${year})\n${rating}${genres ? ` • ${genres}` : ''}`;
    const footer = `\n\n${tag}${genreTag}${yearTag}`;
    const reservedLen = header.length + footer.length + 4; // +4 for \n\n\n▶️
    const maxOverview = Math.max(40, 1024 - reservedLen);
    const trimmedOverview = overview.length > maxOverview
        ? overview.substring(0, maxOverview - 3) + '...'
        : overview;

    const caption = `${header}\n\n${trimmedOverview}${footer}`;

    const photoUrl = item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null;

    // Inline keyboard: "Tonton Sekarang" + optional "Poster HD" link
    const replyMarkup = {
        inline_keyboard: [
            [{ text: '🎬 Tonton Sekarang', url }],
            ...(photoUrl ? [[{ text: '🖼️ Poster HD', url: `https://image.tmdb.org/t/p/original${item.poster_path}` }]] : [])
        ]
    };

    return { caption, photoUrl, replyMarkup };
}

// Map TMDB genre IDs to readable names
const GENRE_MAP = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'SciFi',
    10770: 'TVMovie', 53: 'Thriller', 10752: 'War', 37: 'Western',
    10759: 'ActionAdventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
    10765: 'SciFiFantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'WarPolitics'
};

async function main() {
    const config = loadConfig();
    if (!config || !config.botToken || !config.chatId) {
        console.error('❌ Telegram config not found.');
        console.error('Create /home/ubuntu/flixstream/data/telegram-config.json:');
        console.error(JSON.stringify({
            botToken: 'YOUR_BOT_TOKEN_FROM_BOTFATHER',
            chatId: '-100xxxxxxxxxx (channel id with -100 prefix)',
            enabled: true
        }, null, 2));
        process.exit(1);
    }
    if (config.enabled === false) {
        console.log('⏸️  Telegram push disabled in config');
        process.exit(0);
    }

    // Genre filter config: empty array = no filter (all genres allowed)
    const allowedGenres = Array.isArray(config.allowedGenres) ? config.allowedGenres : [];
    const genreFilterActive = allowedGenres.length > 0;
    if (genreFilterActive) {
        const genreNames = allowedGenres.map(g => GENRE_MAP[g] || g).join(', ');
        console.log(`🎯 Genre filter active: ${genreNames}`);
    }

    const state = loadState();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const slot = now.getHours() < 14 ? 'morning' : 'evening';
    const slotKey = `pushed_${today}_${slot}`;
    if (state[slotKey]) {
        console.log(`⏭️  Already pushed ${slot} slot for ${today}, skipping.`);
        process.exit(0);
    }

    console.log(`📡 Fetching new films/TV for ${today}...`);

    // Fetch from multiple endpoints
    const sources = [
        { url: '/movie/now_playing', type: 'movie' },
        { url: '/movie/upcoming', type: 'movie' },
        { url: '/tv/airing_today', type: 'tv' },
        { url: '/tv/on_the_air', type: 'tv' }
    ];

    const allItems = [];
    const seen = new Set();

    for (const src of sources) {
        try {
            const data = await tmdbFetch(src.url, { page: 1 });
            (data.results || []).forEach(item => {
                if (seen.has(item.id)) return;
                seen.add(item.id);
                allItems.push({ ...item, _type: src.type });
            });
        } catch (e) {
            console.error(`⚠️  Failed to fetch ${src.url}: ${e.message}`);
        }
    }

    // Quality filter: skip non-Latin script titles (Tamil, Hindi, Korean, etc),
    // low-rated, low-popularity, no-poster items
    const MIN_RATING = 5.5;
    const MIN_POPULARITY = 15;
    const filtered = allItems.filter(item => {
        const title = (item.title || item.name || '').trim();
        // Latin/Indonesian/English: must be mostly A-Z, 0-9, spaces, basic punctuation
        const latinRatio = (title.match(/[A-Za-z0-9\s\.,'\-!?:&]/g) || []).length / Math.max(title.length, 1);
        if (latinRatio < 0.7) return false;
        // Skip low rating
        if (item.vote_average && item.vote_average < MIN_RATING) return false;
        // Skip low popularity
        if (item.popularity && item.popularity < MIN_POPULARITY) return false;
        // Skip if no poster
        if (!item.poster_path) return false;
        // Skip if overview is empty or too short
        if (!item.overview || item.overview.length < 20) return false;
        // Genre whitelist filter (only if active)
        if (genreFilterActive) {
            const itemGenres = item.genre_ids || [];
            // Require at least one allowed genre
            const hasAllowed = itemGenres.some(g => allowedGenres.includes(g));
            if (!hasAllowed) return false;
        }
        return true;
    });

    console.log(`📥 Found ${allItems.length} items, ${filtered.length} after quality filter.`);

    // Filter to top items by popularity (don't spam — limit to 5 per run)
    const top = filtered
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
        .slice(0, 5);

    let pushed = 0;
    let skipped = 0;

    for (const item of top) {
        const id = item.id;
        const title = item.title || item.name || '';
        if (state.pushed[id]) {
            skipped++;
            continue;
        }

        const { caption, photoUrl, replyMarkup } = formatMessage(item, item._type);
        try {
            if (photoUrl) {
                await telegramSendPhoto(config.botToken, config.chatId, photoUrl, caption, replyMarkup);
            } else {
                // Fallback to text-only if somehow no poster
                await telegramSend(config.botToken, config.chatId, caption);
            }
            console.log(`✅ Pushed: ${title} (${item._type}) [photo+buttons]`);
            state.pushed[id] = {
                title,
                type: item._type,
                rating: item.vote_average || null,
                popularity: item.popularity || null,
                genres: item.genre_ids || [],
                year: (item.release_date || item.first_air_date || '').substring(0, 4) || null,
                pushedAt: new Date().toISOString()
            };
            pushed++;
            // Rate limit: 1 msg per 2 seconds (photo uploads slightly slower than text)
            await new Promise(r => setTimeout(r, 2500));
        } catch (e) {
            console.error(`❌ Failed to push ${title}: ${e.message}`);
        }
    }

    state[slotKey] = true;
    state.lastRun = new Date().toISOString();
    state.lastRunSummary = { pushed, skipped, total: top.length, slot };

    // Cleanup old state.pushed entries (keep only last 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    Object.keys(state.pushed).forEach(id => {
        if (state.pushed[id].pushedAt && new Date(state.pushed[id].pushedAt).getTime() < thirtyDaysAgo) {
            delete state.pushed[id];
        }
    });

    saveState(state);
    console.log(`\n📊 Done. Pushed: ${pushed}, Skipped: ${skipped}, Total considered: ${top.length}`);
}

main().catch(e => {
    console.error('💥 Fatal:', e);
    process.exit(1);
});
