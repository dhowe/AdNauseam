/*******************************************************************************
    AdNauseam MV3 - Offscreen document for ad visits (Chromium only)

    Thin message adapter: receives visit requests from the service worker
    and delegates to the shared XHR logic in visit-request.js. On Safari,
    where chrome.offscreen is unavailable, visit-request.js is called
    directly from the background page instead (see visitor.js).
*******************************************************************************/

'use strict';

import { visitAdUrl } from './visit-request.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.what !== 'visitAd') return;

  visitAdUrl(msg.ad).then(sendResponse);

  // Return true to indicate async sendResponse
  return true;
});

console.log('[ADN Visitor] Offscreen document ready');
