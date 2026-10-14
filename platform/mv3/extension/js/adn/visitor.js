/*******************************************************************************
    AdNauseam MV3 - Ad Visit Queue Manager

    Polls for pending ads and visits them via the offscreen document.
    This runs in the service worker context.

    Copyright (C) 2014-2024 Daniel C. Howe
    License: GPLv3
*******************************************************************************/

'use strict';

import { adnauseam } from './core.js';
import { log, warn, err, isEventLogging } from './log.js';

/******************************************************************************/

const pollQueueInterval = 5000;   // 5 seconds between queue checks
const maxAttemptsPerAd = 3;
const minVisitInterval = 2000;    // minimum 2s between visits (avoid bursts)

let lastVisitTs = 0;
let visiting = false;
let pollTimerId = null;

/******************************************************************************/
// Offscreen document management

let offscreenReady = false;

async function ensureOffscreen() {
  if (offscreenReady) return true;

  // Check if already exists
  const existing = await chrome.offscreen.hasDocument().catch(() => false);
  if (existing) {
    offscreenReady = true;
    return true;
  }

  try {
    await chrome.offscreen.createDocument({
      url: '/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'AdNauseam needs a DOM context to visit ad URLs with credentials'
    });
    offscreenReady = true;
    log('[ADN Visitor] Offscreen document created');
    return true;
  } catch (e) {
    // May already exist from a race condition
    if (e.message && e.message.includes('Only a single offscreen')) {
      offscreenReady = true;
      return true;
    }
    err('[ADN Visitor] Failed to create offscreen document:', e);
    return false;
  }
}

/******************************************************************************/
// Visit logic

function visitPending(ad) {
  if (!ad) return false;
  if (ad.attempts >= maxAttemptsPerAd) return false;
  if (ad.visitedTs > 0) return false;   // already visited successfully
  if (ad.visitedTs < 0) return false;   // permanently failed
  if (ad.noVisit) return false;         // marked as no-visit
  return true;
}

function nextPending() {
  const ads = adnauseam.adlist();
  for (let i = 0; i < ads.length; i++) {
    if (visitPending(ads[i])) return ads[i];
  }
  return null;
}

async function visitAd(ad) {
  if (visiting) return;
  visiting = true;

  try {
    await adnauseam.ready();

    const ok = await ensureOffscreen();
    if (!ok) {
      warn('[ADN Visitor] No offscreen document, skipping visit');
      visiting = false;
      return;
    }

    ad.attempts++;
    ad.attemptedTs = Date.now();

    log('[ADN Visitor] Attempting Ad#' + ad.id + ' (' + ad.attempts + '/' +
      maxAttemptsPerAd + ') ' + ad.targetUrl);

    // Broadcast attempt to open UIs
    adnauseam.broadcastMessage({ what: 'adAttempt', ad });

    // Send visit request to offscreen document
    const response = await chrome.runtime.sendMessage({
      what: 'visitAd',
      ad: {
        targetUrl: ad.targetUrl,
        parsedTargetUrl: ad.parsedTargetUrl || null,
        pageUrl: ad.pageUrl,
        id: ad.id
      },
      debug: isEventLogging()
    }).catch(e => {
      warn('[ADN Visitor] Message failed:', e);
      return { success: false, error: e.message };
    });

    if (response && response.success) {
      // Success
      ad.visitedTs = Date.now();
      ad.resolvedTargetUrl = response.resolvedTargetUrl || ad.targetUrl;
      // Resolve a real title only when we don't have one yet (MV2 parity).
      if (response.title && ad.title === 'Pending') ad.title = response.title;
      if (ad.title === 'Pending') ad.title = ad.targetDomain || ad.title;
      ad.attemptedTs = 0;

      log('[ADN Visitor] Visited Ad#' + ad.id + ' -> ' +
        (response.title || '(no title)') + ' ' + ad.resolvedTargetUrl);

      adnauseam.broadcastMessage({ what: 'adVisited', ad });
    } else {
      // Failed
      const error = (response && response.error) || 'Unknown error';
      warn('[ADN Visitor] Failed Ad#' + ad.id + ': ' + error);

      if (ad.attempts >= maxAttemptsPerAd) {
        ad.visitedTs = -1; // Mark as permanently failed
        log('[ADN Visitor] Ad#' + ad.id + ' max attempts reached, marking failed');
      }

      ad.attemptedTs = 0;
    }

    await adnauseam.storeAdData(true);
    lastVisitTs = Date.now();

  } catch (e) {
    err('[ADN Visitor] Visit error:', e);
  } finally {
    visiting = false;
  }
}

/******************************************************************************/
// Queue polling

async function pollQueue() {
  try {
    await adnauseam.ready();

    const settings = await adnauseam.getSettings();

    if (!settings.clickingAds) return;

    // Respect minimum interval between visits
    const elapsed = Date.now() - lastVisitTs;
    if (elapsed < minVisitInterval) return;

    // Check idle requirement
    if (settings.clickOnlyWhenIdleFor > 0) {
      // In MV3 we can't easily track user activity across tabs
      // For now, just use the time since last visit as a proxy
      if (elapsed < settings.clickOnlyWhenIdleFor * 1000) return;
    }

    const next = nextPending();
    if (next) {
      await visitAd(next);
    }
  } catch (e) {
    err('[ADN Visitor] Poll error:', e);
  }
}

/******************************************************************************/
// Start/stop

function startVisitQueue() {
  if (pollTimerId) return;

  log('[ADN Visitor] Starting visit queue');
  pollTimerId = setInterval(pollQueue, pollQueueInterval);

  // Run first poll soon
  setTimeout(pollQueue, 1000);
}

function stopVisitQueue() {
  if (pollTimerId) {
    clearInterval(pollTimerId);
    pollTimerId = null;
    log('[ADN Visitor] Stopped visit queue');
  }
}

/******************************************************************************/

export { startVisitQueue, stopVisitQueue, visitAd, pollQueue };
