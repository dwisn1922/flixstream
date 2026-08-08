/* ============================================
   ADSTERRA ADS CONFIG — bioskopgratis.my.id + nontonfilmgratis.xyz
   ============================================
   Ganti ad unit ID di sini kalau bikin unit baru
   di dashboard Adsterra. Kosongkan string ('')
   untuk disable ad tertentu.
   ============================================ */

const ADS_CONFIG = {
    // === Popunder (DISABLED by default — di-set per-domain di bawah) ===
    // Highest revenue per impression, tapi intrusive.
    popunder: {
        enabled: false,
        url: ''
    },

    // === Social Bar (notif pojok kanan bawah) ===
    // Triggered fullscreen takeover + blocked video playback
    socialBar: {
        enabled: false,
        url: ''
    },

    // === Per-domain ad tags ===
    // Domain deteksi via window.location.hostname di loader di bawah.
    // SmartLink shared (1 key untuk semua domain).
    domains: {
        'bioskopgratis.my.id': {
            popunder: {
                enabled: true,
                scriptUrl: 'https://depthschokedirected.com/7c/4c/9a/7c4c9abaa4641b6cae1f9976b4ae8301.js'
            },
            antiAdblock: {
                enabled: true,
                scriptUrl: 'https://depthschokedirected.com/7c/4c/9a/7c4c9abaa4641b6cae1f9976b4ae8301.js'
            }
        },
        'nontonfilmgratis.xyz': {
            popunder: {
                enabled: true,
                scriptUrl: 'https://depthschokedirected.com/bb/c4/b3/bbc4b3b971970916bcd25f1a6b0dbea6.js'
            },
            antiAdblock: {
                enabled: true,
                scriptUrl: 'https://depthschokedirected.com/bb/c4/b3/bbc4b3b971970916bcd25f1a6b0dbea6.js'
            }
        }
    },

    // === Native Banner (728x90 in-feed, di bawah hero) ===
    nativeBanner: {
        enabled: true,
        key: '3b478b074337fa1a70d602db7ef4f1d5',
        containerId: 'container-3b478b074337fa1a70d602db7ef4f1d5',
        scriptUrl: 'https://pl29791403.effectivecpmnetwork.com/3b478b074337fa1a70d602db7ef4f1d5/invoke.js'
    },

    // === Banner 728x90 (leaderboard) — homepage + detail + watch ===
    banner728: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 90,
        width: 728,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },

    // === Banner 300x250 (medium rectangle) — sidebar/footer ===
    banner300: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 250,
        width: 300,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },

    // === Mobile Banner 320x50 (mobile in-content) ===
    bannerMobile: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 50,
        width: 320,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },

    // === Detail Page Slots ===
    detailSlotTop: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 90,
        width: 728,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },
    detailSlotBottom: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 90,
        width: 728,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },

    // === Watch Page Slots (OUTSIDE player container — no fullscreen hijack) ===
    watchSlotTop: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 90,
        width: 728,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },
    watchSlotBottom: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        height: 90,
        width: 728,
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js'
    },

    // === VAST Pre-roll Video (highest CPM, displayed 5-15s before iframe loads) ===
    // Using Adsterra's video ad zone — falls back to image banner if VAST unavailable.
    vastPreRoll: {
        enabled: true,
        key: 'cdbb6a1d18fe7ad996c08f62af3e95e5',
        scriptUrl: 'https://www.highperformanceformat.com/cdbb6a1d18fe7ad996c08f62af3e95e5/invoke.js',
        durationMs: 6000,    // Show pre-roll for 6s
        skipAfterMs: 5000    // Allow skip after 5s
    },

    // === Anti-adblock (DISABLED — Adsterra aa.js domain dead/redirects to google.com) ===
    antiAdblock: {
        enabled: false
    },

    // === Direct Link (SmartLink) — buat tombol Download + Server Cadangan + Alt Link ===
    // SmartLink dari Adsterra dashboard: smart-link-3343765
    // VALIDATED 2026-06-21: returns HTTP 200
    directLink: {
        enabled: true,
        url: 'https://depthschokedirected.com/wrwy0ft541?key=03417d9381fc9ca064bae2e4a637263b',
        fallback: 'https://www.google.com/search?q=nonton+film+gratis&source=directlink'
    }
};

/* ============================================
   ADSTERRA LOADER — auto-inject semua iklan
   ============================================ */

(function loadAds() {
    const cfg = ADS_CONFIG;
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const hostname = (window.location.hostname || '').toLowerCase();
    const domainCfg = cfg.domains && cfg.domains[hostname];

    // 1. Popunder (per-domain, atau fallback ke cfg.popunder)
    const popCfg = (domainCfg && domainCfg.popunder && domainCfg.popunder.enabled)
        ? domainCfg.popunder
        : (cfg.popunder.enabled ? cfg.popunder : null);
    if (popCfg && popCfg.scriptUrl) {
        const s = document.createElement('script');
        s.src = popCfg.scriptUrl;
        s.async = true;
        s.setAttribute('data-cfasync', 'false');
        document.body.appendChild(s);
        console.log('[Ads] Popunder loaded for', hostname, ':', popCfg.scriptUrl.substring(0, 60));
    }

    // 2. Social Bar
    if (cfg.socialBar.enabled && cfg.socialBar.url) {
        const s = document.createElement('script');
        s.src = cfg.socialBar.url;
        s.async = true;
        document.body.appendChild(s);
    }

    // 3. Native Banner
    // Skip — handled by ad-carousel.js rotation

    // 4. Banner 728x90 (leaderboard)
    if (cfg.banner728.enabled && cfg.banner728.key) {
        injectAdsterraIframe('adslot-banner-1', cfg.banner728);
    }

    // 5. Banner 300x250 (medium rectangle)
    if (cfg.banner300.enabled && cfg.banner300.key) {
        injectAdsterraIframe('adslot-banner-300', cfg.banner300);
    }

    // 6. Mobile banner 320x50
    if (cfg.bannerMobile.enabled && cfg.bannerMobile.key && isMobile) {
        injectAdsterraIframe('adslot-banner-mobile', cfg.bannerMobile);
    }

    // 7. Anti-adblock script (per-domain)
    const aaCfg = (domainCfg && domainCfg.antiAdblock && domainCfg.antiAdblock.enabled)
        ? domainCfg.antiAdblock
        : null;
    if (aaCfg && aaCfg.scriptUrl) {
        const s = document.createElement('script');
        s.async = true;
        s.src = aaCfg.scriptUrl;
        s.setAttribute('data-cfasync', 'false');
        s.onerror = () => console.log('[Ads] Anti-adblock script failed to load');
        document.body.appendChild(s);
        console.log('[Ads] Anti-adblock loaded for', hostname);
    }
})();

// Helper: inject Adsterra iframe banner via atOptions + invoke.js
function injectAdsterraIframe(containerId, adCfg) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
        const cfg1 = document.createElement('script');
        cfg1.text = `atOptions = { 'key' : '${adCfg.key}', 'format' : 'iframe', 'height' : ${adCfg.height}, 'width' : ${adCfg.width}, 'params' : {} };`;
        document.head.appendChild(cfg1);

        const s = document.createElement('script');
        s.src = adCfg.scriptUrl;
        s.async = true;
        s.setAttribute('data-cfasync', 'false');
        container.appendChild(s);
    } catch (e) {
        console.warn('[Ads] Failed to inject', containerId, e);
    }
}

// Helper: inject Adsterra banner lazily (when element becomes visible).
// Used for below-the-fold slots in detail/watch pages to avoid layout shift.
function injectAdsterraLazy(containerId, adCfg, rootMargin = '300px') {
    const container = document.getElementById(containerId);
    if (!container) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                injectAdsterraIframe(containerId, adCfg);
                observer.unobserve(container);
            }
        });
    }, { rootMargin });
    observer.observe(container);
}

// Expose globally for use in app.js
window.ADS_CONFIG = ADS_CONFIG;
window.injectAdsterraIframe = injectAdsterraIframe;
window.injectAdsterraLazy = injectAdsterraLazy;

console.log('[ads-config.js] DONE — window.ADS_CONFIG typeof:', typeof window.ADS_CONFIG, 'injectAdsterraIframe:', typeof window.injectAdsterraIframe);