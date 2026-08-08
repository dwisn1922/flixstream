#!/usr/bin/env node
/**
 * Seed views.jsonl with realistic TIME-DISTRIBUTED view data.
 * Each film has a "peak month" so monthly rankings differ from yearly.
 *
 * Patterns:
 *  - 30% of films: "new release" → peak in last 1-2 months, decays before
 *  - 30% of films: "evergreen" → constant views across all months
 *  - 20% of films: "summer hit" → peak in May-Jul
 *  - 20% of films: "Q4 release" → peak in Oct-Dec
 *
 * Generates 8-12K view events from ~70 unique films.
 * Run with `node scripts/seed-leaderboard.js` (appends to existing data).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VIEWS_PATH = path.join(DATA_DIR, 'views.jsonl');
const PUSHED_PATH = path.join(DATA_DIR, 'telegram-pushed.json');
const TMDB_KEY = process.env.TMDB_KEY || '2dca580c2a14b55200e784d157207b4d';
const TMDB_BASE = 'https://api.themoviedb.org/3';

function tmdb(endpoint) {
    return new Promise((resolve, reject) => {
        const url = `${TMDB_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}`;
        const req = https.get(url, { headers: { 'User-Agent': 'AbsoluteCinema/1.0' } }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Bad JSON from ${endpoint}`)); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    });
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function genSessionId() {
    return Array.from({ length: 16 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[rand(0, 35)]).join('');
}

/**
 * Compute monthly view distribution for a film based on its pattern.
 * Returns array of 12 numbers (Jan..Dec for current year), each = view count
 * in that month relative to base intensity (1.0 = average).
 */
function computeMonthlyDistribution(pattern, peakMonth) {
    const dist = Array(12).fill(0);
    const now = new Date();
    const curMonth = now.getMonth(); // 0-11

    if (pattern === 'new_release') {
        // Peak at curMonth and curMonth-1, fall off going back
        for (let m = 0; m < 12; m++) {
            const monthsAgo = (curMonth - m + 12) % 12;
            // 0 = peak, decay backward
            dist[m] = Math.max(0, 1 - monthsAgo * 0.35);
        }
    } else if (pattern === 'evergreen') {
        // Roughly constant, slight wave
        for (let m = 0; m < 12; m++) {
            dist[m] = 0.8 + Math.random() * 0.4; // 0.8-1.2
        }
    } else if (pattern === 'summer_hit') {
        // Peak in May-Jul (months 4-6)
        for (let m = 0; m < 12; m++) {
            const peak = [4, 5, 6, 7];
            if (peak.includes(m)) {
                dist[m] = 1.5 + Math.random() * 0.5; // 1.5-2.0
            } else if (m === 3 || m === 8) {
                dist[m] = 0.7 + Math.random() * 0.3; // 0.7-1.0
            } else {
                dist[m] = 0.3 + Math.random() * 0.3; // 0.3-0.6
            }
        }
    } else if (pattern === 'q4_release') {
        // Peak in Oct-Dec (months 9-11)
        for (let m = 0; m < 12; m++) {
            const peak = [9, 10, 11];
            if (peak.includes(m)) {
                dist[m] = 1.5 + Math.random() * 0.5;
            } else if (m === 0 || m === 8) {
                dist[m] = 0.6 + Math.random() * 0.3;
            } else {
                dist[m] = 0.3 + Math.random() * 0.3;
            }
        }
    } else if (pattern === 'q1_release') {
        // Peak in Jan-Mar
        for (let m = 0; m < 12; m++) {
            const peak = [0, 1, 2];
            if (peak.includes(m)) {
                dist[m] = 1.5 + Math.random() * 0.5;
            } else if (m === 3 || m === 11) {
                dist[m] = 0.6 + Math.random() * 0.3;
            } else {
                dist[m] = 0.3 + Math.random() * 0.3;
            }
        }
    } else if (pattern === 'fall_release') {
        // Peak Aug-Oct
        for (let m = 0; m < 12; m++) {
            const peak = [7, 8, 9];
            if (peak.includes(m)) {
                dist[m] = 1.5 + Math.random() * 0.5;
            } else if (m === 6 || m === 10) {
                dist[m] = 0.6 + Math.random() * 0.3;
            } else {
                dist[m] = 0.3 + Math.random() * 0.3;
            }
        }
    }

    return dist;
}

/**
 * Generate view events for a film across 2025 + 2026 with pattern-based distribution.
 * Returns array of {type, id, title, ts, sessionId}.
 */
function generateFilmViews(film, baseViews) {
    const patterns = ['new_release', 'evergreen', 'summer_hit', 'q4_release', 'q1_release', 'fall_release'];
    // Assign pattern based on film index for determinism-ish
    const pattern = patterns[film.patternIdx % patterns.length];
    const dist = computeMonthlyDistribution(pattern);

    const events = [];
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();

    // Generate for 2025 (full year) and 2026 (Jan to current month)
    for (let year = 2025; year <= curYear; year++) {
        for (let m = 0; m < 12; m++) {
            // For 2026, only go up to current month
            if (year === curYear && m > curMonth) continue;
            // For 2025, all months
            const monthViews = Math.floor(baseViews * dist[m] * (year === curYear ? 1.3 : 0.7)); // 2026 boosted slightly (more recent = more activity)
            for (let v = 0; v < monthViews; v++) {
                const day = rand(1, 28);
                const hour = rand(0, 23);
                const min = rand(0, 59);
                const ts = new Date(year, m, day, hour, min).toISOString();
                events.push({
                    type: film.type,
                    id: String(film.id),
                    title: film.title,
                    ts,
                    sessionId: genSessionId(),
                });
            }
        }
    }
    return events;
}

async function loadPushedItems() {
    if (!fs.existsSync(PUSHED_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(PUSHED_PATH, 'utf-8'));
    const items = [];
    let idx = 0;
    for (const [id, info] of Object.entries(data.pushed || {})) {
        items.push({
            id,
            type: info.type,
            title: info.title,
            popularity: 60,
            patternIdx: idx++,
        });
    }
    return items;
}

async function loadTmdbItems() {
    const sources = [
        tmdb('/trending/movie/week'),
        tmdb('/trending/tv/week'),
        tmdb('/movie/popular?page=1'),
        tmdb('/tv/popular?page=1'),
        tmdb('/movie/top_rated?page=1'),
        tmdb('/tv/top_rated?page=1'),
    ];
    const results = await Promise.allSettled(sources);
    const all = [];
    const seen = new Set();
    let idx = 100; // start pushed items at 0
    for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value.results || []) {
            const type = item.media_type || (r.value === 'tv' ? 'tv' : 'movie');
            const k = `${type || (item.title ? 'movie' : 'tv')}:${item.id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const isMovie = item.title !== undefined || item.release_date !== undefined;
            all.push({
                id: item.id,
                type: isMovie ? 'movie' : 'tv',
                title: item.title || item.name || item.original_title || item.original_name,
                popularity: item.popularity || 0,
                patternIdx: idx++,
            });
        }
    }
    return all;
}

async function main() {
    console.log('🌱 Seeding leaderboard view data (time-distributed)...');

    const pushed = await loadPushedItems();
    console.log(`  → ${pushed.length} films from telegram-pushed history`);

    const tmdbItems = await loadTmdbItems();
    console.log(`  → ${tmdbItems.length} films from TMDB`);

    const all = [...pushed, ...tmdbItems];
    const seen = new Set();
    const deduped = all.filter((it) => {
        const k = `${it.type}:${it.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    console.log(`  → ${deduped.length} unique items`);

    // Generate events for each film with varying base views
    const allEvents = [];
    deduped.forEach((film, i) => {
        // Base views scale with popularity (0-200)
        const popFactor = Math.min(1, (film.popularity || 0) / 100);
        const baseViews = 5 + Math.floor(popFactor * 60) + rand(0, 15);
        const events = generateFilmViews(film, baseViews);
        allEvents.push(...events);
    });
    console.log(`  → ${allEvents.length} total view events generated`);

    // Read existing views.jsonl, dedup against new events
    let existing = [];
    if (fs.existsSync(VIEWS_PATH)) {
        existing = fs.readFileSync(VIEWS_PATH, 'utf-8')
            .trim().split('\n').filter(Boolean)
            .map((l) => {
                try { return JSON.parse(l); } catch { return null; }
            }).filter(Boolean);
    }
    const existingKeys = new Set(
        existing.map((e) => `${e.sessionId}|${e.type}|${e.id}|${(e.ts || '').slice(0, 10)}`)
    );
    const filtered = allEvents.filter((e) => {
        const k = `${e.sessionId}|${e.type}|${e.id}|${(e.ts || '').slice(0, 10)}`;
        return !existingKeys.has(k);
    });
    console.log(`  → ${filtered.length} new unique events (skipped ${allEvents.length - filtered.length} collisions)`);

    if (filtered.length === 0) {
        console.log('  ⚠️  No new events to add (all collisions). Try clearing views.jsonl first.');
        return;
    }

    // Append
    const out = filtered.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(VIEWS_PATH, out);

    console.log(`✅ views.jsonl updated. New size: ${(fs.statSync(VIEWS_PATH).size / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
