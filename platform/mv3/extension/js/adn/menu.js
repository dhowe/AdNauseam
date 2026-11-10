/*******************************************************************************
    AdNauseam MV3 - Popup Menu Script

    Handles the AdNauseam popup (extension icon click).
    Maps state buttons to MV3 filtering modes:
      - Active  → MODE_COMPLETE (3) — full cosmetic filtering (hide all ads)
      - Off     → MODE_NONE (0)     — no blocking
*******************************************************************************/

const MODE_NONE = 0;
const MODE_OPTIMAL = 2;
const MODE_COMPLETE = 3;

const stateToLevel = {
  active: MODE_COMPLETE,   // ADN: Complete enables generic cosmetic filtering
  strict: MODE_COMPLETE,   // ADN: Complete + per-site ad re-block (see commitState)
  disable: MODE_NONE,
};

// Strict shares the Complete level with Active — it's distinguished by the
// per-site strict list, so init() overrides to 'strict' when the site is strict.
const levelToState = {
  [MODE_NONE]: 'disable',
  1: 'active',             // MODE_BASIC
  [MODE_OPTIMAL]: 'active',
  [MODE_COMPLETE]: 'active',
};

let currentTab = null;
let currentHostname = '';
let currentLevel = MODE_OPTIMAL;

/******************************************************************************/
// DOM helpers

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/******************************************************************************/
// Messaging

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

/******************************************************************************/
// Stats

const i18n$ = (...args) => chrome.i18n.getMessage(...args);

// Mirrors setCounts() in MV2 menu.js: the counts go into the localized
// templates ("clicked {{number}}" / "{{count}} Ads detected") rather than
// being written out as bare numbers.
async function setCounts(clicked, total) {
  $('#visited').textContent = i18n$('adnMenuAdsClicked').replace('{{number}}', clicked);
  $('#found').textContent = i18n$('adnMenuAdsDetected').replace('{{count}}', total);
  const vaultCount = $('#vault-count');
  if (vaultCount) {
    vaultCount.textContent = total || 0;
  }
  await setCost(clicked);
  adjustStatCSS();
}

// Mirrors setCost() in MV2 adn-utils.js.
async function setCost(clicked) {
  const west = $('#worth-estimate');
  if (clicked > 0) {
    const costPerClick = await sendMessage({ what: 'getCostPerClick' }) || 0;
    west.textContent = '= $' + (clicked * costPerClick).toFixed(2);
    $$('.cost').forEach(el => el.classList.remove('hidden'));
  } else {
    west.textContent = '';
    $$('.cost').forEach(el => el.classList.add('hidden'));
  }
}

// Mirrors adjustStatCSS() in MV2 menu.js: keeps the now-longer stats line
// from pushing the header onto a second row.
function adjustStatCSS() {
  const wrapper = $('#stats .wrapper');
  if (wrapper && wrapper.clientHeight > 20) {
    wrapper.style.float = 'right';
    wrapper.style.marginLeft = '-25px';
  }
}

async function updateStats() {
  try {
    const stats = await sendMessage({ what: 'getAdNauseamStats' });
    if (stats) {
      await setCounts(stats.totalClicks || 0, stats.totalAds || 0);
    }
  } catch (e) {
    console.warn('[ADN Menu] Stats error:', e);
  }
}

/******************************************************************************/
// Ad list

let showingRecent = false;

async function renderAdList() {
  const list = $('#ad-list-items');
  const alert = $('#alert-noads');

  let ads = [];
  showingRecent = false;

  try {
    if (currentTab && currentTab.url) {
      const result = await sendMessage({
        what: 'adsForPage',
        pageUrl: currentTab.url
      });

      if (result) {
        ads = result.data || [];
        showingRecent = !!result.recent;

        // Update stats from page response too (includes global totals)
        if (result.total !== undefined && result.clicked !== undefined) {
          await setCounts(result.clicked, result.total);
        }
      }
    }
  } catch (e) {
    console.warn('[ADN Menu] Ad list error:', e);
  }

  list.innerHTML = '';
  list.classList.remove('recent-ads');

  if (!ads || ads.length === 0) {
    alert.classList.remove('hide');
    alert.querySelector('p').textContent = 'No ads collected yet';
    return;
  }

  if (showingRecent) {
    alert.classList.remove('hide');
    alert.querySelector('p').textContent = 'No ads on this page — showing recent';
    list.classList.add('recent-ads');
  } else {
    alert.classList.add('hide');
  }

  for (const ad of ads) {
    list.appendChild(createAdElement(ad));
  }
}

function createAdElement(ad) {
  const li = document.createElement('li');
  li.id = 'ad' + ad.id;

  const isImg = ad.contentType === 'img';
  const src = isImg ? (ad.contentData && ad.contentData.src) : null;
  const title = ad.title || (ad.contentData && ad.contentData.title) || 'Ad #' + ad.id;

  if (isImg && src) {
    // Image ad — matches original .ad-item structure
    li.className = ('ad-item ' + adStatusClass(ad)).trim();

    const a = document.createElement('a');
    a.target = 'new';
    a.href = ad.targetUrl || '#';

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    const thumbContainer = document.createElement('span');
    thumbContainer.className = 'thumb-container';
    const img = document.createElement('img');
    img.src = src;
    img.className = 'ad-item-img';
    img.onerror = function() {
      this.style.width = '80px';
      this.style.height = '40px';
      this.src = 'img/placeholder.svg';
      this.onerror = null;
    };
    thumbContainer.appendChild(img);
    thumb.appendChild(thumbContainer);
    a.appendChild(thumb);

    const status = document.createElement('span');
    status.className = 'adStatus';
    status.textContent = adStatusLabel(ad);
    a.appendChild(status);

    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    titleEl.textContent = title.substring(0, 60);
    a.appendChild(titleEl);

    const cite = document.createElement('cite');
    cite.textContent = pageDomain(ad);
    a.appendChild(cite);

    li.appendChild(a);
  } else {
    // Text ad — matches original .ad-item-text structure
    li.className = ('ad-item-text ' + adStatusClass(ad)).trim();

    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    thumb.textContent = 'Text Ad';
    li.appendChild(thumb);

    const status = document.createElement('span');
    status.className = 'adStatus';
    status.textContent = adStatusLabel(ad);
    li.appendChild(status);

    const h3 = document.createElement('h3');
    const a = document.createElement('a');
    a.target = 'new';
    a.href = ad.targetUrl || '#';
    a.className = 'title';
    a.textContent = title.substring(0, 60);
    h3.appendChild(a);
    li.appendChild(h3);

    const cite = document.createElement('cite');
    cite.textContent = pageDomain(ad);
    li.appendChild(cite);
  }

  return li;
}

function adStatusClass(ad) {
  if (ad.visitedTs > 0) return 'visited';
  if (ad.visitedTs < 0) return 'failed';
  if (ad.noVisit) return 'skipped';
  return 'pending';
}

function adStatusLabel(ad) {
  if (ad.visitedTs > 0) return 'visited';
  if (ad.visitedTs < 0) return 'failed';
  if (ad.noVisit) return 'skipped';
  return 'pending';
}

function targetDomain(ad) {
  try {
    return new URL(ad.resolvedTargetUrl || ad.targetUrl).hostname;
  } catch {
    return ad.targetDomain || '';
  }
}

function pageDomain(ad) {
  if (ad.pageDomain) return ad.pageDomain;
  try {
    return new URL(ad.pageUrl).hostname;
  } catch {
    return '';
  }
}

/******************************************************************************/
// State buttons (Strict / Active / Off)

function setActiveState(state) {
  // Use radio inputs matching the original menu.html structure
  const radios = $$('input[name="state_btn"]');
  radios.forEach(radio => { radio.checked = false; });
  const radio = $(`input[name="state_btn"][value="${state}"]`);
  if (radio) radio.checked = true;

  // Update body class for styling
  document.body.className = state === 'disable' ? 'disabled' : state;
}

async function commitState(state) {
  const level = stateToLevel[state];
  if (level === undefined) return;

  setActiveState(state);

  try {
    const hostname = currentHostname || 'all-urls';
    const actualLevel = await sendMessage({
      what: 'setFilteringMode',
      hostname,
      level,
    });

    currentLevel = actualLevel !== undefined ? actualLevel : level;

    // ADN: strict adds a per-site ad re-block overlay (collection still runs);
    // any other state (active/disable) clears it.
    await sendMessage({ what: 'setAdnStrict', hostname, enabled: state === 'strict' });

    if (currentTab && currentTab.id) {
      chrome.tabs.reload(currentTab.id);
    }
  } catch (e) {
    console.warn('[ADN Menu] Mode change error:', e);
  }
}

/******************************************************************************/
// Event listeners

function setupEvents() {
  // State buttons (radio inputs in original menu.html structure)
  $$('input[name="state_btn"]').forEach(radio => {
    radio.addEventListener('change', () => {
      commitState(radio.value);
    });
  });

  // uBlock button → show the original uBOLite popup inline (stay in popup)
  $('#btn-ublock').addEventListener('click', () => {
    window.location.href = 'popup-ubol.html';
  });

  // Settings → open dashboard
  $('#btn-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Vault button → open vault page
  $('#vault-button').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('vault.html') });
    window.close();
  });

  // AdNauseam logo → open website
  $('#toggle-button').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://adnauseam.io' });
    window.close();
  });

  // Listen for ad updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.what === 'adDetected' || msg.what === 'adVisited') {
      updateStats();
      renderAdList();
    }
  });
}

/******************************************************************************/
// Init

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTab = tab;
    try {
      const url = new URL(tab.url);
      // Only web pages have a hostname to filter: chrome://extensions would
      // otherwise yield "extensions"
      if (/^https?:$/.test(url.protocol)) {
        currentHostname = url.hostname;
      }
    } catch {}
  }

  // AdNauseam doesn't run on browser/extension pages (chrome://, about:,
  // vault, dashboard...): show it as disabled, with the state buttons locked.
  // Mirrors renderPage() in MV2 menu.js.
  if (currentHostname === '') {
    currentLevel = MODE_NONE;
    $('#state_btn-wrapper').classList.add('disabled');
    $$('input[name="state_btn"]').forEach(radio => { radio.disabled = true; });
  } else {
    // Get current filtering mode
    try {
      const response = await sendMessage({
        what: 'popupPanelData',
        hostname: currentHostname,
      });
      if (response && response.level !== undefined) {
        currentLevel = response.level;
      }
    } catch {}
  }

  // Set initial state from filtering level; strict overlay takes precedence.
  let state = levelToState[currentLevel] || 'active';
  if (state !== 'disable' && currentHostname) {
    const strict = await sendMessage({ what: 'getAdnStrict', hostname: currentHostname });
    if (strict && strict.enabled) state = 'strict';
  }
  setActiveState(state);

  // Load stats and ads  
  await updateStats();
  await renderAdList();

  // Periodic refresh
  setInterval(updateStats, 3000);

  setupEvents();
}

init();
