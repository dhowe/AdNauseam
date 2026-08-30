/*******************************************************************************

    AdNauseam MV3 - Ad collection and clicking for uBlock Lite

    Copyright (C) 2014-2024 Daniel C. Howe

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

    Home: https://github.com/dhowe/AdNauseam
*******************************************************************************/

'use strict';

import { log, warn, err } from './log.js';
import {
  type, computeHash, parseDomain, isValidDomain,
  internalLinkDomainsDefault, YaMD5, formatCount
} from './adn-utils.js';

/******************************************************************************/

const maxAttemptsPerAd = 3;
const visitTimeout = 20000;
const pollQueueInterval = 5000;
const redactMarker = '********';
const repeatVisitInterval = Number.MAX_VALUE;
const updateStorageInterval = 1000 * 60 * 30; // 30min

const remd5 = /[a-fA-F0-9]{32}/;

// mark ad visits as failure if any of these are included in title
const errorStrings = [
  'file not found',
  'website is currently unavailable',
  'not found on this server'
];

/******************************************************************************/
// State - rehydrated from chrome.storage.local on each service worker wake

let admap = {};
let idgen = 0;
let adsetSize = 0;
let lastStorageUpdate = 0;
let initialized = false;
let initPromise = null;

/******************************************************************************/
// Initialization - lazy, called on first use

async function initialize() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const data = await chrome.storage.local.get(['admap', 'adnIdgen']);
      admap = data.admap || {};
      idgen = data.adnIdgen || 0;

      validateAdStorage();
      computeNextId();
      adsetSize = adCount();
      adIndex = null;

      log('[ADN INIT] Loaded ' + adsetSize + ' ads');
      initialized = true;
    } catch (e) {
      err('[ADN INIT] Failed:', e);
      admap = {};
      idgen = 0;
      initialized = true;
    }
    initPromise = null;
  })();

  return initPromise;
}

// Ensures state is ready before any operation
async function ready() {
  if (!initialized) await initialize();
}

/******************************************************************************/
// Storage

async function storeAdData(immediate) {
  const now = Date.now();
  if (immediate || (now - lastStorageUpdate > updateStorageInterval)) {
    await chrome.storage.local.set({ admap, adnIdgen: idgen });
    lastStorageUpdate = now;
  }
}

/******************************************************************************/
// Validation

function validMD5(s) {
  return remd5.test(s);
}

function validateFields(ad) {
  if (ad.visitedTs === 0 && ad.attempts > 0) {
    warn('Invalid visitTs/attempts pair', ad);
    ad.attempts = 0;
  }

  if (!(ad.pageUrl.startsWith('http') || ad.pageUrl === redactMarker)) {
    warn('Possibly Invalid PageUrl: ', ad.pageUrl);
  }

  // re-add if stripped in export
  ad.pageDomain = ad.pageDomain || parseDomain(ad.pageUrl) || ad.pageUrl;
  ad.targetDomain = ad.targetDomain || parseDomain(ad.resolvedTargetUrl || ad.targetUrl, true);
  ad.targetHostname = ad.targetHostname || parseHostnameFromUrl(ad.resolvedTargetUrl || ad.targetUrl);

  return ad && type(ad) === 'object' &&
    type(ad.pageUrl) === 'string' &&
    type(ad.contentType) === 'string' &&
    type(ad.contentData) === 'object';
}

function parseHostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
}

// Detect strings that are mistakenly JavaScript/CSS code rather than ad text.
function looksLikeCode(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  return /^\s*[!;(]*\s*function\b/.test(s) ||      // function… / (function… / !function
    /\bfunction\s*\(/.test(s) ||                    // function(
    /\b(var|let|const)\s+[\w$]+\s*=/.test(s) ||     // var u = … / let x =
    /=>\s*[{(]/.test(s) ||                          // arrow function body
    /\b(document|window)\.\w/.test(s) ||            // document.x / window.x
    (s.match(/;/g) || []).length >= 2;              // multiple statements
}

// An image src the vault (an extension page) can actually render. Notably
// excludes blob: — those are scoped to the document that created them and were
// previously mangled into a relative path here.
function isDisplayableImageSrc(src) {
  if (typeof src !== 'string' || src.length === 0) return false;
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
}

function validate(ad) {
  if (!validateFields(ad)) {
    return warn('Invalid ad-fields: ', ad);
  }

  const cd = ad.contentData, ct = ad.contentType;

  ad.title = unescapeHTML(ad.title);

  if (ct === 'text') {
    cd.title = unescapeHTML(cd.title);
    cd.text = unescapeHTML(cd.text);
  } else if (ct === 'img') {
    // The parser sends absolute URLs it has already proven load, so anything
    // else is bad data. Rebuilding a relative src here used to guess a base
    // from ad.pageUrl — which registerAd() has replaced with the *top-level
    // tab* URL, so the guess was wrong for every ad inside a frame, and the
    // vault ended up with images that could never load.
    if (!isDisplayableImageSrc(cd.src)) {
      return warn('Invalid image src: ' + String(cd.src).substring(0, 100));
    }
    if (!(cd.width > 0 && cd.height > 0)) {
      return warn('Invalid image dimensions (' + cd.width + 'x' + cd.height + '): ' +
        String(cd.src).substring(0, 100));
    }
  } else {
    warn('Invalid ad type: ' + ct);
  }

  if (!validateTarget(ad)) return false;

  // Reject titles/text that are mistakenly JavaScript/CSS code (MV2 parity).
  if (looksLikeCode(ad.title)) ad.title = ad.targetDomain || 'Pending';
  if (ct === 'text' && looksLikeCode(cd.text)) cd.text = '';

  return true;
}

function validateTarget(ad) {
  const url = ad.targetUrl;

  if (!/^http/.test(url)) {
    const idx = url.indexOf('http');
    if (idx !== -1) {
      ad.targetUrl = decodeURIComponent(url.substring(idx));
      log('Ad.targetUrl updated: ' + ad.targetUrl);
    } else {
      return warn('Invalid targetUrl: ' + url);
    }
  }

  const hostname = parseHostnameFromUrl(ad.resolvedTargetUrl || ad.targetUrl);
  const domain = parseDomain(ad.resolvedTargetUrl || ad.targetUrl, true);

  if (!isValidDomain(domain)) {
    return warn('Invalid domain: ' + url);
  }

  ad.targetHostname = hostname;
  ad.targetDomain = domain;

  // Ensure slash after domain: https://github.com/dhowe/AdNauseam/issues/1304
  const idx = url.indexOf(ad.targetDomain) + ad.targetDomain.length;
  if (idx < url.length - 1 && url.charAt(idx) !== '/') {
    ad.targetUrl = url.substring(0, idx) + '/' + url.substring(idx, url.length);
  }

  return true;
}

/******************************************************************************/
// Admap operations

function validateAdStorage() {
  let ads = adlist();
  let i = ads.length;

  while (i--) {
    if (!validateFields(ads[i])) {
      warn('Invalid ad in storage', ads[i]);
      // Remove invalid ad from admap
      removeAdFromMap(ads[i]);
    }
  }

  validateHashes();
}

function validateHashes() {
  const pages = Object.keys(admap);
  const unhashed = [];
  const orphans = [];

  for (let i = 0; i < pages.length; i++) {
    const isHashed = validMD5(pages[i]);

    if (!isHashed) {
      unhashed.push(pages[i]);
      const hashes = Object.keys(admap[pages[i]]);
      for (let j = 0; j < hashes.length; j++) {
        orphans.push(admap[pages[i]][hashes[j]]);
      }
    } else {
      const hashes = Object.keys(admap[pages[i]]);
      for (let j = hashes.length - 1; j >= 0; j--) {
        if (!validMD5(hashes[j])) {
          orphans.push(admap[pages[i]][hashes[j]]);
          delete admap[pages[i]][hashes[j]];
        }
      }
    }
  }

  if (unhashed.length || orphans.length) {
    orphans.forEach(ad => createAdmapEntry(ad, admap));
    unhashed.forEach(k => delete admap[k]);
  }
}

function computeNextId(ads) {
  ads = ads || adlist();
  idgen = Math.max(0, Math.max.apply(Math,
    ads.map(ad => ad ? ad.id : -1)
  ));
  if (!isFinite(idgen)) idgen = 0;
}

function createAdmapEntry(ad, map) {
  if (validateFields(ad)) {
    const pagehash = YaMD5.hashStr(ad.pageUrl);
    if (!map[pagehash]) map[pagehash] = {};
    map[pagehash][computeHash(ad)] = ad;
    return true;
  }
  warn('Unable to validate ad', ad);
  return false;
}

function removeAdFromMap(ad) {
  const pageHash = YaMD5.hashStr(ad.pageUrl);
  if (admap[pageHash]) {
    const hash = computeHash(ad);
    if (admap[pageHash][hash]) {
      delete admap[pageHash][hash];
      if (Object.keys(admap[pageHash]).length === 0) {
        delete admap[pageHash];
      }
      return true;
    }
  }
  return false;
}

// Check if target is internal to page domain
function internalTarget(ad) {
  if (ad.contentType === 'text') return false;
  const domainOfTarget = parseDomain(ad.targetUrl, true);
  return domainOfTarget === ad.pageDomain;
}

/******************************************************************************/
// Ad list access

function adlist(pageUrl, currentOnly) {
  const result = [];
  const pages = pageUrl
    ? [YaMD5.hashStr(pageUrl)]
    : Object.keys(admap);

  for (let i = 0; admap && i < pages.length; i++) {
    if (admap[pages[i]]) {
      const hashes = Object.keys(admap[pages[i]]);
      for (let j = 0; j < hashes.length; j++) {
        const ad = admap[pages[i]][hashes[j]];
        if (ad) {
          if (!currentOnly || ad.current) {
            result.push(ad);
          }
        }
      }
    }
  }
  return result;
}

function adCount() {
  return adlist().length;
}

// Number of ads collected for a given page (MV2 parity: currentCount()).
// Prefer ads still marked 'current', falling back to all ads for that URL.
function currentCount(pageUrl) {
  if (!pageUrl) return 0;
  return adlist(pageUrl, true).length || adlist(pageUrl).length;
}

/******************************************************************************/
// Toolbar badge - show the number of ads collected for the tab's page, and
// nothing at all when there are none (MV2 parity, see src/js/tab.js updateBadge).

async function updateBadgeForTab(tab) {
  if (!tab || typeof tab.id !== 'number' || tab.id < 0) return;
  await ready();

  const settings = await getSettings();
  const count = currentCount(tab.url);
  // hide the badge entirely when disabled or when no ads were collected
  const text = (settings.showIconBadge && count > 0) ? formatCount(count) : '';

  try {
    await chrome.action.setBadgeText({ tabId: tab.id, text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#666' });
    }
  } catch (e) {
    // tab may have closed between message and update
  }
}

// Clear a tab's badge (e.g. on navigation) so a stale count doesn't linger on a
// page that has no ads yet.
async function clearBadge(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
  } catch (e) {
    // tab may have closed
  }
}

// Index for O(1) cross-page duplicate lookups, keyed by MV2's computeHash and by
// image src. Lazily (re)built; invalidated (set null) when ads change. // adn
let adIndex = null;

// Exact image src: the hash includes targetUrl, which ad servers re-mint per
// impression, so the same creative would otherwise be re-collected. // adn
function adSrcKey(ad) { // adn
  if (!ad || ad.contentType !== 'img') return null; // adn
  const src = ad.contentData && ad.contentData.src; // adn
  return (typeof src === 'string' && src.length) ? 'src:' + src : null; // adn
} // adn

function indexAd(ad) {
  if (adIndex === null) return;
  const h = computeHash(ad); // adn
  if (h) adIndex.set(h, ad); // adn
  const src = adSrcKey(ad); // adn
  if (src) adIndex.set(src, ad); // adn
}

function buildAdIndex() {
  adIndex = new Map();
  const ads = adlist();
  for (let i = 0; i < ads.length; i++) indexAd(ads[i]);
}

// Find an existing ad with the same content hash or image src, across all pages.
function findDuplicateAd(ad) {
  if (adIndex === null) buildAdIndex();
  const h = computeHash(ad); // adn
  if (h) {
    const hit = adIndex.get(h);
    if (hit) return hit;
  }
  const src = adSrcKey(ad); // adn
  if (src) { // adn
    const hit = adIndex.get(src); // adn
    if (hit) return hit; // adn
  } // adn
  return null;
}

function adById(id) {
  const list = adlist();
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
}

/******************************************************************************/
// Ad registration

async function registerAd(ad, tab) {
  await ready();

  if (!ad) return;

  // Ensure required fields from content script
  ad.current = true;
  ad.attemptedTs = 0;
  ad.attempts = ad.attempts || 0;
  ad.visitedTs = ad.visitedTs || 0;
  ad.version = chrome.runtime.getManifest().version;

  // Always source page identity from the top-level tab. Content scripts
  // run inside every frame, so ad.pageUrl from a cross-origin sub-frame
  // (e.g. *.safeframe.googlesyndication.com) would otherwise leak into
  // the saved record instead of the tab the user is actually on.
  if (tab && tab.url) {
    ad.pageUrl = tab.url;
    ad.pageTitle = tab.title || ad.pageTitle;
  }

  if (!ad.pageUrl) {
    return warn('[ADN] registerAd: no pageUrl');
  }

  ad.pageDomain = parseDomain(ad.pageUrl) || ad.pageUrl;

  if (!validate(ad)) return warn('[ADN] Invalid ad', ad);

  // Check internal targets
  if (!internalLinkDomainsDefault.includes(ad.pageDomain) && internalTarget(ad)) {
    return warn('[ADN INTERN] Ignoring Ad on ' + ad.pageDomain + ', target: ' + ad.targetUrl);
  }

  // Skip duplicates across all pages, by content hash or image src. // adn
  const dup = findDuplicateAd(ad);
  if (dup) {
    log('[ADN EXISTS] Duplicate of Ad#' + (dup.id || '?') + ': ' + ad.targetUrl);
    return;
  }

  const pageHash = YaMD5.hashStr(ad.pageUrl);
  if (!admap[pageHash]) admap[pageHash] = {};

  const adhash = computeHash(ad);

  // Check for duplicate
  if (admap[pageHash][adhash]) {
    const orig = admap[pageHash][adhash];
    const msSinceFound = Date.now() - orig.foundTs;

    if (msSinceFound < repeatVisitInterval) {
      log('[ADN EXISTS] Ad#' + (orig.id || '?') + ' found ' + msSinceFound + ' ms ago');
      return;
    }
  }

  // Assign ID - only if not a duplicate
  ad.id = ++idgen;
  ad.foundTs = ad.foundTs || Date.now();

  // Load settings for click probability
  const settings = await getSettings();
  ad.noVisit = Math.random() > settings.clickProbability;

  // Store in admap (overwrites older ad with same key)
  admap[pageHash][adhash] = ad;
  indexAd(ad);
  adsetSize++;

  log('[ADN FOUND] Ad#' + ad.id + ' (' + ad.contentType + ') ' + ad.targetUrl);

  // Persist
  await storeAdData(true);

  // Notify open UIs
  broadcastMessage({ what: 'adDetected', ad });

  return ad;
}

/******************************************************************************/
// Ad deletion

async function deleteAd(arg) {
  await ready();

  const ad = type(arg) === 'object' ? arg : adById(arg);
  if (!ad) {
    return warn('[ADN] No Ad to delete', arg);
  }

  if (removeAdFromMap(ad)) {
    adsetSize--;
    adIndex = null;
    log('[ADN DELETE] Ad#' + (ad.id || '?'));
    await storeAdData(true);
  } else {
    return warn('[ADN] Delete failed', ad);
  }
}

async function deleteAdSet(ids) {
  await ready();
  for (const id of ids) {
    await deleteAd(id);
  }
}

async function clearAds() {
  await ready();
  admap = {};
  adsetSize = 0;
  idgen = 0;
  adIndex = null;
  await chrome.storage.local.set({ admap: {}, adnIdgen: 0 });
  log('[ADN] All ads cleared');
}

/******************************************************************************/
// Ads for UI

async function adsForVault() {
  await ready();
  const settings = await getSettings();
  return {
    data: adlist(),
    prefs: {
      hidingDisabled: !settings.hidingAds,
      clickingDisabled: !settings.clickingAds,
      textAdsDisabled: !settings.parseTextAds,
      logEvents: settings.eventLogging,
      devMode: false,
    },
    current: null,
    notifications: []
  };
}

async function getHideDeadAds() {
  const data = await chrome.storage.local.get(['adnHideDeadAds']);
  return data.adnHideDeadAds || false;
}

async function setHideDeadAds(value) {
  await chrome.storage.local.set({ adnHideDeadAds: value });
}

async function purgeDeadAds(deadAdIds) {
  await ready();
  let purged = 0;
  for (const pageHash of Object.keys(admap)) {
    for (const hash of Object.keys(admap[pageHash])) {
      const ad = admap[pageHash][hash];
      if (deadAdIds && deadAdIds.includes(ad.id)) {
        delete admap[pageHash][hash];
        purged++;
      }
    }
    if (Object.keys(admap[pageHash]).length === 0) {
      delete admap[pageHash];
    }
  }
  adsetSize = adCount();
  adIndex = null;
  await storeAdData(true);
  return { data: adlist() };
}

async function adsForPage(pageUrl) {
  await ready();
  const allAds = adlist();

  // First try exact URL match
  let pageAds = adlist(pageUrl);

  // If no exact match, try matching by hostname
  if (pageAds.length === 0 && pageUrl) {
    try {
      const hostname = new URL(pageUrl).hostname;
      pageAds = allAds.filter(ad => {
        try { return new URL(ad.pageUrl).hostname === hostname; }
        catch { return false; }
      });
    } catch {}
  }

  const recent = pageAds.length === 0;

  // If still no page ads, show most recent (like MV2)
  if (recent) {
    pageAds = allAds.sort((a, b) => (b.foundTs || 0) - (a.foundTs || 0)).slice(0, 20);
  }

  return {
    data: pageAds,
    pageUrl,
    total: allAds.length,
    clicked: allAds.filter(a => a.visitedTs > 0).length,
    recent,
    current: null
  };
}

async function getStats() {
  await ready();
  const ads = adlist();
  const totalAds = ads.length;
  const totalClicks = ads.filter(a => a.visitedTs > 0).length;
  const pending = ads.filter(a => a.visitedTs === 0 && !a.noVisit).length;
  const failed = ads.filter(a => a.visitedTs < 0).length;

  return { totalAds, totalClicks, pending, failed };
}

/******************************************************************************/
// Import / Export

async function exportAds(includeImages) {
  await ready();
  return JSON.stringify(admap, null, 2);
}

async function importAds(data) {
  await ready();

  let map;
  let count = 0;

  if (type(data) === 'object') {
    // Could be admap format or backup format
    map = data;
  } else if (type(data) === 'array') {
    // Array of ads
    map = {};
    for (const ad of data) {
      if (createAdmapEntry(ad, map)) count++;
    }
    // Merge with existing
    for (const pageHash of Object.keys(map)) {
      if (!admap[pageHash]) admap[pageHash] = {};
      Object.assign(admap[pageHash], map[pageHash]);
    }
    computeNextId();
    adsetSize = adCount();
    adIndex = null;
    await storeAdData(true);
    return { count };
  }

  // Validate and merge admap-format import
  const pages = Object.keys(map);
  for (let i = 0; i < pages.length; i++) {
    if (type(map[pages[i]]) !== 'object') continue;

    const hashes = Object.keys(map[pages[i]]);
    for (let j = 0; j < hashes.length; j++) {
      const ad = map[pages[i]][hashes[j]];
      if (validateFields(ad)) {
        validateTarget(ad);
        ad.id = ++idgen;
        if (!admap[pages[i]]) admap[pages[i]] = {};
        admap[pages[i]][hashes[j]] = ad;
        count++;
      }
    }
  }

  adsetSize = adCount();
  adIndex = null;
  await storeAdData(true);
  return { count };
}

/******************************************************************************/
// Settings helper

async function getSettings() {
  const data = await chrome.storage.local.get(['adnSettings']);
  return Object.assign({
    clickingAds: true,
    hidingAds: true,
    blockingMalware: true,
    clickProbability: 1.0,
    clickOnlyWhenIdleFor: 0,
    parseTextAds: true,
    eventLogging: true,
    disableClickingForDNT: true,
    disableHidingForDNT: true,
    dntDomains: [],
    showIconBadge: true,
    disableWarnings: false,
    blurCollectedAds: false,
    costPerClick: 1.58,
    hidingStyle: 'opacity'   // 'opacity' (clickable/collectable) | 'display' (display:none)
  }, data.adnSettings || {});
}

/******************************************************************************/
// Broadcast to open extension pages

function broadcastMessage(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // No listeners - this is normal when popup/vault is closed
  });
}

/******************************************************************************/
// Utility

function unescapeHTML(s) {
  if (s && s.length) {
    const entities = [
      '#0*32', ' ', '#0*33', '!', '#0*34', '"', '#0*35', '#',
      '#0*36', '$', '#0*37', '%', '#0*38', '&', '#0*39', '\'',
      'apos', '\'', 'amp', '&', 'lt', '<', 'gt', '>',
      'quot', '"', '#x27', '\'', '#x60', '`'
    ];
    for (let i = 0; i < entities.length; i += 2) {
      s = s.replace(new RegExp('\\&' + entities[i] + ';', 'g'), entities[i + 1]);
    }
  }
  return s;
}

function millis() {
  return Date.now();
}

/******************************************************************************/
// Public API

const adnauseam = {
  ready,
  registerAd,
  deleteAd,
  deleteAdSet,
  clearAds,
  adlist,
  adCount,
  currentCount,
  updateBadgeForTab,
  clearBadge,
  adById,
  adsForVault,
  adsForPage,
  getStats,
  exportAds,
  importAds,
  getSettings,
  getHideDeadAds,
  setHideDeadAds,
  purgeDeadAds,
  storeAdData,
  broadcastMessage,
  validateTarget,
  validate,
  validateFields,
  // Exposed for Phase 2 (click queue)
  get admap() { return admap; },
  get idgen() { return idgen; },
  maxAttemptsPerAd,
  visitTimeout,
  pollQueueInterval,
  errorStrings,
  millis,
};

export { adnauseam };
