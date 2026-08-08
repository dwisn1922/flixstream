/* ============================================
   STADIUM LED AD BANNER — ROTATING CAROUSEL
   ============================================
   - 4 promo templates rotate with visible slide animation
   - If real Adsterra ad loads, replaces carousel
   - Two slots use different ad keys (banner + native)
   - Off-sync so they don't appear stacked
   ============================================ */

(function initStadiumAds() {
    'use strict';

    const HOLD_MS = 7000;      // hold each promo for 7s
    const SLIDE_MS = 1100;     // slide animation duration
    const ADSTERRA_TIMEOUT_MS = 3500;

    // 4 different promo templates — cycle through these when Adsterra doesn't load
    const PROMOS = [
        {
            label: 'ADVERTISEMENT',
            emoji: '📢',
            text: 'Join Telegram untuk update film tiap hari',
            cta: '@absolutecinemaid →',
            href: 'https://t.me/absolutecinemaid',
            accent: 'rgba(236, 72, 153, 0.22)'  // pink
        },
        {
            label: 'ADVERTISEMENT',
            emoji: '🎬',
            text: 'Request film? Langsung chat admin di Telegram',
            cta: '@absolutecinemaid →',
            href: 'https://t.me/absolutecinemaid',
            accent: 'rgba(99, 102, 241, 0.22)'  // indigo
        },
        {
            label: 'ADVERTISEMENT',
            emoji: '⭐',
            text: 'Dapetin notifikasi film baru setiap hari — gratis!',
            cta: '@absolutecinemaid →',
            href: 'https://t.me/absolutecinemaid',
            accent: 'rgba(168, 85, 247, 0.22)'  // purple
        },
        {
            label: 'ADVERTISEMENT',
            emoji: '🔔',
            text: 'Subtitle Indonesia lengkap — update tiap jam',
            cta: '@absolutecinemaid →',
            href: 'https://t.me/absolutecinemaid',
            accent: 'rgba(59, 130, 246, 0.22)'  // blue
        }
    ];

    function buildPromoHTML(promo) {
        return `
            <div class="ad-stadium-track">
                <a href="${promo.href}" target="_blank" rel="noopener noreferrer"
                   class="ad-stadium-fallback-link"
                   style="--promo-accent: ${promo.accent};">
                    <span class="ad-stadium-label">${promo.label}</span>
                    <span class="ad-stadium-text">${promo.emoji} ${promo.text}</span>
                    <span class="ad-stadium-cta">${promo.cta}</span>
                </a>
            </div>
        `;
    }

    function clearSlot(slot) {
        slot.querySelectorAll('iframe').forEach(f => f.remove());
        slot.querySelectorAll('[id^="container-"]').forEach(c => c.remove());
        slot.querySelectorAll('script').forEach(s => s.remove());
        slot.classList.remove(
            'ad-stadium-loaded', 'ad-stadium-fallback', 'ad-stadium-out',
            'ad-stadium-active', 'ad-stadium-real'
        );
    }

    function startRotatingCarousel(slot, startIndex = 0) {
        let idx = startIndex % PROMOS.length;
        let cycling = true;
        let currentAd = null;

        function showPromo(i, isFirst = false) {
            if (!cycling) return;
            const promo = PROMOS[i];
            clearSlot(slot);
            slot.classList.add('ad-stadium-fallback');
            slot.innerHTML = buildPromoHTML(promo);

            // First show: slide in from right
            // Subsequent: already in position, just swap content
            if (isFirst) {
                slot.classList.add('ad-stadium-loaded');
            } else {
                // Brief fade transition for content swap
                slot.classList.add('ad-stadium-loaded');
            }
        }

        function nextCycle() {
            if (!cycling) return;
            // Phase 1: slide out left (0.9s) — only on inner track, container stays static
            slot.classList.add('ad-stadium-out');
            slot.classList.remove('ad-stadium-loaded');

            // Phase 2: after slide-out, snap inner track to right off-screen (no transition)
            setTimeout(() => {
                if (!cycling) return;
                slot.classList.remove('ad-stadium-out');
                const track = slot.querySelector('.ad-stadium-track');
                if (track) {
                    track.style.transition = 'none';
                    track.style.transform = 'translateX(110%) scale(0.92)';
                    track.style.opacity = '0';
                }
                // Force reflow so browser registers the snap
                void slot.offsetWidth;

                // Phase 3: re-enable transition on track, swap content, slide in from right
                requestAnimationFrame(() => {
                    if (!cycling) return;
                    if (track) {
                        track.style.transition = '';
                        track.style.transform = '';
                        track.style.opacity = '';
                    }
                    idx = (idx + 1) % PROMOS.length;
                    showPromo(idx);
                });
            }, 900);
        }

        // Initial show
        showPromo(idx, true);

        // Start cycling
        const interval = setInterval(nextCycle, HOLD_MS + SLIDE_MS);

        // Expose stop function so real ad can take over
        slot._stopCarousel = function() {
            cycling = false;
            clearInterval(interval);
        };
    }

    function showRealAd(slot, container) {
        slot._stopCarousel && slot._stopCarousel();
        clearSlot(slot);
        slot.classList.remove('ad-stadium-fallback');
        slot.classList.add('ad-stadium-real');
        // Wrap real ad in track so slide animation works same as fallback
        const track = document.createElement('div');
        track.className = 'ad-stadium-track';
        track.appendChild(container);
        slot.appendChild(track);
        // Slide in
        requestAnimationFrame(() => {
            slot.classList.add('ad-stadium-loaded');
        });
    }

    function tryLoadAdsterra(slot, onSuccess) {
        const key = slot.dataset.key;
        const w = parseInt(slot.dataset.w) || 728;
        const h = parseInt(slot.dataset.h) || 90;
        if (!key) return;

        const container = document.createElement('div');
        container.id = 'container-' + key;
        container.style.cssText = `width:100%;height:100%;margin:0;display:flex;align-items:center;justify-content:center;min-height:90px;`;
        slot.appendChild(container);

        // Inject atOptions
        const cfgScript = document.createElement('script');
        cfgScript.text = `atOptions = { 'key' : '${key}', 'format' : 'iframe', 'height' : ${h}, 'width' : ${w}, 'params' : {} };`;
        document.head.appendChild(cfgScript);

        // Inject invoke.js
        const s = document.createElement('script');
        s.src = `https://www.profitabledisplaynetwork.com/${key}/invoke.js?_=${Date.now()}`;
        s.async = true;
        s.onerror = () => console.log('[StadiumAd] invoke.js failed for', key);
        document.head.appendChild(s);

        // Watch for real iframe
        const start = Date.now();
        const check = setInterval(() => {
            const iframe = container.querySelector('iframe');
            const hasReal = iframe && iframe.offsetHeight > 5;
            if (hasReal) {
                clearInterval(check);
                iframe.style.cssText = `width:${w}px;height:${h}px;max-width:100%;border:0;display:block;margin:0 auto;border-radius:6px;`;
                onSuccess(container);
            } else if (Date.now() - start > ADSTERRA_TIMEOUT_MS) {
                clearInterval(check);
                // Failed — clear Adsterra artifacts, carousel will keep running
                container.remove();
                cfgScript.remove();
                s.remove();
                console.log('[StadiumAd] Adsterra timeout for', key, '— carousel continues');
            }
        }, 250);
    }

    function loadStadiumSlot(slot, startIndex = 0) {
        // Start carousel immediately so user sees movement
        startRotatingCarousel(slot, startIndex);

        // In parallel, try Adsterra
        tryLoadAdsterra(slot, (container) => {
            // Real ad loaded — smoothly hand off
            const adEl = container.querySelector('iframe');
            if (!adEl) return;
            console.log('[StadiumAd] Real ad loaded for', slot.id);

            // Animate out current promo, then swap to real ad
            slot.classList.add('ad-stadium-out');
            slot.classList.remove('ad-stadium-loaded');
            setTimeout(() => {
                showRealAd(slot, container);
            }, SLIDE_MS);
        });
    }

    function boot() {
        const slots = document.querySelectorAll('.ad-stadium');
        console.log('[StadiumAd] Initialized', slots.length, 'slots');

        // Offset second slot by 2 promos so they don't appear stacked/in sync
        slots.forEach((slot, i) => {
            const offset = i * 2;  // 0, 2, 0, 2, ...
            loadStadiumSlot(slot, offset);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
