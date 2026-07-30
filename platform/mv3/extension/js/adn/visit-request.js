/*******************************************************************************
    AdNauseam MV3 - Shared ad-visit request logic

    Performs the ad-visit XMLHttpRequest with credentials in a DOM context.
    Used by the offscreen document on Chromium, and called directly from the
    non-persistent background *page* on Safari (which has a DOM, since Safari
    does not support the chrome.offscreen API).

    This module must not touch XMLHttpRequest/document/navigator at the top
    level so it stays importable (though not callable) from a service worker.

    Copyright (C) 2014-2024 Daniel C. Howe
    License: GPLv3
*******************************************************************************/

'use strict';

const visitTimeout = 20000; // 20 seconds

// Always resolves (never rejects) with:
//   { success, status?, title?, resolvedTargetUrl?, error? }
function visitAdUrl(ad) {
  return new Promise(resolve => {
    if (!ad || !ad.targetUrl) {
      resolve({ success: false, error: 'No target URL' });
      return;
    }

    const target = ad.parsedTargetUrl || ad.targetUrl;

    console.log('[ADN Visitor] Visiting:', target);

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

        console.log('[ADN Visitor] Response:', status, title || '(no title)',
          'from:', xhr.responseURL || target);

        if (status >= 200 && status < 400) {
          resolve({
            success: true,
            status,
            title,
            resolvedTargetUrl: xhr.responseURL || target
          });
        } else {
          resolve({
            success: false,
            error: 'HTTP ' + status,
            status
          });
        }
      };

      xhr.onerror = function (e) {
        console.warn('[ADN Visitor] Error visiting:', target, e);
        resolve({
          success: false,
          error: 'Network error'
        });
      };

      xhr.ontimeout = function () {
        console.warn('[ADN Visitor] Timeout visiting:', target);
        resolve({
          success: false,
          error: 'Timeout'
        });
      };

      xhr.send();
    } catch (e) {
      console.error('[ADN Visitor] Exception:', e);
      resolve({
        success: false,
        error: e.message
      });
    }
  });
}

export { visitAdUrl };
