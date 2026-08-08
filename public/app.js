// ===== State =====
let trendingPage = 1;
let discoverPage = 1;
let searchPage = 1;
let currentGenre = '';
let currentType = 'movie';
let currentSort = 'popularity.desc';
let currentTrendingType = 'all';
let heroItems = [];
let heroIndex = 0;
let heroInterval = null;
let genres = {};
let lastView = 'home';


// ===== Live Search / Autocomplete =====
let searchTimeout = null;
let lastSearchQuery = '';

// Persistent sessionId for view tracking (one per browser, 1 year)
function getSessionId() {
    let sid = localStorage.getItem('flixSessionId');
    if (!sid) {
        sid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('flixSessionId', sid);
    }
    return sid;
}

// ===== Watchlist (Bookmark) — localStorage backed =====
const WL_KEY = 'flixWatchlist';
const HIST_KEY = 'flixHistory';
const CW_KEY = 'flixContinue'; // continue watching

function getWatchlist() {
    try { return JSON.parse(localStorage.getItem(WL_KEY) || '[]'); }
    catch (e) { return []; }
}
function saveWatchlist(arr) {
    try { localStorage.setItem(WL_KEY, JSON.stringify(arr.slice(0, 200))); }
    catch (e) {}
}
function isInWatchlist(id, type) {
    return getWatchlist().some(x => String(x.id) === String(id) && x.type === type);
}
function toggleWatchlist(item, type) {
    const list = getWatchlist();
    const idx = list.findIndex(x => String(x.id) === String(item.id) && x.type === type);
    let added = false;
    if (idx >= 0) {
        list.splice(idx, 1);
    } else {
        const title = item.title || item.name || '';
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : '';
        list.unshift({
            id: item.id,
            type: type || item.media_type || 'movie',
            title,
            poster,
            year: (item.release_date || item.first_air_date || '').substring(0, 4),
            rating: item.vote_average?.toFixed(1) || '0',
            addedAt: Date.now()
        });
        added = true;
    }
    saveWatchlist(list);
    return added;
}

// ===== Watch History (max 50) =====
function getHistory() {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
    catch (e) { return []; }
}
function addToHistory(item, type) {
    if (!item || !item.id) return;
    const list = getHistory();
    const id = String(item.id);
    const t = type || item.media_type || 'movie';
    // Remove existing entry for same id+type
    const idx = list.findIndex(x => String(x.id) === id && x.type === t);
    if (idx >= 0) list.splice(idx, 1);
    const title = item.title || item.name || '';
    const poster = item.poster_path ? `https://image.tmdb.org/t/p/w185${item.poster_path}` : '';
    list.unshift({
        id: item.id,
        type: t,
        title,
        poster,
        year: (item.release_date || item.first_air_date || '').substring(0, 4),
        rating: item.vote_average?.toFixed(1) || '0',
        watchedAt: Date.now()
    });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 50))); }
    catch (e) {}
    updateContinueWatchingSection();
}

// ===== Continue Watching (derived from history, deduped by id+type) =====
function getContinueWatching() {
    return getHistory().slice(0, 12);
}
function updateContinueWatchingSection() {
    const section = document.getElementById('continueSection');
    const grid = document.getElementById('continueGrid');
    if (!section || !grid) return;
    const items = getContinueWatching();
    if (items.length === 0) {
        section.classList.add('hidden-section');
        return;
    }
    section.classList.remove('hidden-section');
    grid.innerHTML = items.map(item => `
        <div class="movie-card cw-card" onclick="showDetail(${item.id}, '${item.type}')">
            <img src="${item.poster}" alt="${item.title}" loading="lazy"
                 onerror="this.onerror=null;this.classList.add('img-failed');this.insertAdjacentHTML('afterend','<div class=\\'card-fallback\\'>${(item.title || '').replace(/'/g, '')}</div>');this.remove();">
            <div class="cw-progress"></div>
            <div class="card-overlay">
                <div class="card-play">▶</div>
            </div>
            <div class="card-info">
                <div class="card-title">${item.title}</div>
                <div class="card-meta">
                    <span>${item.year || ''}</span>
                    <span class="card-rating">⭐ ${item.rating || '0'}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// Fire-and-forget view tracker for leaderboard
function trackView(type, id, title) {
    if (!type || !id) return;
    try {
        fetch('/api/track-view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                id: String(id),
                title: title || '',
                ts: new Date().toISOString(),
                sessionId: getSessionId()
            }),
            keepalive: true
        }).catch(() => {});
    } catch (e) { /* silent */ }
}

function liveSearch(query) {
    const dropdown = document.getElementById('searchDropdown');
    
    // Clear if empty
    if (!query || query.length < 2) {
        dropdown.classList.remove('show');
        dropdown.innerHTML = '';
        lastSearchQuery = '';
        return;
    }
    
    // Debounce - tunggu 300ms setelah user berhenti ngetik
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        if (query === lastSearchQuery) return;
        lastSearchQuery = query;
        fetchLiveResults(query);
    }, 300);
}

async function fetchLiveResults(query) {
    const dropdown = document.getElementById('searchDropdown');
    dropdown.classList.add('show');
    dropdown.innerHTML = '<div class="search-loading">🔍 Mencari...</div>';
    
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        const results = data.results
            .filter(r => r.media_type !== 'person' && r.poster_path)
            .slice(0, 8);
        
        if (results.length === 0) {
            dropdown.innerHTML = '<div class="search-loading">Tidak ditemukan</div>';
            return;
        }
        
        dropdown.innerHTML = results.map(item => {
            const title = item.title || item.name;
            const year = (item.release_date || item.first_air_date || '').substring(0, 4);
            const rating = item.vote_average?.toFixed(1) || '0';
            const type = item.media_type === 'tv' ? '📺 TV' : '🎬 Movie';
            const poster = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '';
            
            return `
                <div class="search-item" onclick="selectSearchResult(${item.id}, '${item.media_type}')">
                    <img src="${poster}" alt="${title}" loading="lazy">
                    <div class="search-item-info">
                        <div class="search-item-title">${title}</div>
                        <div class="search-item-meta">
                            <span>${type}</span>
                            <span>${year}</span>
                            <span class="search-item-rating">⭐ ${rating}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        dropdown.innerHTML = '<div class="search-loading">Error loading results</div>';
    }
}

function selectSearchResult(id, type) {
    const dropdown = document.getElementById('searchDropdown');
    dropdown.classList.remove('show');
    dropdown.innerHTML = '';
    document.getElementById('searchInput').value = '';
    lastSearchQuery = '';
    showDetail(id, type);
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const searchBox = document.getElementById('searchBox');
    if (searchBox && !searchBox.contains(e.target)) {
        const dropdown = document.getElementById('searchDropdown');
        dropdown.classList.remove('show');
    }
});

// ===========================================
// SEO Helpers — dynamic per-page meta + schema
// ===========================================
const SEO = {
    BASE: 'https://bioskopgratis.my.id',
    setMeta(name, content, attr = 'name') {
        let el = document.head.querySelector(`meta[${attr}="${name}"]`);
        if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
        el.setAttribute('content', content);
    },
    setLink(rel, href) {
        let el = document.head.querySelector(`link[rel="${rel}"]`);
        if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
        el.setAttribute('href', href);
    },
    injectSchema(id, schemaObj) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('script');
            el.type = 'application/ld+json';
            el.id = id;
            document.head.appendChild(el);
        }
        el.textContent = JSON.stringify(schemaObj);
    },
    removeSchema(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    },
    injectBreadcrumb(items) {
        const schema = {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            'itemListElement': items.map((it, i) => ({
                '@type': 'ListItem',
                'position': i + 1,
                'name': it.name,
                'item': this.BASE + it.path
            }))
        };
        this.injectSchema('pageBreadcrumb', schema);
    }
};

function setSEOMeta({ title, description, canonical, schema, breadcrumbs, ogImage, ogType = 'website' }) {
    if (title) {
        document.title = title;
        SEO.setMeta('title', title);
        SEO.setMeta('og:title', title, 'property');
        SEO.setMeta('twitter:title', title);
    }
    if (description) {
        SEO.setMeta('description', description);
        SEO.setMeta('og:description', description, 'property');
        SEO.setMeta('twitter:description', description);
    }
    if (canonical) {
        const url = SEO.BASE + canonical;
        SEO.setLink('canonical', url);
        SEO.setMeta('og:url', url, 'property');
    }
    if (ogImage) {
        SEO.setMeta('og:image', ogImage, 'property');
        SEO.setMeta('twitter:image', ogImage);
    }
    SEO.setMeta('og:type', ogType, 'property');
    if (schema) SEO.injectSchema('pageSchema', schema);
    else SEO.removeSchema('pageSchema');
    if (breadcrumbs) SEO.injectBreadcrumb(breadcrumbs);
}

// Country name lookup for SEO-friendly URLs
function getCountryName(code) {
    const map = {
        'id': 'Indonesia', 'us': 'Amerika', 'gb': 'Inggris', 'kr': 'Korea Selatan',
        'jp': 'Jepang', 'cn': 'China', 'in': 'India', 'th': 'Thailand',
        'ph': 'Filipina', 'my': 'Malaysia', 'sg': 'Singapura', 'hk': 'Hong Kong',
        'tw': 'Taiwan', 'au': 'Australia', 'fr': 'Prancis', 'de': 'Jerman',
        'es': 'Spanyol', 'it': 'Italia', 'ca': 'Kanada', 'mx': 'Meksiko',
        'br': 'Brazil', 'tr': 'Turki', 'ru': 'Rusia', 'ae': 'Uni Emirat Arab',
        'eg': 'Mesir', 'ng': 'Nigeria', 'za': 'Afrika Selatan', 'ar': 'Argentina',
        'cl': 'Chili', 'co': 'Kolombia', 'pe': 'Peru', 've': 'Venezuela',
        'se': 'Swedia', 'no': 'Norwegia', 'dk': 'Denmark', 'fi': 'Finlandia',
        'nl': 'Belanda', 'be': 'Belgia', 'ch': 'Swiss', 'at': 'Austria',
        'pl': 'Polandia', 'cz': 'Ceko', 'gr': 'Yunani', 'pt': 'Portugal',
        'ie': 'Irlandia', 'nz': 'Selandia Baru', 'vn': 'Vietnam',
        'sa': 'Arab Saudi', 'il': 'Israel', 'ir': 'Iran', 'iq': 'Irak',
        'pk': 'Pakistan', 'bd': 'Bangladesh', 'lk': 'Sri Lanka', 'mm': 'Myanmar',
        'kh': 'Kamboja', 'la': 'Laos', 'np': 'Nepal', 'mm': 'Myanmar'
    };
    return map[code.toLowerCase()] || code.toUpperCase();
}

// TMDB discover endpoints for genre/year/country — proxy via /api/discover
// === SEO helper: inject ItemList JSON-LD for category/genre/year/country pages ===
// Helps Google show "Top X movies in [genre]" rich snippets in search results
function injectItemListSchema(items, listName, listUrl, listType = 'ItemList') {
    if (!items || items.length === 0) return;
    const listItems = items.slice(0, 20).map((it, idx) => {
        const itemUrl = `https://bioskopgratis.my.id/${it.media_type || 'movie'}/${it.id}`;
        return {
            "@type": "ListItem",
            "position": idx + 1,
            "url": itemUrl,
            "name": it.title || it.name || '',
            "image": it.poster_path ? `https://image.tmdb.org/t/p/w185${it.poster_path}` : undefined
        };
    }).filter(it => it.name);
    const schema = {
        "@context": "https://schema.org",
        "@type": listType,
        "name": listName,
        "url": listUrl,
        "numberOfItems": listItems.length,
        "itemListElement": listItems
    };
    // Remove ALL existing ItemList scripts (home page trending ItemList also persists on SPA nav)
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
        try {
            const d = JSON.parse(s.textContent);
            if (d['@type'] === 'ItemList' || d['@graph']?.some(g => g['@type'] === 'ItemList')) {
                s.remove();
            }
        } catch(e) {}
    });
    const existing = document.getElementById('itemListSchema');
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = 'itemListSchema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
}

async function showDiscoverByGenre(slug, genreName) {
    const genreMap = {
        'action': 28, 'adventure': 12, 'animation': 16, 'comedy': 35,
        'crime': 80, 'documentary': 99, 'drama': 18, 'family': 10751,
        'fantasy': 14, 'history': 36, 'horror': 27, 'music': 10402,
        'mystery': 9648, 'romance': 10749, 'sci-fi': 878, 'science-fiction': 878,
        'thriller': 53, 'tv-movie': 10770, 'war': 10752, 'western': 37,
        'action-adventure': 10759, 'kids': 10762, 'news': 10763, 'reality': 10764,
        'sci-fi-fantasy': 10765, 'soap': 10766, 'talk': 10767, 'war-politics': 10768
    };
    const id = genreMap[slug.toLowerCase()] || 28;
    const grid = document.getElementById('discoverGrid');
    if (grid) {
        grid.innerHTML = '<div class="loader"></div>';
        document.getElementById('discoverSection')?.scrollIntoView({behavior:'smooth', block:'start'});
    }
    try {
        const data = await fetch(`/api/discover?type=movie&genre=${id}`).then(r => r.json());
        const results = data.results || [];
        if (grid) renderDiscoverGrid(results, grid);
        // Inject ItemList regardless of grid (for collection pages without grid)
        injectItemListSchema(results, `Film ${genreName} Terbaik`, `https://bioskopgratis.my.id/genre/${slug}`);
    } catch(e) { if (grid) grid.innerHTML = '<p>Gagal memuat film.</p>'; }
}

async function showDiscoverByYear(year, sort = 'popularity.desc') {
    const grid = document.getElementById('discoverGrid');
    if (grid) {
        grid.innerHTML = '<div class="loader"></div>';
        document.getElementById('discoverSection')?.scrollIntoView({behavior:'smooth', block:'start'});
    }
    try {
        const data = await fetch(`/api/discover?type=movie&year=${year}&sort_by=${encodeURIComponent(sort)}`).then(r => r.json());
        const results = data.results || [];
        if (grid) renderDiscoverGrid(results, grid);
        const label = sort === 'top_rated' ? `Film ${year} Terbaik` : `Film ${year} Populer`;
        injectItemListSchema(results, label, `https://bioskopgratis.my.id/year/${year}`);
    } catch(e) { if (grid) grid.innerHTML = '<p>Gagal memuat film.</p>'; }
}

async function showDiscoverByCountry(code) {
    const grid = document.getElementById('discoverGrid');
    if (grid) {
        grid.innerHTML = '<div class="loader"></div>';
        document.getElementById('discoverSection')?.scrollIntoView({behavior:'smooth', block:'start'});
    }
    try {
        const data = await fetch(`/api/discover?type=movie&country=${encodeURIComponent(code)}`).then(r => r.json());
        const results = data.results || [];
        if (grid) renderDiscoverGrid(results, grid);
        const countryName = (typeof getCountryName === 'function' ? getCountryName(code) : code);
        injectItemListSchema(results, `Film ${countryName} Terbaik`, `https://bioskopgratis.my.id/country/${code}`);
    } catch(e) { if (grid) grid.innerHTML = '<p>Gagal memuat film.</p>'; }
}

function renderDiscoverGrid(movies, grid) {
    if (!movies.length) {
        grid.innerHTML = '<p style="color:#888;padding:20px;text-align:center;">Tidak ada film ditemukan.</p>';
        return;
    }
    grid.innerHTML = movies.map(m => {
        const poster = m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : '/placeholder.svg';
        const year = (m.release_date || '').slice(0, 4) || '';
        const rating = m.vote_average ? m.vote_average.toFixed(1) : '–';
        return `
        <div class="movie-card" onclick="goToDetail(${m.id}, 'movie')" data-id="${m.id}" data-type="movie">
            <div class="poster">
                <img src="${poster}" alt="${(m.title || '').replace(/"/g, '&quot;')}" loading="lazy" decoding="async">
                <div class="rating">⭐ ${rating}</div>
            </div>
            <div class="info">
                <h3>${(m.title || '').replace(/</g, '&lt;')}</h3>
                <p>${year} ${m.original_language ? '· ' + m.original_language.toUpperCase() : ''}</p>
            </div>
        </div>`;
    }).join('');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    // Hide loader
    setTimeout(() => {
        document.getElementById('loader').classList.add('fade-out');
        setTimeout(() => document.getElementById('loader').style.display = 'none', 500);
    }, 800);

    // Restore home filter from localStorage (so chip selection persists across refreshes)
    restoreHomeFilter();

    // Load initial data
    await Promise.all([
        loadTotalStats(),
        loadTrending(),
        loadLatest(),
        loadPopularMovies(),
        loadPopularTV(),
        loadNowPlaying()
    ]);

    // Check for new movie notifications
    checkNewMovies();

    // Show Telegram join pill (delayed, persistent across pages, dismissable per session)
    scheduleTgPill();

    // Start smart ad refresh
    startAdRefresh();

    // Lazy load native banner
    lazyLoadNativeBanner();

    // URL Routing - auto-open correct view from URL
    updateNotifBodyClass();
    const currentPath = window.location.pathname;
    const movieRouteMatch = currentPath.match(/^\/movie\/(.+)/);
    const tvRouteMatch = currentPath.match(/^\/tv\/(.+)/);
    const genreMatch = currentPath.match(/^\/genre\/(.+)/);
    const yearMatch = currentPath.match(/^\/year\/(\d{4})/);
    const bestMatch = currentPath.match(/^\/best\/(\d{4})/);
    const countryMatch = currentPath.match(/^\/country\/(.+)/);
    // /watch/movie/123 or /watch/tv/123 or /watch/tv/123/1/5 (with season/episode)
    const watchRouteMatch = currentPath.match(/^\/watch\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
    if (watchRouteMatch) {
        const type = watchRouteMatch[1];
        const id = watchRouteMatch[2];
        const season = watchRouteMatch[3] ? parseInt(watchRouteMatch[3], 10) : null;
        const episode = watchRouteMatch[4] ? parseInt(watchRouteMatch[4], 10) : null;
        console.log('[route] watch:', { type, id, season, episode });
        if (type === 'tv' && season != null && episode != null) {
            watchContent(id, 'tv', { season, episode });
        } else {
            watchContent(id, type);
        }
    } else if (movieRouteMatch) {
        const idOrSlug = movieRouteMatch[1];
        const id = extractIdFromSlug(idOrSlug);
        if (id) {
            showDetail(id, 'movie');
        } else {
            findAndShowDetail(idOrSlug, 'movie');
        }
    } else if (tvRouteMatch) {
        const idOrSlug = tvRouteMatch[1];
        const id = extractIdFromSlug(idOrSlug);
        if (id) {
            showDetail(id, 'tv');
        } else {
            findAndShowDetail(idOrSlug, 'tv');
        }
    } else if (genreMatch) {
        const slug = genreMatch[1];
        const genreName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        showDiscoverByGenre(slug, genreName);
        updateNav('movies');
        setSEOMeta({
            title: `Nonton Film ${genreName} Subtitle Indonesia HD - Bioskop Gratis`,
            description: `Koleksi film ${genreName} subtitle Indonesia terlengkap. Streaming movie ${genreName} online gratis kualitas HD. Update setiap hari.`,
            canonical: `/genre/${slug}`,
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': `Film ${genreName}`,
                'description': `Koleksi film ${genreName} subtitle Indonesia.`,
                'url': `https://bioskopgratis.my.id/genre/${slug}`,
                'isPartOf': { '@id': 'https://bioskopgratis.my.id/#website' },
                'about': { '@type': 'Thing', 'name': genreName }
            }
        });
    } else if (yearMatch) {
        const year = yearMatch[1];
        showDiscoverByYear(year);
        updateNav('movies');
        setSEOMeta({
            title: `Nonton Film ${year} Subtitle Indonesia HD - Bioskop Gratis`,
            description: `Daftar film rilisan tahun ${year} subtitle Indonesia terlengkap. Streaming movie ${year} online gratis kualitas HD.`,
            canonical: `/year/${year}`,
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': `Film Tahun ${year}`,
                'description': `Koleksi film rilisan tahun ${year}.`,
                'url': `https://bioskopgratis.my.id/year/${year}`,
                'isPartOf': { '@id': 'https://bioskopgratis.my.id/#website' }
            }
        });
    } else if (bestMatch) {
        const year = bestMatch[1];
        showDiscoverByYear(year, 'top_rated');
        updateNav('movies');
        setSEOMeta({
            title: `Film Terbaik ${year} - Rating Tertinggi - Bioskop Gratis`,
            description: `Daftar film terbaik tahun ${year} dengan rating tertinggi. Rekomendasi film ${year} paling worth it untuk ditonton.`,
            canonical: `/best/${year}`,
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': `Film Terbaik ${year}`,
                'description': `Film terbaik tahun ${year} dengan rating tertinggi.`,
                'url': `https://bioskopgratis.my.id/best/${year}`
            }
        });
    } else if (countryMatch) {
        const code = countryMatch[1];
        const countryName = getCountryName(code);
        showDiscoverByCountry(code);
        updateNav('movies');
        setSEOMeta({
            title: `Nonton Film ${countryName} Subtitle Indonesia HD`,
            description: `Koleksi film ${countryName} subtitle Indonesia terlengkap. Streaming movie ${countryName} online gratis HD.`,
            canonical: `/country/${code}`,
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': `Film ${countryName}`,
                'url': `https://bioskopgratis.my.id/country/${code}`
            }
        });
    } else if (currentPath === '/discover' || currentPath === '/movies') {
        showDiscover('movie');
        updateNav('movies');
        setSEOMeta({
            title: 'Daftar Film Subtitle Indonesia HD Terbaru 2026 - Bioskop Gratis',
            description: 'Daftar lengkap film subtitle Indonesia terbaru 2026. Streaming movie dari berbagai genre action, horror, drama, comedy, romance gratis kualitas HD.',
            canonical: '/movies',
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': 'Daftar Film',
                'description': 'Koleksi lengkap film subtitle Indonesia.',
                'url': 'https://bioskopgratis.my.id/movies'
            }
        });
    } else if (currentPath === '/tv') {
        showDiscover('tv');
        updateNav('tv');
        setSEOMeta({
            title: 'Serial TV Subtitle Indonesia HD Terbaru 2026 - Bioskop Gratis',
            description: 'Daftar lengkap serial TV dan drama Korea subtitle Indonesia terbaru 2026. Streaming drama Korea, drama China, anime, series barat gratis kualitas HD.',
            canonical: '/tv',
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': 'Serial TV',
                'description': 'Koleksi lengkap serial TV subtitle Indonesia.',
                'url': 'https://bioskopgratis.my.id/tv'
            }
        });
    } else if (currentPath === '/leaderboard' || currentPath === '/top') {
        showLeaderboard();
        updateNav('leaderboard');
        setSEOMeta({
            title: 'Top Film Paling Banyak Ditonton 2026 - Leaderboard Bioskop Gratis',
            description: 'Daftar film paling banyak ditonton di Absolute Cinema minggu ini, bulan ini, dan sepanjang masa. Cek film populer dan trending.',
            canonical: '/leaderboard',
            schema: {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                'name': 'Top Leaderboard Film',
                'url': 'https://bioskopgratis.my.id/leaderboard'
            }
        });
    } else if (currentPath === '/search') {
        // Search lives on home — go home then focus search input
        goHome();
        updateNav('home');
        setTimeout(() => {
            const inp = document.querySelector('#searchBox input, #searchInput');
            if (inp) inp.focus();
        }, 200);
    } else if (currentPath === '/faq') {
        // FAQ is a section on home — go home and scroll to it
        goHome();
        updateNav('home');
        setTimeout(() => {
            const faq = document.getElementById('faqSection');
            if (faq) faq.scrollIntoView({behavior: 'smooth'});
        }, 200);
    } else if (currentPath === '/dmca') {
        // Link to DMCA page (external)
        window.location.href = '/dmca.html';
    }

    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
        const popPath = e.state?.path || window.location.pathname;
        const moviePop = popPath.match(/^\/movie\/(.+)/);
        const tvPop = popPath.match(/^\/tv\/(.+)/);
        const watchPop = popPath.match(/^\/watch\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?/);
        if (watchPop) {
            const type = watchPop[1];
            const id = watchPop[2];
            const season = watchPop[3] ? parseInt(watchPop[3], 10) : null;
            const episode = watchPop[4] ? parseInt(watchPop[4], 10) : null;
            if (type === 'tv' && season != null && episode != null) {
                watchContent(id, 'tv', { season, episode });
            } else {
                watchContent(id, type);
            }
        } else if (moviePop) {
            const idOrSlug = moviePop[1];
            const id = extractIdFromSlug(idOrSlug);
            if (id) {
                showDetail(id, 'movie');
            } else {
                findAndShowDetail(idOrSlug, 'movie');
            }
        } else if (tvPop) {
            const idOrSlug = tvPop[1];
            const id = extractIdFromSlug(idOrSlug);
            if (id) {
                showDetail(id, 'tv');
            } else {
                findAndShowDetail(idOrSlug, 'tv');
            }
        } else if (popPath === '/discover' || popPath === '/movies') {
            showDiscover('movie');
            updateNav('movies');
        } else if (popPath === '/tv') {
            showDiscover('tv');
            updateNav('tv');
        } else if (popPath === '/leaderboard' || popPath === '/top') {
            showLeaderboard();
            updateNav('leaderboard');
        } else if (popPath === '/search') {
            goHome();
            updateNav('home');
            setTimeout(() => {
                const inp = document.querySelector('#searchBox input, #searchInput');
                if (inp) inp.focus();
            }, 200);
        } else if (popPath === '/faq') {
            goHome();
            updateNav('home');
            setTimeout(() => {
                const faq = document.getElementById('faqSection');
                if (faq) faq.scrollIntoView({behavior: 'smooth'});
            }, 200);
        } else if (popPath === '/' || popPath === '') {
            goHome();
        }
    });

    // Header scroll effect + Sticky ad
    window.addEventListener('scroll', () => {
        const header = document.querySelector('.header');
        const btn = document.getElementById('backToTop');
        if (window.scrollY > 100) {
            header.classList.add('scrolled');
            btn.classList.add('visible');
        } else {
            header.classList.remove('scrolled');
            btn.classList.remove('visible');
        }
    });

    // Sticky bottom ad DISABLED — too intrusive
    // setTimeout(() => {
    //     const stickyBar = document.getElementById('stickyAdBar');
    //     if (stickyBar && !localStorage.getItem('stickyAdClosed')) {
    //         stickyBar.classList.remove('hidden');
    //     }
    // }, 3000);
});

// ===== Navigation =====
function updateMeta(name, content) {
    let el = document.querySelector(`meta[property="${name}"]`) || document.querySelector(`meta[name="${name}"]`);
    if (el) el.setAttribute('content', content);
}

function showDisclaimer() {
    alert('⚠️ DISCLAIMER\n\nSemua konten video yang tersedia di Absolute Cinema tidak disimpan di server kami. Kami hanya menampilkan embed dari situs pihak ketiga.\n\nKami tidak bertanggung jawab atas konten yang di-host di situs eksternal.');
}

function closeStickyAd() {
    const bar = document.getElementById('stickyAdBar');
    if (bar) bar.classList.add('hidden');
    localStorage.setItem('stickyAdClosed', '1');
}

function goHome() {
    showSection('home');
    updateNav('home');
    // Reset URL
    if (window.location.pathname !== '/') {
        history.pushState({}, '', '/');
    }
    // Reset SEO title
    document.title = 'Nonton Film Gratis - Streaming Movie & Serial TV Online | Absolute Cinema';
    updateMeta('description', 'Nonton film gratis subtitle Indonesia. Streaming movie dan serial TV online terbaru. Koleksi film action, horror, comedy, drama terlengkap.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSection(view) {
    // Track watch state for ad refresh
    isWatching = (view === 'watch');
    if (isWatching) {
        stopAdRefresh();
    } else {
        startAdRefresh();
    }

    // Stop video playback when leaving watch section
    if (view !== 'watch') {
        const watchContent = document.getElementById('watchContent');
        if (watchContent) {
            const iframes = watchContent.querySelectorAll('iframe');
            iframes.forEach(iframe => {
                iframe.src = '';
                iframe.remove();
            });
            watchContent.innerHTML = '';
        }
    }
    
    const sections = ['hero', 'trendingSection', 'latestSection', 'popularMoviesSection', 'popularTVSection', 'nowPlayingSection', 'discoverSection', 'searchSection', 'detailSection', 'watchSection', 'faqSection', 'leaderboardSection', 'watchlistSection', 'historySection', 'nativeBannerSlot', 'bannerSlot1', 'continueSection'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (view === 'home' && ['hero', 'trendingSection', 'latestSection', 'popularMoviesSection', 'popularTVSection', 'nowPlayingSection', 'faqSection', 'nativeBannerSlot', 'bannerSlot1'].includes(id)) {
                el.classList.remove('hidden');
                // continueSection visibility is controlled by history (uses hidden-section)
                if (id === 'continueSection') el.classList.remove('hidden');
            } else if (view === 'discover' && id === 'discoverSection') {
                el.classList.remove('hidden');
            } else if (view === 'search' && id === 'searchSection') {
                el.classList.remove('hidden');
            } else if (view === 'detail' && id === 'detailSection') {
                el.classList.remove('hidden');
            } else if (view === 'watch' && id === 'watchSection') {
                el.classList.remove('hidden');
            } else if (view === 'leaderboard' && id === 'leaderboardSection') {
                el.classList.remove('hidden');
            } else if (view === 'watchlist' && id === 'watchlistSection') {
                el.classList.remove('hidden');
            } else if (view === 'history' && id === 'historySection') {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
                // continueSection: when navigating away from home, hide it via hidden-section
                // so updateContinueWatchingSection can re-evaluate on return
                if (id === 'continueSection') el.classList.add('hidden-section');
            }
        }
    });
    lastView = view;
}

function updateNav(nav) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll(`[data-nav="${nav}"]`).forEach(l => l.classList.add('active'));
    // Close mobile menu
    document.getElementById('mobileNav').classList.remove('show');
}

function toggleMobileMenu() {
    document.getElementById('mobileNav').classList.toggle('show');
}

// ===== iOS 26 Bottom Tab Bar =====
function iosTabGo(tab, btn) {
    document.querySelectorAll('.ios-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    switch (tab) {
        case 'home':
            goHome();
            break;
        case 'movies':
            showDiscover('movie');
            break;
        case 'tv':
            showDiscover('tv');
            break;
        case 'top':
            showLeaderboard();
            break;
        case 'search':
            // Focus search input on mobile
            const sb = document.getElementById('searchBox');
            if (sb) {
                const inp = sb.querySelector('input');
                if (inp) { inp.focus(); inp.scrollIntoView({behavior: 'smooth', block: 'center'}); }
            }
            break;
    }
    // Sync with header nav highlight
    const navMap = { home: 'home', movies: 'movies', tv: 'tv', top: 'leaderboard' };
    if (navMap[tab]) updateNav(navMap[tab]);
}

// ===== Hero =====
function setHero(items) {
    heroItems = items.filter(i => i.backdrop_path).slice(0, 5);
    heroIndex = 0;
    heroActiveLayer = 'A'; // reset
    // Reset both layers
    const bgA = document.getElementById('heroBgA');
    const bgB = document.getElementById('heroBgB');
    if (bgA) { bgA.classList.add('active'); bgA.classList.remove('fading'); bgA.dataset.preloaded = ''; }
    if (bgB) { bgB.classList.remove('active'); bgB.classList.remove('fading'); bgB.dataset.preloaded = ''; }
    // Inject <link rel="preload"> for LCP boost (first hero backdrop is the LCP element)
    if (heroItems[0] && heroItems[0].backdrop_path) {
        const lcpUrl = `https://image.tmdb.org/t/p/w1280${heroItems[0].backdrop_path}`;
        let preloadLink = document.getElementById('heroLcpPreload');
        if (!preloadLink) {
            preloadLink = document.createElement('link');
            preloadLink.id = 'heroLcpPreload';
            preloadLink.rel = 'preload';
            preloadLink.as = 'image';
            preloadLink.setAttribute('fetchpriority', 'high');
            document.head.appendChild(preloadLink);
        }
        preloadLink.href = lcpUrl;
    }
    renderHero();
    renderHeroDots();
    startHeroAuto();
    // Preload next image immediately for snappy first transition
    setTimeout(() => preloadHeroImage(1), 100);
    // Update continue watching section in case history was modified elsewhere
    updateContinueWatchingSection();
}

let heroActiveLayer = 'A'; // which bg layer is currently visible

function preloadHeroImage(index) {
    const item = heroItems[index];
    if (!item || !item.backdrop_path) return;
    const url = `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`;
    // Preload into the INACTIVE layer so it's ready when user clicks next
    const inactiveLayer = heroActiveLayer === 'A' ? document.getElementById('heroBgB') : document.getElementById('heroBgA');
    const img = new Image();
    img.onload = () => {
        inactiveLayer.style.backgroundImage = `url(${url})`;
        inactiveLayer.dataset.preloadedBackdrop = item.backdrop_path;
        inactiveLayer.dataset.preloaded = 'true';
    };
    img.src = url;
}

function renderHero() {
    const item = heroItems[heroIndex];
    if (!item) return;

    const title = item.title || item.name;
    const backdrop = item.backdrop_path;
    const rating = item.vote_average?.toFixed(1) || '0';
    const year = (item.release_date || item.first_air_date || '').substring(0, 4);
    const type = item.media_type || 'movie';
    const imageUrl = `https://image.tmdb.org/t/p/w1280${backdrop}`;

    const content = document.querySelector('.hero-content');
    const bgA = document.getElementById('heroBgA');
    const bgB = document.getElementById('heroBgB');

    const updateContent = () => {
        document.getElementById('heroTitle').textContent = title;
        document.getElementById('heroOverview').textContent = item.overview || '';
        document.getElementById('heroRating').textContent = `⭐ ${rating}`;
        document.getElementById('heroYear').textContent = year;
        document.getElementById('heroType').textContent = type === 'tv' ? '📺 TV Show' : '🎬 Movie';
        document.querySelectorAll('.hero-dot').forEach((d, i) => {
            d.classList.toggle('active', i === heroIndex);
        });
    };

    const nextIndex = (heroIndex + 1) % heroItems.length;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        const nextLayer = heroActiveLayer === 'A' ? bgA : bgB;
        const currentLayer = heroActiveLayer === 'A' ? bgB : bgA;
        nextLayer.style.backgroundImage = `url(${imageUrl})`;
        nextLayer.classList.add('active');
        currentLayer.classList.remove('active');
        heroActiveLayer = heroActiveLayer === 'A' ? 'B' : 'A';
        updateContent();
        preloadHeroImage(nextIndex);
        return;
    }

    // Cancel any in-flight animations on content
    if (content.getAnimations) content.getAnimations().forEach(a => a.cancel());

    // === Layered cross-fade (Netflix-style) ===
    const nextBg = heroActiveLayer === 'A' ? bgB : bgA;
    const currentBg = heroActiveLayer === 'A' ? bgA : bgB;

    let swapped = false;
    const CROSSFADE_MS = 900;
    const TEXT_OUT_MS = 400;
    const TEXT_IN_MS = 500;

    const performCrossFade = () => {
        if (swapped) return;
        swapped = true;

        // Set image on next layer
        nextBg.style.backgroundImage = `url(${imageUrl})`;

        // Reset Ken Burns on next layer
        nextBg.style.animation = 'none';
        void nextBg.offsetWidth;
        nextBg.style.animation = '';

        // Use WAAPI for instant start with longer, smoother easing
        currentBg.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: CROSSFADE_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }
        );
        nextBg.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: CROSSFADE_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' }
        );

        // Update classes for CSS (in case anything else cares)
        nextBg.classList.add('active');
        currentBg.classList.remove('active');
        heroActiveLayer = heroActiveLayer === 'A' ? 'B' : 'A';

        // Text content fade: synchronized with bg cross-fade
        // Fade out in first 40% of bg cross-fade, swap text at midpoint
        const fadeOut = content.animate([
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(8px)' }
        ], { duration: TEXT_OUT_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' });

        fadeOut.onfinish = () => {
            updateContent();
            // Fade in over second half of bg cross-fade
            content.animate([
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], { duration: TEXT_IN_MS, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)', fill: 'forwards' });
        };

        // Preload next-next image
        preloadHeroImage((heroIndex + 1) % heroItems.length);
    };

    // Check if image already preloaded → instant cross-fade (no waiting)
    if (nextBg.dataset.preloaded === 'true' && nextBg.dataset.preloadedBackdrop === backdrop) {
        performCrossFade();
    } else {
        // Preload on the fly with short fallback
        const preloadImg = new Image();
        preloadImg.onload = performCrossFade;
        preloadImg.onerror = performCrossFade;
        preloadImg.src = imageUrl;
        setTimeout(() => { if (!swapped) performCrossFade(); }, 80);
    }
}

function renderHeroDots() {
    const container = document.getElementById('heroDots');
    container.innerHTML = heroItems.map((_, i) =>
        `<div class="hero-dot ${i === 0 ? 'active' : ''}" onclick="goToHero(${i})"></div>`
    ).join('');
}

function goToHero(index) {
    heroIndex = index;
    renderHero();
    resetHeroAuto();
}

function heroNext() {
    heroIndex = (heroIndex + 1) % heroItems.length;
    renderHero();
    resetHeroAuto();
}

function heroPrev() {
    heroIndex = (heroIndex - 1 + heroItems.length) % heroItems.length;
    renderHero();
    resetHeroAuto();
}

function startHeroAuto() {
    if (heroInterval) clearInterval(heroInterval);
    heroInterval = setInterval(heroNext, 6000);
}

function resetHeroAuto() {
    startHeroAuto();
}

function watchHero() {
    if (heroItems[heroIndex]) {
        const item = heroItems[heroIndex];
        watchContent(item.id, item.media_type || 'movie');
    }
}

function detailHero() {
    if (heroItems[heroIndex]) {
        const item = heroItems[heroIndex];
        showDetail(item.id, item.media_type || 'movie');
    }
}

// ===== Load Data =====
// Compact number formatter: 1234 -> "1.2rb", 12345 -> "12rb", 1234567 -> "1.2jt"
function compactNum(n) {
    if (!n || n <= 0) return '0';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'rb';
    if (n < 1_000_000_000) return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '') + 'jt';
    return (n / 1_000_000_000).toFixed(1) + 'M';
}

// Load live aggregate stats for the homepage stat bar
async function loadTotalStats() {
    try {
        const res = await fetch('/api/total-views');
        const d = await res.json();
        const elT = document.getElementById('hsbTotal');
        const elD = document.getElementById('hsbToday');
        const elW = document.getElementById('hsbWeek');
        const elF = document.getElementById('hsbFilms');
        if (elT) elT.textContent = compactNum(d.total);
        if (elD) elD.textContent = compactNum(d.today);
        if (elW) elW.textContent = compactNum(d.week);
        if (elF) elF.textContent = compactNum((d.uniqueMovies || 0) + (d.uniqueTV || 0));
    } catch (e) {
        // Silent fail — keep "—" placeholders
    }
}

async function loadTrending(page = 1, type = 'all') {
    try {
        // Trending is a compact ranked strip: load page 1, keep top 6 = 1 row × 6 cols
        const res1 = await fetch(`/api/trending?page=1`);
        const data1 = await res1.json();
        let items = data1.results || [];
        if (type !== 'all') items = items.filter(r => r.media_type === type);
        items = items.slice(0, 6);

        // Hero is always from page 1, filtered by type
        const heroSource = (data1.results || []).filter(r => type === 'all' || r.media_type === type);
        setHero(heroSource);

        // === SEO: inject dynamic ItemList for trending (replaces removed static empty one) ===
        // Only on home page (no category page active) — showDiscover functions set their own
        if (!/^\/(genre|year|country|search)\b/.test(window.location.pathname)) {
            injectItemListSchema(items, 'Film Trending Minggu Ini', 'https://bioskopgratis.my.id/');
        }

        renderMovies(items, 'trending', false, 6);
        addTrendingRanks();
        trendingPage = 1;
    } catch (e) {
        console.error('Error loading trending:', e);
    }
}

function addTrendingRanks() {
    const cards = document.querySelectorAll('#trending .movie-card');
    cards.forEach((card, i) => {
        if (card.querySelector('.trending-rank')) return; // idempotent
        const rank = document.createElement('div');
        rank.className = 'trending-rank';
        rank.textContent = i + 1;
        card.style.position = 'relative';
        card.prepend(rank);
    });
}

function loadMoreTrending() {
    loadTrending(trendingPage + 1, currentTrendingType);
}

function switchTrending(type, btn) {
    currentTrendingType = type;
    document.querySelectorAll('.section-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    trendingPage = 1;
    loadTrending(1, type);
}

async function loadPopularMovies() {
    try {
        const params = buildHomeFilterParams('movie');
        const res = await fetch(`/api/popular?type=movie&${params}`);
        const data = await res.json();
        renderMovies(data.results.slice(0, 12), 'popularMovies');
    } catch (e) { console.error(e); }
}

async function loadPopularTV() {
    try {
        const params = buildHomeFilterParams('tv');
        const res = await fetch(`/api/popular?type=tv&${params}`);
        const data = await res.json();
        renderMovies(data.results.slice(0, 10), 'popularTV');
    } catch (e) { console.error(e); }
}

// ===== Home Filter (Genre + Year chips) =====
// Persists current selection in localStorage. applyHomeFilter is called on chip click.
const _homeFilter = { genre: '', year: '' };

function buildHomeFilterParams(type) {
    const sp = new URLSearchParams();
    if (_homeFilter.genre) sp.set('with_genres', _homeFilter.genre);
    if (_homeFilter.year) {
        // TMDB uses date ranges, not bare year. Translate to gte/lte release_date.
        if (type === 'movie') {
            sp.set('primary_release_date.gte', `${_homeFilter.year}-01-01`);
            sp.set('primary_release_date.lte', `${_homeFilter.year}-12-31`);
        } else {
            sp.set('first_air_date.gte', `${_homeFilter.year}-01-01`);
            sp.set('first_air_date.lte', `${_homeFilter.year}-12-31`);
        }
    }
    return sp;  // URLSearchParams — supports both .toString() and .get()
}

function applyHomeFilter(kind, value, el) {
    // Update state
    _homeFilter[kind] = value || '';
    // Update chip active state (only within the same row, identified by data-* attribute)
    const row = el.parentElement;
    if (row) {
        row.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    }
    el.classList.add('active');
    // Persist (so refreshes keep the filter)
    try { localStorage.setItem('homeFilter', JSON.stringify(_homeFilter)); } catch (e) {}
    // Reload affected sections
    loadPopularMovies();
    loadPopularTV();
    // Trending is discovery-based but doesn't accept these filters server-side — keep it static
    showToast(kind === 'genre' ? `Filter genre: ${el.textContent}` : `Filter tahun: ${value || 'Semua'}`, true);
}

function restoreHomeFilter() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('homeFilter') || 'null'); } catch (e) {}
    if (!saved) return;
    _homeFilter.genre = saved.genre || '';
    _homeFilter.year = saved.year || '';
    // Update active chip visually
    const bar = document.getElementById('homeFilterBar');
    if (!bar) return;
    bar.querySelectorAll('[data-genre]').forEach(c => {
        if ((c.getAttribute('data-genre') || '') === _homeFilter.genre) c.classList.add('active');
        else c.classList.remove('active');
    });
    bar.querySelectorAll('[data-year]').forEach(c => {
        if ((c.getAttribute('data-year') || '') === _homeFilter.year) c.classList.add('active');
        else c.classList.remove('active');
    });
    // Sync quick filter panel buttons too
    syncQuickFilterButtons();
}

function syncQuickFilterButtons() {
    document.querySelectorAll('#qfGenreGrid .quick-filter-btn').forEach(b => {
        if ((b.getAttribute('data-value') || '') === _homeFilter.genre) b.classList.add('active');
        else b.classList.remove('active');
    });
    document.querySelectorAll('#qfYearGrid .quick-filter-btn').forEach(b => {
        if ((b.getAttribute('data-value') || '') === _homeFilter.year) b.classList.add('active');
        else b.classList.remove('active');
    });
}

// ===== Quick Filter Panel (side drawer triggered by FAB) =====
function openQuickFilter() {
    const panel = document.getElementById('quickFilterPanel');
    const overlay = document.getElementById('quickFilterOverlay');
    if (!panel || !overlay) return;
    // Sync panel state with current filter before opening
    syncQuickFilterButtons();
    panel.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeQuickFilter() {
    const panel = document.getElementById('quickFilterPanel');
    const overlay = document.getElementById('quickFilterOverlay');
    if (panel) panel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
}

function applyQuickFilter(kind, value, btn) {
    // Update filter state (shared with sticky filter bar)
    _homeFilter[kind] = value || '';
    // Persist
    try { localStorage.setItem('homeFilter', JSON.stringify(_homeFilter)); } catch (e) {}
    // Update active button in the quick filter panel (within same kind grid)
    const grid = btn.parentElement;
    if (grid) {
        grid.querySelectorAll('.quick-filter-btn').forEach(b => b.classList.remove('active'));
    }
    btn.classList.add('active');
    // Sync sticky filter bar chips in the page header
    const bar = document.getElementById('homeFilterBar');
    if (bar) {
        const attr = `data-${kind}`;
        bar.querySelectorAll(`[${attr}]`).forEach(c => {
            if ((c.getAttribute(attr) || '') === value) c.classList.add('active');
            else c.classList.remove('active');
        });
    }
// Reload affected sections (popular movie/TV lists)
    loadPopularMovies();
    loadPopularTV();
    loadLatest(1);     // reload Film Terbaru with current filter (reset pagination)
    loadNowPlaying();  // reload Sedang Tayang with current filter
    // Auto-scroll to the Film Populer section so user sees the filtered result
    setTimeout(() => {
        const target = document.getElementById('popularMoviesSection');
        if (target) {
            const headerOffset = 80; // sticky header height
            const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
            window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
    }, 350); // wait for the list to finish rendering
    // Show feedback toast
    const label = btn.textContent.trim();
    showToast(kind === 'genre' ? `Genre: ${label}` : `Tahun: ${label}`, true);
    // Close panel after a brief delay so user sees the active state
    setTimeout(closeQuickFilter, 180);
}

function resetQuickFilter() {
    _homeFilter.genre = '';
    _homeFilter.year = '';
    try { localStorage.removeItem('homeFilter'); } catch (e) {}
    // Reset panel buttons: only "Semua" (value="") active
    document.querySelectorAll('.quick-filter-btn').forEach(b => {
        if ((b.getAttribute('data-value') || '') === '') b.classList.add('active');
        else b.classList.remove('active');
    });
    // Reset sticky filter chips
    const bar = document.getElementById('homeFilterBar');
    if (bar) {
        bar.querySelectorAll('.filter-chip').forEach(c => {
            const g = c.getAttribute('data-genre');
            const y = c.getAttribute('data-year');
            if ((g !== null && g === '') || (y !== null && y === '')) c.classList.add('active');
            else c.classList.remove('active');
        });
    }
    // Reload
    loadPopularMovies();
    loadPopularTV();
    showToast('Filter direset', true);
    setTimeout(closeQuickFilter, 180);
}

// Close panel on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const panel = document.getElementById('quickFilterPanel');
        if (panel && panel.classList.contains('open')) closeQuickFilter();
    }
});

async function loadNowPlaying() {
    try {
        const params = new URLSearchParams();
        params.set('page', '1');
        const filterParams = buildHomeFilterParams('movie');
        // Copy relevant filter params (with_genres + year range)
        if (filterParams.get('with_genres')) params.set('with_genres', filterParams.get('with_genres'));
        if (filterParams.get('primary_release_date.gte')) params.set('primary_release_date.gte', filterParams.get('primary_release_date.gte'));
        if (filterParams.get('primary_release_date.lte')) params.set('primary_release_date.lte', filterParams.get('primary_release_date.lte'));
        const res = await fetch(`/api/now-playing?${params}`);
        const data = await res.json();
        renderMovies(data.results.slice(0, 10), 'nowPlaying');
    } catch (e) { console.error(e); }
}

// ===== Latest Releases =====
let latestPage = 1;

async function loadLatest(page = 1) {
    try {
        const params = new URLSearchParams();
        params.set('page', String(page));
        if (page === 1) {
            // Apply home filter only on first page to avoid mixing genres in pagination
            const filterParams = buildHomeFilterParams('movie');
            if (filterParams.get('with_genres')) params.set('with_genres', filterParams.get('with_genres'));
            if (filterParams.get('primary_release_date.gte')) params.set('primary_release_date.gte', filterParams.get('primary_release_date.gte'));
            if (filterParams.get('primary_release_date.lte')) params.set('primary_release_date.lte', filterParams.get('primary_release_date.lte'));
        }
        const res = await fetch(`/api/latest?${params}`);
        const data = await res.json();
        renderMovies(data.results, 'latestMovies', page > 1);
        latestPage = page;
    } catch (e) { console.error(e); }
}

function loadMoreLatest() {
    loadLatest(latestPage + 1);
}

// ===== Notification Banner =====
// Smart ad refresh — uses Viewability API + IntersectionObserver
// Refreshes banner ad slot only when it's actually visible to the user.
// Replaces legacy 45s opacity-toggle approach which counted impressions regardless of viewability.
let adRefreshInterval = null;
let isWatching = false;
const viewabilityTracker = new WeakMap(); // element -> { visibleMs, lastRefresh, isVisible }

function startAdRefresh() {
    if (adRefreshInterval) return;
    adRefreshInterval = setInterval(() => {
        if (isWatching) return;

        // Refresh native banner slot (visible check)
        try {
            const nativeSlot = document.getElementById('container-dab98f7cf1e8cb830b83370d9ae08e43');
            if (nativeSlot && isElementVisible(nativeSlot)) {
                nativeSlot.innerHTML = '';
                const script = document.createElement('script');
                script.async = true;
                script.setAttribute('data-cfasync', 'false');
                script.src = 'https://pl29790005.effectivecpmnetwork.com/dab98f7cf1e8cb830b83370d9ae08e43/invoke.js';
                nativeSlot.appendChild(script);
            }
        } catch(e) {}

        // Refresh sticky banner via opacity pulse (visible check)
        try {
            const stickySlot = document.getElementById('stickyAdSlot');
            if (stickySlot && isElementVisible(stickySlot) && !document.getElementById('stickyAdBar')?.classList.contains('hidden')) {
                stickySlot.style.opacity = '0';
                setTimeout(() => { stickySlot.style.opacity = '1'; }, 100);
            }
        } catch(e) {}
    }, 45000); // 45s refresh (Adsterra allows)
}

// Check element visibility via IntersectionObserver (cached for performance)
const visibilityCache = new Map();
function isElementVisible(el) {
    if (!el) return false;
    if (!('IntersectionObserver' in window)) return true; // Fallback: assume visible
    const cached = visibilityCache.get(el);
    if (cached !== undefined) return cached;
    // Default to visible (observer updates cache when it runs)
    visibilityCache.set(el, true);
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            visibilityCache.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.5);
        });
    }, { threshold: [0, 0.5, 1] });
    observer.observe(el);
    return true;
}

function stopAdRefresh() {
    if (adRefreshInterval) {
        clearInterval(adRefreshInterval);
        adRefreshInterval = null;
    }
}

// Track watch state
const originalShowSection = window.showSection;
if (typeof originalShowSection === 'function') {
    // Already defined, we'll hook into it below
}

// ===== Popunder Frequency Cap =====
// Show popunder max once per 30 minutes
let popunderCooldown = false;
function canTriggerPopunder() {
    const lastPopunder = localStorage.getItem('lastPopunder');
    if (!lastPopunder) return true;
    const elapsed = Date.now() - parseInt(lastPopunder);
    return elapsed > 1800000; // 30 minutes
}

// Override click to add frequency cap
document.addEventListener('click', function(e) {
    if (!canTriggerPopunder()) return;
    // Mark popunder as triggered
    localStorage.setItem('lastPopunder', Date.now().toString());
}, { once: false });

// Lazy load native banner when visible
function lazyLoadNativeBanner() {
    const wrapper = document.getElementById('nativeAdWrapper');
    if (!wrapper) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const script = document.createElement('script');
                script.async = true;
                script.setAttribute('data-cfasync', 'false');
                script.src = 'https://pl29790005.effectivecpmnetwork.com/dab98f7cf1e8cb830b83370d9ae08e43/invoke.js';
                wrapper.appendChild(script);
                observer.unobserve(wrapper);
            }
        });
    }, { rootMargin: '200px' });

    observer.observe(wrapper);
}

function scheduleTgPill() {
    // Don't show if user already dismissed this session
    if (sessionStorage.getItem('tgPillDismissed')) return;

    const pill = document.getElementById('tgPill');
    if (!pill) return;

    // Show after 5s on homepage, immediately on watch page (post-view CTA)
    const isWatchPage = window.location.pathname.startsWith('/movie/') || window.location.pathname.startsWith('/tv/');
    const delay = isWatchPage ? 8000 : 5000;

    setTimeout(() => {
        pill.classList.remove('hidden');
    }, delay);
}

function dismissTgPill() {
    const pill = document.getElementById('tgPill');
    if (pill) pill.classList.add('hidden');
    sessionStorage.setItem('tgPillDismissed', '1');
}

function checkNewMovies() {
    // Check if banner was dismissed today
    const dismissed = localStorage.getItem('bannerDismissed');
    const today = new Date().toDateString();
    if (dismissed === today) return;

    // Fetch trending to check for new content
    fetch('/api/trending?page=1')
        .then(r => r.json())
        .then(data => {
            const topMovie = data.results?.[0];
            if (topMovie) {
                const title = topMovie.title || topMovie.name;
                const banner = document.getElementById('notifBanner');
                const text = document.getElementById('notifText');
                text.textContent = `🔥 "${title}" lagi trending!`;
                banner.classList.remove('hidden');
                document.body.classList.remove('no-notif');
            }
        })
        .catch(() => {});
}

function closeBanner() {
    document.getElementById('notifBanner').classList.add('hidden');
    document.body.classList.add('no-notif');
    localStorage.setItem('bannerDismissed', new Date().toDateString());
}

function updateNotifBodyClass() {
    const banner = document.getElementById('notifBanner');
    if (banner && !banner.classList.contains('hidden')) {
        document.body.classList.remove('no-notif');
    } else {
        document.body.classList.add('no-notif');
    }
}

function scrollToLatest() {
    closeBanner();
    const el = document.getElementById('latestSection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ===== Leaderboard =====
let leaderboardType = 'movie';
let leaderboardPeriod = 'month';
let leaderboardCustomMonth = ''; // '' | '01'-'12'
let leaderboardCustomYear = '';  // '' | '2024'-'2026'
let leaderboardLoading = false;

async function showLeaderboard() {
    showSection('leaderboard');
    updateNav('leaderboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Bind tab clicks (idempotent — use onclick on inner buttons)
    document.querySelectorAll('#lbTypeTabs .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#lbTypeTabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            leaderboardType = btn.dataset.type;
            loadLeaderboard();
        };
    });
    document.querySelectorAll('#lbPeriodTabs .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#lbPeriodTabs .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            leaderboardPeriod = btn.dataset.period;
            // Reset custom filters when period tab clicked (use defaults)
            leaderboardCustomMonth = '';
            leaderboardCustomYear = '';
            document.getElementById('lbMonthSelect').value = '';
            document.getElementById('lbYearSelect').value = '';
            loadLeaderboard();
        };
    });

    await loadLeaderboard();
}

function onLbCustomChange() {
    leaderboardCustomMonth = document.getElementById('lbMonthSelect').value;
    leaderboardCustomYear = document.getElementById('lbYearSelect').value;
    // Deactivate period tab buttons since we're using custom
    document.querySelectorAll('#lbPeriodTabs .tab-btn').forEach(b => b.classList.remove('active'));
    loadLeaderboard();
}

function resetLbFilters() {
    leaderboardPeriod = 'month';
    leaderboardCustomMonth = '';
    leaderboardCustomYear = '';
    document.getElementById('lbMonthSelect').value = '';
    document.getElementById('lbYearSelect').value = '';
    document.querySelectorAll('#lbPeriodTabs .tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.period === 'month');
    });
    loadLeaderboard();
}

async function loadLeaderboard() {
    if (leaderboardLoading) return;
    leaderboardLoading = true;

    const grid = document.getElementById('leaderboardContent');
    const status = document.getElementById('leaderboardStatus');
    const typeLabel = leaderboardType === 'movie' ? 'Movies' : 'TV Series';

    grid.innerHTML = '';
    status.innerHTML = `<div class="lb-loading">⏳ Memuat leaderboard ${typeLabel}…</div>`;

    // Build URL: custom filters override period
    const hasCustom = leaderboardCustomMonth || leaderboardCustomYear;
    let url = `/api/leaderboard?type=${leaderboardType}&limit=50`;
    if (hasCustom) {
        url += '&period=custom';
        // If both month and year, use month=YYYY-MM; else just year=
        if (leaderboardCustomMonth && leaderboardCustomYear) {
            url += `&month=${leaderboardCustomYear}-${leaderboardCustomMonth}`;
        } else if (leaderboardCustomYear) {
            url += `&year=${leaderboardCustomYear}`;
        } else if (leaderboardCustomMonth) {
            // Month without year — use current year
            const cy = new Date().getFullYear();
            url += `&month=${cy}-${leaderboardCustomMonth}`;
        }
    } else {
        url += `&period=${leaderboardPeriod}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        const entries = data.entries || [];
        const periodLabel = data.periodLabel || (leaderboardPeriod === 'month' ? 'Bulan Ini' : leaderboardPeriod === 'year' ? 'Tahun Ini' : 'Semua Waktu');
        const isSeeded = entries.some(e => e.fallback);

        if (entries.length === 0) {
            status.innerHTML = `
                <div class="lb-empty">
                    <div style="font-size:48px;margin-bottom:12px">🎬</div>
                    <div style="font-size:18px;font-weight:600;margin-bottom:6px">Belum ada data untuk periode ini</div>
                    <div style="color:var(--text-secondary);font-size:14px">Coba pilih periode lain atau mulai nonton ${typeLabel.toLowerCase()}!</div>
                </div>`;
            return;
        }

        status.innerHTML = `
            <div class="lb-meta">
                <strong>${entries.length}</strong> ${typeLabel} teratas ·
                Periode: <strong>${periodLabel}</strong>${isSeeded ? ' · <em>(fallback ke TMDB — data asli belum tersedia)</em>' : ''}
            </div>`;

        grid.innerHTML = entries.map((e, i) => {
            const rank = i + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
            // e.poster may be either a full URL (from server enrichment) or a TMDB path
            const posterPath = e.poster || '';
            const poster = posterPath.startsWith('http')
                ? posterPath  // server already gave full URL — use as-is
                : (posterPath
                    ? `https://image.tmdb.org/t/p/w300${posterPath}`
                    : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect fill="%231a1a1a" width="200" height="300"/><text x="50%25" y="50%25" fill="%23666" text-anchor="middle" font-size="14">No Poster</text></svg>');
            const year = e.year || '';
            const rating = e.rating ? e.rating.toFixed(1) : '–';
            const viewCount = e.count || e.views || 0;
            const viewLabel = viewCount === 1 ? '1 view' : `${viewCount.toLocaleString('id-ID')} views`;
            const title = (e.title || '').replace(/</g, '&lt;');
            const slug = e.slug || slugify(title);
            const href = e.type === 'tv' || leaderboardType === 'tv'
                ? `#/tv/${e.id}-${slug}`
                : `#/movie/${e.id}-${slug}`;

            // Use onerror to fall back to placeholder if TMDB 404s
            const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect fill="%231a1a1a" width="200" height="300"/><text x="50%25" y="50%25" fill="%23666" text-anchor="middle" font-size="14">No Poster</text></svg>';

            return `
            <a class="lb-card" href="${href}" data-rank="${rank}">
                <div class="lb-poster-wrap">
                    <img class="lb-poster" src="${poster}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}'">
                    <div class="lb-rank-badge ${rank <= 3 ? 'lb-top' : ''}">${medal || '#' + rank}</div>
                    <div class="lb-views-badge">${viewLabel}</div>
                </div>
                <div class="lb-info">
                    <div class="lb-title">${title}</div>
                    <div class="lb-meta-row">
                        <span class="lb-rating">⭐ ${rating}</span>
                        ${year ? `<span class="lb-year">${year}</span>` : ''}
                    </div>
                </div>
            </a>`;
        }).join('');

        // Bind clicks to use showDetail
        grid.querySelectorAll('.lb-card').forEach(card => {
            card.addEventListener('click', (ev) => {
                ev.preventDefault();
                const href = card.getAttribute('href');
                const m = href.match(/^#\/(movie|tv)\/(\d+)/);
                if (m) showDetail(m[2], m[1]);
            });
        });
    } catch (err) {
        status.innerHTML = `<div class="lb-error">❌ Gagal memuat leaderboard: ${err.message}</div>`;
    } finally {
        leaderboardLoading = false;
    }
}

function slugify(s) {
    return (s || '').toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}

// ===== Discover =====
async function showDiscover(type) {
    currentType = type;
    currentGenre = '';
    discoverPage = 1;

    showSection('discover');
    updateNav(type === 'movie' ? 'movies' : 'tv');

    document.getElementById('discoverTitle').textContent = type === 'movie' ? '🎬 Semua Film' : '📺 Semua Serial TV';

    // Load genres
    if (!genres[type]) {
        try {
            const res = await fetch(`/api/genres?type=${type}`);
            const data = await res.json();
            genres[type] = data.genres || [];
        } catch (e) { genres[type] = []; }
    }
    renderGenreFilter(type);
    loadDiscover();
}

function showGenreDirect(type, genreId) {
    currentType = type;
    currentGenre = String(genreId);
    discoverPage = 1;

    showSection('discover');
    updateNav(type === 'movie' ? 'movies' : 'tv');

    document.getElementById('discoverTitle').textContent = type === 'movie' ? '🎬 Semua Film' : '📺 Semua Serial TV';

    // Load genres then select
    if (!genres[type]) {
        fetch(`/api/genres?type=${type}`)
            .then(r => r.json())
            .then(data => {
                genres[type] = data.genres || [];
                renderGenreFilter(type);
                // Activate the correct genre button
                document.querySelectorAll('.genre-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.genre === String(genreId));
                });
            });
    } else {
        renderGenreFilter(type);
        document.querySelectorAll('.genre-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.genre === String(genreId));
        });
    }
    loadDiscover();
}

function renderGenreFilter(type) {
    const container = document.getElementById('genreFilter');
    container.innerHTML = `<button class="genre-btn active" data-genre="" onclick="filterGenre('', this)">Semua</button>`;
    if (genres[type]) {
        genres[type].forEach(g => {
            container.innerHTML += `<button class="genre-btn" data-genre="${g.id}" onclick="filterGenre('${g.id}', this)">${g.name}</button>`;
        });
    }
}

function filterGenre(genreId, btn) {
    currentGenre = genreId;
    discoverPage = 1;
    document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadDiscover();
}

function changeSort() {
    currentSort = document.getElementById('sortSelect').value;
    discoverPage = 1;
    loadDiscover();
}

async function loadDiscover(page = 1) {
    try {
        const res = await fetch(`/api/discover?type=${currentType}&genre=${currentGenre}&page=${page}&sort_by=${currentSort}`);
        const data = await res.json();
        renderMovies(data.results, 'discover', page > 1);
        discoverPage = page;
    } catch (e) { console.error(e); }
}

function loadMoreDiscover() {
    // Delegate to listing pagination when trending/now-playing listing is active
    if (listingEndpoint) {
        loadMoreListing(listingPage + 1, false);
    } else {
        loadDiscover(discoverPage + 1);
    }
}

// ===== Trending All — paginated listing =====
let listingEndpoint = null;  // remembers which endpoint loadMoreListing() paginates

async function showTrendingAll() {
    showSection('discover');
    updateNav('movies');
    document.getElementById('discoverTitle').textContent = '🔥 Trending Minggu Ini';
    hideDiscoverFilters();
    listingEndpoint = '/api/trending';
    loadMoreListing(1, /*reset*/ true);
}

// ===== Now Playing All — paginated listing =====
async function showNowPlayingAll() {
    showSection('discover');
    updateNav('movies');
    document.getElementById('discoverTitle').textContent = '🎥 Sedang Tayang di Bioskop';
    hideDiscoverFilters();
    listingEndpoint = '/api/now-playing';
    loadMoreListing(1, /*reset*/ true);
}

function hideDiscoverFilters() {
    const gf = document.getElementById('genreFilter');
    if (gf) gf.style.display = 'none';
    const sb = document.querySelector('.sort-bar');
    if (sb) sb.style.display = 'none';
    const lm = document.querySelector('#discoverSection .btn-more');
    if (lm) lm.textContent = 'Load More Trending ↓';
}

async function loadMoreListing(page = 1, reset = false) {
    if (!listingEndpoint) return;
    try {
        const res = await fetch(`${listingEndpoint}?page=${page}`);
        const data = await res.json();
        const items = (data.results || []).map(r => ({ ...r, media_type: r.media_type || 'movie' }));
        renderMovies(items, 'discover', !reset && page > 1);
        listingPage = page;
        // Restore Load More button label per section
        const lm = document.querySelector('#discoverSection .btn-more');
        if (lm) lm.textContent = listingEndpoint === '/api/now-playing' ? 'Load More ↓' : 'Load More Trending ↓';
    } catch (e) { console.error(e); }
}
let listingPage = 1;

// ===== Search =====
function handleSearch(event) {
    if (event.key === 'Enter') doSearch();
}

async function doSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    searchPage = 1;
    showSection('search');
    updateNav('');

    document.getElementById('searchTitle').textContent = `🔍 Hasil: "${query}"`;
    loadSearchResults(query);
}

async function loadSearchResults(query, page = 1) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}`);
        const data = await res.json();
        const filtered = data.results.filter(r => r.media_type !== 'person' && r.poster_path);
        renderMovies(filtered, 'searchResults', page > 1);
        searchPage = page;
    } catch (e) { console.error(e); }
}

function loadMoreSearch() {
    const query = document.getElementById('searchInput').value.trim();
    if (query) loadSearchResults(query, searchPage + 1);
}

// ===== Detail =====
// Generate SEO slug from title
function generateSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 80);
}

// Extract numeric ID from "id-slug" or "id" format
function extractIdFromSlug(idOrSlug) {
    const m = idOrSlug.match(/^(\d+)(?:-.*)?$/);
    return m ? parseInt(m[1]) : null;
}

// Find movie/TV by slug and show detail
async function findAndShowDetail(slug, type) {
    try {
        // Search TMDB for the movie/TV show
        const searchQuery = slug.replace(/-/g, ' ');
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        
        // Find best match - prefer exact type match
        const results = data.results || [];
        let match = results.find(r => {
            const rSlug = generateSlug(r.title || r.name || '');
            return rSlug === slug && (r.media_type === type || !r.media_type);
        });
        
        // Fallback: find any result of the right type
        if (!match) {
            match = results.find(r => r.media_type === type || (!r.media_type && type === 'movie'));
        }
        
        // Fallback: first result with poster
        if (!match) {
            match = results.find(r => r.poster_path);
        }
        
        if (match) {
            showDetail(match.id, match.media_type || type);
        } else {
            // If no match found, go home
            goHome();
        }
    } catch (e) {
        goHome();
    }
}

async function showDetail(id, type) {
    showSection('detail');
    updateNav('');

    const container = document.getElementById('detailContent');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">Loading...</div>';

    try {
        const res = await fetch(`/api/${type}/${id}`);
        const data = await res.json();
        renderDetail(data, type);

        // Track view (for leaderboard). Fire-and-forget.
        trackView(type, id, data.title || data.name || '');

        // Save to watch history on detail view too (so users can resume from history)
        addToHistory(data, type);

        // Save title for watch page (used by fake download button)
        window._lastWatchTitle = data.title || data.name || '';

        // Fetch and display "X menonton" count from views.jsonl
        loadDetailViewCount(type, id);

        // Update URL for SEO and direct linking (after we have the title)
        const title = data.title || data.name || '';
        if (title) {
            const slug = generateSlug(title);
            const newUrl = `/${type}/${slug}`;
            if (window.location.pathname !== newUrl) {
                history.pushState({ id, type }, '', newUrl);
            }
            document.title = `Nonton ${title} Subtitle Indonesia - Absolute Cinema`;
            updateMeta('description', `Nonton ${title} subtitle Indonesia gratis.`);
        }
    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--accent)">Error loading details</div>';
        console.error('showDetail error:', e);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderDetail(data, type) {
    const container = document.getElementById('detailContent');
    const title = data.title || data.name;

    // SEO: Update page title and meta dynamically
    const seoYear = (data.release_date || data.first_air_date || '').substring(0, 4);

    // Schema.org Movie/TVSeries markup with VideoObject + WatchAction + BreadcrumbList
    const schemaScript = document.getElementById('movieSchema');
    if (schemaScript) schemaScript.remove();
    const breadcrumbScript = document.getElementById('detailBreadcrumb');
    if (breadcrumbScript) breadcrumbScript.remove();
    const schemaType = type === 'tv' ? 'TVSeries' : 'Movie';
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 80);
    const canonicalUrl = `https://bioskopgratis.my.id/${type}/${data.id}-${slug}`;
    const movieSchema = {
        "@context": "https://schema.org",
        "@type": schemaType,
        "name": title,
        "description": data.overview || "",
        "datePublished": data.release_date || data.first_air_date || "",
        "dateModified": new Date().toISOString().split('T')[0],
        "inLanguage": data.original_language || "en",
        "genre": data.genres?.map(g => g.name) || [],
        "director": type === 'movie' ? data.credits?.crew?.filter(c => c.job === 'Director').map(d => ({ "@type": "Person", "name": d.name })) : undefined,
        "creator": type === 'tv' ? data.created_by?.map(c => ({ "@type": "Person", "name": c.name })) : undefined,
        "actor": data.credits?.cast?.slice(0, 10).map(a => ({ "@type": "Person", "name": a.name })),
        "publisher": {
            "@type": "Organization",
            "name": "Absolute Cinema",
            "url": "https://bioskopgratis.my.id",
            "logo": { "@type": "ImageObject", "url": "https://bioskopgratis.my.id/og-image.jpg" }
        },
        "isAccessibleForFree": true,
        "contentRating": data.adult ? "R" : (type === 'tv' ? "TV-14" : "PG-13"),
        "aggregateRating": data.vote_average ? {
            "@type": "AggregateRating",
            "ratingValue": data.vote_average.toFixed(1),
            "bestRating": "10",
            "ratingCount": data.vote_count || 0
        } : undefined,
        "image": data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        "url": canonicalUrl,
        "mainEntityOfPage": canonicalUrl,
        "potentialAction": {
            "@type": "WatchAction",
            "target": `${canonicalUrl}/watch`,
            "expectsAcceptanceOf": {
                "@type": "Offer",
                "price": "0",
                "priceCurrency": "IDR",
                "availability": "https://schema.org/InStock",
                "availabilityStarts": data.release_date || data.first_air_date || "2024-01-01"
            }
        },
        "trailer": data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube') ? {
            "@type": "VideoObject",
            "name": `${title} Trailer`,
            "embedUrl": `https://www.youtube.com/embed/${data.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube').key}`,
            "thumbnailUrl": `https://img.youtube.com/vi/${data.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube').key}/hqdefault.jpg`,
            "uploadDate": data.release_date || data.first_air_date
        } : undefined,
        "speakable": {
            "@type": "SpeakableSpecification",
            "xpath": ["/html/head/title", "//h1", "//p[@class='detail-overview']"]
        }
    };
    const script = document.createElement('script');
    script.id = 'movieSchema';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(movieSchema);
    document.head.appendChild(script);

    // BreadcrumbList schema for this detail page
    const breadcrumb = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://bioskopgratis.my.id/"},
            {"@type": "ListItem", "position": 2, "name": type === 'tv' ? "TV Shows" : "Movies", "item": `https://bioskopgratis.my.id/${type === 'tv' ? 'tv' : 'movies'}`},
            {"@type": "ListItem", "position": 3, "name": title, "item": canonicalUrl}
        ]
    };
    const bcScript = document.createElement('script');
    bcScript.id = 'detailBreadcrumb';
    bcScript.type = 'application/ld+json';
    bcScript.textContent = JSON.stringify(breadcrumb);
    document.head.appendChild(bcScript);

    document.title = `Nonton ${title} (${seoYear}) Subtitle Indonesia - Absolute Cinema`;
    updateMeta('description', `Nonton ${title} (${seoYear}) subtitle Indonesia gratis. Streaming ${type === 'tv' ? 'serial TV' : 'film'} ${title} online kualitas HD. Sinopsis, cast, dan rating lengkap.`);
    updateMeta('og:title', `Nonton ${title} (${seoYear}) Subtitle Indonesia`);
    updateMeta('og:description', `Streaming ${title} gratis subtitle Indonesia di Absolute Cinema`);
    updateMeta('og:type', 'article');
    updateMeta('og:url', canonicalUrl);
    updateMeta('twitter:title', `Nonton ${title} (${seoYear}) Sub Indo`);
    updateMeta('twitter:description', `Streaming ${title} subtitle Indonesia HD gratis.`);
    if (data.poster_path) {
        const posterUrl = `https://image.tmdb.org/t/p/w500${data.poster_path}`;
        updateMeta('og:image', posterUrl);
        updateMeta('twitter:image', posterUrl);
    }
    // Update canonical to current detail URL
    let canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', canonicalUrl);
    const year = (data.release_date || data.first_air_date || '').substring(0, 4);
    const runtime = data.runtime || (data.episode_run_time && data.episode_run_time[0]) || 0;
    const rating = data.vote_average?.toFixed(1) || '0';
    const genreList = data.genres?.map(g => g.name).join(', ') || '';
    const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : 'https://via.placeholder.com/250x375?text=No+Poster';
    const backdrop = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : '';

    // Trailer
    const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');

    // Cast
    const cast = data.credits?.cast?.slice(0, 12) || [];

    // Similar
    const similar = (data.similar?.results || data.recommendations?.results || []).slice(0, 8);

    // Seasons (for TV)
    const seasons = data.seasons || [];

    // === END Movie/TVSeries JSON-LD (was added by previous edit; existing schema at line 1759 already comprehensive) ===

    container.innerHTML = `
        <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="/">Home</a> &rsaquo;
            <a href="/${type === 'tv' ? 'tv' : 'movies'}">${type === 'tv' ? 'TV Shows' : 'Movies'}</a> &rsaquo;
            <span>${title.replace(/</g, '&lt;')}</span>
        </nav>
        <button class="back-btn" onclick="goBack()">← Kembali</button>
        <div class="detail-hero" style="background-image: url(${backdrop})">
            <div class="detail-hero-overlay"></div>
            <div class="detail-info">
                <img src="${poster}" alt="${title}" class="detail-poster" loading="lazy">
                <div class="detail-text">
                    <h1>${title}</h1>
                    <div class="detail-meta">
                        <span class="rating">⭐ ${rating}</span>
                        <span>📅 ${year}</span>
                        ${runtime ? `<span>⏱️ ${runtime} min</span>` : ''}
                        <span>🎭 ${genreList}</span>
                        <span class="detail-view-count" id="detailViewCount" style="display:none;">👁 <span id="detailViewCountNum">…</span> menonton</span>
                    </div>
                    <p class="detail-overview">${data.overview || 'Tidak ada deskripsi.'}</p>
                    <div class="detail-actions">
                        <button class="btn-play" onclick="watchContent(${data.id}, '${type}')">▶ Tonton</button>
                        ${trailer ? `<button class="btn-trailer" onclick="playTrailer('${trailer.key}')">🎬 Trailer</button>` : ''}
                        <a href="#" onclick="return openAdLink(event, 'detail');" class="btn-direct" title="Tonton alternatif di server lain">🔗 Alt Link</a>
                    </div>
                </div>
            </div>
        </div>

        <!-- CPM Banner Slot #1: Below hero (high viewability, above the fold for most users) -->
        <div class="detail-ad-slot detail-ad-top" id="detailAdSlotTop" data-cpm-slot="top"></div>

        ${seasons.length > 0 ? `
        <div class="season-selector">
            <h3>📺 Seasons</h3>
            <select onchange="changeSeason(${data.id}, this.value)">
                ${seasons.map(s => `<option value="${s.season_number}">Season ${s.season_number}</option>`).join('')}
            </select>
            <div id="episodeList" class="episode-list"></div>
        </div>
        ` : ''}

        ${trailer ? `
        <div class="trailer-section" style="margin-bottom:30px;">
            <h3 style="font-size:1.3rem;margin-bottom:15px;">🎬 Trailer</h3>
            <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:var(--radius-lg);background:#000;">
                <iframe src="https://www.youtube.com/embed/${trailer.key}?autoplay=0&rel=0" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
            </div>
        </div>
        ` : ''}

        ${cast.length ? `
        <div class="cast-section">
            <h3>🎭 Cast</h3>
            <div class="cast-grid">
                ${cast.map(c => `
                    <div class="cast-card">
                        <img src="${c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : 'https://via.placeholder.com/80'}" alt="${c.name}" loading="lazy">
                        <div class="cast-name">${c.name}</div>
                        <div class="cast-role">${c.character || ''}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${similar.length ? `
        <!-- CPM Banner Slot #2: Above similar movies (lower CPM but high scroll depth) -->
        <div class="detail-ad-slot detail-ad-bottom" id="detailAdSlotBottom" data-cpm-slot="bottom"></div>

        <div class="similar-section">
            <h3>🎬 Rekomendasi</h3>
            <div class="movie-grid">
                ${injectInGridNative(similar, type)}
            </div>
        </div>
        ` : ''}
    `;

    // Load first season episodes if TV
    if (seasons.length > 0) {
        changeSeason(data.id, seasons[0].season_number);
    }

    // Hydrate CPM slots after DOM is ready
    hydrateDetailAdSlots();
}

// Inject native ad card every N cards in a grid (every 6 cards).
// Returns HTML string of cards with ad break inserted mid-grid.
function injectInGridNative(items, type) {
    const AD_EVERY = 6; // Inject ad after every 6 cards
    if (!items || items.length <= AD_EVERY) {
        return items.map(m => movieCard(m, type)).join('');
    }
    const out = [];
    items.forEach((m, idx) => {
        out.push(movieCard(m, type));
        // After every N-th card (and not last), insert in-grid native ad
        if ((idx + 1) % AD_EVERY === 0 && idx !== items.length - 1) {
            out.push(`<div class="movie-grid-ad" id="inGridNativeAd${idx}" data-cpm-slot="native"></div>`);
        }
    });
    // Schedule hydration after this HTML is rendered
    setTimeout(() => hydrateInGridAds(items.length), 50);
    return out.join('');
}

function hydrateDetailAdSlots() {
    if (window.ADS_CONFIG?.detailSlotTop?.enabled) {
        window.injectAdsterraLazy('detailAdSlotTop', window.ADS_CONFIG.detailSlotTop);
    }
    if (window.ADS_CONFIG?.detailSlotBottom?.enabled) {
        window.injectAdsterraLazy('detailAdSlotBottom', window.ADS_CONFIG.detailSlotBottom);
    }
}

function hydrateInGridAds(itemCount) {
    const slots = document.querySelectorAll('.movie-grid-ad');
    slots.forEach(slot => {
        if (slot.id) {
            window.injectAdsterraLazy(slot.id, window.ADS_CONFIG?.banner300 || window.ADS_CONFIG?.banner728);
        }
    });
}

async function changeSeason(tvId, seasonNum) {
    const container = document.getElementById('episodeList');
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-secondary)">Loading episodes...</div>';

    try {
        const res = await fetch(`/api/tv/${tvId}/season/${seasonNum}`);
        const data = await res.json();
        const episodes = data.episodes || [];

        container.innerHTML = episodes.map(ep => `
            <div class="episode-card" onclick="watchEpisode(${tvId}, ${seasonNum}, ${ep.episode_number})">
                <div class="episode-num">E${ep.episode_number}</div>
                <div class="episode-title">${ep.name || `Episode ${ep.episode_number}`}</div>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<div style="color:var(--accent)">Error loading episodes</div>';
    }
}

function goBack() {
    if (lastView === 'watch') {
        // Go back to detail if we came from there
        window.history.back();
    } else {
        goHome();
    }
}

// ===== Watch =====
function watchContent(id, type, opts = {}) {
    showSection('watch');
    updateNav('');
    loadWatchContent(id, type, opts);
    // Track "play" event — stronger signal than just opening detail
    trackView(type, id, '');
    // Save to watch history (localStorage)
    addToHistory({ id, media_type: type, title: '', poster_path: null }, type);
}

function watchEpisode(tvId, season, episode) {
    showSection('watch');
    updateNav('');
    loadWatchEpisode(tvId, season, episode);
}

// ===== EMBED SERVERS — central source of truth =====
// 8 servers, auto-fallback if iframe load errors. Order = priority.
// If a server fails, watchAutoFallback() advances to next within 6s.
const EMBED_SERVERS = {
    movie: [
        { name: 'Server 1 (VidSrc)', url: (id) => `https://vidsrc.to/embed/movie/${id}` },
        { name: 'Server 2 (VidSrc.io)', url: (id) => `https://vidsrc.io/embed/movie/${id}` },
        { name: 'Server 3 (Smashy)', url: (id) => `https://embed.smashystream.com/playere.php?tmdb=${id}` },
        { name: 'Server 4 (SuperEmbed)', url: (id) => `https://multiembed.mov/?video_id=${id}` },
        { name: 'Server 5 (2Embed)', url: (id) => `https://www.2embed.cc/embed/${id}` },
        { name: 'Server 6 (AutoEmbed)', url: (id) => `https://autoembed.co/embed/movie/${id}` },
        { name: 'Server 7 (MoviesAPI)', url: (id) => `https://moviesapi.club/movie/${id}` },
        { name: 'Server 8 (NontonMovie)', url: (id) => `https://nontonmovie.cfd/embed/movie/${id}` }
    ],
    tv: (tvId, season, episode) => [
        { name: 'Server 1 (VidSrc)', url: () => `https://vidsrc.to/embed/tv/${tvId}/${season}/${episode}` },
        { name: 'Server 2 (VidSrc.io)', url: () => `https://vidsrc.io/embed/tv/${tvId}/${season}/${episode}` },
        { name: 'Server 3 (Smashy)', url: () => `https://embed.smashystream.com/playere.php?tmdb=${tvId}&s=${season}&e=${episode}` },
        { name: 'Server 4 (SuperEmbed)', url: () => `https://multiembed.mov/?video_id=${tvId}&tmdb=1&s=${season}&e=${episode}` },
        { name: 'Server 5 (2Embed)', url: () => `https://www.2embed.cc/embedtv/${tvId}&s=${season}&e=${episode}` },
        { name: 'Server 6 (AutoEmbed)', url: () => `https://autoembed.co/embed/tv/${tvId}/${season}/${episode}` },
        { name: 'Server 7 (MoviesAPI)', url: () => `https://moviesapi.club/tv/${tvId}/${season}/${episode}` }
    ]
};

// Auto-fallback state (one timer at a time, per page load)
let _fallbackTimer = null;
function watchAutoFallback(reason) {
    // Stop if already running
    if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }
    const frame = document.getElementById('playerFrame');
    if (!frame) return;
    const currentUrl = frame.src;
    // Find current server index
    const allBtns = Array.from(document.querySelectorAll('.server-btn'));
    const currentIdx = allBtns.findIndex(b => b.classList.contains('active'));
    if (currentIdx < 0 || currentIdx >= allBtns.length - 1) {
        console.warn('[watch] No more servers to try. Last URL:', currentUrl);
        showToast('⚠️ Semua server gagal. Coba lagi nanti.', false);
        return;
    }
    const nextBtn = allBtns[currentIdx + 1];
    const nextUrl = nextBtn.dataset.url;
    if (!nextUrl) return;
    console.info(`[watch] Auto-fallback ${currentIdx} → ${currentIdx + 1} (${reason || 'load error'})`);
    // Wait 5s to give the current server a chance, then advance
    _fallbackTimer = setTimeout(() => {
        if (!document.getElementById('playerFrame')) return; // page navigated away
        nextBtn.click();
        showToast(`🔄 Pindah ke ${nextBtn.textContent}`, true);
    }, 5000);
}

function loadWatchContent(id, type, opts = {}) {
    const container = document.getElementById('watchContent');

    const season = opts.season || 1;
    const episode = opts.episode || 1;
    const serverDefs = type === 'tv'
        ? EMBED_SERVERS.tv(id, season, episode)
        : EMBED_SERVERS.movie;
    const servers = serverDefs.map((s, i) => ({
        name: s.name,
        url: type === 'tv' ? s.url() : s.url(id)
    }));
    const currentTitle = (typeof window._lastWatchTitle === 'string') ? window._lastWatchTitle : '';

    // NOTE: sandbox attribute REMOVED — 2Embed refuses to play in sandboxed iframes.
    // Trade-off: 3rd party ads can hijack clicks. To compensate, we keep socialBar/sticky/pre-roll OFF,
    // so only the embed's own internal ads remain (overlaid on the video player UI).
    const allowAttrs = 'autoplay; encrypted-media; fullscreen; picture-in-picture; accelerometer; gyroscope';

    container.innerHTML = `
        <!-- VAST Pre-roll: overlay shown for 6s before iframe loads (highest CPM format) -->
        <div id="vastPreRoll" class="vast-preroll hidden">
            <div class="vast-preroll-inner">
                <div id="vastPreRollAd" class="vast-preroll-ad"></div>
                <div class="vast-preroll-overlay">
                    <div class="vast-preroll-timer">
                        <span id="vastSkipBtn" class="vast-skip-btn hidden">Skip Ad →</span>
                        <span id="vastTimer" class="vast-timer">Ad • 6s</span>
                    </div>
                </div>
            </div>
        </div>

        <button class="back-btn watch-back-btn" onclick="showDetail(${id}, '${type}')">← Kembali ke Detail</button>

        <!-- Title + quick info ABOVE player so user knows what they're watching -->
        <div class="watch-title-bar">
            <h1 class="watch-title">${currentTitle || 'Sedang Memutar...'}</h1>
            <span class="watch-quality">HD</span>
        </div>

        <!-- CPM Banner Slot #1: Above player (small, 728x90 desktop / 320x50 mobile) -->
        <div class="watch-ad-slot watch-ad-top" id="watchAdSlotTop" data-cpm-slot="top"></div>

        <div class="watch-container">
            <iframe id="playerFrame" data-src="${servers[0].url}"
                referrerpolicy="no-referrer"
                allowfullscreen
                allow="${allowAttrs}"></iframe>
        </div>

        <!-- Action bar right below player: Download (visible!) + Alt Link -->
        <div class="watch-action-bar">
            <button class="watch-download-btn" id="watchDownloadBtn" data-title="${currentTitle.replace(/"/g, '&quot;')}" data-tmdb-id="${id}" data-type="${type}">
                <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20"><path d="M5 20h14v-2H5m14-9h-4V3H9v6H5l7 7 7-7z" fill="currentColor"/></svg>
                <span>⬇️ Download Film (Gratis)</span>
            </button>
            <button class="watch-direct-link" id="watchDirectLink" data-source="cadangan" data-tmdb-id="${id}" data-type="${type}" title="Server Alternatif — buka link film">
                <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z" fill="currentColor"/></svg>
                <span>Server Cadangan</span>
            </button>
        </div>

        <!-- CPM Banner Slot #2: Below player (high engagement, post-content) -->
        <div class="watch-ad-slot watch-ad-bottom" id="watchAdSlotBottom" data-cpm-slot="bottom"></div>

        <div class="watch-info">
            <div class="watch-info-header">
                <h2>📺 Pilih Server</h2>
                <span class="server-hint">Klik server lain kalau video buffering / error</span>
            </div>
            <div class="watch-servers">
                ${servers.map((s, i) => `
                    <button class="server-btn ${i === 0 ? 'active' : ''}" data-url="${s.url}" onclick="switchServer(this, '${s.url}')">${s.name}</button>
                `).join('')}
            </div>

            <!-- CPM Banner Slot #3: 300x250 in info section -->
            <div class="watch-ad-slot watch-ad-square" id="watchAdSlotSquare" data-cpm-slot="square"></div>

            <!-- Telegram CTA: don't miss next new releases -->
            <div class="watch-cta">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
                <div class="watch-cta-text">
                    <strong>Jangan sampai ketinggalan!</strong><br>
                    Join channel Telegram untuk notifikasi film terbaru tiap hari.
                </div>
                <a href="https://t.me/absolutecinemaid" target="_blank" rel="noopener noreferrer" class="watch-cta-link">Join Channel</a>
            </div>
        </div>

        <!-- Daftar Film Serupa — placed at BOTTOM (after player, so user finds player first) -->
        <section class="watch-similar watch-similar-bottom">
            <div class="section-header">
                <h2 class="section-title">🎬 Film Serupa yang Mungkin Lu Suka</h2>
            </div>
            <div id="watchSimilarGrid" class="movie-grid">
                <div class="similar-loading">Memuat rekomendasi film serupa...</div>
            </div>
        </section>
    `;

    // Fetch full data for SEO schema + similar grid (non-blocking, won't delay iframe load)
    fetch(`/api/${type}/${id}`).then(r => r.json()).then(seoData => {

    // === VideoObject JSON-LD for Google Video Search (rich video snippets) ===
    if (seoData) {
        const seoTitle = seoData.title || seoData.name || currentTitle;
        const seoYear = (seoData.release_date || seoData.first_air_date || '').substring(0, 4);
        const seoRuntime = seoData.runtime || (seoData.episode_run_time && seoData.episode_run_time[0]) || 0;
        const seoPoster = seoData.poster_path ? `https://image.tmdb.org/t/p/w500${seoData.poster_path}` : '';
        const seoBackdrop = seoData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${seoData.backdrop_path}` : '';
        const canonicalWatch = `https://bioskopgratis.my.id/watch/${type}/${id}`;
        const videoSchema = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "VideoObject",
                    "@id": canonicalWatch + "#video",
                    "name": `Nonton ${seoTitle}${seoYear ? ' (' + seoYear + ')' : ''} Subtitle Indonesia`,
                    "alternateName": seoData.original_title || seoData.original_name || seoTitle,
                    "description": (seoData.overview || `Streaming ${seoTitle} subtitle Indonesia HD gratis di Absolute Cinema.`).substring(0, 500),
                    "thumbnailUrl": [seoPoster, seoBackdrop].filter(Boolean),
                    "uploadDate": seoData.release_date || seoData.first_air_date || new Date().toISOString().split('T')[0],
                    "duration": seoRuntime ? `PT${seoRuntime}M` : (type === 'tv' ? 'PT45M' : 'PT1H30M'),
                    "contentUrl": canonicalWatch,
                    "embedUrl": servers[0].url,
                    "inLanguage": "id-ID",
                    "isFamilyFriendly": !seoData.adult,
                    "isAccessibleForFree": true,
                    "genre": (seoData.genres || []).map(g => g.name),
                    "director": (() => {
                        const dirs = (seoData.credits?.crew || []).filter(c => c.job === 'Director').slice(0, 2);
                        return dirs.length ? dirs.map(d => ({ "@type": "Person", "name": d.name })) : undefined;
                    })(),
                    "actor": (seoData.credits?.cast || []).slice(0, 8).map(c => ({ "@type": "Person", "name": c.name })),
                    "publisher": { "@type": "Organization", "name": "Absolute Cinema", "url": "https://bioskopgratis.my.id/" },
                    "potentialAction": {
                        "@type": "WatchAction",
                        "target": canonicalWatch,
                        "expectsAcceptanceOf": {
                            "@type": "Offer",
                            "price": "0",
                            "priceCurrency": "IDR",
                            "availability": "https://schema.org/InStock"
                        }
                    }
                },
                {
                    "@type": "WebPage",
                    "@id": canonicalWatch + "#webpage",
                    "url": canonicalWatch,
                    "name": `Nonton ${seoTitle}${seoYear ? ' (' + seoYear + ')' : ''} Subtitle Indonesia`,
                    "description": `Streaming ${seoTitle} subtitle Indonesia HD gratis. ${servers.length} server tersedia.`,
                    "inLanguage": "id-ID",
                    "isPartOf": { "@id": "https://bioskopgratis.my.id/#website" },
                    "primaryImageOfPage": seoPoster ? { "@type": "ImageObject", "url": seoPoster, "width": 500, "height": 750 } : undefined,
                    "dateModified": new Date().toISOString()
                }
            ]
        };
        // Strip undefined for clean JSON
        const cleanVideo = JSON.parse(JSON.stringify(videoSchema));
        // Update watch page title + meta description (was missing — defaulted to home)
        document.title = `Nonton ${seoData.title || seoData.name}${seoYear ? ' (' + seoYear + ')' : ''} Subtitle Indonesia - Absolute Cinema`;
        updateMeta('description', `Nonton ${seoData.title || seoData.name}${seoYear ? ' (' + seoYear + ')' : ''} subtitle Indonesia HD gratis. ${servers.length} server embed tersedia. Streaming online tanpa buffering.`);
        updateMeta('og:title', `Nonton ${seoData.title || seoData.name}${seoYear ? ' (' + seoYear + ')' : ''} Subtitle Indonesia`);
        updateMeta('og:description', `Streaming ${seoData.title || seoData.name} HD subtitle Indonesia. ${servers.length} server embed, ganti server kalau buffering.`);
        updateMeta('og:type', 'video.episode');
        if (seoPoster) {
            updateMeta('og:image', seoPoster);
            updateMeta('twitter:image', seoPoster);
        }
        updateMeta('twitter:title', `Nonton ${seoData.title || seoData.name} Sub Indo`);
        updateMeta('twitter:description', `Streaming HD ${seoData.title || seoData.name} subtitle Indonesia gratis.`);
        // Update canonical to watch URL
        const watchCanonicalLink = document.querySelector('link[rel="canonical"]');
        if (watchCanonicalLink) watchCanonicalLink.setAttribute('href', canonicalWatch);
        // Remove any existing, then inject
        const existingVideo = document.getElementById('watchVideoSchema');
        if (existingVideo) existingVideo.remove();
        const videoScript = document.createElement('script');
        videoScript.id = 'watchVideoSchema';
        videoScript.type = 'application/ld+json';
        videoScript.textContent = JSON.stringify(cleanVideo);
        document.head.appendChild(videoScript);
    }
    }).catch(() => {});

    // Defer iframe load until after VAST pre-roll countdown completes
    const iframe = document.getElementById('playerFrame');
    if (iframe && iframe.dataset.src) {
        const dst = iframe.dataset.src;
        iframe.removeAttribute('data-src');
        iframe.src = 'about:blank';
        // Show VAST pre-roll, then load iframe after countdown
        if (window.ADS_CONFIG?.vastPreRoll?.enabled) {
            showVastPreRoll(() => { iframe.src = dst; setupWatchAutoFallback(); });
        } else {
            iframe.src = dst;
            setupWatchAutoFallback();
        }
    }

    // Fetch similar movies asynchronously (uses detail API which has similar + recommendations)
    loadWatchSimilar(id, type);

    // Initialize watch page ad slots (outside player container, no fullscreen hijack)
    hydrateWatchAdSlots();

    // Bind Download + Server Cadangan buttons (shared ad handler, rotated URLs)
    bindActionBarButtons();

    // Show Telegram join pill on watch page after 8s (contextual follow-up)
    setTimeout(() => {
        if (!sessionStorage.getItem('tgPillDismissed')) {
            const pill = document.getElementById('tgPill');
            if (pill) pill.classList.remove('hidden');
        }
    }, 8000);

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Auto-fallback wiring: detect iframe load errors and advance to next server.
// Called after iframe src is set. Listens for "error" event on iframe + network online event.
function setupWatchAutoFallback() {
    const frame = document.getElementById('playerFrame');
    if (!frame) return;
    // Reset any previous timer
    if (_fallbackTimer) { clearTimeout(_fallbackTimer); _fallbackTimer = null; }

    // 1) Browser-level error event (fires on network/load failures)
    frame.addEventListener('error', () => watchAutoFallback('iframe error event'), { once: true });

    // 2) load event: did it actually load? Some providers stay blank silently.
    // After 6s, peek at the iframe's window via contentWindow (only same-origin works,
    // so we just trust the error event plus a manual timeout fallback).
    let didLoad = false;
    frame.addEventListener('load', () => { didLoad = true; }, { once: true });

    // 3) Hard timeout — if no load event within 8s, assume it's broken (silent fail)
    setTimeout(() => {
        if (!didLoad && document.getElementById('playerFrame') === frame) {
            // Don't auto-fallback on the first server too aggressively — some legit embeds
            // take 10+ seconds on first load. Only fallback if iframe is still on initial src.
            watchAutoFallback('silent load timeout (8s)');
        }
    }, 8000);
}

async function loadWatchSimilar(id, type) {
    const grid = document.getElementById('watchSimilarGrid');
    if (!grid) return;
    try {
        const res = await fetch(`/api/${type}/${id}`);
        const data = await res.json();
        let similar = (data.similar?.results || data.recommendations?.results || []).filter(s => s.poster_path);
        // Fallback to trending if no similar/recommendations
        if (similar.length === 0) {
            const tr = await fetch('/api/trending?page=1');
            const trData = await tr.json();
            // Exclude current item
            similar = trData.results.filter(r => r.id !== id && r.poster_path).slice(0, 8);
        }
        similar = similar.slice(0, 8);
        if (similar.length === 0) {
            grid.innerHTML = '<div class="similar-loading">Tidak ada rekomendasi tersedia.</div>';
            return;
        }
        grid.innerHTML = similar.map(item => movieCard(item, item.media_type || type)).join('');
    } catch (e) {
        console.error('Error loading watch similar:', e);
        grid.innerHTML = '<div class="similar-loading">Gagal memuat rekomendasi.</div>';
    }
}

function loadWatchEpisode(tvId, season, episode) {
    const container = document.getElementById('watchContent');

    const serverDefs = EMBED_SERVERS.tv(tvId, season, episode);
    const servers = serverDefs.map((s) => ({ name: s.name, url: s.url() }));
    const currentTitle = (typeof window._lastWatchTitle === 'string') ? window._lastWatchTitle : '';

    // NOTE: sandbox REMOVED (see loadWatchContent comment)
    const allowAttrs = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

    container.innerHTML = `
        <!-- VAST Pre-roll: overlay shown for 6s before iframe loads -->
        <div id="vastPreRoll" class="vast-preroll hidden">
            <div class="vast-preroll-inner">
                <div id="vastPreRollAd" class="vast-preroll-ad"></div>
                <div class="vast-preroll-overlay">
                    <div class="vast-preroll-timer">
                        <span id="vastSkipBtn" class="vast-skip-btn hidden">Skip Ad →</span>
                        <span id="vastTimer" class="vast-timer">Ad • 6s</span>
                    </div>
                </div>
            </div>
        </div>

        <button class="back-btn" onclick="showDetail(${tvId}, 'tv')">← Kembali ke Detail</button>

        <!-- CPM Banner Slot #1: Above player -->
        <div class="watch-ad-slot watch-ad-top" id="watchAdSlotTop" data-cpm-slot="top"></div>

        <div class="watch-container">
            <iframe id="playerFrame" data-src="${servers[0].url}"
                referrerpolicy="no-referrer"
                allowfullscreen
                allow="${allowAttrs}"></iframe>
        </div>

        <!-- CPM Banner Slot #2: Below player -->
        <div class="watch-ad-slot watch-ad-bottom" id="watchAdSlotBottom" data-cpm-slot="bottom"></div>

        <div class="watch-info">
            <div class="watch-info-header">
                <h2>📺 S${season} E${episode}</h2>
                <span class="server-hint">Ganti server jika video tidak loading</span>
            </div>
            <div class="watch-servers">
                ${servers.map((s, i) => `
                    <button class="server-btn ${i === 0 ? 'active' : ''}" data-url="${s.url}" onclick="switchServer(this, '${s.url}')">${s.name}</button>
                `).join('')}
            </div>

            <!-- Fake Download Button (TV Episode) — redirects to Adsterra direct link -->
            <button class="watch-download-btn" id="watchDownloadBtn" data-title="${currentTitle.replace(/"/g, '&quot;')}" data-tmdb-id="${tvId}" data-type="tv" data-season="${season}" data-episode="${episode}">
                <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18"><path d="M5 20h14v-2H5m14-9h-4V3H9v6H5l7 7 7-7z" fill="currentColor"/></svg>
                <span>Download Episode (Gratis)</span>
            </button>

            <!-- CPM Banner Slot #3: 300x250 in info section -->
            <div class="watch-ad-slot watch-ad-square" id="watchAdSlotSquare" data-cpm-slot="square"></div>

            <button class="watch-direct-link" data-source="cadangan" data-tmdb-id="${tvId}" data-type="tv" data-season="${season}" data-episode="${episode}">
                🔗 Butuh alternatif? Klik di sini
            </button>
        </div>
    `;

    // Defer iframe load until after VAST pre-roll countdown
    const iframe = document.getElementById('playerFrame');
    if (iframe && iframe.dataset.src) {
        const dst = iframe.dataset.src;
        iframe.removeAttribute('data-src');
        iframe.src = 'about:blank';
        if (window.ADS_CONFIG?.vastPreRoll?.enabled) {
            showVastPreRoll(() => { iframe.src = dst; setupWatchAutoFallback(); });
        } else {
            iframe.src = dst;
            setupWatchAutoFallback();
        }
    }

    // Hydrate watch page ad slots
    hydrateWatchAdSlots();

    // Bind Download + Server Cadangan buttons (shared ad handler)
    bindActionBarButtons();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Hydrate all watch page ad slots
function hydrateWatchAdSlots() {
    const cfg = window.ADS_CONFIG;
    if (!cfg) return;
    if (cfg.watchSlotTop?.enabled) window.injectAdsterraLazy('watchAdSlotTop', cfg.watchSlotTop);
    if (cfg.watchSlotBottom?.enabled) window.injectAdsterraLazy('watchAdSlotBottom', cfg.watchSlotBottom);
    if (cfg.banner300?.enabled) window.injectAdsterraLazy('watchAdSlotSquare', cfg.banner300);
}

// Show VAST pre-roll overlay before loading main iframe.
// Loads banner ad into overlay, counts down, then calls onComplete to swap iframe src.
function showVastPreRoll(onComplete) {
    const cfg = window.ADS_CONFIG?.vastPreRoll;
    const overlay = document.getElementById('vastPreRoll');
    const adContainer = document.getElementById('vastPreRollAd');
    const skipBtn = document.getElementById('vastSkipBtn');
    const timerEl = document.getElementById('vastTimer');
    if (!overlay || !adContainer || !cfg) { onComplete && onComplete(); return; }

    overlay.classList.remove('hidden');
    let elapsed = 0;
    const totalMs = cfg.durationMs || 6000;
    const skipAfterMs = cfg.skipAfterMs || 5000;

    // Inject pre-roll banner into overlay
    window.injectAdsterraIframe('vastPreRollAd', {
        key: cfg.key,
        width: 728,
        height: 90,
        scriptUrl: cfg.scriptUrl
    });

    const tick = setInterval(() => {
        elapsed += 100;
        const remaining = Math.max(0, totalMs - elapsed) / 1000;
        if (timerEl) timerEl.textContent = `Ad • ${Math.ceil(remaining)}s`;

        // Show skip button after threshold
        if (elapsed >= skipAfterMs && skipBtn) {
            skipBtn.classList.remove('hidden');
            skipBtn.onclick = () => {
                clearInterval(tick);
                overlay.classList.add('hidden');
                onComplete && onComplete();
            };
        }

        // Auto-complete after full duration
        if (elapsed >= totalMs) {
            clearInterval(tick);
            overlay.classList.add('hidden');
            onComplete && onComplete();
        }
    }, 100);

    // Safety timeout in case tick fails (10s hard cap)
    setTimeout(() => {
        clearInterval(tick);
        overlay.classList.add('hidden');
        onComplete && onComplete();
    }, totalMs + 4000);
}

function switchServer(btn, url) {
    document.querySelectorAll('.server-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('playerFrame').src = url;
    // Reset the auto-fallback timer for the new server
    setupWatchAutoFallback();
}

// Action bar buttons: Download + Server Cadangan — keduanya buka iklan
// Pattern: countdown 3s → direct link → window.open. Logs ke backend.
// Use ADS_CONFIG.directLink.url (SmartLink) for real ad revenue.
let _adRotateIndex = 0;
function getNextAdUrl() {
    const cfg = window.ADS_CONFIG || {};
    let url = null;

    // Priority 1: ADS_CONFIG.directLink.url (SmartLink dari Adsterra)
    if (cfg.directLink && cfg.directLink.enabled && cfg.directLink.url) {
        url = cfg.directLink.url;
    }
    // Priority 2: ADS_CONFIG.directLinks (legacy array pool)
    else if (Array.isArray(cfg.directLinks) && cfg.directLinks.length) {
        url = cfg.directLinks[_adRotateIndex % cfg.directLinks.length];
    }
    // Priority 3: ADS_CONFIG.directLink.fallback (Google search, earns via search ads)
    else if (cfg.directLink && cfg.directLink.fallback) {
        url = cfg.directLink.fallback;
    }
    // Last resort: build search fallback
    else {
        url = buildSearchFallbackUrl('nonton film');
    }

    _adRotateIndex++;

    // Append UTM-like source param so Adsterra can track source
    // (only if it's a real ad URL, not the Google search fallback)
    if (url && !url.includes('google.com/search')) {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}src=flixstream`;
    }
    return url;
}

// Build a Google search fallback URL (used when no direct ad URL is configured).
// Google shows search ads on the results page, so user still monetizes the click.
function buildSearchFallbackUrl(query = 'nonton film') {
    return `https://www.google.com/search?q=${encodeURIComponent(query)}&utm_source=flixstream`;
}

// Quick open: dipakai oleh inline "Alt Link" di detail page (no countdown).
// Logs click lalu open URL di tab baru. Penting: `event` adalah click event
// supaya <a href="#"> gak navigate.
function openAdLink(event, source = 'detail') {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    const adUrl = getNextAdUrl();
    // Log click
    try {
        if (window.fetch) {
            fetch('/api/ad-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, url: location.pathname })
            }).catch(() => {});
        }
    } catch (e) {}
    const w = window.open(adUrl, '_blank', 'noopener,noreferrer');
    if (!w) {
        // Popup blocked — fallback to same-tab navigation
        location.href = adUrl;
    }
    return false;
}

function bindActionBarButtons() {
    const buttons = [
        { btn: document.getElementById('watchDownloadBtn'), source: 'download' },
        { btn: document.getElementById('watchDirectLink'), source: 'cadangan' }
    ].filter(b => b.btn);

    // Also bind any extra .watch-direct-link (TV info section)
    document.querySelectorAll('.watch-direct-link:not([data-bound])').forEach(el => {
        el.setAttribute('data-bound', '1');
        buttons.push({ btn: el, source: 'cadangan' });
    });

    buttons.forEach(({ btn, source }) => {
        // Avoid double-binding
        if (btn.dataset.boundActionBar) return;
        btn.dataset.boundActionBar = '1';

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tmdbId = btn.dataset.tmdbId;
            const type = btn.dataset.type;
            const title = btn.dataset.title || 'Film';
            const season = btn.dataset.season;
            const episode = btn.dataset.episode;
            const src = btn.dataset.source || source;

            // Disable button + show countdown
            btn.disabled = true;
            const span = btn.querySelector('span');
            const originalText = span ? span.textContent : btn.textContent;
            let countdown = 3;
            const statusMsg = src === 'download'
                ? `⏳ Menyiapkan link... (${countdown}s)`
                : `⏳ Membuka server cadangan... (${countdown}s)`;
            if (span) span.textContent = statusMsg;
            else btn.textContent = statusMsg;

            const tick = setInterval(() => {
                countdown--;
                const next = src === 'download'
                    ? `⏳ Menyiapkan link... (${countdown}s)`
                    : `⏳ Membuka server cadangan... (${countdown}s)`;
                if (span) span.textContent = next;
                else btn.textContent = next;
                if (countdown <= 0) {
                    clearInterval(tick);
                    // Open rotated ad URL in new tab (revenue per click)
                    const adUrl = getNextAdUrl();
                    try { window.open(adUrl, '_blank', 'noopener,noreferrer'); } catch (err) {}
                    const successMsg = '✅ Link dibuka di tab baru';
                    if (span) span.textContent = successMsg;
                    else btn.textContent = successMsg;
                    // Re-enable after 4s
                    setTimeout(() => {
                        btn.disabled = false;
                        if (span) span.textContent = originalText;
                        else btn.textContent = originalText;
                    }, 4000);
                }
            }, 1000);
        });
    });
}

function playTrailer(key) {
    showSection('watch');
    updateNav('');

    const container = document.getElementById('watchContent');
    container.innerHTML = `
        <button class="back-btn" onclick="goBack()">← Kembali</button>
        <div class="watch-container">
            <iframe src="https://www.youtube.com/embed/${key}?autoplay=1" allowfullscreen allow="autoplay; encrypted-media"></iframe>
        </div>
    `;

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Render Movies =====
const MAX_CARDS_PER_SECTION = 12;  // 2 rows × 6 cols desktop, 3 rows × 4 cols mobile
function renderMovies(items, containerId, append = false, limit = MAX_CARDS_PER_SECTION) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!append) container.innerHTML = '';

    // Cap to the given limit (default MAX_CARDS_PER_SECTION) to keep home page compact.
    // Trending overrides to 36 (6 rows × 6 cols desktop) for the ranked list.
    const limited = append ? items : items.slice(0, limit);

    limited.forEach(item => {
        if (!item.poster_path) return;
        container.innerHTML += movieCard(item, item.media_type);
    });

    // After rendering, fetch view counts in bulk and inject badges onto cards with non-zero views
    decorateWithViewCounts(container, limited);
}

// Add "X menonton" badge to each card based on /api/bulk-view-counts
// Skips items with 0 views to keep cards clean.
async function decorateWithViewCounts(container, items) {
    try {
        if (!items || !items.length) return;
        const keys = items.map(it => `${it.media_type || 'movie'}:${it.id}`).join(',');
        if (!keys) return;
        const res = await fetch(`/api/bulk-view-counts?ids=${encodeURIComponent(keys)}`);
        const data = await res.json();
        const counts = data.counts || {};
        // For each card, find the matching id and add badge if count > 0
        container.querySelectorAll('.movie-card').forEach(card => {
            // Skip if already has a count badge
            if (card.querySelector('.card-view-count')) return;
            // Extract id from onclick handler "showDetail(123, 'movie')"
            const onclick = card.getAttribute('onclick') || '';
            const m = onclick.match(/showDetail\((\d+),\s*'([^']+)'/);
            if (!m) return;
            const id = m[1];
            const type = m[2];
            const count = counts[`${type}:${id}`];
            if (count && count > 0) {
                const badge = document.createElement('div');
                badge.className = 'card-view-count';
                badge.textContent = `👁 ${formatCount(count)} menonton`;
                card.appendChild(badge);
            }
        });
    } catch (e) {
        // Silent fail — view count is decorative
    }
}

function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'jt';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'rb';
    return String(n);
}

// Fetch and display "X menonton" count on the detail page
async function loadDetailViewCount(type, id) {
    const el = document.getElementById('detailViewCount');
    const num = document.getElementById('detailViewCountNum');
    if (!el || !num) return;
    try {
        const res = await fetch(`/api/movie-views/${type}/${id}`);
        const data = await res.json();
        if (data && data.count && data.count > 0) {
            num.textContent = formatCount(data.count);
            el.style.display = 'inline-flex';
        } else {
            // Hide the badge entirely if 0 — looks cleaner than "0 menonton"
            el.style.display = 'none';
        }
    } catch (e) {
        el.style.display = 'none';
    }
}

function movieCard(item, type = 'movie') {
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || '').substring(0, 4);
    const rating = item.vote_average?.toFixed(1) || '0';
    const poster = `/img/w342/${item.poster_path}`;
    const mediaType = type || item.media_type || 'movie';
    const bookmarked = isInWatchlist(item.id, mediaType);
    const safeTitle = (title || '').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

    return `
        <div class="movie-card" onclick="showDetail(${item.id}, '${mediaType}')">
            ${mediaType === 'tv' ? '<span class="badge">TV</span>' : ''}
            <button class="bookmark-btn ${bookmarked ? 'bookmarked' : ''}"
                    onclick="event.stopPropagation();handleBookmarkClick(this, ${item.id}, '${mediaType}', '${safeTitle}')"
                    aria-label="${bookmarked ? 'Hapus dari watchlist' : 'Tambah ke watchlist'}"
                    title="${bookmarked ? 'Hapus dari watchlist' : 'Tambah ke watchlist'}">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                </svg>
            </button>
            <img src="https://image.tmdb.org/t/p/w342${item.poster_path}" alt="${title}" loading="lazy" onerror="this.onerror=null;this.classList.add('img-failed');this.insertAdjacentHTML('afterend', '<div class=\\'card-fallback\\'>' + (this.alt || 'No Poster') + '</div>');this.remove();">
            <div class="card-overlay">
                <div class="card-play">▶</div>
            </div>
            <div class="card-info">
                <div class="card-title">${title}</div>
                <div class="card-meta">
                    <span>${year}</span>
                    <span class="card-rating">⭐ ${rating}</span>
                </div>
            </div>
        </div>
    `;
}

// Bookmark click handler (needs minimal data — full data not in scope)
function handleBookmarkClick(btn, id, type, title) {
    // Get full data from card if available, else create minimal
    const card = btn.closest('.movie-card');
    const img = card?.querySelector('img');
    const item = {
        id,
        media_type: type,
        title: title,
        name: title,
        poster_path: img ? img.src.replace('https://image.tmdb.org/t/p/w342', '') : null
    };
    const added = toggleWatchlist(item, type);
    btn.classList.toggle('bookmarked', added);
    btn.setAttribute('aria-label', added ? 'Hapus dari watchlist' : 'Tambah ke watchlist');
    btn.setAttribute('title', added ? 'Hapus dari watchlist' : 'Tambah ke watchlist');
    showToast(added ? `+ "${title}" ditambahkan ke Watchlist` : `- "${title}" dihapus dari Watchlist`, added);
}

// Lightweight toast for bookmark feedback
function showToast(msg, success = true) {
    let t = document.getElementById('flixToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'flixToast';
        t.className = 'flix-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('toast-success', success);
    t.classList.add('show');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ===== Request Film Modal =====
// Server endpoint /api/request already exists; this is the UI side.
// Opens via floating button (FAB). Posts JSON to server, which forwards to Telegram
// and persists to data/requests.jsonl.
function openRequestModal() {
    const m = document.getElementById('requestModal');
    if (!m) return;
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // Reset form on open
    const f = document.getElementById('requestForm');
    if (f) f.reset();
    const status = document.getElementById('requestStatus');
    if (status) status.style.display = 'none';
    // Focus title field
    setTimeout(() => {
        const t = document.getElementById('reqTitle');
        if (t) t.focus();
    }, 100);
}

function closeRequestModal() {
    const m = document.getElementById('requestModal');
    if (!m) return;
    m.style.display = 'none';
    document.body.style.overflow = '';
}

async function submitRequest(e) {
    e.preventDefault();
    const btn = document.getElementById('reqSubmitBtn');
    const status = document.getElementById('requestStatus');
    const title = document.getElementById('reqTitle')?.value.trim();
    if (!title) {
        if (status) {
            status.style.display = 'block';
            status.className = 'request-status error';
            status.textContent = 'Judul wajib diisi!';
        }
        return;
    }
    const body = {
        title,
        type: document.getElementById('reqType')?.value || 'movie',
        year: document.getElementById('reqYear')?.value || '',
        message: document.getElementById('reqMessage')?.value.trim() || ''
    };
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Mengirim...';
    }
    if (status) {
        status.style.display = 'block';
        status.className = 'request-status info';
        status.textContent = 'Lagi kirim ke Telegram...';
    }
    try {
        const res = await fetch('/api/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            if (status) {
                status.className = 'request-status success';
                status.textContent = '✓ Request terkirim! Kita kabarin kalau udah masuk (maks 24 jam).';
            }
            // Reset and close after 2.5s
            setTimeout(() => {
                closeRequestModal();
                if (btn) { btn.disabled = false; btn.textContent = 'Kirim Request 🚀'; }
            }, 2500);
        } else {
            throw new Error(data.error || 'Server error');
        }
    } catch (err) {
        if (status) {
            status.className = 'request-status error';
            status.textContent = '✗ Gagal kirim: ' + (err.message || 'network error') + '. Coba lagi ya.';
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Kirim Request 🚀'; }
    }
}

// Esc key closes the modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const m = document.getElementById('requestModal');
        if (m && m.style.display !== 'none' && m.style.display !== '') {
            closeRequestModal();
        }
    }
});

// ===== Keyboard Shortcuts =====
//  j → next hero   k → prev hero
//  / → focus search   Esc → close/clear search
//  m → mute/unmute video (if any iframe w/ contentWindow? — limited; we try playerFrame)
//  Backspace → go back (when not in input)
//  ArrowLeft / ArrowRight → prev/next hero
document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
        if (e.key === 'Escape') {
            e.target.blur();
            const dd = document.getElementById('searchDropdown');
            if (dd) { dd.classList.remove('show'); dd.innerHTML = ''; }
        }
        return;
    }

    if (e.key === 'j' || e.key === 'ArrowRight') {
        if (heroItems && heroItems.length > 1) { heroNext(); e.preventDefault(); }
    } else if (e.key === 'k' || e.key === 'ArrowLeft') {
        if (heroItems && heroItems.length > 1) { heroPrev(); e.preventDefault(); }
    } else if (e.key === '/') {
        e.preventDefault();
        const s = document.getElementById('searchInput');
        if (s) s.focus();
    } else if (e.key === 'Escape') {
        const dd = document.getElementById('searchDropdown');
        if (dd && dd.classList.contains('show')) { dd.classList.remove('show'); dd.innerHTML = ''; return; }
        // Close any open modals/trailer
        const trailer = document.getElementById('trailerModal');
        if (trailer) { trailer.remove(); return; }
        // Go back if on detail/watch
        const watchVisible = !document.getElementById('watchSection')?.classList.contains('hidden');
        const detailVisible = !document.getElementById('detailSection')?.classList.contains('hidden');
        if (watchVisible || detailVisible) { goBack(); e.preventDefault(); }
    } else if (e.key === 'Backspace') {
        const watchVisible = !document.getElementById('watchSection')?.classList.contains('hidden');
        const detailVisible = !document.getElementById('detailSection')?.classList.contains('hidden');
        if (watchVisible || detailVisible) { goBack(); e.preventDefault(); }
    } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        // Show keyboard shortcuts help
        e.preventDefault();
        showShortcutsHelp();
    }
});

function showShortcutsHelp() {
    let m = document.getElementById('shortcutsModal');
    if (m) { m.remove(); return; }
    m = document.createElement('div');
    m.id = 'shortcutsModal';
    m.className = 'shortcuts-modal';
    m.innerHTML = `
        <div class="shortcuts-backdrop" onclick="document.getElementById('shortcutsModal').remove()"></div>
        <div class="shortcuts-content">
            <button class="shortcuts-close" onclick="document.getElementById('shortcutsModal').remove()" aria-label="Tutup">✕</button>
            <h3>⌨️ Pintasan Keyboard</h3>
            <ul>
                <li><kbd>j</kbd> / <kbd>→</kbd><span>Hero berikutnya</span></li>
                <li><kbd>k</kbd> / <kbd>←</kbd><span>Hero sebelumnya</span></li>
                <li><kbd>/</kbd><span>Fokus ke pencarian</span></li>
                <li><kbd>Esc</kbd><span>Tutup pencarian / kembali</span></li>
                <li><kbd>Backspace</kbd><span>Kembali ke halaman sebelumnya</span></li>
                <li><kbd>?</kbd><span>Tampilkan bantuan ini</span></li>
            </ul>
            <p class="shortcuts-hint">Tekan <kbd>?</kbd> kapan saja untuk menampilkan bantuan ini</p>
        </div>
    `;
    document.body.appendChild(m);
    // Focus trap
    setTimeout(() => m.querySelector('.shortcuts-close')?.focus(), 50);
}

// ===== Watchlist page/section =====
function showWatchlist() {
    showSection('watchlist');
    updateNav('');
    const container = document.getElementById('watchlistContent');
    if (!container) return;
    const list = getWatchlist();
    if (list.length === 0) {
        container.innerHTML = `
            <button class="back-btn" onclick="goHome()">← Kembali</button>
            <div class="empty-state">
                <div class="empty-icon">🔖</div>
                <h3>Watchlist kamu kosong</h3>
                <p>Klik ikon 🔖 di kartu film untuk menyimpan ke watchlist. Bisa diakses kapan saja, bahkan tanpa internet.</p>
            </div>
        `;
        return;
    }
    container.innerHTML = `
        <button class="back-btn" onclick="goHome()">← Kembali</button>
        <div class="section-header" style="margin-top:20px;">
            <h2 class="section-title">🔖 Watchlist Saya <span style="color:var(--text-secondary);font-size:14px;font-weight:500;">(${list.length})</span></h2>
            <button class="btn-clear-wl" onclick="clearWatchlist()" title="Hapus semua">🗑️ Hapus Semua</button>
        </div>
        <div class="movie-grid">
            ${list.map(item => `
                <div class="movie-card" onclick="showDetail(${item.id}, '${item.type}')">
                    ${item.type === 'tv' ? '<span class="badge">TV</span>' : ''}
                    <button class="bookmark-btn bookmarked"
                            onclick="event.stopPropagation();removeFromWatchlistView(${item.id}, '${item.type}', this)"
                            aria-label="Hapus dari watchlist" title="Hapus dari watchlist">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                        </svg>
                    </button>
                    <img src="${item.poster}" alt="${item.title}" loading="lazy"
                         onerror="this.onerror=null;this.classList.add('img-failed');this.insertAdjacentHTML('afterend','<div class=\\'card-fallback\\'>${(item.title || '').replace(/'/g, '')}</div>');this.remove();">
                    <div class="card-overlay">
                        <div class="card-play">▶</div>
                    </div>
                    <div class="card-info">
                        <div class="card-title">${item.title}</div>
                        <div class="card-meta">
                            <span>${item.year || ''}</span>
                            <span class="card-rating">⭐ ${item.rating || '0'}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function removeFromWatchlistView(id, type, btn) {
    const card = btn.closest('.movie-card');
    const img = card?.querySelector('img');
    const title = card?.querySelector('.card-title')?.textContent || '';
    const item = { id, media_type: type, title, name: title, poster_path: img ? img.src.replace('https://image.tmdb.org/t/p/w185', '') : null };
    toggleWatchlist(item, type);
    // Animate out
    if (card) {
        card.style.transition = 'opacity 250ms, transform 250ms';
        card.style.opacity = '0';
        card.style.transform = 'scale(0.85)';
        setTimeout(() => {
            // Reload watchlist
            showWatchlist();
            showToast(`- "${title}" dihapus dari Watchlist`);
        }, 260);
    }
}

function clearWatchlist() {
    if (!confirm('Hapus semua film dari Watchlist?')) return;
    saveWatchlist([]);
    showWatchlist();
    showToast('Watchlist dikosongkan');
}

// ===== Watch History page =====
function showWatchHistory() {
    showSection('history');
    updateNav('');
    const container = document.getElementById('historyContent');
    if (!container) return;
    const list = getHistory();
    if (list.length === 0) {
        container.innerHTML = `
            <button class="back-btn" onclick="goHome()">← Kembali</button>
            <div class="empty-state">
                <div class="empty-icon">🕘</div>
                <h3>Belum ada riwayat tonton</h3>
                <p>Film & serial TV yang pernah kamu buka akan muncul di sini. Akses offline — tersimpan di browser kamu.</p>
            </div>
        `;
        return;
    }
    container.innerHTML = `
        <button class="back-btn" onclick="goHome()">← Kembali</button>
        <div class="section-header" style="margin-top:20px;">
            <h2 class="section-title">🕘 Riwayat Tonton <span style="color:var(--text-secondary);font-size:14px;font-weight:500;">(${list.length})</span></h2>
            <button class="btn-clear-wl" onclick="clearHistory()" title="Hapus semua">🗑️ Hapus Semua</button>
        </div>
        <div class="movie-grid">
            ${list.map(item => {
                const ago = timeAgo(item.watchedAt);
                return `
                <div class="movie-card" onclick="showDetail(${item.id}, '${item.type}')">
                    ${item.type === 'tv' ? '<span class="badge">TV</span>' : ''}
                    <span class="cw-time-badge">${ago}</span>
                    <img src="${item.poster}" alt="${item.title}" loading="lazy"
                         onerror="this.onerror=null;this.classList.add('img-failed');this.insertAdjacentHTML('afterend','<div class=\\'card-fallback\\'>${(item.title || '').replace(/'/g, '')}</div>');this.remove();">
                    <div class="card-overlay">
                        <div class="card-play">▶</div>
                    </div>
                    <div class="card-info">
                        <div class="card-title">${item.title}</div>
                        <div class="card-meta">
                            <span>${item.year || ''}</span>
                            <span class="card-rating">⭐ ${item.rating || '0'}</span>
                        </div>
                    </div>
                </div>
            `;}).join('')}
        </div>
    `;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function timeAgo(ts) {
    if (!ts) return '';
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return 'baru saja';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h';
    if (sec < 604800) return Math.floor(sec / 86400) + 'd';
    return Math.floor(sec / 604800) + 'w';
}

function clearHistory() {
    if (!confirm('Hapus semua riwayat tonton?')) return;
    try { localStorage.removeItem(HIST_KEY); } catch (e) {}
    showWatchHistory();
    updateContinueWatchingSection();
    showToast('Riwayat dikosongkan');
}

// Update watchlist count badge in nav
function updateWatchlistBadge() {
    const badge = document.getElementById('wlCountBadge');
    if (!badge) return;
    const count = getWatchlist().length;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

// Wrap toggleWatchlist to also update badge (in place)
const _origToggle = toggleWatchlist;
toggleWatchlist = function(item, type) {
    const result = _origToggle(item, type);
    updateWatchlistBadge();
    return result;
};

// Run on load
document.addEventListener('DOMContentLoaded', () => {
    updateWatchlistBadge();
    updateContinueWatchingSection();
});
// Also run immediately (in case DOMContentLoaded already fired)
updateWatchlistBadge();
updateContinueWatchingSection();
