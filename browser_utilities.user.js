// ==UserScript==
// @name         Browser Utilities
// @namespace    shortcuts-dev
// @version      7.2.1
// @author       Tojioo
// @license      LicenseRef-ANC-SA-1.0
// @description  Hamburger menu with page tools: Copy HTML, lightweight web inspector with JSON export, image browser, cookie banner handling, and themes.
// @match        *://*/*
// @run-at       document-start
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @updateURL    https://raw.githubusercontent.com/Tojioo/Browser-Utilities/main/browser_utilities.user.js
// @downloadURL  https://raw.githubusercontent.com/Tojioo/Browser-Utilities/main/browser_utilities.user.js
// ==/UserScript==

/*
Copyright (C) 2026 Tojioo. All rights reserved.

This software is licensed under the Attribution-NonCommercial-ShareAlike Source
License v1.0 (ANC-SA-1.0). You may use, distribute verbatim copies, and create
modified versions for non-commercial purposes only, provided that attribution to
the original author and a reference to the original repository are retained.
Commercial use is prohibited. See the LICENSE file for the full terms and
conditions.
*/

(function () {
    'use strict';
    if (window.top !== window.self) return;  // Avoid duplicate menus: run only in the top frame, never in embedded iframes
    if (window.__suLoaded) return;
    window.__suLoaded = true;

    // ─── Constants ─────────────────────────────────────────────────────────
    const isRoutineHubShortcut = /^routinehub\.co$/.test(location.hostname) && /^\/shortcut\//.test(location.pathname);
    const FAB_SIZE = 44, FAB_MARGIN = 18;
    const LIST_CAP = 200, IMG_VIEW_CAP = 500;

    const BANNER_SELECTORS = [
        '#onetrust-banner-sdk', '#onetrust-consent-sdk',
        '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
        '.cc-window', '.cc-banner',
        '#cookie-law-info-bar', '#cookie-law-info-again',
        '.cmplz-cookiebanner', '#cmplz-cookiebanner-container',
        '.qc-cmp2-container', '.qc-cmp-cleanslate',
        '#truste-consent-track', '.fc-consent-root', '#didomi-host',
        '.iubenda-cs-container', '[id^="sp_message_container_"]',
        '.osano-cm-window', '#hs-eu-cookie-confirmation', '#gdpr-cookie-message',
        '.cookie-notice', '#cookie-notice',
        '.cookie-banner', '.cookies-banner', '.cookie-consent',
        '[aria-label="cookieconsent" i]',
    ];
    const UNLOCK_CSS = 'html.cookie-consent-open,body.cookie-consent-open,body.modal-open.cookie,body.no-scroll.cookie{overflow:auto !important;}';

    const LANDMARK_ROLES = { banner:1, navigation:1, main:1, complementary:1, contentinfo:1, search:1, form:1, region:1 };

    const THEMES = {
        purple:   { accent: '#6d28d9', rgb: '109,40,217' },
        blue:     { accent: '#2563eb', rgb: '37,99,235'  },
        teal:     { accent: '#00555A', rgb: '0,85,90'     },
        green:    { accent: '#059669', rgb: '5,150,105'  },
        pink:     { accent: '#db2777', rgb: '219,39,119' },
        orange:   { accent: '#ea580c', rgb: '234,88,12'  },
        graphite: { accent: '#4b5563', rgb: '75,85,99'   },
    };

    const SECTION_INFO = {
        Identity:      'Core identifying details of the page: its title, address, protocol, language, and character encoding.',
        Meta:          'Metadata from meta tags used by browsers, search engines, and social link previews.',
        Security:      'Client-visible security signals: secure context, transport, any CSP meta tag, referrer policy, and cross-origin isolation. Real HTTP response headers are not readable from a userscript.',
        DOM:           'Counts of element types currently present in the live document tree.',
        Resources:     'External and inline scripts, stylesheets, and the third-party domains they load from. Tap a count to list the items.',
        Performance:   'Navigation timing. Load Time is the full page load duration. TTFB is the time to first byte from the server.',
        Links:         'Anchor links on the page, split into internal and external, plus the external domains they point to.',
        Images:        'Image summary for the page. Use Browse all images for per-image previews, sizes, origins, ordering, filtering, and download.',
        Fonts:         'Web fonts loaded through the CSS Font Loading API, listed by family.',
        Accessibility: 'Basic accessibility signals: document language, landmark elements, heading structure, and images missing alt text.',
        Storage:       'Client-side storage for this origin: cookie count plus localStorage and sessionStorage key counts.',
        Display:       'Viewport size, physical screen size, and device pixel ratio of the current device.',
    };

    // ─── State ─────────────────────────────────────────────────────────────
    let panelOpen     = false;
    let pinned        = true;
    let corner        = 'br';
    let codeBlockWrap = true;
    let cookieMode    = 'off';        // 'off' | 'once' | 'always'
    let theme         = 'teal';       // named key or 'custom'
    let customHex     = '#00555a';
    let customColors  = [];           // user-saved custom accent hexes
    let downloadSource = 'origin';    // 'origin' | 'website'
    let downloadLocation = 'file';    // 'file' | 'photos'

    let sectionMap   = {};            // name -> data object (also the JSON model)
    let imageEntries = [];            // full image list for the browser view
    let imagesTotal  = 0;
    let collapsed    = {};            // persisted collapsed section names

    let stack    = [];                // view-name stack
    let viewEls  = [];                // matching view elements
    let imagesBodyEl = null;          // body of the live images view, for re-render
    let imgSort   = { key: 'dom', dir: 'asc' };
    let imgFilter = 'all';
    let imgView   = 'list';           // 'list' | 'grid' | 'compact'
    let sheetH    = 82;               // sheet height in vh, drag-adjustable

    let activePopover = null, currentAnchor = null;

    function applyConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        if (typeof cfg.pinned === 'boolean')                 pinned        = cfg.pinned;
        if (['br','bl','tr','tl'].includes(cfg.corner))      corner        = cfg.corner;
        if (typeof cfg.codeBlockWrap === 'boolean')          codeBlockWrap = cfg.codeBlockWrap;
        if (['off','once','always'].includes(cfg.cookieMode))cookieMode    = cfg.cookieMode;
        if (THEMES[cfg.theme] || cfg.theme === 'custom')      theme         = cfg.theme;
        if (typeof cfg.customHex === 'string' && /^#[0-9a-f]{6}$/i.test(cfg.customHex)) customHex = cfg.customHex.toLowerCase();
        if (Array.isArray(cfg.customColors)) customColors = cfg.customColors.filter(h => /^#[0-9a-f]{6}$/i.test(h)).map(h => h.toLowerCase());
        if (['dom','origin','alt','size','load'].includes(cfg.imgSortKey)) imgSort.key = cfg.imgSortKey;
        if (['asc','desc'].includes(cfg.imgSortDir)) imgSort.dir = cfg.imgSortDir;
        if (['all','missing-alt','has-alt','cross','same','large','small'].includes(cfg.imgFilter)) imgFilter = cfg.imgFilter;
        if (['list','grid','compact'].includes(cfg.imgView)) imgView = cfg.imgView;
        if (typeof cfg.sheetH === 'number' && cfg.sheetH >= 30 && cfg.sheetH <= 94) sheetH = cfg.sheetH;
        if (['origin','website'].includes(cfg.downloadSource))     downloadSource   = cfg.downloadSource;
        if (['file','photos'].includes(cfg.downloadLocation))      downloadLocation = cfg.downloadLocation;
    }
    try { applyConfig(JSON.parse(localStorage.getItem('su-config') || '{}')); } catch (e) {}
    collapsed = readStore('su-collapsed');

    function persist() {
        const data = JSON.stringify({ pinned, corner, codeBlockWrap, cookieMode, theme, customHex, customColors, downloadSource, downloadLocation, imgSortKey: imgSort.key, imgSortDir: imgSort.dir, imgFilter, imgView, sheetH });
        try { localStorage.setItem('su-config', data); } catch (e) {}
        try { if (typeof GM !== 'undefined' && GM && GM.setValue) GM.setValue('su-config', data); } catch (e) {}  // shared store keeps settings consistent across all sites
    }
    function readStore(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { return {}; } }
    function writeStore(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }

    function normHex(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); return m ? '#' + m[1].toLowerCase() : null; }
    function hexToRgb(hex) { const n = parseInt(normHex(hex).slice(1), 16); return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255); }
    function accentOf(name) {
        if (name === 'custom') return { accent: customHex, rgb: hexToRgb(customHex) };
        const t = THEMES[name] || THEMES.teal; return { accent: t.accent, rgb: t.rgb };
    }
    function applyTheme(name) {
        const a = accentOf(name), r = document.documentElement.style;
        r.setProperty('--su-accent', a.accent);
        r.setProperty('--su-accent-18', `rgba(${a.rgb},0.18)`);
        r.setProperty('--su-accent-28', `rgba(${a.rgb},0.28)`);
        void document.documentElement.offsetHeight;  // Needed so iOS Safari repaints var-driven colors immediately
    }
    applyTheme(theme);

    // ─── Styles ────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        #su-root, #su-root *, .su-popover, .su-popover *, #su-preview, #su-preview * {
            box-sizing: border-box; font-family: -apple-system, 'SF Pro Text', sans-serif;
        }
        #su-fab {
            position: fixed; z-index: 2147483647;
            width: ${FAB_SIZE}px; height: ${FAB_SIZE}px;
            border-radius: 12px; background: #111; border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            transition: bottom .3s cubic-bezier(.34,1.2,.64,1), top .3s cubic-bezier(.34,1.2,.64,1),
                        left .3s cubic-bezier(.34,1.2,.64,1), right .3s cubic-bezier(.34,1.2,.64,1),
                        transform .15s ease, background .15s ease, opacity .15s ease;
            touch-action: none; -webkit-tap-highlight-color: transparent;
        }
        #su-fab:hover  { background: #222; transform: scale(1.06); }
        #su-fab:active { transform: scale(0.96); }
        #su-fab.hidden { opacity: 0; pointer-events: none; transform: scale(0.6); }
        #su-fab svg { transition: transform .2s ease; pointer-events: none; }
        #su-fab.menu-open svg { transform: rotate(90deg); }
        #su-fab[data-corner="br"] { bottom: calc(${FAB_MARGIN}px + var(--su-nudge-y,0px)); right: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); }
        #su-fab[data-corner="bl"] { bottom: calc(${FAB_MARGIN}px + var(--su-nudge-y,0px)); left: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); }
        #su-fab[data-corner="tr"] { top: calc(${FAB_MARGIN}px + var(--su-nudge-y,0px)); right: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); }
        #su-fab[data-corner="tl"] { top: calc(${FAB_MARGIN}px + var(--su-nudge-y,0px)); left: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); }
        #su-fab-dot {
            position: absolute; top: 5px; right: 5px; width: 8px; height: 8px; border-radius: 50%;
            background: var(--su-accent); opacity: 0; transform: scale(0);
            transition: opacity .2s ease, transform .2s ease; pointer-events: none;
        }
        #su-fab.overlay-active #su-fab-dot { opacity: 1; transform: scale(1); }
        #su-fab.unpinned::after {
            content: ''; position: absolute; inset: -3px; border-radius: 14px;
            border: 1.5px dashed rgba(255,255,255,0.25); pointer-events: none;
        }

        #su-panel {
            position: fixed; z-index: 2147483646; width: 230px; background: #111;
            border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,0.45); overflow: hidden;
            transform: scale(0.85); opacity: 0; pointer-events: none;
            transition: transform .2s cubic-bezier(.34,1.56,.64,1), opacity .15s ease;
        }
        #su-panel.open { transform: scale(1); opacity: 1; pointer-events: all; }
        #su-panel[data-corner="br"] { bottom: calc(${FAB_MARGIN+FAB_SIZE+10}px + var(--su-nudge-y,0px)); right: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); transform-origin: bottom right; }
        #su-panel[data-corner="bl"] { bottom: calc(${FAB_MARGIN+FAB_SIZE+10}px + var(--su-nudge-y,0px)); left: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); transform-origin: bottom left; }
        #su-panel[data-corner="tr"] { top: calc(${FAB_MARGIN+FAB_SIZE+10}px + var(--su-nudge-y,0px)); right: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); transform-origin: top right; }
        #su-panel[data-corner="tl"] { top: calc(${FAB_MARGIN+FAB_SIZE+10}px + var(--su-nudge-y,0px)); left: calc(${FAB_MARGIN}px + var(--su-nudge-x,0px)); transform-origin: top left; }

        .su-item {
            display: flex; align-items: center; gap: 10px; padding: 12px 14px;
            color: #f0f0f0; font-size: 13px; font-weight: 500; cursor: pointer;
            border: none; background: none; width: 100%; text-align: left;
            transition: background .12s ease; line-height: 1.2; -webkit-tap-highlight-color: transparent;
        }
        .su-item:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.07); }
        .su-item:hover  { background: rgba(255,255,255,0.08); }
        .su-item:active { background: rgba(255,255,255,0.14); }
        .su-item.active { background: var(--su-accent-18); }
        .su-item.active .su-item-icon { box-shadow: 0 0 0 2px rgba(255,255,255,0.25); }
        .su-item-icon { width: 28px; height: 28px; border-radius: 7px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: box-shadow .15s ease; }
        .su-item-label   { flex: 1; }
        .su-item-sublabel { font-size: 11px; color: #888; font-weight: 400; display: block; margin-top: 1px; }

        /* Overlay + sliding view stack */
        #su-overlay {
            position: fixed; inset: 0; z-index: 2147483645;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
            display: flex; align-items: flex-end; opacity: 0; pointer-events: none;
            transition: opacity .2s ease; overscroll-behavior: contain;
        }
        #su-overlay.open { opacity: 1; pointer-events: all; }
        #su-sheet {
            width: 100%; height: 82vh; background: #0e0e0e; border-radius: 20px 20px 0 0;
            overflow: hidden; position: relative;
            transform: translateY(40px); transition: transform .25s cubic-bezier(.34,1.2,.64,1);
        }
        #su-overlay.open #su-sheet { transform: translateY(0); }
        #su-skirt { position: absolute; left: 0; right: 0; bottom: 0; height: 260px; background: #0e0e0e; transform: translateY(100%); pointer-events: none; z-index: 0; }
        .su-views { position: absolute; inset: 0; overflow: hidden; }
        .su-view {
            position: absolute; inset: 0; display: flex; flex-direction: column;
            background: #0e0e0e; transition: transform .28s cubic-bezier(.34,1.05,.64,1);
            will-change: transform;
        }

        #su-grab { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); width: 40px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.22); z-index: 2; pointer-events: none; }
        .su-vhead { touch-action: none; }
        .su-vhead {
            flex: 0 0 auto; background: #0e0e0e; padding: 16px 18px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        .su-vtitle { font-size: 15px; font-weight: 600; color: #f0f0f0; letter-spacing: -0.01em; }
        .su-vhead-left { display: flex; align-items: center; gap: 10px; }
        .su-vhead-actions { display: flex; gap: 6px; align-items: center; }
        .su-vbody { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        #su-inspector-body { padding: 12px 0 80px; }

        .su-x {
            width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.1);
            border: none; cursor: pointer; color: #aaa; font-size: 14px;
            display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent;
        }
        .su-x:hover { background: rgba(255,255,255,0.16); }
        .su-icon-btn {
            width: 28px; height: 28px; border-radius: 6px; background: rgba(255,255,255,0.06);
            border: none; cursor: pointer; color: #aaa;
            display: flex; align-items: center; justify-content: center;
            transition: background .15s ease, color .15s ease; -webkit-tap-highlight-color: transparent; flex-shrink: 0;
        }
        .su-icon-btn:hover  { background: rgba(255,255,255,0.12); color: #fff; }
        .su-icon-btn:active { background: rgba(255,255,255,0.18); }
        .su-icon-btn.flash  { background: rgba(74,222,128,0.25); color: #4ade80; }
        .su-icon-btn.active { background: var(--su-accent-28); color: var(--su-accent); }

        .su-section { margin-bottom: 8px; }
        .su-section-header { display: flex; align-items: center; justify-content: space-between; padding: 0 18px; margin-bottom: 8px; gap: 8px; }
        .su-section-toggle {
            display: flex; align-items: center; gap: 7px; background: none; border: none; cursor: pointer;
            padding: 6px 0; flex: 1; min-width: 0; -webkit-tap-highlight-color: transparent;
        }
        .su-chevron { color: #555; flex-shrink: 0; transition: transform .18s ease; }
        .su-section.collapsed .su-chevron { transform: rotate(-90deg); }
        .su-section-title { font-size: 13px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #ededed; }
        .su-section-actions { display: flex; gap: 4px; }
        .su-section-body { padding: 0 18px; overflow: hidden; }
        .su-section.collapsed .su-section-body { display: none; }

        .su-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.05); gap: 12px; width: 100%; }
        .su-row:last-child { border-bottom: none; }
        .su-row-key { font-size: 12px; color: #666; font-weight: 500; flex-shrink: 0; padding-top: 1px; }
        .su-row-val { font-size: 12px; color: #ccc; text-align: right; word-break: break-all; font-family: 'SF Mono','Menlo',monospace; }
        button.su-row { background: none; border-top: none; border-left: none; border-right: none; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
        button.su-row .su-row-val { display: flex; align-items: center; gap: 6px; color: #9aa; }
        .su-mini-chevron { color: #666; transition: transform .18s ease; }
        button.su-row.open .su-mini-chevron { transform: rotate(90deg); }
        .su-sublist { display: none; padding: 2px 0 8px; }
        .su-sublist.open { display: block; }
        .su-subitem { font-size: 11px; color: #9ab; font-family: 'SF Mono','Menlo',monospace; padding: 4px 0 4px 12px; word-break: break-all; border-bottom: 1px solid rgba(255,255,255,0.04); }
        .su-subitem:last-child { border-bottom: none; }

        .su-chip { display: inline-block; padding: 2px 7px; border-radius: 5px; font-size: 11px; font-weight: 600; font-family: -apple-system,sans-serif; }
        .su-chip-green  { background: rgba(74,222,128,0.15);  color: #4ade80; }
        .su-chip-yellow { background: rgba(250,204,21,0.15);  color: #facc15; }
        .su-chip-red    { background: rgba(248,113,113,0.15); color: #f87171; }
        .su-chip-blue   { background: rgba(96,165,250,0.15);  color: #60a5fa; }
        .su-chip-gray   { background: rgba(255,255,255,0.08); color: #999; }
        .su-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 4px 18px 12px; }

        .su-browse {
            display: flex; align-items: center; justify-content: space-between;
            width: 100%; margin-top: 6px; padding: 11px 12px; border-radius: 9px;
            background: rgba(255,255,255,0.05); border: none; cursor: pointer;
            color: #ddd; font-size: 12px; font-weight: 600; font-family: inherit; -webkit-tap-highlight-color: transparent;
        }
        .su-browse:hover { background: rgba(255,255,255,0.09); }

        /* Image browser */
        .su-img-cap { font-size: 11px; color: #777; padding: 10px 18px; }
        .su-img {
            display: flex; align-items: center; gap: 12px; width: 100%;
            padding: 10px 18px; border-bottom: 1px solid rgba(255,255,255,0.05);
            background: none; border-left: none; border-right: none; border-top: none;
            cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent;
        }
        .su-img:active { background: rgba(255,255,255,0.05); }
        .su-img-info { flex: 1; min-width: 0; }
        .su-img-dims { font-size: 12px; color: #9ab; font-family: 'SF Mono','Menlo',monospace; }
        .su-img-host { font-size: 11px; color: #777; font-family: 'SF Mono','Menlo',monospace; word-break: break-all; margin-top: 2px; }
        .su-img-alt  { font-size: 11px; color: #888; margin-top: 2px; }
        .su-img-alt.muted { color: #555; font-style: italic; }
        .su-img-load { font-size: 11px; color: #666; margin-top: 2px; }
        .su-img-thumb {
            width: 52px; height: 52px; border-radius: 8px; object-fit: cover; flex-shrink: 0;
            background: #1a1a1a; border: 1px solid rgba(255,255,255,0.08);
        }
        .su-img-dl { width: 30px; height: 30px; }
        .su-img.compact { padding: 6px 18px; gap: 10px; }
        .su-img.compact .su-img-thumb { width: 34px; height: 34px; }
        .su-img.compact .su-img-host { margin-top: 0; }
        .su-img-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; padding: 4px 14px 0; }
        .su-img-cell { position: relative; aspect-ratio: 1 / 1; border-radius: 10px; overflow: hidden; background: #1a1a1a; border: 1px solid rgba(255,255,255,0.08); cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; }
        .su-img-cell.noalt { border-color: rgba(248,113,113,0.4); }
        .su-img-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .su-cell-dl { position: absolute; bottom: 4px; right: 4px; width: 26px; height: 26px; background: rgba(0,0,0,0.55); border-radius: 6px; color: #fff; display: flex; align-items: center; justify-content: center; }
        .su-cell-badge { position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.6); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 6px; font-family: -apple-system, sans-serif; }

        /* Settings */
        #su-set-body { padding: 14px 0; }
        .su-set-footer { flex: 0 0 auto; display: flex; justify-content: flex-start; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); background: #0e0e0e; }
        .su-group { margin-bottom: 18px; }
        .su-group-title { font-size: 13px; font-weight: 700; letter-spacing: 0; text-transform: none; color: #ededed; padding: 0 18px; margin-bottom: 8px; }
        .su-set-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.05); }
        .su-set-col { padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.05); }
        .su-set-label { font-size: 13px; color: #e8e8e8; line-height: 1.3; }
        .su-set-sub { font-size: 11px; color: #888; margin-top: 2px; line-height: 1.3; }
        .su-set-col .su-set-label { margin-bottom: 9px; }

        .su-switch { width: 44px; height: 26px; border-radius: 13px; flex-shrink: 0; background: rgba(255,255,255,0.15); position: relative; cursor: pointer; border: none; transition: background .18s ease; -webkit-tap-highlight-color: transparent; }
        .su-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .18s cubic-bezier(.34,1.4,.64,1); }
        .su-switch.on { background: var(--su-accent); }
        .su-switch.on::after { transform: translateX(18px); }

        .su-seg { display: flex; background: rgba(255,255,255,0.06); border-radius: 9px; padding: 3px; gap: 3px; }
        .su-seg-btn { flex: 1; padding: 8px 6px; border: none; background: none; color: #aaa; font-size: 12px; font-weight: 600; border-radius: 7px; cursor: pointer; font-family: inherit; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
        .su-seg-btn.active { background: var(--su-accent); color: #fff; }

        .su-link-btn { background: none; border: 1px solid rgba(255,255,255,0.12); color: #bbb; border-radius: 9px; padding: 10px 12px; font-size: 12px; font-weight: 600; cursor: pointer; width: 100%; text-align: left; font-family: inherit; -webkit-tap-highlight-color: transparent; }
        .su-link-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }

        .su-swatches { display: flex; gap: 10px; flex-wrap: wrap; }
        .su-swatch { width: 34px; height: 34px; border-radius: 9px; border: 2px solid transparent; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .su-swatch.active { border-color: #fff; box-shadow: 0 0 0 2px #0e0e0e, 0 0 0 4px rgba(255,255,255,0.4); }
        .su-hex-row { display: flex; gap: 8px; margin-top: 12px; }
        .su-hex-input { flex: 1; min-width: 0; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 9px; color: #eee; padding: 9px 11px; font-size: 13px; font-family: 'SF Mono','Menlo',monospace; }
        .su-hex-input:focus { outline: none; border-color: var(--su-accent); }
        .su-swatch-add { display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 22px; font-weight: 300; line-height: 1; background: rgba(255,255,255,0.05); border: 1.5px dashed rgba(255,255,255,0.3); }
        .su-color-picker { display: none; align-items: center; gap: 8px; margin-top: 12px; }
        .su-color-picker.open { display: flex; }
        .su-color-swatch-input { width: 40px; height: 40px; flex-shrink: 0; border: none; background: none; padding: 0; border-radius: 9px; cursor: pointer; }

        .su-btn { padding: 9px 16px; border-radius: 9px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; -webkit-tap-highlight-color: transparent; }
        .su-btn-secondary { background: rgba(255,255,255,0.08); color: #ccc; }
        .su-btn-secondary:hover { background: rgba(255,255,255,0.14); }

        /* Skeleton placeholders */
        .su-sk { display: inline-block; height: 11px; border-radius: 4px; background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.13), rgba(255,255,255,0.05)); background-size: 200% 100%; animation: su-shimmer 1.1s linear infinite; }
        .su-sk-title { width: 78px; height: 8px; }
        .su-sk-k { width: 84px; }
        .su-sk-v { width: 120px; }
        @keyframes su-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

        /* Popover */
        .su-popover {
            position: fixed; z-index: 2147483648; min-width: 180px; max-width: 280px; max-height: 300px; overflow-y: auto;
            background: #1a1a1a; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            transform: scale(0.92); opacity: 0; pointer-events: none;
            transition: transform .15s cubic-bezier(.34,1.4,.64,1), opacity .12s ease; -webkit-overflow-scrolling: touch;
        }
        .su-popover.show { transform: scale(1); opacity: 1; pointer-events: all; }
        .su-popover-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 14px; background: none; border: none; color: #ddd; font-size: 12px; text-align: left; cursor: pointer; font-family: inherit; -webkit-tap-highlight-color: transparent; }
        .su-popover-item:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.05); }
        .su-popover-item:hover  { background: rgba(255,255,255,0.08); color: #fff; }
        .su-popover-item.flash  { background: rgba(74,222,128,0.2); color: #4ade80; }
        .su-popover-item.sel { color: var(--su-accent); }
        .su-pop-ic { width: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: inherit; }
        .su-pop-tail { margin-left: auto; color: #888; font-size: 11px; }
        .su-popover-info { padding: 12px 14px; font-size: 12px; color: #cfcfcf; line-height: 1.5; }


        /* Full image preview */
        #su-preview { position: fixed; inset: 0; z-index: 2147483649; background: rgba(0,0,0,0.94); display: none; flex-direction: column; }
        #su-preview.open { display: flex; }
        #su-preview-bar { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 14px; background: rgba(20,20,20,0.6); }
        #su-preview-meta { flex: 0 0 auto; text-align: center; padding: 12px 16px 2px; font-size: 14px; color: #9a9a9a; font-family: 'SF Mono','Menlo',monospace; }
        #su-preview-meta b { color: #fff; font-weight: 700; }
        #su-preview-strip { flex: 0 0 auto; display: none; gap: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 10px 14px; background: rgba(20,20,20,0.4); }
        .su-prev-thumb { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: none; cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; }
        .su-prev-thumb img { width: 54px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; background: #1a1a1a; }
        .su-prev-thumb.active img { border-color: var(--su-accent); }
        .su-prev-thumb span { font-size: 10px; color: #888; font-family: 'SF Mono','Menlo',monospace; }
        .su-prev-thumb.active span { color: var(--su-accent); }
        #su-preview-stage { flex: 1 1 auto; overflow: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; display: flex; align-items: center; justify-content: center; padding: 16px; }
        #su-preview-img { display: block; max-width: 100%; max-height: 100%; object-fit: contain; background: rgba(255,255,255,0.03); }
        .su-prev-btn { display: flex; align-items: center; gap: 7px; background: rgba(255,255,255,0.12); border: none; color: #fff; border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; -webkit-tap-highlight-color: transparent; }
        .su-prev-btn:hover { background: rgba(255,255,255,0.2); }
    `;
    (document.head || document.documentElement).appendChild(style);

    // ─── Icons ─────────────────────────────────────────────────────────────
    const iconCopy    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const iconCopyC   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const iconDesc    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
    const iconInspect = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>`;
    const iconGear    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
    const iconJson    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/></svg>`;
    const iconKebab   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>`;
    const iconOverall = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
    const iconInfo    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    const iconBack    = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    const iconChevD   = `<svg class="su-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    const iconChevR   = `<svg class="su-mini-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
    const iconDownload= `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
    const iconExternal= `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    const iconOrder   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v16"/><polyline points="4 8 8 4 12 8"/><path d="M16 20V4"/><polyline points="12 16 16 20 20 16"/></svg>`;
    const iconFilter  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>`;
    const iconImage   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
    const iconLayout  = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;
    const iconClose   = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
    const iconRefresh = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    const iconGrid    = iconLayout;
    const iconList    = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
    const iconCompact = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="13" x2="20" y2="13"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`;
    const iconArrowUp = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>`;
    const iconArrowDown=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/></svg>`;

    // ─── UI initialisation (runs as soon as document.body exists) ──────────
    function initUI() {
        if (document.getElementById('su-root')) return;  // Guard against a second injection in the same document
        // ─── Build root DOM ────────────────────────────────────────────────────
        const root = document.createElement('div');
        root.id = 'su-root';
        document.body.appendChild(root);

        const fab = document.createElement('button');
        fab.id = 'su-fab';
        if (!pinned) fab.classList.add('unpinned');
        fab.innerHTML = `<svg width="18" height="14" viewBox="0 0 18 14"><rect x="0" y="0" width="18" height="2" rx="1" fill="white"/><rect x="0" y="6" width="18" height="2" rx="1" fill="white"/><rect x="0" y="12" width="18" height="2" rx="1" fill="white"/></svg><span id="su-fab-dot"></span>`;
        root.appendChild(fab);

        const panel = document.createElement('div');
        panel.id = 'su-panel';
        root.appendChild(panel);

        function makeItem(iconBg, iconSvg, label, sublabel) {
            const btn = document.createElement('button');
            btn.className = 'su-item';
            btn.innerHTML = `<span class="su-item-icon" style="background:${iconBg}">${iconSvg}</span><span class="su-item-label">${label}${sublabel ? `<span class="su-item-sublabel">${sublabel}</span>` : ''}</span>`;
            panel.appendChild(btn);
            return btn;
        }
        const btnCopyDesc = isRoutineHubShortcut ? makeItem('#ee3535', iconDesc, 'Copy Description', 'RoutineHub shortcut') : null;
        const btnInspect  = makeItem('#6d28d9', iconInspect, 'Inspect Page', 'Lightweight web inspector');
        const btnImages   = makeItem('#0ea5e9', iconImage, 'Browse Images', 'All images on the page');
        const btnSettings = makeItem('#3f3f46', iconGear, 'Settings', 'Preferences and cookies');

        const overlay = document.createElement('div');
        overlay.id = 'su-overlay';
        overlay.innerHTML = `<div id="su-sheet"><div id="su-grab"></div><div class="su-views"></div></div><div id="su-skirt"></div>`;
        root.appendChild(overlay);
        const sheet   = overlay.querySelector('#su-sheet');
        const viewsEl = overlay.querySelector('.su-views');
        applySheetHeight();

        const popover = document.createElement('div');
        popover.className = 'su-popover';
        document.body.appendChild(popover);

        const preview = document.createElement('div');
        preview.id = 'su-preview';
        preview.innerHTML = `
        <div id="su-preview-bar">
            <button class="su-prev-btn" data-action="prev-origin">${iconExternal}<span>Open origin</span></button>
            <button class="su-prev-btn" data-action="prev-download">${iconDownload}<span>Download</span></button>
            <button class="su-prev-btn" data-action="prev-close">${iconClose}</button>
        </div>
        <div id="su-preview-meta"></div>
        <div id="su-preview-strip"></div>
        <div id="su-preview-stage"><img id="su-preview-img" alt=""></div>`;
        document.body.appendChild(preview);

        // ─── Corner helpers ────────────────────────────────────────────────────
        function applyCorner(c) { corner = c; if (fab) fab.dataset.corner = c; if (panel) panel.dataset.corner = c; }
        function applySheetHeight() { if (sheet) sheet.style.height = sheetH + 'vh'; }
        applyCorner(corner);

        function cornerPoint(c) {
            const o = FAB_MARGIN + FAB_SIZE / 2;
            return { x: c[1] === 'r' ? innerWidth - o : o, y: c[0] === 'b' ? innerHeight - o : o };
        }
        const SU_INTERACTIVE = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="tab"],[role="textbox"],[role="search"],[role="searchbox"],[contenteditable="true"]';
        // Returns the rect of a bar/control under corner c, else null. Catches bottom bars that are statically
        // positioned inside a fixed app shell (common in SPAs), which a position check on ancestors would miss.
        function cornerObstruction(c) {
            const p = cornerPoint(c);
            let els; try { els = document.elementsFromPoint(p.x, p.y); } catch (e) { return null; }
            let hit = null;
            for (const el of els) {
                if (root && root.contains(el)) continue;                          // ignore our own menu
                if (el === document.body || el === document.documentElement) break; // reached page background
                const r0 = el.getBoundingClientRect();
                if (r0.width >= innerWidth * 0.95 && r0.height >= innerHeight * 0.85) break; // full-screen content or shell
                let pos = ''; try { pos = getComputedStyle(el).position; } catch (e) {}
                const ctrl = el.closest(SU_INTERACTIVE);
                if (ctrl || pos === 'fixed' || pos === 'sticky') { hit = ctrl || el; break; }
            }
            if (!hit) return null;
            let bar = hit, n = hit.parentElement;
            while (n && n !== document.body && n !== document.documentElement) {   // grow to the whole bar container
                const r = n.getBoundingClientRect();
                if (r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.85) break;
                if (r.left <= p.x && r.right >= p.x && r.top <= p.y && r.bottom >= p.y && r.width > 8 && r.height > 8) bar = n;
                n = n.parentElement;
            }
            return bar.getBoundingClientRect();
        }
        function setNudge(x, y) {
            root.style.setProperty('--su-nudge-x', x + 'px');
            root.style.setProperty('--su-nudge-y', y + 'px');
        }
        function reposition() {
            if (!fab || overlayOpen()) return;
            const obs = cornerObstruction(corner);
            if (!obs) { setNudge(0, 0); return; }                                 // corner clear: sit flush
            const GAP = 8;
            const horizontal = obs.width >= obs.height;
            const amount = horizontal
                ? (corner[0] === 'b' ? (innerHeight - obs.top) : obs.bottom) - FAB_MARGIN + GAP
                : (corner[1] === 'r' ? (innerWidth - obs.left) : obs.right) - FAB_MARGIN + GAP;
            const limit = (horizontal ? innerHeight : innerWidth) * 0.45;
            if (amount > 0 && amount <= limit) { setNudge(horizontal ? 0 : amount, horizontal ? amount : 0); return; }
            for (const c of ['br', 'bl', 'tr', 'tl']) if (c !== corner && !cornerObstruction(c)) { setNudge(0, 0); applyCorner(c); return; }  // too tall to offset: relocate
        }
        [600, 1500, 3000].forEach(t => setTimeout(reposition, t));
        addEventListener('load', () => setTimeout(reposition, 300));
        let repoQueued = false;
        addEventListener('scroll', () => { if (repoQueued) return; repoQueued = true; requestAnimationFrame(() => { repoQueued = false; reposition(); }); }, { passive: true });

        // ─── Cookie banner handling ────────────────────────────────────────────
        function injectCookieCSS() {
            removeCookieCSS();
            const custom = readStore('su-cookie-custom')[location.hostname] || [];
            const el = document.createElement('style');
            el.id = 'su-cookie-style';
            el.textContent = BANNER_SELECTORS.concat(custom).join(',') + '{display:none !important;visibility:hidden !important;}\n' + UNLOCK_CSS;
            (document.head || document.documentElement).appendChild(el);
        }
        function removeCookieCSS() { const el = document.getElementById('su-cookie-style'); if (el) el.remove(); }
        function applyCookieMode() {
            removeCookieCSS();
            if (cookieMode === 'off') return;
            if (cookieMode === 'always') { injectCookieCSS(); return; }
            const seen = readStore('su-cookie-seen');
            if (seen[location.hostname]) injectCookieCSS();
            else { seen[location.hostname] = 1; writeStore('su-cookie-seen', seen); }
        }
        applyCookieMode();

        // ─── Utility ───────────────────────────────────────────────────────────
        function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
        function chipHtml(text, color) { return `<span class="su-chip su-chip-${color}">${escapeHtml(text)}</span>`; }
        function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

        function renderScalar(section, key, val) {
            if (val === null || val === undefined) return chipHtml('none', 'gray');
            if (section === 'Identity' && key === 'Protocol') return chipHtml(val, val === 'HTTPS' ? 'green' : 'red');
            if (section === 'Security') {
                if (val === 'Yes') return chipHtml('Yes', 'green');
                if (val === 'No')  return chipHtml('No', 'red');
                if (val === 'Present') return chipHtml('Present', 'blue');
            }
            if (section === 'Performance') {
                const ms = parseInt(val);
                const color = key === 'Load Time' ? (ms < 2000 ? 'green' : ms < 5000 ? 'yellow' : 'red') : (ms < 200 ? 'green' : ms < 600 ? 'yellow' : 'red');
                return chipHtml(val, color);
            }
            if (section === 'Meta' && key === 'OG Image' && typeof val === 'string' && val.startsWith('http')) return chipHtml('present', 'blue');
            return escapeHtml(trunc(val, 80));
        }
        function formatValue(val) { return Array.isArray(val) ? val.join('\n') : (val === null || val === undefined ? '' : String(val)); }
        function wrapCopy(text, lang) { return codeBlockWrap ? ('```' + lang + '\n' + text + '\n```') : text; }
        function copyToClipboard(text, anchor) {
            navigator.clipboard.writeText(text).then(() => {
                if (anchor) { anchor.classList.add('flash'); setTimeout(() => anchor.classList.remove('flash'), 800); }
            }).catch(() => {});
        }

        // ─── HTML → Markdown ───────────────────────────────────────────────────
        function htmlToMarkdown(rootEl) {
            function walk(node) {
                if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/[ \t\r\n]+/g, ' ');
                if (node.nodeType !== Node.ELEMENT_NODE) return '';
                const tag = node.tagName.toLowerCase();
                const children = () => Array.from(node.childNodes).map(walk).join('');
                switch (tag) {
                    case 'h1': return '\n# '      + children().trim() + '\n\n';
                    case 'h2': return '\n## '     + children().trim() + '\n\n';
                    case 'h3': return '\n### '    + children().trim() + '\n\n';
                    case 'h4': return '\n#### '   + children().trim() + '\n\n';
                    case 'h5': return '\n##### '  + children().trim() + '\n\n';
                    case 'h6': return '\n###### ' + children().trim() + '\n\n';
                    case 'p':  return children().trim() + '\n\n';
                    case 'br': return '\n';
                    case 'strong': case 'b': { const t = children().trim(); return t ? '**' + t + '**' : ''; }
                    case 'em':     case 'i': { const t = children().trim(); return t ? '_'  + t + '_'  : ''; }
                    case 'del':    case 's': { const t = children().trim(); return t ? '~~' + t + '~~' : ''; }
                    case 'code': { const inPre = node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre'; return inPre ? node.textContent : '`' + node.textContent + '`'; }
                    case 'pre': { const codeEl = node.querySelector('code'); const lang = (((codeEl && codeEl.className) || '').match(/language-(\w+)/) || [])[1] || ''; return '\n```' + lang + '\n' + (codeEl || node).textContent.trim() + '\n```\n\n'; }
                    case 'a': { const href = node.getAttribute('href') || ''; const text = children().trim(); return href ? '[' + text + '](' + href + ')' : text; }
                    case 'img': return '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
                    case 'ul': { const lis = Array.from(node.children).filter(c => c.tagName === 'LI'); return lis.length ? '\n' + lis.map(li => '- ' + walk(li).trim()).join('\n') + '\n\n' : ''; }
                    case 'ol': { const lis = Array.from(node.children).filter(c => c.tagName === 'LI'); return lis.length ? '\n' + lis.map((li, i) => (i + 1) + '. ' + walk(li).trim()).join('\n') + '\n\n' : ''; }
                    case 'li': return children();
                    case 'blockquote': return '\n> ' + children().trim().replace(/\n/g, '\n> ') + '\n\n';
                    case 'hr': return '\n---\n\n';
                    case 'script': case 'style': return '';
                    default: return children();
                }
            }
            return walk(rootEl).replace(/\n{3,}/g, '\n\n').trim();
        }

        // ─── Gather inspector data (single element pass) ───────────────────────
        function gatherSections() {
            const loc = location, doc = document, perf = window.performance;

            const identity = {};
            identity.Title    = doc.title || null;
            identity.Host     = loc.hostname;
            identity.Path     = loc.pathname || '/';
            if (loc.search) identity.Query = loc.search;
            identity.Protocol = loc.protocol.replace(':', '').toUpperCase();
            if (doc.documentElement.lang) identity.Language = doc.documentElement.lang;
            if (doc.characterSet)         identity.Charset  = doc.characterSet;
            if (doc.doctype)              identity.Doctype  = doc.doctype.name;
            const canon = doc.querySelector('link[rel="canonical"]'); if (canon) identity.Canonical = canon.href;

            const meta = {};
            const getMeta = n => { const el = doc.querySelector(`meta[name="${n}"]`) || doc.querySelector(`meta[property="${n}"]`); return el ? el.getAttribute('content') : null; };
            const mDesc = getMeta('description') || getMeta('og:description'); if (mDesc) meta.Description = mDesc;
            const mAuthor = getMeta('author');   if (mAuthor) meta.Author = mAuthor;
            const ogTitle = getMeta('og:title'); if (ogTitle) meta['OG Title'] = ogTitle;
            const ogImg   = getMeta('og:image'); if (ogImg)   meta['OG Image'] = ogImg;
            const vp      = getMeta('viewport'); if (vp)      meta.Viewport = vp;

            const c = { total:0, iframes:0, forms:0, inputs:0, inlineScripts:0, imgCount:0, imgNoAlt:0, links:0, linkInt:0, linkExt:0, mailto:0, tel:0 };
            const extDomains = new Set(), linkDomains = new Set(), imgOrigins = new Set();
            const scriptUrls = [], styleUrls = [];
            const headings = {}, landmarks = { MAIN:0, NAV:0, HEADER:0, FOOTER:0, ASIDE:0 };

            // Map image src -> load time once, for the browser view
            const resMap = {};
            if (perf && perf.getEntriesByType) {
                perf.getEntriesByType('resource').forEach(r => {
                    if (r.initiatorType === 'img' || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?|$)/i.test(r.name)) resMap[r.name] = Math.round(r.responseEnd);
                });
            }
            imageEntries = [];

            const all = doc.getElementsByTagName('*');
            c.total = all.length;
            for (let i = 0; i < all.length; i++) {
                const el = all[i], tag = el.tagName;
                if (tag === 'IMG') {
                    c.imgCount++;
                    if (!el.hasAttribute('alt')) c.imgNoAlt++;
                    const src = el.currentSrc || el.src || '';
                    let origin = '';
                    try { origin = new URL(src, loc.href).hostname; } catch (e) {}
                    if (origin) imgOrigins.add(origin);
                    if (imageEntries.length < IMG_VIEW_CAP && src) {
                        const r = el.getBoundingClientRect();
                        imageEntries.push({
                            el, src, origin,
                            nw: el.naturalWidth || 0, nh: el.naturalHeight || 0,
                            natural: el.naturalWidth ? (el.naturalWidth + '×' + el.naturalHeight) : 'not loaded',
                            rendered: (r.width && r.height) ? (Math.round(r.width) + '×' + Math.round(r.height)) : 'hidden',
                            rw: Math.round(r.width) || 0, rh: Math.round(r.height) || 0,
                            alt: el.getAttribute('alt') || '',
                            load: resMap[src] != null ? resMap[src] : null,
                            idx: imageEntries.length,
                        });
                    }
                } else if (tag === 'IFRAME') c.iframes++;
                else if (tag === 'FORM') c.forms++;
                else if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') c.inputs++;
                else if (tag === 'SCRIPT') {
                    if (el.src) { if (scriptUrls.length < LIST_CAP) scriptUrls.push(el.src); try { const u = new URL(el.src); if (u.hostname !== loc.hostname) extDomains.add(u.hostname); } catch (e) {} }
                    else c.inlineScripts++;
                } else if (tag === 'LINK' && el.rel === 'stylesheet') {
                    if (el.href) { if (styleUrls.length < LIST_CAP) styleUrls.push(el.href); try { const u = new URL(el.href); if (u.hostname !== loc.hostname) extDomains.add(u.hostname); } catch (e) {} }
                } else if (tag === 'A') {
                    const href = el.getAttribute('href');
                    if (href && href[0] !== '#') {
                        if (/^mailto:/i.test(href)) c.mailto++;
                        else if (/^tel:/i.test(href)) c.tel++;
                        else try {
                                const u = new URL(href, loc.href);
                                if (u.protocol === 'http:' || u.protocol === 'https:') {
                                    c.links++;
                                    if (u.hostname === loc.hostname) c.linkInt++; else { c.linkExt++; linkDomains.add(u.hostname); }
                                }
                            } catch (e) {}
                    }
                } else if (tag.length === 2 && tag[0] === 'H' && tag >= 'H1' && tag <= 'H6') headings[tag] = (headings[tag] || 0) + 1;
                else if (landmarks[tag] !== undefined) landmarks[tag]++;
            }

            let ariaLandmarks = 0;
            doc.querySelectorAll('[role]').forEach(el => { if (LANDMARK_ROLES[(el.getAttribute('role') || '').toLowerCase()]) ariaLandmarks++; });

            const cspMeta = doc.querySelector('meta[http-equiv="Content-Security-Policy" i]');
            const refMeta = doc.querySelector('meta[name="referrer"]');
            const security = {};
            security['Secure Context']        = window.isSecureContext ? 'Yes' : 'No';
            security['HTTPS']                 = loc.protocol === 'https:' ? 'Yes' : 'No';
            security['CSP (meta)']            = cspMeta ? 'Present' : null;
            security['Referrer Policy']       = doc.referrerPolicy || (refMeta && refMeta.getAttribute('content')) || '(browser default)';
            security['Cross-Origin Isolated'] = window.crossOriginIsolated ? 'Yes' : 'No';
            let refOrigin = null; if (doc.referrer) { try { refOrigin = new URL(doc.referrer).hostname; } catch (e) {} }
            security['Referrer'] = refOrigin;

            const fontFamilies = new Set(); let fontCount = 0;
            try { if (doc.fonts && doc.fonts.forEach) doc.fonts.forEach(ff => { fontCount++; fontFamilies.add((ff.family || '').replace(/['"]/g, '')); }); } catch (e) {}

            const order = ['H1','H2','H3','H4','H5','H6'];
            const hParts = order.filter(h => headings[h]).map(h => h.toLowerCase() + ':' + headings[h]);

            imagesTotal = c.imgCount;

            const out = {};
            out.Identity = identity;
            out.Meta = meta;
            out.Security = security;
            out.DOM = { 'Total Elements': c.total, 'Images': c.imgCount, 'Iframes': c.iframes, 'Forms': c.forms, 'Inputs': c.inputs };
            const resources = { 'External Scripts': scriptUrls, 'Inline Scripts': c.inlineScripts, 'Stylesheets': styleUrls };
            if (extDomains.size) resources['3rd-party Domains'] = [...extDomains];
            out.Resources = resources;
            if (perf && perf.getEntriesByType) {
                const nav0 = perf.getEntriesByType('navigation')[0];
                if (nav0) out.Performance = { 'Load Time': Math.round(nav0.loadEventEnd - nav0.startTime) + ' ms', 'TTFB': Math.round(nav0.responseStart - nav0.requestStart) + ' ms' };
            }
            const links = { 'Total': c.links, 'Internal': c.linkInt, 'External': c.linkExt };
            if (c.mailto) links['Mailto'] = c.mailto;
            if (c.tel) links['Tel'] = c.tel;
            if (linkDomains.size) links['External Domains'] = [...linkDomains];
            out.Links = links;
            out.Images = { 'Total': c.imgCount, 'Missing alt': c.imgNoAlt, 'Origins': imgOrigins.size };
            out.Fonts = { 'Web Fonts': fontCount, 'Families': fontFamilies.size ? [...fontFamilies] : 0 };
            out.Accessibility = {
                'Document Lang': doc.documentElement.lang || null,
                'Main': landmarks.MAIN, 'Nav': landmarks.NAV, 'Header': landmarks.HEADER, 'Footer': landmarks.FOOTER, 'Aside': landmarks.ASIDE,
                'ARIA Landmarks': ariaLandmarks, 'Headings': hParts.length ? hParts.join(', ') : '0', 'Images Missing alt': c.imgNoAlt,
            };
            const cookieCount = doc.cookie ? doc.cookie.split(';').filter(x => x.trim()).length : 0;
            let lsCount = 0, ssCount = 0; try { lsCount = localStorage.length; } catch (e) {} try { ssCount = sessionStorage.length; } catch (e) {}
            out.Storage = { 'Cookies': cookieCount, 'LocalStorage Keys': lsCount, 'SessionStorage Keys': ssCount };
            out.Display = { 'Viewport': `${innerWidth} × ${innerHeight} px`, 'Screen': `${screen.width} × ${screen.height} px`, 'Pixel Ratio': (window.devicePixelRatio || 1) + 'x' };
            return out;
        }

        // ─── Inspector view ────────────────────────────────────────────────────
        // Live component lists for count-style rows; computed on demand, never persisted
        function detailItems(section, key) {
            const q = sel => [...document.querySelectorAll(sel)];
            const map = {
                'Storage|Cookies': () => (document.cookie ? document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(Boolean) : []),
                'Storage|LocalStorage Keys': () => { try { return Object.keys(localStorage); } catch (e) { return []; } },
                'Storage|SessionStorage Keys': () => { try { return Object.keys(sessionStorage); } catch (e) { return []; } },
                'DOM|Iframes': () => q('iframe').map(f => f.getAttribute('src') || '(no src)'),
                'DOM|Forms': () => q('form').map(f => f.id || f.getAttribute('name') || f.getAttribute('action') || '(form)'),
                'DOM|Inputs': () => q('input, textarea, select').map(i => (i.tagName.toLowerCase() === 'input' ? (i.type || 'text') : i.tagName.toLowerCase()) + (i.name ? ':' + i.name : '')),
                'Links|Internal': () => q('a[href]').map(a => a.href).filter(h => { try { return new URL(h).hostname === location.hostname && !h.includes('#'); } catch (e) { return false; } }),
                'Links|External': () => q('a[href]').map(a => a.href).filter(h => { try { const u = new URL(h); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== location.hostname; } catch (e) { return false; } }),
                'Links|Mailto': () => q('a[href^="mailto:" i]').map(a => a.getAttribute('href').replace(/^mailto:/i, '')),
                'Links|Tel': () => q('a[href^="tel:" i]').map(a => a.getAttribute('href').replace(/^tel:/i, '')),
                'Accessibility|ARIA Landmarks': () => q('[role]').map(e => e.getAttribute('role')).filter(Boolean),
                'Accessibility|Images Missing alt': () => q('img:not([alt])').map(i => i.currentSrc || i.src || '(no src)'),
                'Fonts|Web Fonts': () => { const out = []; try { document.fonts.forEach(f => out.push((f.family || '').replace(/['"]/g, '') + ' ' + (f.style || '') + ' ' + (f.weight || ''))); } catch (e) {} return out; },
            };
            return map[section + '|' + key] || null;
        }
        function rowHtml(section, key, val) {
            if (Array.isArray(val) && val.length) {
                const items = val.map(v => `<div class="su-subitem">${escapeHtml(trunc(v, 120))}</div>`).join('');
                return `<button class="su-row" data-action="row-list"><span class="su-row-key">${escapeHtml(key)}</span><span class="su-row-val">${val.length}${iconChevR}</span></button><div class="su-sublist">${items}</div>`;
            }
            const v = Array.isArray(val) ? 0 : val;
            const n = parseInt(v, 10);
            if (detailItems(section, key) && Number.isFinite(n) && n > 0) {
                return `<button class="su-row" data-action="row-detail" data-section="${escapeHtml(section)}" data-key="${escapeHtml(key)}"><span class="su-row-key">${escapeHtml(key)}</span><span class="su-row-val">${escapeHtml(String(v))}${iconChevR}</span></button><div class="su-sublist"></div>`;
            }
            return `<div class="su-row"><span class="su-row-key">${escapeHtml(key)}</span><span class="su-row-val">${renderScalar(section, key, v)}</span></div>`;
        }
        function renderSectionEl(name, data) {
            const rows = Object.entries(data).map(([k, v]) => rowHtml(name, k, v)).join('');
            const browse = name === 'Images' ? `<button class="su-browse" data-action="browse-images">Browse all images ${iconChevR}</button>` : '';
            const cls = collapsed[name] ? ' collapsed' : '';
            return `<div class="su-section${cls}" data-section="${escapeHtml(name)}">
            <div class="su-section-header">
                <button class="su-section-toggle" data-action="section-toggle">${iconChevD}<span class="su-section-title">${escapeHtml(name)}</span></button>
                <div class="su-section-actions">
                    <button class="su-icon-btn" data-action="section-info" data-section="${escapeHtml(name)}" title="What is this?">${iconInfo}</button>
                    <button class="su-icon-btn" data-action="section-json" data-section="${escapeHtml(name)}" title="Copy section as JSON">${iconJson}</button>
                    <button class="su-icon-btn" data-action="section-kebab" data-section="${escapeHtml(name)}" title="Copy a value">${iconKebab}</button>
                </div>
            </div>
            <div class="su-section-body">${rows}${browse}</div>
        </div>`;
        }
        function sectionsHtml() {
            return Object.entries(sectionMap).map(([n, d], i) => (i ? '<div class="su-divider"></div>' : '') + renderSectionEl(n, d)).join('');
        }
        function skeletonHtml() {
            const bar = '<div class="su-row"><span class="su-sk su-sk-k"></span><span class="su-sk su-sk-v"></span></div>';
            const sec = n => `<div class="su-section"><div class="su-section-header"><div class="su-section-toggle">${iconChevD}<span class="su-sk su-sk-title"></span></div></div><div class="su-section-body">${bar.repeat(n)}</div></div>`;
            return [sec(5), sec(4), sec(4), sec(3)].join('<div class="su-divider"></div>');
        }
        function fillInspector(view) {
            sectionMap = gatherSections();
            const body = view.querySelector('#su-inspector-body');
            if (body) body.innerHTML = sectionsHtml();
        }
        function buildInspectorView() {
            const el = document.createElement('div');
            el.className = 'su-view';
            el.dataset.view = 'inspector';
            el.innerHTML = `
            <div class="su-vhead">
                <span class="su-vtitle">Page Inspector</span>
                <div class="su-vhead-actions">
                    <button class="su-icon-btn" data-action="refresh" title="Rescan">${iconRefresh}</button>
                    <button class="su-icon-btn" data-action="overall-menu" title="Page actions">${iconOverall}</button>
                    <button class="su-x" data-action="close-all">${iconClose}</button>
                </div>
            </div>
            <div class="su-vbody" id="su-inspector-body">${skeletonHtml()}</div>`;
            return el;
        }

        // ─── Images view ───────────────────────────────────────────────────────
        // Group the raw <img> list by source so the same image appearing at several sizes is one entry.
        function imageGroups() {
            const map = new Map();
            for (const im of imageEntries) {
                let g = map.get(im.src);
                if (!g) { g = { id: map.size, src: im.src, origin: im.origin, alt: im.alt, nw: im.nw, nh: im.nh, natural: im.natural, load: im.load, firstIdx: im.idx, variants: [] }; map.set(im.src, g); }
                if (!g.alt && im.alt) g.alt = im.alt;
                if ((im.nw * im.nh) > (g.nw * g.nh)) { g.nw = im.nw; g.nh = im.nh; g.natural = im.natural; }
                g.variants.push({ el: im.el, rw: im.rw, rh: im.rh, rendered: im.rendered });
            }
            const groups = [...map.values()];
            for (const g of groups) {
                const seen = new Set();
                g.variants = g.variants
                    .filter(v => { const k = v.rw + 'x' + v.rh; if (seen.has(k)) return false; seen.add(k); return true; })
                    .sort((a, b) => (b.rw * b.rh) - (a.rw * a.rh));  // largest rendered size first
            }
            return groups;
        }
        function groupById(id) { return imageGroups().find(g => g.id === id) || null; }
        function sortedFilteredGroups() {
            const host = location.hostname;
            const list = imageGroups().filter(g => {
                switch (imgFilter) {
                    case 'missing-alt': return !g.alt;
                    case 'has-alt':     return !!g.alt;
                    case 'cross':       return g.origin && g.origin !== host;
                    case 'same':        return g.origin === host;
                    case 'large':       return g.nw >= 256 || g.nh >= 256;
                    case 'small':       return g.nw > 0 && g.nw < 64 && g.nh < 64;
                    default:            return true;
                }
            });
            const dir = imgSort.dir === 'desc' ? -1 : 1;
            const cmp = {
                dom:    (a, b) => a.firstIdx - b.firstIdx,
                origin: (a, b) => (a.origin || '').localeCompare(b.origin || ''),
                alt:    (a, b) => (a.alt || '~').localeCompare(b.alt || '~'),
                size:   (a, b) => (a.nw * a.nh) - (b.nw * b.nh),
                load:   (a, b) => (a.load == null ? Infinity : a.load) - (b.load == null ? Infinity : b.load),
            }[imgSort.key] || ((a, b) => a.firstIdx - b.firstIdx);
            list.sort((a, b) => { const r = cmp(a, b); return r !== 0 ? r * dir : (a.firstIdx - b.firstIdx); });
            return list;
        }
        function imgDimText(g) { return g.variants.length > 1 ? `${escapeHtml(g.natural)} · ${g.variants.length} sizes` : `${escapeHtml(g.natural)} → ${escapeHtml(g.variants[0] ? g.variants[0].rendered : 'hidden')}`; }
        function imgRowList(g) {
            return `
            <button class="su-img" data-action="img-entry" data-id="${g.id}">
                <span class="su-img-info">
                    <span class="su-img-dims">${imgDimText(g)}</span>
                    <span class="su-img-host">${escapeHtml(g.origin || '(relative)')}</span>
                    ${g.alt ? `<span class="su-img-alt">alt: ${escapeHtml(trunc(g.alt, 60))}</span>` : `<span class="su-img-alt muted">no alt</span>`}
                    ${g.load != null ? `<span class="su-img-load">loaded ${g.load} ms</span>` : ''}
                </span>
                <img class="su-img-thumb" src="${escapeHtml(g.src)}" loading="lazy" referrerpolicy="no-referrer" alt="">
                <span class="su-icon-btn su-img-dl" data-action="img-download" data-id="${g.id}" role="button" title="Download">${iconDownload}</span>
            </button>`;
        }
        function imgRowCompact(g) {
            return `
            <button class="su-img compact" data-action="img-entry" data-id="${g.id}">
                <img class="su-img-thumb" src="${escapeHtml(g.src)}" loading="lazy" referrerpolicy="no-referrer" alt="">
                <span class="su-img-info">
                    <span class="su-img-dims">${escapeHtml(g.natural)}${g.variants.length > 1 ? ` · ${g.variants.length}×` : ''}</span>
                    <span class="su-img-host">${escapeHtml(g.origin || '(relative)')}</span>
                </span>
                <span class="su-icon-btn su-img-dl" data-action="img-download" data-id="${g.id}" role="button" title="Download">${iconDownload}</span>
            </button>`;
        }
        function imgCellGrid(g) {
            return `
            <button class="su-img-cell${g.alt ? '' : ' noalt'}" data-action="img-entry" data-id="${g.id}">
                <img src="${escapeHtml(g.src)}" loading="lazy" referrerpolicy="no-referrer" alt="">
                ${g.variants.length > 1 ? `<span class="su-cell-badge">${g.variants.length}</span>` : ''}
                <span class="su-cell-dl" data-action="img-download" data-id="${g.id}" role="button" title="Download">${iconDownload}</span>
            </button>`;
        }
        function renderImageList(bodyEl) {
            const list = sortedFilteredGroups();
            const total = imageGroups().length;
            const cap = `<div class="su-img-cap">${total} image${total !== 1 ? 's' : ''}${list.length !== total ? ` (${list.length} shown)` : ''}</div>`;
            let body;
            if (!list.length) body = '<div class="su-img-cap">No images found.</div>';
            else if (imgView === 'grid') body = `<div class="su-img-grid">${list.map(imgCellGrid).join('')}</div>`;
            else body = list.map(imgView === 'compact' ? imgRowCompact : imgRowList).join('');
            bodyEl.innerHTML = cap + body;
            updateImagesControls();
        }
        // Reflect current view, order direction, and whether a filter is active in the header icons.
        function updateImagesControls() {
            const d = document.getElementById('su-img-display'); if (d) d.innerHTML = imgView === 'grid' ? iconGrid : imgView === 'compact' ? iconCompact : iconList;
            const o = document.getElementById('su-img-order');   if (o) o.innerHTML = imgSort.dir === 'asc' ? iconArrowUp : iconArrowDown;
            const f = document.getElementById('su-img-filter');  if (f) f.classList.toggle('active', imgFilter !== 'all');
        }
        function buildImagesView(withBack) {
            const el = document.createElement('div');
            el.className = 'su-view';
            el.dataset.view = 'images';
            el.innerHTML = `
            <div class="su-vhead">
                <div class="su-vhead-left">
                    ${withBack ? `<button class="su-icon-btn" data-action="back">${iconBack}</button>` : ''}
                    <span class="su-vtitle">Images</span>
                </div>
                <div class="su-vhead-actions">
                    <button class="su-icon-btn" data-action="refresh" title="Rescan">${iconRefresh}</button>
                    <button class="su-icon-btn" id="su-img-display" data-action="display" title="Display">${iconLayout}</button>
                    <button class="su-icon-btn" id="su-img-order" data-action="order" title="Order">${iconOrder}</button>
                    <button class="su-icon-btn" id="su-img-filter" data-action="filter" title="Filter">${iconFilter}</button>
                    <button class="su-x" data-action="close-all">${iconClose}</button>
                </div>
            </div>
            <div class="su-vbody"></div>`;
            imagesBodyEl = el.querySelector('.su-vbody');
            renderImageList(imagesBodyEl);
            return el;
        }

        // ─── Settings view ─────────────────────────────────────────────────────
        function seg(action, current, opts) {
            return `<div class="su-seg">${opts.map(o => `<button class="su-seg-btn${o.val === current ? ' active' : ''}" data-action="${action}" data-val="${o.val}" data-mode="${o.val}">${o.label}</button>`).join('')}</div>`;
        }
        function orderLabel(k) { return ({ dom: 'Default', origin: 'Origin host', alt: 'Alt text', size: 'Size', load: 'Load time' })[k] || 'Default'; }
        function dirLabel(k, dir) {
            const asc = dir === 'asc';
            if (k === 'size') return asc ? 'Small to large' : 'Large to small';
            if (k === 'load') return asc ? 'Fast to slow' : 'Slow to fast';
            if (k === 'dom')  return asc ? 'First to last' : 'Last to first';
            return asc ? 'A to Z' : 'Z to A';
        }
        function filterLabel(v) { return ({ all: 'All images', 'missing-alt': 'Missing alt', 'has-alt': 'Has alt', cross: 'Cross-origin', same: 'Same-origin', large: 'Large (256px+)', small: 'Small (under 64px)' })[v] || 'All images'; }
        function settingsBodyHtml() {
            const presets = Object.entries(THEMES).map(([name, t]) =>
                `<button class="su-swatch${theme === name ? ' active' : ''}" data-action="set-theme" data-val="${name}" style="background:${t.accent}" title="${name}"></button>`).join('');
            const customs = customColors.map(h =>
                    `<button class="su-swatch${theme === 'custom' && customHex === h ? ' active' : ''}" data-action="set-custom" data-val="${h}" style="background:${h}" title="${h}"></button>`).join('')
                + `<button class="su-swatch su-swatch-add" data-action="add-color" title="Add a custom color">+</button>`;
            return `
            <div class="su-group">
                <div class="su-group-title">General</div>
                <div class="su-set-row"><div><div class="su-set-label">Pin menu</div><div class="su-set-sub">Unpin to reposition by swiping the button.</div></div><button class="su-switch${pinned ? ' on' : ''}" data-action="set-pin"></button></div>
                <div class="su-set-row"><div><div class="su-set-label">Code block wrapping</div><div class="su-set-sub">Wrap copied HTML and JSON in a fenced code block.</div></div><button class="su-switch${codeBlockWrap ? ' on' : ''}" data-action="set-wrap"></button></div>
            </div>
            <div class="su-group">
                <div class="su-group-title">Cookie banners</div>
                <div class="su-set-col"><div class="su-set-label">Banner handling</div>${seg('set-cookie', cookieMode, [{val:'off',label:'Off'},{val:'once',label:'Ask once'},{val:'always',label:'Always hide'}])}<div class="su-set-sub" style="margin-top:8px">Ask once shows the banner on your first visit to a site, then hides it on later visits. Always hide hides it every time.</div></div>
            </div>
            <div class="su-group">
                <div class="su-group-title">Images</div>
                <div class="su-set-col"><div class="su-set-label">Default order</div><button class="su-link-btn" data-action="set-default-order">${orderLabel(imgSort.key)} (${dirLabel(imgSort.key, imgSort.dir)})</button><div class="su-set-sub" style="margin-top:6px">Order used when opening the image browser. Changes made inside the browser are remembered too.</div></div>
                <div class="su-set-col"><div class="su-set-label">Default filter</div><button class="su-link-btn" data-action="set-default-filter">${filterLabel(imgFilter)}</button><div class="su-set-sub" style="margin-top:6px">Filter applied when opening the image browser.</div></div>
                <div class="su-set-col"><div class="su-set-label">Source</div>${seg('set-dlsrc', downloadSource, [{val:'origin',label:'Original file'},{val:'website',label:'As shown'}])}<div class="su-set-sub" style="margin-top:8px">Original file downloads the full-resolution image from its host. As shown saves the on-page version at its rendered size.</div></div>
                <div class="su-set-col"><div class="su-set-label">Save to</div>${seg('set-dlloc', downloadLocation, [{val:'file',label:'Files'},{val:'photos',label:'Photos'}])}<div class="su-set-sub" style="margin-top:8px">Files downloads through the browser. Photos opens the share sheet so you can save the image into Photos.</div></div>
            </div>
            <div class="su-group">
                <div class="su-group-title">Theme</div>
                <div class="su-set-col"><div class="su-set-label">Preset colors</div><div class="su-swatches">${presets}</div></div>
                <div class="su-set-col">
                    <div class="su-set-label">Custom colors</div>
                    <div class="su-swatches">${customs}</div>
                    <div class="su-color-picker" id="su-color-picker">
                        <input type="color" id="su-color" class="su-color-swatch-input" value="${customHex}">
                        <input class="su-hex-input" id="su-colorhex" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="#RRGGBB" value="${customHex}">
                        <button class="su-btn su-btn-secondary" data-action="add-color-confirm">Add</button>
                    </div>
                </div>
            </div>`;
        }
        function buildSettingsView(withBack) {
            const el = document.createElement('div');
            el.className = 'su-view'; el.dataset.view = 'settings';
            el.innerHTML = `
            <div class="su-vhead">
                <div class="su-vhead-left">
                    ${withBack ? `<button class="su-icon-btn" data-action="back">${iconBack}</button>` : ''}
                    <span class="su-vtitle">Settings</span>
                </div>
                <div class="su-vhead-actions"><button class="su-x" data-action="close-all">${iconClose}</button></div>
            </div>
            <div class="su-vbody" id="su-set-body">${settingsBodyHtml()}</div>
            <div class="su-set-footer"><button class="su-btn su-btn-secondary" data-action="set-reset">Reset to default</button></div>`;
            return el;
        }
        function refreshSettings() {
            const b = viewsEl.querySelector('#su-set-body');
            if (b) b.innerHTML = settingsBodyHtml();
        }
        function resetDefaults() {
            pinned = true; codeBlockWrap = true; corner = 'br'; cookieMode = 'off';
            theme = 'teal'; customHex = '#00555a'; customColors = []; downloadSource = 'origin'; downloadLocation = 'file';
            imgSort = { key: 'dom', dir: 'asc' }; imgFilter = 'all'; imgView = 'list'; sheetH = 82; applySheetHeight();
            fab.classList.remove('unpinned'); applyCorner('br'); applyTheme('teal'); applyCookieMode(); persist();
        }

        // ─── View stack navigation ─────────────────────────────────────────────
        function buildView(name, opts) {
            if (name === 'inspector') return buildInspectorView();
            if (name === 'images')    return buildImagesView(opts && opts.back);
            if (name === 'settings')  return buildSettingsView(opts && opts.back);
        }
        function afterMount(name, el) {
            if (name === 'inspector') requestAnimationFrame(() => requestAnimationFrame(() => { if (el.isConnected) fillInspector(el); }));
            else if (name === 'images') updateImagesControls();
        }
        function updateActiveItems() {
            const open = overlayOpen(), top = stack[stack.length - 1];
            if (btnInspect)  btnInspect.classList.toggle('active', open && top === 'inspector');
            if (btnImages)   btnImages.classList.toggle('active', open && top === 'images');
            if (btnSettings) btnSettings.classList.toggle('active', open && top === 'settings');
        }
        function refreshCurrent() {
            const top = stack[stack.length - 1], el = viewEls[viewEls.length - 1];
            if (top === 'inspector') fillInspector(el);
            else if (top === 'images') { gatherSections(); if (imagesBodyEl) renderImageList(imagesBodyEl); }
        }
        function openOverlay(rootName, opts) {
            if (activePopover) closePopover();
            viewsEl.innerHTML = ''; viewEls = []; stack = [];
            const el = buildView(rootName, opts);
            el.style.transform = 'translateX(0)';
            viewsEl.appendChild(el); viewEls.push(el); stack.push(rootName);
            overlay.classList.add('open'); fab.classList.add('overlay-active');
            setNudge(0, 0);  // keep the button flush at its corner while the sheet covers the page
            afterMount(rootName, el); updateActiveItems();
        }
        function pushView(name, opts) {
            if (activePopover) closePopover();
            const el = buildView(name, opts);
            el.style.transform = 'translateX(100%)';
            viewsEl.appendChild(el); viewEls.push(el); stack.push(name);
            const below = viewEls[viewEls.length - 2];
            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.style.transform = 'translateX(0)';
                if (below) below.style.transform = 'translateX(-25%)';
            }));
            afterMount(name, el); updateActiveItems();
        }
        function popView() {
            if (activePopover) closePopover();
            if (viewEls.length <= 1) { closeOverlay(); return; }
            const top = viewEls.pop(); stack.pop();
            const below = viewEls[viewEls.length - 1];
            top.style.transform = 'translateX(100%)';
            if (below) below.style.transform = 'translateX(0)';
            setTimeout(() => top.remove(), 320);
            updateActiveItems();
        }
        function closeOverlay() {
            if (activePopover) closePopover();
            overlay.classList.remove('open');
            fab.classList.remove('overlay-active');
            setTimeout(() => { viewsEl.innerHTML = ''; viewEls = []; stack = []; imagesBodyEl = null; }, 260);
            updateActiveItems();
            setTimeout(reposition, 60);  // restore any page-bar offset once the sheet is gone
        }
        function overlayOpen() { return overlay && overlay.classList.contains('open'); }

        function openImages(withBack) { if (withBack) pushView('images', { back: true }); else openOverlay('images'); }

        // ─── Popover ───────────────────────────────────────────────────────────
        function positionAndShow(anchor) {
            popover.style.visibility = 'hidden'; popover.classList.add('show');
            const ph = popover.offsetHeight;
            popover.classList.remove('show'); popover.style.visibility = '';
            const rect = anchor.getBoundingClientRect();
            const placeBelow = (innerHeight - rect.bottom) >= ph + 12;
            popover.style.left = 'auto'; popover.style.right = (innerWidth - rect.right) + 'px';
            if (placeBelow) { popover.style.top = (rect.bottom + 6) + 'px'; popover.style.bottom = 'auto'; popover.style.transformOrigin = 'top right'; }
            else { popover.style.top = 'auto'; popover.style.bottom = (innerHeight - rect.top + 6) + 'px'; popover.style.transformOrigin = 'bottom right'; }
            popover.classList.add('show'); activePopover = popover; currentAnchor = anchor;
        }
        function showMenu(items, anchor) {
            popover.innerHTML = items.map(it => {
                const attrs = Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${escapeHtml(v)}"`).join(' ');
                return `<button class="su-popover-item${it.sel ? ' sel' : ''}" data-action="${it.action}" ${attrs}>${it.icon ? `<span class="su-pop-ic">${it.icon}</span>` : ''}<span>${escapeHtml(it.label)}</span>${it.tail ? `<span class="su-pop-tail">${escapeHtml(it.tail)}</span>` : ''}</button>`;
            }).join('');
            positionAndShow(anchor);
        }
        function showInfo(text, anchor) { popover.innerHTML = `<div class="su-popover-info">${escapeHtml(text)}</div>`; positionAndShow(anchor); }
        function closePopover() { popover.classList.remove('show'); activePopover = null; currentAnchor = null; }
        function toggleMenu(items, anchor) { currentAnchor === anchor ? closePopover() : showMenu(items, anchor); }

        popover.addEventListener('click', (e) => {
            const item = e.target.closest('.su-popover-item');
            if (!item) return;
            const a = item.dataset.action;
            if (a === 'copy-value') copyToClipboard(formatValue(sectionMap[item.dataset.section][item.dataset.key]), item);
            else if (a === 'copy-all-json') copyToClipboard(wrapCopy(JSON.stringify(sectionMap, null, 2), 'json'), item);
            else if (a === 'copy-html') copyToClipboard(wrapCopy(document.documentElement.outerHTML, 'html'), item);
            else if (a === 'sort') {
                const key = item.dataset.key;
                if (imgSort.key === key) imgSort.dir = imgSort.dir === 'asc' ? 'desc' : 'asc';
                else imgSort = { key, dir: 'asc' };
                persist();
                if (imagesBodyEl) renderImageList(imagesBodyEl);
                refreshSettings();
                closePopover(); return;
            } else if (a === 'filter') {
                imgFilter = item.dataset.val; persist();
                if (imagesBodyEl) renderImageList(imagesBodyEl);
                refreshSettings();
                closePopover(); return;
            } else if (a === 'imgview') {
                imgView = item.dataset.val; persist();
                if (imagesBodyEl) renderImageList(imagesBodyEl);
                closePopover(); return;
            }
            setTimeout(closePopover, 220);
        });

        function openOrderMenu(anchor) {
            const opts = [['dom','Default'],['origin','Origin host'],['alt','Alt text'],['size','Size'],['load','Load time']];
            toggleMenu(opts.map(([k, label]) => ({
                label, action: 'sort', data: { key: k },
                sel: imgSort.key === k, tail: imgSort.key === k ? dirLabel(k, imgSort.dir) : '',
            })), anchor);
        }
        function openDisplayMenu(anchor) {
            const opts = [['list','List'],['grid','Grid'],['compact','Compact']];
            toggleMenu(opts.map(([v, label]) => ({ label, action: 'imgview', data: { val: v }, sel: imgView === v })), anchor);
        }
        function openFilterMenu(anchor) {
            const opts = [['all','All'],['missing-alt','Missing alt'],['has-alt','Has alt'],['cross','Cross-origin'],['same','Same-origin'],['large','Large (256px+)'],['small','Small (under 64px)']];
            toggleMenu(opts.map(([v, label]) => ({ label, action: 'filter', data: { val: v }, sel: imgFilter === v })), anchor);
        }

        // ─── Full image preview ────────────────────────────────────────────────
        let previewGroup = null, previewVariant = 0;
        function openPreview(id) {
            const g = groupById(id);
            if (!g || !g.variants.length) return;
            previewGroup = g; previewVariant = 0;  // variants are largest-first, so this defaults to the largest
            renderPreview();
            preview.classList.add('open');
        }
        function renderPreview() {
            const g = previewGroup; if (!g) return;
            const v = g.variants[previewVariant] || g.variants[0];
            const img = preview.querySelector('#su-preview-img');
            img.src = g.src;
            img.style.width = v.rw ? v.rw + 'px' : 'auto';
            img.style.height = v.rh ? v.rh + 'px' : 'auto';
            const strip = preview.querySelector('#su-preview-strip');
            strip.style.display = g.variants.length > 1 ? 'flex' : 'none';
            strip.innerHTML = g.variants.map((vv, i) =>
                `<button class="su-prev-thumb${i === previewVariant ? ' active' : ''}" data-action="prev-pick" data-i="${i}"><img src="${escapeHtml(g.src)}" referrerpolicy="no-referrer" alt=""><span>${vv.rw}×${vv.rh}</span></button>`).join('');
            preview.querySelector('#su-preview-meta').innerHTML = `<b>${v.rw} × ${v.rh}</b> shown${g.nw ? ` · source ${g.nw} × ${g.nh}` : ''}`;
            preview.querySelector('#su-preview-stage').scrollTop = 0;
        }
        function setVariant(i) {
            if (!previewGroup) return;
            previewVariant = Math.max(0, Math.min(previewGroup.variants.length - 1, i));
            renderPreview();
        }
        function closePreview() { preview.classList.remove('open'); previewGroup = null; }
        preview.addEventListener('click', (e) => {
            const act = e.target.closest('[data-action]');
            if (!act) { if (e.target.id === 'su-preview-stage') closePreview(); return; }
            const a = act.dataset.action;
            if (a === 'prev-close') closePreview();
            else if (a === 'prev-origin') { if (previewGroup) window.open(previewGroup.src, '_blank'); }
            else if (a === 'prev-download') { if (previewGroup) downloadImage(previewGroup, previewGroup.variants[previewVariant]); }
            else if (a === 'prev-pick') setVariant(+act.dataset.i);
        });
        let pvX = 0, pvY = 0, pvOn = false;
        preview.addEventListener('touchstart', (e) => { if (!previewGroup) return; const t = e.touches[0]; pvX = t.clientX; pvY = t.clientY; pvOn = true; }, { passive: true });
        preview.addEventListener('touchend', (e) => {
            if (!pvOn || !previewGroup) return; pvOn = false;
            const t = e.changedTouches[0], dx = t.clientX - pvX, dy = t.clientY - pvY;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) setVariant(previewVariant + (dx < 0 ? 1 : -1));
        }, { passive: true });
        preview.addEventListener('touchmove', (e) => {
            if (e.target.closest('#su-preview-strip')) return;
            const st = preview.querySelector('#su-preview-stage');
            if (st && e.target.closest('#su-preview-stage') && (st.scrollHeight > st.clientHeight || st.scrollWidth > st.clientWidth)) return;
            e.preventDefault();  // keep the page behind the preview from scrolling
        }, { passive: false });

        // ─── Image download ────────────────────────────────────────────────────
        function fileName(src, fallbackExt) {
            let name = 'image';
            try { const u = new URL(src, location.href); const seg = u.pathname.split('/').filter(Boolean).pop(); if (seg) name = seg.split('?')[0]; } catch (e) {}
            if (fallbackExt && !/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + fallbackExt;
            return name;
        }
        async function deliver(blob, name) {
            if (downloadLocation === 'photos' && navigator.canShare) {
                try {
                    const file = new File([blob], name, { type: blob.type || 'image/png' });
                    if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
                } catch (e) { return; }  // user cancelled share or it failed; do not also download
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        }
        function renderedBlob(el, w, h) {
            return new Promise((resolve, reject) => {
                if (!el || !w || !h) return reject();
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                try {
                    canvas.getContext('2d').drawImage(el, 0, 0, w, h);
                    canvas.toBlob(b => b ? resolve(b) : reject(), 'image/png');
                } catch (e) { reject(e); }  // cross-origin taint
            });
        }
        async function downloadImage(g, variant) {
            const v = variant || g.variants[0];
            try {
                if (downloadSource === 'website') { await deliver(await renderedBlob(v.el, v.rw, v.rh), fileName(g.src, 'png')); return; }
                const resp = await fetch(g.src, { mode: 'cors' });
                await deliver(await resp.blob(), fileName(g.src));
            } catch (e) {
                window.open(g.src, '_blank');  // fallback: let the user save manually
            }
        }

        // ─── Section collapse ──────────────────────────────────────────────────
        function toggleCollapse(name, sectionEl) {
            if (!name) return;
            if (collapsed[name]) { delete collapsed[name]; sectionEl.classList.remove('collapsed'); }
            else { collapsed[name] = 1; sectionEl.classList.add('collapsed'); }
            writeStore('su-collapsed', collapsed);
        }

        // ─── Delegated view interactions ───────────────────────────────────────
        viewsEl.addEventListener('click', (e) => {
            const act = e.target.closest('[data-action]');
            if (!act) return;
            switch (act.dataset.action) {
                case 'close-all': closeOverlay(); break;
                case 'back': popView(); break;
                case 'overall-menu': toggleMenu([
                    { label: 'Copy HTML', action: 'copy-html', icon: iconCopyC },
                    { label: 'Copy all as JSON', action: 'copy-all-json', icon: iconJson },
                ], act); break;
                case 'order': openOrderMenu(act); break;
                case 'filter': openFilterMenu(act); break;
                case 'browse-images': openImages(true); break;
                case 'refresh': refreshCurrent(); break;
                case 'display': openDisplayMenu(act); break;
                case 'row-detail': { const sub = act.nextElementSibling; if (sub && sub.classList.contains('su-sublist')) { if (!sub.dataset.filled) { const fn = detailItems(act.dataset.section, act.dataset.key); const items = fn ? fn() : []; sub.innerHTML = items.length ? items.map(v => `<div class="su-subitem">${escapeHtml(trunc(v, 120))}</div>`).join('') : '<div class="su-subitem" style="color:#666">none</div>'; sub.dataset.filled = '1'; } sub.classList.toggle('open'); act.classList.toggle('open'); } break; }
                case 'img-entry': openPreview(+act.dataset.id); break;
                case 'img-download': e.stopPropagation(); { const g = groupById(+act.dataset.id); if (g) downloadImage(g, g.variants[0]); } break;
                case 'section-toggle': { const s = act.closest('.su-section'); toggleCollapse(s.dataset.section, s); break; }
                case 'section-info': currentAnchor === act ? closePopover() : showInfo(SECTION_INFO[act.dataset.section] || '', act); break;
                case 'section-json': copyToClipboard(wrapCopy(JSON.stringify(sectionMap[act.dataset.section], null, 2), 'json'), act); break;
                case 'section-kebab': { const sec = act.dataset.section; toggleMenu(Object.keys(sectionMap[sec]).map(key => ({ label: 'Copy ' + key, action: 'copy-value', data: { section: sec, key } })), act); break; }
                case 'row-list': { const sub = act.nextElementSibling; if (sub && sub.classList.contains('su-sublist')) sub.classList.toggle('open'); break; }
                case 'set-pin': pinned = !pinned; fab.classList.toggle('unpinned', !pinned); persist(); refreshSettings(); break;
                case 'set-wrap': codeBlockWrap = !codeBlockWrap; persist(); refreshSettings(); break;
                case 'set-cookie': cookieMode = act.dataset.mode; persist(); applyCookieMode(); refreshSettings(); break;
                case 'set-dlsrc': downloadSource = act.dataset.val; persist(); refreshSettings(); break;
                case 'set-dlloc': downloadLocation = act.dataset.val; persist(); refreshSettings(); break;
                case 'set-theme': theme = act.dataset.val; applyTheme(theme); persist(); refreshSettings(); break;
                case 'set-custom': theme = 'custom'; customHex = act.dataset.val; applyTheme('custom'); persist(); refreshSettings(); break;
                case 'add-color': { const p = viewsEl.querySelector('#su-color-picker'); if (p) p.classList.toggle('open'); break; }
                case 'add-color-confirm': { const hx = viewsEl.querySelector('#su-colorhex'); const norm = hx && normHex(hx.value); if (norm) { if (!customColors.includes(norm)) customColors.push(norm); customHex = norm; theme = 'custom'; applyTheme('custom'); persist(); refreshSettings(); } break; }
                case 'set-default-order': openOrderMenu(act); break;
                case 'set-default-filter': openFilterMenu(act); break;
                case 'set-reset': resetDefaults(); refreshSettings(); break;
            }
        });

        // Close popover when its anchor scrolls out from under it
        viewsEl.addEventListener('scroll', () => { if (activePopover) closePopover(); }, { passive: true, capture: true });
        addEventListener('resize', () => { if (activePopover) closePopover(); reposition(); });

        // Live-sync the native color picker into the hex field
        viewsEl.addEventListener('input', (e) => {
            if (e.target.id === 'su-color') { const hx = viewsEl.querySelector('#su-colorhex'); if (hx) hx.value = e.target.value; }
        });

        // Drag the sheet header to resize the inspector so it need not cover the whole page
        let rsStart = null, rsBaseH = 0, rsMoved = false;
        viewsEl.addEventListener('pointerdown', (e) => {
            const head = e.target.closest('.su-vhead');
            if (!head || e.target.closest('.su-icon-btn, .su-x')) return;
            rsStart = e.clientY; rsBaseH = sheetH; rsMoved = false;
        });
        addEventListener('pointermove', (e) => {
            if (rsStart == null) return;
            const dy = e.clientY - rsStart;
            if (Math.abs(dy) > 4) rsMoved = true;
            if (!rsMoved) return;
            sheetH = Math.max(30, Math.min(94, rsBaseH - dy / innerHeight * 100));
            applySheetHeight();
        }, { passive: true });
        addEventListener('pointerup', () => { if (rsStart != null) { rsStart = null; if (rsMoved) persist(); } });
        addEventListener('pointercancel', () => { rsStart = null; });

        // ─── Panel ─────────────────────────────────────────────────────────────
        function openPanel()  { panelOpen = true;  panel.classList.add('open');    fab.classList.add('menu-open'); }
        function closePanel() { panelOpen = false; panel.classList.remove('open'); fab.classList.remove('menu-open'); }
        function togglePanel() { panelOpen ? closePanel() : openPanel(); }

        if (btnCopyDesc) btnCopyDesc.addEventListener('click', () => {
            const container = document.querySelector('.rh-description .content');
            if (!container) return;
            navigator.clipboard.writeText(htmlToMarkdown(container)).then(() => {
                const ic = btnCopyDesc.querySelector('.su-item-icon');
                ic.style.background = '#16a34a'; setTimeout(() => ic.style.background = '#ee3535', 900);
            });
        });
        btnInspect.addEventListener('click', () => {
            const top = stack[stack.length - 1];
            if (overlayOpen() && top === 'inspector') closeOverlay();
            else if (overlayOpen() && stack[0] === 'inspector') popView();
            else openOverlay('inspector');
            closePanel();
        });
        btnImages.addEventListener('click', () => {
            if (overlayOpen() && stack[stack.length - 1] === 'images') closeOverlay();
            else openImages(false);
            closePanel();
        });
        btnSettings.addEventListener('click', () => {
            const top = stack[stack.length - 1];
            if (overlayOpen() && top === 'settings') { popView(); closePanel(); return; }  // re-tap closes, like Back
            if (overlayOpen() && stack[0] === 'inspector') pushView('settings', { back: true });
            else openOverlay('settings', { back: false });
            closePanel();
        });

        // ─── FAB pointer / swipe ───────────────────────────────────────────────
        let pStart = null, pMoved = false;
        fab.addEventListener('pointerdown', (e) => { pStart = { x: e.clientX, y: e.clientY }; pMoved = false; try { fab.setPointerCapture(e.pointerId); } catch (err) {} });
        fab.addEventListener('pointermove', (e) => { if (pStart && (Math.abs(e.clientX - pStart.x) > 10 || Math.abs(e.clientY - pStart.y) > 10)) pMoved = true; });
        fab.addEventListener('pointerup', (e) => {
            if (!pStart) return;
            const dx = e.clientX - pStart.x, dy = e.clientY - pStart.y;
            const isSwipe = pMoved && !pinned && (Math.abs(dx) > 30 || Math.abs(dy) > 30);
            pStart = null;
            if (isSwipe) handleSwipe(dx, dy);
            else if (!pMoved) togglePanel();
        });
        fab.addEventListener('pointercancel', () => { pStart = null; pMoved = false; });
        function handleSwipe(dx, dy) {
            let v = corner[0], h = corner[1];
            if (Math.abs(dx) > 30) h = dx > 0 ? 'r' : 'l';
            if (Math.abs(dy) > 30) v = dy > 0 ? 'b' : 't';
            const nc = v + h;
            if (nc !== corner) { applyCorner(nc); persist(); }
        }

        // ─── Outside-click dismissals ──────────────────────────────────────────
        document.addEventListener('click', (e) => {
            if (activePopover && !e.target.closest('.su-popover') && !(currentAnchor && currentAnchor.contains(e.target))) closePopover();
            if (panelOpen && !e.target.closest('#su-root')) closePanel();
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
        // Keep gestures inside the sheet: scroll a scrollable body, otherwise block so the page underneath stays put
        overlay.addEventListener('touchmove', (e) => {
            const sc = e.target.closest('.su-vbody');
            if (sc && sc.scrollHeight > sc.clientHeight) return;
            e.preventDefault();
        }, { passive: false });
    }

    function whenBody(fn) {
        if (document.body) { fn(); return; }
        const mo = new MutationObserver(() => { if (document.body) { mo.disconnect(); fn(); } });
        mo.observe(document.documentElement, { childList: true });
    }
    let uiStarted = false;
    function startOnce() { if (uiStarted) return; uiStarted = true; whenBody(initUI); }
    // Reconcile from the cross-site shared store, but never let it block or break the menu:
    // the GM bridge can be unready at document-start, so the UI always starts regardless of how GM resolves.
    function loadShared() {
        try {
            if (typeof GM === 'undefined' || !GM || typeof GM.getValue !== 'function') { startOnce(); return; }
            let settled = false;
            Promise.resolve(GM.getValue('su-config', '')).then(v => {
                settled = true;
                if (v) { try { applyConfig(JSON.parse(v)); } catch (e) {} applyTheme(theme); try { applyCookieMode(); } catch (e) {} }
                else { try { persist(); } catch (e) {} }  // seed the shared store from existing per-site settings on first run after update
                startOnce();
            }, () => { settled = true; startOnce(); });
            setTimeout(() => { if (!settled) startOnce(); }, 800);
        } catch (e) { startOnce(); }
    }
    loadShared();
})();