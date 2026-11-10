/*******************************************************************************

    AdNauseam Lite - a comprehensive, MV3-compliant content blocker
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

import { browser, runtime, sendMessage } from './ext.js';
import { dom, qs$ } from './dom.js';
import { i18n$ } from './i18n.js';
import punycode from './punycode.js';

/******************************************************************************/

const popupPanelData = {};
const  currentTab = {};
const tabURL = new URL(runtime.getURL('/'));

/******************************************************************************/

function renderAdminRules() {
    const { disabledFeatures: forbid = [] } = popupPanelData;
    if ( forbid.length === 0 ) { return; }
    dom.body.dataset.forbid = forbid.join(' ');
}

/******************************************************************************/

const BLOCKING_MODE_MAX = 3;

async function setFilteringMode(level, commit = false) {
    const modeSlider = qs$('.filteringModeSlider');
    modeSlider.dataset.level = level;
    if ( qs$('.filteringModeSlider.moving') === null ) {
        dom.text(
            '#filteringModeText > span:nth-of-type(1)',
            i18n$(`filteringMode${level}Name`)
        );
    }
    if ( commit !== true ) { return; }
    dom.cl.add(dom.body, 'busy');
    await commitFilteringMode();
    dom.cl.remove(dom.body, 'busy');
}

async function commitFilteringMode() {
    if ( tabURL.hostname === '' ) { return; }
    const targetHostname = tabURL.hostname;
    const modeSlider = qs$('.filteringModeSlider');
    const afterLevel = parseInt(modeSlider.dataset.level, 10);
    const beforeLevel = parseInt(modeSlider.dataset.levelBefore, 10);
    if ( afterLevel > 1 ) {
        if ( beforeLevel <= 1 ) {
            sendMessage({
                what: 'setPendingFilteringMode',
                tabId: currentTab.id,
                url: tabURL.href,
                hostname: targetHostname,
                beforeLevel,
                afterLevel,
            });
        }
        let granted = false;
        try {
            granted = await browser.permissions.request({
                origins: [ `*://*.${targetHostname}/*` ],
            });
        } catch {
        }
        if ( granted !== true ) {
            setFilteringMode(beforeLevel);
            return;
        }
    }
    dom.text(
        '#filteringModeText > span:nth-of-type(1)',
        i18n$(`filteringMode${afterLevel}Name`)
    );
    const actualLevel = await sendMessage({
        what: 'setFilteringMode',
        hostname: targetHostname,
        level: afterLevel,
    });
    if ( actualLevel !== afterLevel ) {
        setFilteringMode(actualLevel);
    }
    if ( actualLevel !== beforeLevel && popupPanelData.autoReload ) {
        const justReload = tabURL.href === currentTab.url;
        self.setTimeout(( ) => {
            if ( justReload ) {
                browser.tabs.reload(currentTab.id);
            } else {
                browser.tabs.update(currentTab.id, { url: tabURL.href });
            }
        }, 437);
    }
}

{
    let mx0 = 0;
    let mx1 = 0;
    let l0 = 0;
    let lMax = 0;
    let timer;

    const move = ( ) => {
        timer = undefined;
        const l1 = Math.min(Math.max(l0 + mx1 - mx0, 0), lMax);
        let level = Math.floor(l1 * BLOCKING_MODE_MAX / lMax);
        if ( qs$('body[dir="rtl"]') !== null ) {
            level = 3 - level;
        }
        const modeSlider = qs$('.filteringModeSlider');
        if ( `${level}` === modeSlider.dataset.level ) { return; }
        dom.text(
            '#filteringModeText > span:nth-of-type(2)',
            i18n$(`filteringMode${level}Name`)
        );
        setFilteringMode(level);
    };

    const moveAsync = ev => {
        if ( timer !== undefined ) { return; }
        mx1 = ev.pageX;
        timer = self.requestAnimationFrame(move);
    };

    const stop = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') === false ) { return; }
        dom.cl.remove(modeSlider, 'moving');
        self.removeEventListener('mousemove', moveAsync, { capture: true });
        self.removeEventListener('mouseup', stop, { capture: true });
        dom.text('#filteringModeText > span:nth-of-type(2)', '');
        commitFilteringMode();
        ev.stopPropagation();
        ev.preventDefault();
        if ( timer !== undefined ) {
            self.cancelAnimationFrame(timer);
            timer = undefined;
        }
    };

    const startSliding = ev => {
        if ( ev.button !== 0 ) { return; }
        const modeButton = qs$('.filteringModeButton');
        if ( ev.currentTarget !== modeButton ) { return; }
        const modeSlider = qs$('.filteringModeSlider');
        if ( dom.cl.has(modeSlider, 'moving') ) { return; }
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        mx0 = ev.pageX;
        const buttonRect = modeButton.getBoundingClientRect();
        l0 = buttonRect.left + buttonRect.width / 2;
        const sliderRect = modeSlider.getBoundingClientRect();
        lMax = sliderRect.width - buttonRect.width ;
        dom.cl.add(modeSlider, 'moving');
        self.addEventListener('mousemove', moveAsync, { capture: true });
        self.addEventListener('mouseup', stop, { capture: true });
        ev.stopPropagation();
        ev.preventDefault();
    };

    dom.on('.filteringModeButton', 'mousedown', startSliding);
}

dom.on(
    '.filteringModeSlider',
    'click',
    '.filteringModeSlider span[data-level]',
    ev => {
        const modeSlider = qs$('.filteringModeSlider');
        modeSlider.dataset.levelBefore = modeSlider.dataset.level;
        const span = ev.target;
        const level = parseInt(span.dataset.level, 10);
        setFilteringMode(level, true);
    }
);

if ( dom.cl.has(dom.html, 'mobile') === false ) {
    dom.on('.filteringModeSlider',
        'mouseenter',
        '.filteringModeSlider span[data-level]',
        ev => {
            const span = ev.target;
            const level = parseInt(span.dataset.level, 10);
            dom.text('#filteringModeText > span:nth-of-type(2)',
                i18n$(`filteringMode${level}Name`)
            );
        }
    );

    dom.on('.filteringModeSlider',
        'mouseleave',
        '.filteringModeSlider span[data-level]',
        ( ) => {
            dom.text('#filteringModeText > span:nth-of-type(2)', '');
        }
    );
}

/******************************************************************************/

dom.on('#gotoMatchedRules', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    if ( ev.button !== 0 ) { return; }
    sendMessage({
        what: 'showMatchedRules',
        tabId: currentTab.id,
    });
});

/******************************************************************************/

dom.on('#gotoReport', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    let url;
    try {
        url = new URL(currentTab.url);
    } catch {
    }
    if ( url === undefined ) { return; }
    const reportURL = new URL(runtime.getURL('/report.html'));
    reportURL.searchParams.set('tabid', currentTab.id);
    reportURL.searchParams.set('url', tabURL.href);
    reportURL.searchParams.set('mode', popupPanelData.level);
    sendMessage({
        what: 'gotoURL',
        url: `${reportURL.pathname}${reportURL.search}`,
    });
});

/******************************************************************************/

dom.on('#gotoDashboard', 'click', ev => {
    if ( ev.isTrusted !== true ) { return; }
    if ( ev.button !== 0 ) { return; }
    runtime.openOptionsPage();
});

/******************************************************************************/

dom.on('#gotoZapper', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [ '/js/scripting/tool-overlay.js', '/js/scripting/zapper.js' ],
        target: { tabId: currentTab.id },
    });
    self.close();
});

/******************************************************************************/

dom.on('#gotoPicker', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/picker.js',
        ],
        target: { tabId: currentTab.id },
    });
    self.close();
});

/******************************************************************************/

dom.on('#gotoUnpicker', 'click', ( ) => {
    if ( browser.scripting === undefined ) { return; }
    browser.scripting.executeScript({
        files: [
            '/js/scripting/css-procedural-api.js',
            '/js/scripting/tool-overlay.js',
            '/js/scripting/unpicker.js',
        ],
        target: { tabId: currentTab.id },
    });
    self.close();
});


/******************************************************************************/
// AdNauseam Vault Integration
/******************************************************************************/

async function updateAdNauseamStats() {
    try {
        const response = await sendMessage({ what: 'getAdNauseamStats' });
        if (response) {
            dom.text('#adn-total-ads', response.totalAds || 0);
            dom.text('#adn-total-clicks', response.totalClicks || 0);
        }
    } catch (error) {
        console.error('[ADN Popup] Failed to get stats:', error);
    }
}

function adStatusText(ad) {
    if (ad.visitedTs > 0) return 'visited';
    if (ad.visitedTs < 0) return 'failed';
    if (ad.noVisit) return 'no-visit';
    if (ad.dntAllowed) return 'dnt';
    return 'pending';
}

function adStatusLabel(ad) {
    const status = adStatusText(ad);
    const labels = {
        'visited': 'Visited',
        'failed': 'Failed',
        'no-visit': 'Skipped',
        'dnt': 'DNT',
        'pending': 'Pending'
    };
    return labels[status] || 'Pending';
}

async function renderVault() {
    try {
        const ads = await sendMessage({ what: 'adsForVault' });
        const vaultList = qs$('#adn-vault-list');

        if (!ads || ads.length === 0) {
            vaultList.innerHTML = '<div class="adn-vault-empty">No ads collected yet</div>';
            return;
        }

        // Sort by foundTs descending, show most recent 20
        const sorted = ads.sort((a, b) => (b.foundTs || 0) - (a.foundTs || 0));
        const recentAds = sorted.slice(0, 20);

        vaultList.innerHTML = recentAds.map(ad => {
            let displayUrl = '';
            try {
                displayUrl = ad.targetUrl ? new URL(ad.targetUrl).hostname : '';
            } catch (e) {
                displayUrl = ad.targetDomain || '';
            }

            // Get image source from contentData (MV2 format) or direct fields
            const imgSrc = (ad.contentData && ad.contentData.src) || ad.imgSrc;
            const imgWidth = (ad.contentData && ad.contentData.width) || ad.imgWidth;
            const imgHeight = (ad.contentData && ad.contentData.height) || ad.imgHeight;
            const title = (ad.contentData && ad.contentData.title) || ad.title || 'Untitled Ad';
            const text = (ad.contentData && ad.contentData.text) || ad.text || '';

            const imgHtml = imgSrc
                ? `<img src="${imgSrc}" class="adn-vault-img" onerror="this.style.display='none'">`
                : '';

            const status = adStatusText(ad);
            const statusLabel = adStatusLabel(ad);

            return `
                <div class="adn-vault-item ${status}">
                    ${imgHtml}
                    <div class="adn-vault-details">
                        <div class="adn-vault-title">${title}</div>
                        ${text ? `<div class="adn-vault-text">${text.substring(0, 60)}</div>` : ''}
                        <div class="adn-vault-url">${displayUrl}</div>
                        <div class="adn-vault-status ${status}">
                            ${statusLabel}
                            ${imgWidth > 0 ? ` &bull; ${imgWidth}&times;${imgHeight}` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('[ADN Popup] Failed to render vault:', error);
    }
}

dom.on('#adn-toggle-vault', 'click', async () => {
    const vaultList = qs$('#adn-vault-list');
    const isHidden = dom.cl.has(vaultList, 'hidden');

    if (isHidden) {
        dom.cl.remove(vaultList, 'hidden');
        await renderVault();
    } else {
        dom.cl.add(vaultList, 'hidden');
    }
});

dom.on('#adn-clear-vault', 'click', async () => {
    if (!confirm('Clear all ads from vault?')) return;

    try {
        await sendMessage({ what: 'clearAds' });
        await updateAdNauseamStats();
        const vaultList = qs$('#adn-vault-list');
        if (!dom.cl.has(vaultList, 'hidden')) {
            await renderVault();
        }
    } catch (error) {
        console.error('[ADN Popup] Failed to clear vault:', error);
    }
});

// Update stats when popup opens
async function initAdNauseam() {
    await updateAdNauseamStats();
    // Update stats every 2 seconds while popup is open
    setInterval(updateAdNauseamStats, 2000);
}

/******************************************************************************/

async function init() {
    const [ tab ] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    if ( tab instanceof Object === false ) { return false; }
    Object.assign(currentTab, tab);

    let url;
    try {
        const strictBlockURL = runtime.getURL('/strictblock.');
        url = new URL(currentTab.url);
        if ( url.href.startsWith(strictBlockURL) ) {
            url = new URL(url.hash.slice(1));
        }
        tabURL.href = url.href || '';
    } catch {
    }
    if ( url === undefined ) { return false; }
    if ( url.hostname === '' ) { return false; }
    if ( /^https?:/.test(url.protocol) === false ) { return false; }

    const response = await sendMessage({
        what: 'popupPanelData',
        origin: url.origin,
        hostname: tabURL.hostname,
    });
    if ( response instanceof Object === false ) { return false; }
    Object.assign(popupPanelData, response);

    renderAdminRules();

    setFilteringMode(popupPanelData.level);

    dom.text('#hostname', punycode.toUnicode(tabURL.hostname));

    dom.cl.toggle('#gotoMatchedRules', 'enabled',
        popupPanelData.isSideloaded === true &&
        popupPanelData.developerMode &&
        typeof currentTab.id === 'number' &&
        isNaN(currentTab.id) === false
    );

    const isHTTP = url.protocol === 'http:' || url.protocol === 'https:';
    dom.cl.toggle(dom.root, 'isHTTP', isHTTP);

    dom.cl.toggle('#gotoUnpicker', 'enabled', popupPanelData.hasCustomFilters);

		// adn
		await initAdNauseam();

    return true;
}

async function tryInit() {
    try {
        const status = await init();
        if ( status === false ) {
            dom.cl.add(dom.body, 'nodata');
            dom.text('#hostname', i18n$('popupNoWebsite'));
        }
    } catch {
    } finally {
        dom.cl.remove(dom.body, 'loading', 'busy');
    }
}

tryInit();

/******************************************************************************/

