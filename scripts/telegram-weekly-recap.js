// Telegram Weekly Recap — push top 5 trending films/TV of the week
// Runs Sunday 07:00 WIB via cron. Fetches TMDB /trending/all/week
// (top trending past 7 days) and pushes a single digest to the channel.
//
// Setup:
//   cron: 0 7 * * 0 cd /home/ubuntu/flixstream && TZ='Asia/Jakarta' \
//        /home/ubuntu/.local/bin/node scripts/telegram-weekly-recap.js \
//        >> /home/ubuntu/flixstream/data/cron.log 2>&1
//
// State dedup: only re-pushes if lastRecap is missing or older than 6 days,
// so a manual re-run won't spam the channel.

const fs = require('fs');
const https = require('https');
const path = require('path');

const TMDB_KEY = '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const SITE_URL = 'https://bioskopgratis.my.id';

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'telegram-config.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'telegram-pushed.json');

const GENRE_MAP = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
    99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
    27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'SciFi',
    10770: 'TVMovie', 53: 'Thriller', 10752: 'War', 37: 'Western',
    10759: 'ActionAdventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
    10765: 'SciFiFantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'WarPolitics'
};

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
}
function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { pushed: {} }; }
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
        https.get(url.toString(), { headers: { 'User-Agent': 'AbsoluteCinema-Recap/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}
function telegramSendPhoto(token, chatId, photoUrl, caption, replyMarkup) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            chat_id: chatId, photo: photoUrl, caption,
            parse_mode: 'HTML', reply_markup: replyMarkup
        });
        const req = https.request({
            hostname: 'api.telegram.org', path: `/bot${token}/sendPhoto`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
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
        req.write(payload); req.end();
    });
}
function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
}

// Format date range for recap header (WIB)
function formatDateRange() {
    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const fmt = (d) => `${d.getDate()} ${months[d.getMonth()]}`;
    return `${fmt(start)}–${fmt(end)} ${now.getFullYear()}`;
}

async function main() {
    const config = loadConfig();
    if (!config || !config.botToken || !config.chatId) {
        console.error('❌ Telegram config not found.');
        process.exit(1);
    }
    if (config.enabled === false || config.weeklyRecapEnabled === false) {
        console.log('⏸️  Weekly recap disabled in config');
        process.exit(0);
    }

    const state = loadState();

    // Dedup: skip if last recap was < 6 days ago
    if (state.lastWeeklyRecap) {
        const lastDate = new Date(state.lastWeeklyRecap);
        const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 6) {
            console.log(`⏭️  Last recap ${daysSince.toFixed(1)} days ago, skipping (min 6 days).`);
            process.exit(0);
        }
    }

    console.log(`📡 Fetching trending this week (${formatDateRange()})...`);

    const data = await tmdbFetch('/trending/all/week', { page: 1 });
    const allItems = (data.results || []).slice(0, 25);

    // Filter: latin title, has poster, rating/popularity thresholds
    const MIN_RATING = 6.0;
    const MIN_POPULARITY = 30;
    const filtered = allItems
        .filter(item => {
            const title = (item.title || item.name || '').trim();
            const latinRatio = (title.match(/[A-Za-z0-9\s\.,'\-!?:&]/g) || []).length / Math.max(title.length, 1);
            if (latinRatio < 0.7) return false;
            if (!item.poster_path) return false;
            if (item.vote_average && item.vote_average < MIN_RATING) return false;
            if (item.popularity && item.popularity < MIN_POPULARITY) return false;
            return true;
        })
        .slice(0, 5);

    if (filtered.length === 0) {
        console.log('⚠️  No items passed filter for weekly recap.');
        process.exit(0);
    }

    // Build caption + inline keyboard
    const lines = [
        `📊 <b>RECAP MINGGUAN</b>`,
        `<i>5 film paling trending ${formatDateRange()}</i>`,
        ''
    ];
    const buttons = [];
    filtered.forEach((item, idx) => {
        const num = idx + 1;
        const title = item.title || item.name || 'Tanpa Judul';
        const year = (item.release_date || item.first_air_date || '').substring(0, 4) || '?';
        const rating = item.vote_average ? `⭐ ${item.vote_average.toFixed(1)}` : '';
        const genres = (item.genre_ids || []).slice(0, 2).map(g => GENRE_MAP[g] || '').filter(Boolean).join(', ');
        const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
        const typeLabel = mediaType === 'tv' ? '📺' : '🎬';
        const url = `${SITE_URL}/${mediaType}/${item.id}-${slugify(title)}`;

        lines.push(`${typeLabel} <b>${num}. ${title}</b> (${year}) ${rating}`);
        if (genres) lines.push(`   <i>${genres}</i>`);
        buttons.push([{ text: `▶️ Tonton #${num}: ${title.length > 25 ? title.substring(0, 23) + '…' : title}`, url }]);
    });

    lines.push('');
    lines.push('🌐 <b>bioskopgratis.my.id</b>');
    lines.push('📲 Follow untuk update harian');

    const caption = lines.join('\n');
    const coverPhoto = filtered[0].poster_path
        ? `https://image.tmdb.org/t/p/w780${filtered[0].poster_path}`
        : null;

    // Ensure caption <= 1024 chars (Telegram photo limit)
    const finalCaption = caption.length > 1024
        ? caption.substring(0, 1020) + '...'
        : caption;

    try {
        if (coverPhoto) {
            await telegramSendPhoto(config.botToken, config.chatId, coverPhoto, finalCaption, { inline_keyboard: buttons });
        } else {
            // Fallback: send as text (still with inline keyboard)
            await new Promise((resolve, reject) => {
                const payload = JSON.stringify({
                    chat_id: config.chatId, text: finalCaption,
                    parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons }
                });
                const req = https.request({
                    hostname: 'api.telegram.org', path: `/bot${config.botToken}/sendMessage`,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                }, (res) => {
                    let data = ''; res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            const p = JSON.parse(data);
                            p.ok ? resolve(p) : reject(new Error(p.description || data));
                        } catch (e) { reject(e); }
                    });
                });
                req.on('error', reject); req.write(payload); req.end();
            });
        }
        console.log(`✅ Weekly recap sent (${filtered.length} films)`);
        state.lastWeeklyRecap = new Date().toISOString();
        saveState(state);
    } catch (e) {
        console.error(`❌ Failed to send weekly recap: ${e.message}`);
        process.exit(1);
    }
}

main().catch(e => {
    console.error('💥 Fatal:', e);
    process.exit(1);
});