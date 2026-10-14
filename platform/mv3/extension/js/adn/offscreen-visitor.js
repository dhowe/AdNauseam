/*******************************************************************************
    AdNauseam MV3 - Offscreen document for ad visits

    Uses XMLHttpRequest with credentials in a real DOM context to simulate
    ad clicks. This is the MV3 equivalent of the MV2 background-page XHR
    approach.

    The offscreen document receives visit requests from the service worker
    and returns results via chrome.runtime.sendMessage.
*******************************************************************************/

'use strict';

const visitTimeout = 20000; // 20 seconds

// Listen for visit requests from the service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.what !== 'visitAd') return;

  const { ad } = msg;
  if (!ad || !ad.targetUrl) {
    sendResponse({ success: false, error: 'No target URL' });
    return;
  }

  const target = ad.parsedTargetUrl || ad.targetUrl;
  const log = msg.debug ? console.log.bind(console) : () => {};
  const warn = msg.debug ? console.warn.bind(console) : () => {};

  log('[ADN Visitor] Visiting:', target);

  const xhr = new XMLHttpRequest();

  try {
    xhr.open('GET', target, true);
    xhr.withCredentials = true;
    xhr.timeout = visitTimeout;
    xhr.responseType = '';

    // Set headers to look like a real browser navigation. Note: Referer,
    // Upgrade-Insecure-Requests, etc. are forbidden headers and cannot be set
    // here — the browser ignores them. Setting a real Referer requires a DNR
    // modifyHeaders rule (see note in visitor.js).
    xhr.setRequestHeader('Accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    );
    xhr.setRequestHeader('Accept-Language', navigator.language || 'en-US,en;q=0.9');

    xhr.onload = function () {
      const status = xhr.status || 200;
      let title = '';

      // Parse title from response
      if (xhr.responseText) {
        const match = /<title[^>]*>([^<]+)<\/title>/i.exec(xhr.responseText);
        if (match && match[1]) {
          title = match[1].trim();
        }
      }

      log('[ADN Visitor] Response:', status, title || '(no title)',
        'from:', xhr.responseURL || target);

      if (status >= 200 && status < 400) {
        sendResponse({
          success: true,
          status,
          title,
          resolvedTargetUrl: xhr.responseURL || target
        });
      } else {
        sendResponse({
          success: false,
          error: 'HTTP ' + status,
          status
        });
      }
    };

    xhr.onerror = function (e) {
      warn('[ADN Visitor] Error visiting:', target, e);
      sendResponse({
        success: false,
        error: 'Network error'
      });
    };

    xhr.ontimeout = function () {
      warn('[ADN Visitor] Timeout visiting:', target);
      sendResponse({
        success: false,
        error: 'Timeout'
      });
    };

    xhr.send();
  } catch (e) {
    console.error('[ADN Visitor] Exception:', e);
    sendResponse({
      success: false,
      error: e.message
    });
  }

  // Return true to indicate async sendResponse
  return true;
});
