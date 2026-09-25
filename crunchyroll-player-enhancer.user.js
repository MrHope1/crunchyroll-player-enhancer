// ==UserScript==
// @name         Crunchyroll Player Enhancer
// @namespace    https://github.com/MrHope1/crunchyroll-player-enhancer
// @version      6.0.0
// @description  Auto skip intro/credits, maximum-quality lock and fullscreen-only native speed/volume controls.
// @author       Contributors; original auto-skip/volume script by JRem
// @match        https://*.crunchyroll.com/*
// @match        https://static.crunchyroll.com/vilos-v2/web/vilos/player.html*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @license      MIT
// @homepageURL  https://github.com/MrHope1/crunchyroll-player-enhancer
// ==/UserScript==

(() => {
    'use strict';
    const installKey = Symbol.for('cr-enhancer.quality-installed');
    if (window[installKey]) return;
    window[installKey] = true;
    // Install in the page at document-start, before the player loads its manifest.
    // Inspiration: retouching's quality fixer (manifest filtering) and CrOptix
    // (persistent native quality controls). Implementation below is independent.
    const qualityKey = 'cr-enhancer.maximum-quality';
    let qualityEnabled = true;
    try { qualityEnabled = localStorage.getItem(qualityKey) !== 'false'; } catch {}
    let qualityApplied = false;
    let qualityReloadNeeded = false;
    let qualitySummary = '';
    function setQualityEnabled(enabled) {
        if (qualityEnabled !== enabled) qualityReloadNeeded = true;
        qualityEnabled = enabled;
        try { localStorage.setItem(qualityKey, String(enabled)); } catch {}
    }
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    function compareQuality(a, b) {
        return b.height - a.height || b.width - a.width || b.bandwidth - a.bandwidth;
    }
    function recordQuality(best) {
        qualityApplied = true;
        if (best?.height) qualitySummary = `${best.height}p · ${(best.bandwidth / 1e6).toFixed(2)} Mbps video`;
    }
    function filterManifest(text) {
        if (!qualityEnabled || typeof text !== 'string') return text;
        try {
            if (/^\s*(?:<\?xml[^>]*>\s*)?<MPD[\s>]/.test(text)) {
                const xml = new DOMParser().parseFromString(text, 'application/xml');
                if (xml.getElementsByTagName('parsererror').length || xml.documentElement.localName !== 'MPD') return text;
                let processed = false, bestVideo;
                for (const set of xml.getElementsByTagNameNS('*', 'AdaptationSet')) {
                    const groups = new Map();
                    for (const rep of [...set.children].filter(el => el.localName === 'Representation')) {
                        const mime = rep.getAttribute('mimeType') || set.getAttribute('mimeType') || '';
                        const kind = set.getAttribute('contentType') || mime.split('/')[0];
                        if (kind !== 'video' && kind !== 'audio') continue;
                        const codec = (rep.getAttribute('codecs') || set.getAttribute('codecs') || '').split('.')[0];
                        const channels = rep.getElementsByTagNameNS('*', 'AudioChannelConfiguration')[0]?.getAttribute('value') || '';
                        const groupKey = `${kind}|${codec}|${channels}`;
                        const item = {rep, kind, height: number(rep.getAttribute('height') || set.getAttribute('height')),
                            width: number(rep.getAttribute('width') || set.getAttribute('width')), bandwidth: number(rep.getAttribute('bandwidth'))};
                        if (!groups.has(groupKey)) groups.set(groupKey, []);
                        groups.get(groupKey).push(item);
                    }
                    for (const group of groups.values()) {
                        // Missing bandwidth metadata: preserve the original group.
                        if (!group.every(item => item.bandwidth > 0)) continue;
                        group.sort(compareQuality);
                        const best = group[0];
                        for (const item of group.slice(1)) item.rep.remove();
                        processed = true;
                        if (best.kind === 'video' && (!bestVideo || compareQuality(best, bestVideo) < 0)) bestVideo = best;
                    }
                }
                if (!processed) return text;
                recordQuality(bestVideo);
                return new XMLSerializer().serializeToString(xml);
            }
            if (text.trimStart().startsWith('#EXTM3U') && text.includes('#EXT-X-STREAM-INF:')) {
                const lines = text.split(/\r?\n/), variants = [];
                for (let i = 0; i < lines.length; i++) {
                    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
                    const attrs = {};
                    for (const match of lines[i].matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) attrs[match[1]] = match[2].replace(/^"|"$/g, '');
                    const size = (attrs.RESOLUTION || '').split('x');
                    let uri = i + 1;
                    while (uri < lines.length && !lines[uri].trim()) uri++;
                    if (!lines[uri] || lines[uri].startsWith('#')) return text;
                    variants.push({line:i, uri, height:number(size[1]), width:number(size[0]), bandwidth:number(attrs.BANDWIDTH),
                        group:[(attrs.CODECS || '').split(',').map(codec=>codec.split('.')[0]).join(','), attrs.AUDIO || '', attrs['VIDEO-RANGE'] || ''].join('|')});
                }
                if (!variants.length || !variants.every(v => v.bandwidth > 0 && v.height > 0)) return text;
                const groups = new Map(), remove = new Set();
                for (const variant of variants) {
                    if (!groups.has(variant.group)) groups.set(variant.group, []);
                    groups.get(variant.group).push(variant);
                }
                for (const group of groups.values()) {
                    group.sort(compareQuality);
                    for (const variant of group.slice(1)) { remove.add(variant.line); remove.add(variant.uri); }
                }
                recordQuality([...variants].sort(compareQuality)[0]);
                return lines.filter((_, i) => !remove.has(i)).join('\n');
            }
        } catch { /* Preserve playback if a manifest format is not supported. */ }
        return text;
    }
    function isManifest(url, type = '') {
        return /\.(mpd|m3u8)(?:[?#]|$)/i.test(url || '') || /dash\+xml|mpegurl/i.test(type);
    }
    function preserveResponseMetadata(response, original) {
        for (const key of ['url', 'redirected', 'type']) {
            Object.defineProperty(response, key, {value: original[key], configurable: true});
        }
        const clone = response.clone.bind(response);
        response.clone = () => preserveResponseMetadata(clone(), original);
        return response;
    }
    if (typeof window.fetch === 'function') {
        const nativeFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await Reflect.apply(nativeFetch, this, args);
            if (!qualityEnabled || !response.ok || !isManifest(response.url, response.headers.get('content-type'))) return response;
            try {
                const text = await response.clone().text();
                const filtered = filterManifest(text);
                if (filtered === text) return response;
                const headers = new Headers(response.headers);
                headers.delete('content-length'); headers.delete('content-encoding');
                return preserveResponseMetadata(new Response(filtered, {status:response.status, statusText:response.statusText, headers}), response);
            } catch { return response; }
        };
    }
    // Bitmovin/Shaka integrations can request manifests through XHR instead of fetch.
    if (typeof XMLHttpRequest !== 'undefined') {
        const proto = XMLHttpRequest.prototype;
        for (const property of ['responseText', 'response']) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, property);
            if (!descriptor?.get || !descriptor.configurable) continue;
            const cache = new WeakMap();
            Object.defineProperty(proto, property, {...descriptor, get() {
                const raw = descriptor.get.call(this);
                if (!qualityEnabled || this.readyState !== 4 || this.status < 200 || this.status >= 300 ||
                    !isManifest(this.responseURL, this.getResponseHeader('content-type'))) return raw;
                const last = cache.get(this);
                if (last?.raw === raw) return last.value;
                let value = raw;
                try {
                    if (typeof raw === 'string') value = filterManifest(raw);
                    else if (raw instanceof ArrayBuffer) {
                        const text = new TextDecoder().decode(raw), filtered = filterManifest(text);
                        if (filtered !== text) value = new TextEncoder().encode(filtered).buffer;
                    }
                } catch {}
                cache.set(this, {raw, value});
                return value;
            }});
        }
    }

    function startUI() {
    if (document.documentElement.dataset.crEnhancerLoaded) return;
    document.documentElement.dataset.crEnhancerLoaded = '6.0.0';

    // Use the player's Fullscreen button; added controls appear only in that mode.
    const enableSkipIntro = 1;
    const enableSkipCredits = 1;
    const enableVolumeControl = 1;
    const enableSpeedMenu = 1;
    const volumePercentage = 5;
    const desiredSpeedOptions = [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

    const addStyle = typeof GM_addStyle === 'function' ? GM_addStyle : css => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    };
    addStyle(`
        .cr-native-controls-hidden {
            opacity: 0 !important; pointer-events: none !important;
            transition: opacity 60ms linear !important;
        }
        .cr-native-cursor-hidden, .cr-native-cursor-hidden * { cursor: none !important; }
        .cr-native-cursor-hidden [data-testid="top-gradient"] {
            opacity: 0 !important; pointer-events: none !important;
        }

        [data-cr-extra-speed][aria-checked="true"] { background: rgba(255,255,255,.08); }
        [data-cr-speed-selected="false"] svg { visibility: hidden; }
        [data-cr-speed-selected="false"][aria-checked="true"] { background-color: transparent !important; }
        #toast-container {
            position: absolute; left: 50%; top: 20px; transform: translateX(-50%);
            z-index: 2147483647; padding: 8px 12px; border-radius: 5px;
            background: #141519e8; color: #fff; font: 16px Arial,sans-serif;
            pointer-events: none;
        }
    `);

    function getPlayerRoot(video) {
        return video?.closest('#player-container, #vilos') || video?.parentElement || null;
    }
    function isPlayerFullscreen(video = document.querySelector('video')) {
        const fs = document.fullscreenElement;
        return !!(video && fs && fs.contains(video));
    }
    let toastTimer;
    function showToast(message) {
        if (!isPlayerFullscreen()) return;
        const mount = document.fullscreenElement;
        if (mount.matches('video, iframe')) return;
        let toast = document.getElementById('toast-container');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-container';
            toast.setAttribute('role', 'status');
        }
        if (toast.parentElement !== mount) mount.appendChild(toast);
        toast.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.remove(), 700);
    }

    let volumeEnabled = true;
    document.addEventListener('keydown', event => {
        if (!enableVolumeControl || !isPlayerFullscreen() || event.repeat ||
            event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (event.key === 'Shift') {
            volumeEnabled = !volumeEnabled;
            showToast(`Mouse volume ${volumeEnabled ? 'on' : 'off'}`);
        }
    });
    document.addEventListener('wheel', event => {
        const video = document.querySelector('video');
        const root = getPlayerRoot(video);
        if (!enableVolumeControl || !volumeEnabled || !isPlayerFullscreen(video) ||
            !root?.contains(event.target) || !event.deltaY || event.altKey || event.ctrlKey || event.metaKey ||
            event.target.closest?.('[role="menu"], [role="listbox"], input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        const step = event.deltaY < 0 ? volumePercentage / 100 : -volumePercentage / 100;
        video.volume = Math.min(1, Math.max(0, video.volume + step));
        if (step > 0) video.muted = false;
        showToast(`Volume: ${Math.round(video.volume * 100)}%`);
    }, {passive: false});

    function parseSpeed(element) {
        const label = (element.getAttribute('aria-label') || element.textContent).trim().toLowerCase().replace(',', '.');
        if (label === 'normal' || label === 'normal speed') return 1;
        const match = label.match(/^(\d+(?:\.\d+)?)\s*[x×]$/);
        return match ? Number(match[1]) : null;
    }
    const optionSelector = '[role="menuitemradio"], [role="menuitem"], [role="option"], button';
    function setSpeed(rate) {
        const video = document.querySelector('video');
        if (!isPlayerFullscreen(video)) return;
        for (const property of ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch']) {
            if (property in video) video[property] = true;
        }
        video.playbackRate = rate;
        updateSelection(video);
        showToast(`Speed: ${rate}x`);
    }
    function updateSelection(video) {
        for (const menu of document.querySelectorAll('[data-cr-speed-list]')) {
            for (const row of menu.querySelectorAll(optionSelector)) {
                const rate = parseSpeed(row);
                if (rate === null) continue;
                const selected = rate === video.playbackRate;
                row.dataset.crSpeedSelected = String(selected);
                if (row.dataset.crExtraSpeed) {
                    row.setAttribute('aria-checked', String(selected));
                    const marker = row.querySelector('[data-cr-check]');
                    if (marker) marker.textContent = selected ? '✓' : '';
                }
            }
        }
    }
    function removeExtraSpeeds() {
        document.querySelectorAll('[data-cr-extra-speed]').forEach(el => el.remove());
        document.querySelectorAll('[data-cr-speed-selected]').forEach(el => el.removeAttribute('data-cr-speed-selected'));
        document.querySelectorAll('[data-cr-speed-list]').forEach(el => el.removeAttribute('data-cr-speed-list'));
    }
    function extendNativeSpeedMenu(video) {
        if (!enableSpeedMenu || !isPlayerFullscreen(video)) { removeExtraSpeeds(); return; }
        const root = getPlayerRoot(video);
        // Current Edge player: labelled menu > scroll container > menuitemradio.
        // Only extend a container whose direct children are native speed rows.
        const lists = new Set();
        root.querySelectorAll(optionSelector).forEach(row => {
            if (!row.dataset.crExtraSpeed && parseSpeed(row) !== null && row.closest('[role="menu"], [role="listbox"]')) lists.add(row.parentElement);
        });
        for (const list of lists) {
            const original = [...list.children].filter(row => row.matches(optionSelector) && !row.dataset.crExtraSpeed && parseSpeed(row) !== null);
            if (original.length < 2 || !list.getClientRects().length) continue;
            list.dataset.crSpeedList = 'true';
            const template = original.find(row => row.getAttribute('aria-checked') !== 'true') || original[0];
            for (const rate of desiredSpeedOptions) {
                if ([...list.children].some(row => parseSpeed(row) === rate)) continue;
                const row = template.cloneNode(true);
                for (const el of [row, ...row.querySelectorAll('*')]) {
                    el.removeAttribute('id');
                    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
                }
                row.dataset.crExtraSpeed = String(rate);
                row.setAttribute('aria-label', `${rate}x`);
                row.setAttribute('role', 'menuitemradio');
                row.setAttribute('aria-checked', 'false');
                row.setAttribute('aria-disabled', 'false');
                row.tabIndex = 0;
                if ('disabled' in row) row.disabled = false;
                // Reuse the native label wrapper, spacing, fonts and hover styles.
                const label = [...row.querySelectorAll('*')].find(el => !el.children.length && /^\s*\d+(?:[.,]\d+)?\s*[x×]\s*$/.test(el.textContent));
                if (label) label.textContent = `${rate}x`; else row.textContent = `${rate}x`;
                row.querySelectorAll('svg').forEach(el => el.remove());
                if (row.children.length > 1) {
                    const marker = row.lastElementChild;
                    marker.replaceChildren();
                    marker.dataset.crCheck = 'true';
                    marker.setAttribute('aria-hidden', 'true');
                }
                const activate = event => {
                    event.preventDefault(); event.stopPropagation();
                    setSpeed(rate);
                };
                row.addEventListener('click', activate);
                row.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') activate(event);
                    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                        event.preventDefault(); event.stopPropagation();
                        const options = [...list.children].filter(el => el.matches(optionSelector));
                        let index = options.indexOf(row);
                        index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1 :
                            (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                        options[index].focus();
                    }
                });
                const next = [...list.children].find(el => parseSpeed(el) > rate);
                list.insertBefore(row, next || null);
            }
        }
        updateSelection(video);
    }

// Retry a failed click after a cooldown, never on every 250 ms tick.
const skipAttempts = new WeakMap();
function checkSkipButtons() {
    const video = document.querySelector('video');
    if (!video) return;
    const root = getPlayerRoot(video);
    const candidates = root.querySelectorAll(
        '[data-testid*="skip" i], button, [role="button"]'
    );
    const seen = new Set();
    for (const label of candidates) {
        const button = label.closest('button, [role="button"]') || label;
        if (seen.has(button)) continue;
        seen.add(button);
        if (button.disabled || button.getAttribute('aria-disabled') === 'true' ||
            button.closest('[hidden], [aria-hidden="true"]') || !button.getClientRects().length ||
            getComputedStyle(button).visibility === 'hidden') continue;
        const text = [button.textContent, button.getAttribute('aria-label'),
            button.getAttribute('title')].filter(Boolean).join(' ').trim();
        const testId = label.getAttribute('data-testid') || '';
        // skipIntroText is also used for credits, so inspect the label first.
        const credits = /skip\s+(?:credits|outro|ending)|(?:jeneriği|kapanışı)\s+atla|salta\s+(?:i\s+)?titoli/i.test(text) || /skip.*(?:credits|outro|ending)/i.test(testId);
        const intro = !credits && (/skip\s+(?:intro|opening)|(?:girişi|açılışı)\s+atla|salta\s+(?:l.intro|intro|sigla)/i.test(text) || /skip.*(?:intro|opening)/i.test(testId));
        if (!((credits && enableSkipCredits === 1) || (intro && enableSkipIntro === 1))) continue;
        const previous = skipAttempts.get(button);
        const now = Date.now();
        const signature = video.currentSrc + '|' + text;
        if (previous && previous.signature === signature && now - previous.time < 3000) continue;
        skipAttempts.set(button, {signature, time: now});
        button.click();
    }
}


const nativeFullscreenHideDelay = 700;

let nativeFullscreenRoot = null;
let nativeFullscreenControls = null;
let nativeFullscreenHideTimer = null;

function findNativeFullscreenControls(fullscreenRoot) {
    if (!fullscreenRoot) return null;

    const fullscreenButton = Array.from(
        fullscreenRoot.querySelectorAll('button')
    ).find((button) =>
        /fullscreen/i.test(
            button.getAttribute('aria-label') ||
            button.textContent ||
            ''
        )
    );

    if (!fullscreenButton) return null;

    let candidate = fullscreenButton.parentElement;

    while (
        candidate &&
        candidate !== fullscreenRoot
    ) {
        const hasTimeline = candidate.querySelector(
            '[aria-label*="timeline" i]'
        );

        const hasPlaybackButton = Array.from(
            candidate.querySelectorAll('button')
        ).some((button) =>
            /^(play|pause)\b/i.test(
                button.getAttribute('aria-label') ||
                ''
            )
        );

        if (
            hasTimeline &&
            hasPlaybackButton &&
            !candidate.querySelector('video')
        ) {
            return candidate;
        }

        candidate = candidate.parentElement;
    }

    return null;
}

function nativeFullscreenMenuIsOpen() {
    if (!nativeFullscreenRoot) return false;

    if (
        nativeFullscreenRoot.querySelector(
            '[aria-expanded="true"]'
        )
    ) {
        return true;
    }

    return Array.from(
        nativeFullscreenRoot.querySelectorAll(
            '[role="menu"]'
        )
    ).some((menu) =>
        !menu.hidden && menu.getClientRects().length > 0 &&
        getComputedStyle(menu).visibility !== 'hidden' &&
        menu.getAttribute('aria-hidden') !== 'true'
    );
}

function clearNativeFullscreenHideTimer() {
    if (!nativeFullscreenHideTimer) return;

    clearTimeout(nativeFullscreenHideTimer);
    nativeFullscreenHideTimer = null;
}

function showNativeFullscreenControls() {
    nativeFullscreenControls?.classList.remove(
        'cr-native-controls-hidden'
    );

    nativeFullscreenRoot?.classList.remove(
        'cr-native-cursor-hidden'
    );
}

function scheduleNativeFullscreenHide() {
    clearNativeFullscreenHideTimer();

    if (
        !document.fullscreenElement ||
        !nativeFullscreenRoot ||
        !nativeFullscreenControls
    ) {
        return;
    }

    nativeFullscreenHideTimer = setTimeout(() => {
        nativeFullscreenHideTimer = null;

        if (nativeFullscreenMenuIsOpen()) {
            scheduleNativeFullscreenHide();
            return;
        }

        nativeFullscreenControls.classList.add(
            'cr-native-controls-hidden'
        );

        nativeFullscreenRoot.classList.add(
            'cr-native-cursor-hidden'
        );
    }, nativeFullscreenHideDelay);
}

function handleNativeFullscreenActivity() {
    if (!document.fullscreenElement) return;

    showNativeFullscreenControls();
    scheduleNativeFullscreenHide();
}

function unbindNativeFullscreenAutoHide() {
    clearNativeFullscreenHideTimer();

    if (nativeFullscreenRoot) {
        [
            'mousemove',
            'pointermove',
            'pointerdown',
            'wheel',
        ].forEach((eventName) => {
            nativeFullscreenRoot.removeEventListener(
                eventName,
                handleNativeFullscreenActivity
            );
        });
    }

    document.removeEventListener(
        'keydown',
        handleNativeFullscreenActivity
    );

    showNativeFullscreenControls();

    nativeFullscreenRoot = null;
    nativeFullscreenControls = null;
}

function refreshNativeFullscreenAutoHide() {
    const fullscreenRoot = document.fullscreenElement;

    if (!fullscreenRoot) {
        if (nativeFullscreenRoot) {
            unbindNativeFullscreenAutoHide();
        }

        return;
    }

    const controls = findNativeFullscreenControls(
        fullscreenRoot
    );

    if (!controls) { unbindNativeFullscreenAutoHide(); return; }

    if (
        nativeFullscreenRoot === fullscreenRoot &&
        nativeFullscreenControls === controls
    ) {
        return;
    }

    unbindNativeFullscreenAutoHide();

    nativeFullscreenRoot = fullscreenRoot;
    nativeFullscreenControls = controls;

    [
        'mousemove',
        'pointermove',
        'pointerdown',
        'wheel',
    ].forEach((eventName) => {
        nativeFullscreenRoot.addEventListener(
            eventName,
            handleNativeFullscreenActivity
        );
    });

    document.addEventListener(
        'keydown',
        handleNativeFullscreenActivity
    );

    showNativeFullscreenControls();
    scheduleNativeFullscreenHide();
}

document.addEventListener(
    'fullscreenchange',
    refreshNativeFullscreenAutoHide
);


    function refreshQualityMenu(video) {
        if (!isPlayerFullscreen(video)) {
            document.querySelectorAll('[data-cr-quality-lock], [data-cr-quality-reload]').forEach(el => el.remove());
            return;
        }
        const root = getPlayerRoot(video);
        // Current native menu inspected in Edge; use its label and row styles.
        for (const menu of root.querySelectorAll('[role="menu"][aria-label="Quality"]')) {
            const choices = [...menu.children].filter(el => el.matches('[role="menuitemradio"]'));
            if (!choices.length) continue;
            let row = menu.querySelector('[data-cr-quality-lock]');
            if (!row) {
                const template = choices.find(el => el.getAttribute('aria-checked') !== 'true') || choices[0];
                row = template.cloneNode(true);
                for (const el of [row, ...row.querySelectorAll('*')]) {
                    el.removeAttribute('id');
                    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
                }
                row.dataset.crQualityLock = 'true';
                row.setAttribute('role', 'menuitemcheckbox');
                row.setAttribute('aria-label', 'Maximum quality — locked');
                row.setAttribute('aria-disabled', 'false');
                row.tabIndex = 0;
                row.querySelectorAll('svg').forEach(el => el.remove());
                const labels = row.querySelectorAll('span');
                if (labels[0]) labels[0].textContent = 'Maximum quality — locked';
                else row.textContent = 'Maximum quality — locked';
                if (labels[1]) labels[1].dataset.crQualityStatus = 'true';
                const activate = event => {
                    event.preventDefault(); event.stopPropagation();
                    setQualityEnabled(!qualityEnabled);
                    refreshQualityMenu(video);
                };
                row.addEventListener('click', activate);
                row.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') activate(event);
                });
                menu.insertBefore(row, choices[0]);
            }
            row.setAttribute('aria-checked', String(qualityEnabled));
            const description = qualityReloadNeeded ? `${qualityEnabled ? 'On' : 'Off'} · reload to apply` :
                !qualityEnabled ? 'Off · use Crunchyroll quality settings' : qualityApplied ?
                `On · ${qualitySummary || 'maximum stream selected'}` : 'On · waiting for the next playback load';
            row.setAttribute('aria-description', description);
            const status = row.querySelector('[data-cr-quality-status]');
            if (status && status.textContent !== description) status.textContent = description;
            if (row.children.length > 1) {
                const check = row.lastElementChild;
                const text = qualityEnabled ? '✓' : '';
                if (check.textContent !== text) check.textContent = text;
                check.setAttribute('aria-hidden', 'true');
            }
            let reload = menu.querySelector('[data-cr-quality-reload]');
            if (qualityReloadNeeded && !reload) {
                reload = document.createElement('button');
                reload.type = 'button'; reload.dataset.crQualityReload = 'true';
                reload.className = choices[0].className;
                reload.textContent = 'Reload to apply';
                reload.setAttribute('role', 'menuitem');
                reload.addEventListener('click', event => {event.stopPropagation(); location.reload();});
                menu.insertBefore(reload, row.nextSibling);
            }
            // Selecting a built-in mode turns our lock off for the next load.
            for (const choice of choices) {
                if (qualityBoundChoices.has(choice)) continue;
                qualityBoundChoices.add(choice);
                choice.addEventListener('click', () => {
                    setQualityEnabled(false);
                    showToast('Quality lock off — reload to apply');
                    refreshQualityMenu(video);
                }, true);
            }
        }
    }
    const qualityBoundChoices = new WeakSet();

    function refreshPlayer() {
        refreshNativeFullscreenAutoHide();
        const video = document.querySelector('video');
        if (!video) { removeExtraSpeeds(); return; }
        extendNativeSpeedMenu(video);
        refreshQualityMenu(video);
        if (enableSkipIntro || enableSkipCredits) checkSkipButtons();
        if (!isPlayerFullscreen(video)) document.getElementById('toast-container')?.remove();
    }
    let pending = false;
    const observer = new MutationObserver(records => {
        // Ignore our own additions so extending the menu cannot cause a loop.
        const changed = records.some(record => [...record.addedNodes].some(node =>
            node.nodeType === 1 && !node.matches('[data-cr-extra-speed], #toast-container') &&
            (node.matches('video, iframe, [role="menu"], [role="menuitemradio"]') || node.querySelector('video, [role="menu"]'))
        ));
        if (changed && !pending) {
            pending = true;
            queueMicrotask(() => { pending = false; refreshPlayer(); });
        }
    });
    observer.observe(document.documentElement, {childList: true, subtree: true});
    document.addEventListener('fullscreenchange', refreshPlayer);
    document.addEventListener('ratechange', () => {
        const video = document.querySelector('video');
        if (video && isPlayerFullscreen(video)) updateSelection(video);
    }, true);
    window.addEventListener('pageshow', refreshPlayer);
    refreshPlayer();
    setInterval(refreshPlayer, 250);
    }
    if (document.body) startUI();
    else document.addEventListener("DOMContentLoaded", startUI, {once:true});
})();
