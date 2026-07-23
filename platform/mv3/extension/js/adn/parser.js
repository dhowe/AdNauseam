/*******************************************************************************
    AdNauseam MV3 - Content script ad parser
    Simplified version of parser.js for MV3
    
    This script gets injected by uBlock Lite's registerInjectables()
    It queries the DOM using cosmetic filter selectors
*******************************************************************************/

(function() {
  'use strict';
  
  // Check if already injected
  if (window.adnParserInjected) return;
  window.adnParserInjected = true;
  
  console.log('[ADN Parser] Loaded on:', window.location.hostname);
  
  const imgSelectors = [
    'img',
    'amp-img',
    'picture',
    'picture > source[srcset]',
    'img[srcset]',
    '.cropped-image-intermedia-box',
    '.imageholder',
    '[data-imgsrc]',
    '[data-src]',
    '[data-lazy-src]',
    '[data-original]',
    '[data-original-src]',
    '[data-bgset]',
    '[data-background-image]',
    '[data-thumb]',
    '[data-thumbnail]',
    '[data-image-url]',
    '[data-image]',
    '.posterImage-link'
  ];

  const titleSelectors = [
    '[data-title-id]',
    '.title',
    '.ad-title',
    '.headline',
    '.ad-headline',
    'h1', 'h2', 'h3', 'h4'
  ];

  const textSelectors = [
    '.ad-description',
    '.ad-text',
    '.description',
    '.ad-body',
    'p',
    'span'
  ];

  function logP(...args) {
    console.log('[ADN Parser]', ...args);
  }

  // Text content with <script>/<style>/<noscript> removed and whitespace
  // collapsed, so we never capture page code as ad text.
  function cleanText(el) {
    if (!el) return '';
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (out.length > 400) return;
        if (child.nodeType === 3) {
          out += child.nodeValue + ' ';
        } else if (child.nodeType === 1 &&
                   !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(child.tagName)) {
          walk(child);
        }
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }

  // Detect strings that are mistakenly JavaScript/CSS code rather than ad text.
  function looksLikeCode(s) {
    if (typeof s !== 'string' || s.length === 0) return false;
    return /^\s*[!;(]*\s*function\b/.test(s) ||
      /\bfunction\s*\(/.test(s) ||
      /\b(var|let|const)\s+[\w$]+\s*=/.test(s) ||
      /=>\s*[{(]/.test(s) ||
      /\b(document|window)\.\w/.test(s) ||
      (s.match(/;/g) || []).length >= 2;
  }

  // Resolve an image src from an element, covering the same sources as MV2's
  // processImage: <picture>, <source srcset>, <img srcset>, lazy-load data
  // attributes, and finally a background-image.
  function resolveImageSrc(el) {
    if (!el) return null;

    const tag = el.tagName;

    // <picture>: prefer the rendered <img>, else the first <source srcset>
    if (tag === 'PICTURE') {
      const innerImg = el.querySelector('img');
      if (innerImg) {
        const s = innerImg.currentSrc || innerImg.src || innerImg.getAttribute('src');
        if (s) return s;
      }
      const source = el.querySelector('source[srcset]');
      if (source) return parseSrcset(source.getAttribute('srcset'));
    }

    // <source srcset="...">
    if (tag === 'SOURCE' && el.hasAttribute('srcset')) {
      return parseSrcset(el.getAttribute('srcset'));
    }

    // <img> / <amp-img>
    if (tag === 'IMG') {
      if (el.currentSrc) return el.currentSrc;
      if (el.src) return el.src;
    }
    if (tag === 'AMP-IMG') {
      const s = el.getAttribute('src');
      if (s) return s;
    }

    // srcset on the element itself
    if (el.hasAttribute && el.hasAttribute('srcset')) {
      const s = parseSrcset(el.getAttribute('srcset'));
      if (s) return s;
    }

    // Common lazy-load / native-ad data attributes
    const attrs = [
      'data-src', 'data-lazy-src', 'data-original', 'data-original-src',
      'data-imgsrc', 'data-bgset', 'data-background-image',
      'data-thumb', 'data-thumbnail', 'data-image-url', 'data-image',
      'src'
    ];
    for (const attr of attrs) {
      const val = el.getAttribute && el.getAttribute(attr);
      if (val && val.length > 5) return val;
    }

    // Last resort: a background-image on the element (inline or computed)
    return getBackgroundImageUrl(el);
  }

  // Parse the largest URL from a srcset attribute
  function parseSrcset(srcset) {
    if (!srcset) return null;
    // "url1 300w, url2 600w" or "url1 1x, url2 2x" — pick the largest descriptor
    let bestUrl = null, bestSize = 0;
    for (const cand of srcset.split(',')) {
      const parts = cand.trim().split(/\s+/);
      if (!parts[0]) continue;
      const size = parts.length > 1 ? (parseFloat(parts[1]) || 1) : 1;
      if (size >= bestSize) { bestSize = size; bestUrl = parts[0]; }
    }
    return bestUrl;
  }

  // Get image dimensions from an element
  function getImageDimensions(el) {
    let w = el.naturalWidth || parseInt(el.getAttribute('width')) || el.clientWidth || -1;
    let h = el.naturalHeight || parseInt(el.getAttribute('height')) || el.clientHeight || -1;
    if (isNaN(w)) w = -1;
    if (isNaN(h)) h = -1;
    return { w, h };
  }

  // Pick the largest non-tracking-pixel image within a root element.
  function bestImageIn(root) {
    if (!root || !root.querySelectorAll) return null;
    const imgs = root.querySelectorAll(imgSelectors.join(', '));
    let best = null;
    for (const img of imgs) {
      const src = resolveImageSrc(img);
      if (!src) continue;
      const dims = getImageDimensions(img);
      if (dims.w > 0 && dims.h > 0 &&
          (Math.min(dims.w, dims.h) < 31 || Math.max(dims.w, dims.h) < 65)) continue;
      const isDataUri = src.startsWith('data:');
      const bestIsDataUri = best && best.src.startsWith('data:');
      if (!best || (bestIsDataUri && !isDataUri) ||
          (!bestIsDataUri && !isDataUri && dims.w > best.w && dims.h > best.h)) {
        best = { src, w: dims.w, h: dims.h };
      }
    }
    return best;
  }

  // When the ad element has no image of its own, look outward — closest first:
  // walk up ancestors, then (inside an iframe) the whole document, since the
  // iframe is usually the ad creative.
  function findNearbyImage(element) {
    let node = element.parentElement;
    let depth = 0;
    while (node && depth < 8) {
      const best = bestImageIn(node);
      if (best) return best;
      node = node.parentElement;
      depth++;
    }
    if (window !== window.top) {
      return bestImageIn(document.body || document.documentElement);
    }
    return null;
  }

  // Extract ad data from element
  function extractAdData(element) {
    const data = {
      targetUrl: null,
      imgSrc: null,
      imgWidth: -1,
      imgHeight: -1,
      text: '',
      title: ''
    };

    // Find target URL — check parents first, then children
    const clickable = findClickableParent(element) || findClickableChild(element);
    if (clickable) {
      if (clickable.hasAttribute('href')) {
        data.targetUrl = clickable.getAttribute('href');
      } else if (clickable.hasAttribute('onclick')) {
        data.targetUrl = parseOnClick(clickable.getAttribute('onclick'));
      }
    }

    if (!data.targetUrl) {
      logP('No targetUrl found for element:', element.className || element.tagName, element);
      return null;
    }

    // Last-resort guard: never register ad-network info links as targets
    if (isAdInfoLink(data.targetUrl)) {
      logP('  Skipping ad-network info link:', data.targetUrl);
      return null;
    }

    // Skip internal/relative google tracking links (e.g. /aclk?...)
    if (data.targetUrl.startsWith('/aclk') || data.targetUrl.startsWith('/url?')) {
      logP('  Skipping internal tracking link:', data.targetUrl);
      return null;
    }

    // Make absolute URL
    if (data.targetUrl.indexOf('http') !== 0) {
      if (data.targetUrl.indexOf('//') === 0) {
        data.targetUrl = window.location.protocol + data.targetUrl;
      } else if (data.targetUrl.indexOf('/') === 0) {
        data.targetUrl = window.location.origin + data.targetUrl;
      } else {
        data.targetUrl = window.location.origin + '/' + data.targetUrl;
      }
    }

    logP('Processing element:', element.className || element.tagName, '-> target:', data.targetUrl, element);

    // --- Image search (thorough) ---

    // 1. Check children matching image selectors
    const imgs = element.querySelectorAll(imgSelectors.join(', '));
    logP('  Found', imgs.length, 'image elements matching selectors');

    let chosenImg = null;
    for (const img of imgs) {
      const src = resolveImageSrc(img);
      if (src) {
        const dims = getImageDimensions(img);
        logP('  Image candidate:', src, 'dims:', dims.w, 'x', dims.h, img);

        // Prefer real URLs over data URIs (data URIs are often placeholders)
        const isDataUri = src.startsWith('data:');
        const currentIsDataUri = data.imgSrc && data.imgSrc.startsWith('data:');

        if (!data.imgSrc || (currentIsDataUri && !isDataUri) ||
            (!currentIsDataUri && !isDataUri && dims.w > data.imgWidth && dims.h > data.imgHeight)) {
          data.imgSrc = src;
          data.imgWidth = dims.w;
          data.imgHeight = dims.h;
          chosenImg = img;
        }
      }
    }

    // 2. Check the element itself for background-image
    if (!data.imgSrc) {
      logP('  Checking element itself for background-image');
      const bgSrc = getBackgroundImageUrl(element);
      if (bgSrc) {
        data.imgSrc = bgSrc;
        data.imgWidth = element.clientWidth || -1;
        data.imgHeight = element.clientHeight || -1;
        logP('  Found bg image on element:', bgSrc);
      }
    }

    // 3. Check children with background-image style
    if (!data.imgSrc) {
      logP('  Checking children for background-image');
      const bgChildren = element.querySelectorAll('[style*="background"]');
      logP('  Found', bgChildren.length, 'children with background style');
      for (const child of bgChildren) {
        const bgSrc = getBackgroundImageUrl(child);
        if (bgSrc) {
          data.imgSrc = bgSrc;
          data.imgWidth = child.clientWidth || -1;
          data.imgHeight = child.clientHeight || -1;
          logP('  Found bg image in child:', bgSrc);
          break;
        }
      }
    }

    // 4. Still nothing — search nearby (ancestors, and the whole iframe doc)
    //    for the closest image, since we already know this element is an ad.
    if (!data.imgSrc) {
      const near = findNearbyImage(element);
      if (near) {
        data.imgSrc = near.src;
        data.imgWidth = near.w;
        data.imgHeight = near.h;
        logP('  Found nearby image:', near.src);
      }
    }

    // Make image URL absolute if needed
    if (data.imgSrc && data.imgSrc.indexOf('http') !== 0 && data.imgSrc.indexOf('data:') !== 0) {
      if (data.imgSrc.indexOf('//') === 0) {
        data.imgSrc = window.location.protocol + data.imgSrc;
      } else if (data.imgSrc.indexOf('/') === 0) {
        data.imgSrc = window.location.origin + data.imgSrc;
      }
    }

    // Validate image dimensions (skip tracking pixels)
    if (data.imgSrc && data.imgWidth > 0 && data.imgHeight > 0) {
      const minDim = Math.min(data.imgWidth, data.imgHeight);
      const maxDim = Math.max(data.imgWidth, data.imgHeight);
      if (minDim < 31 || maxDim < 65) {
        logP('  Image too small (' + data.imgWidth + 'x' + data.imgHeight + '), discarding');
        data.imgSrc = null;
        data.imgWidth = -1;
        data.imgHeight = -1;
      }
    }

    // --- Text extraction (for text ads or as fallback) ---

    // Title — try multiple sources so we have a real title before any visit.
    const titleEl = element.querySelector(titleSelectors.join(', '));
    if (titleEl) {
      data.title = cleanText(titleEl);
    }
    if (!data.title && chosenImg) {
      data.title = (chosenImg.getAttribute('alt')
        || chosenImg.getAttribute('title')
        || chosenImg.getAttribute('aria-label')
        || '').trim();
    }
    if (!data.title && clickable) {
      data.title = (clickable.getAttribute('aria-label')
        || clickable.getAttribute('title')
        || '').trim();
      if (!data.title && clickable.tagName === 'A') {
        // Link text, but skip if it's just the image's alt we already tried
        const linkText = cleanText(clickable);
        if (linkText && linkText.length <= 120) data.title = linkText;
      }
    }
    if (!data.title) {
      data.title = (element.getAttribute('aria-label')
        || element.getAttribute('title')
        || '').trim();
    }
    if (data.title.length > 120) data.title = data.title.substring(0, 120).trim();

    // Reject titles that look like JavaScript/CSS code
    if (looksLikeCode(data.title)) {
      data.title = '';
    }

    // Description text — cleanText strips <script>/<style> so we don't capture code
    if (!data.imgSrc) {
      const textEl = element.querySelector(textSelectors.join(', '));
      if (textEl) {
        data.text = cleanText(textEl).substring(0, 200);
      }
      if (!data.text) {
        data.text = cleanText(element).substring(0, 200);
      }
    } else {
      data.text = cleanText(element).substring(0, 100);
    }
    if (looksLikeCode(data.text)) {
      data.text = '';
    }

    // Must have either an image or text content
    if (!data.imgSrc && !data.text) {
      logP('  No image and no text found, skipping');
      return null;
    }

    logP('  Result:', data.imgSrc ? 'IMG (' + data.imgWidth + 'x' + data.imgHeight + ')' : 'TEXT',
      data.title ? 'title="' + data.title.substring(0, 40) + '"' : '', element);

    return data;
  }
  
  // Check if onclick attribute contains a valid URL
  function onclickHasUrl(onclickStr) {
    if (!onclickStr) return false;
    // Check for window.open with URL
    if (/window\.open\(['"]https?:\/\//i.test(onclickStr)) return true;
    // Check for location.href assignment
    if (/location\.href\s*=\s*['"]https?:\/\//i.test(onclickStr)) return true;
    // Check for any http(s) URL in the string
    if (/https?:\/\/[^\s'"]+/i.test(onclickStr)) return true;
    return false;
  }

  // Ad-network info/opt-out pages (e.g. AdChoices, Google's "Why this ad?")
  // and network utility/branding links (e.g. Taboola's "advertise with us"
  // footer) — never the actual advertiser, and the info pages typically 403
  // when visited out of context.
  const adInfoLinkRe = /adssettings\.google\.|whythisad|(^|[./])adchoices([./?#]|$)|aboutads\.info|youradchoices|google\.com\/settings\/ads|popup\.(taboola|tblcontent)\.com|(taboola|tblcontent)\.com\/(en\/)?\?|outbrain\.com\/what-is|\.outbrain\.com\/?$/i;

  function isAdInfoLink(href) {
    return href ? adInfoLinkRe.test(href) : false;
  }

  // Find clickable parent
  function findClickableParent(node) {
    let checkNode = node;
    let depth = 0;
    while (checkNode && checkNode.nodeType === 1 && depth < 10) {
      if (checkNode.tagName === 'A' || checkNode.hasAttribute('href')) {
        if (!isAdInfoLink(checkNode.getAttribute('href'))) {
          return checkNode;
        }
      }
      // Only consider onclick if it contains a valid URL
      if (checkNode.hasAttribute('onclick') && onclickHasUrl(checkNode.getAttribute('onclick'))) {
        return checkNode;
      }
      checkNode = checkNode.parentNode;
      depth++;
    }
    return null;
  }

  // Find clickable child — search inside the element for <a> with external href
  function findClickableChild(node) {
    if (!node) return null;

    // Prefer the anchor that wraps the thumbnail image: in native cards
    // (Taboola/Outbrain) that's the advertiser click-through, whereas other
    // anchors in the card are branding/"Sponsored by" utility links.
    for (const link of node.querySelectorAll('a[href^="http"]')) {
      const href = link.getAttribute('href');
      if (href && !isAdInfoLink(href) && link.querySelector('img, picture, [style*="background"]')) {
        logP('  Found clickable child (image-wrapping):', link);
        return link;
      }
    }

    // Prefer links with specific ad-link classes (Google PLA, etc.)
    const adLinkSelectors = [
      'a.clickable-card',
      'a.pla-unit-single-clickable-target',
      'a.plantl[href^="http"]',
      'a[data-agdh]',
      'a[href^="http"]'
    ];

    for (const sel of adLinkSelectors) {
      for (const link of node.querySelectorAll(sel)) {
        const href = link.getAttribute('href');
        // Skip internal tracking redirects and ad-network info links —
        // we want the actual advertiser destination
        if (href && href.startsWith('http') && !isAdInfoLink(href)) {
          logP('  Found clickable child via:', sel, link);
          return link;
        }
      }
    }

    // Fallback: any <a> with onclick containing a URL
    const allLinks = node.querySelectorAll('a[onclick]');
    for (const link of allLinks) {
      if (onclickHasUrl(link.getAttribute('onclick'))) {
        logP('  Found clickable child via onclick', link);
        return link;
      }
    }

    return null;
  }
  
  // Extract URL from background-image
  function getBackgroundImageUrl(element) {
    const style = window.getComputedStyle(element);
    const bgImage = style.backgroundImage || style.background;
    
    if (bgImage && bgImage !== 'none') {
      const match = bgImage.match(/url\(['"]?([^'"]+)['"]?\)/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }
  
  // Parse onclick handler
  function parseOnClick(onclickStr) {
    if (!onclickStr) return null;
    
    const openMatch = /window\.open\(['"]([^'"]+)['"]/i.exec(onclickStr);
    if (openMatch && openMatch[1]) {
      return openMatch[1];
    }
    
    const urlMatch = /(https?:\/\/[^\s'"]+)/i.exec(onclickStr);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    
    return null;
  }
  
  let pollTimer = null;
  let observer = null;

  function contextValid() {
    return chrome.runtime && chrome.runtime.id !== undefined;
  }

  // Stop scanning once the extension context is gone (e.g. extension reloaded
  // while this content script is still running on an old page).
  function teardown() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (observer) { observer.disconnect(); observer = null; }
  }

  function sendAd(ad) {
    if (!contextValid()) return teardown();
    try {
      chrome.runtime.sendMessage({ what: 'registerAd', ad: ad }).catch(() => {});
    } catch (e) {
      teardown();
    }
  }

  // Reprocess each ad element at most once per REPROCESS_DELAY (not permanently),
  // so a slot that rotates its creative at runtime gets re-examined. Core dedup
  // (by targetUrl/src) stops the same creative being stored twice.
  const REPROCESS_DELAY = 3000;

  function canProcess(element) {
    const last = element.getAttribute('process-adn');
    if (!last) return true;
    return (Date.now() - parseInt(last, 10)) >= REPROCESS_DELAY;
  }

  function markProcessed(element) {
    element.setAttribute('process-adn', Date.now().toString());
  }

  // Extract ad data from an element already known/suspected to be an ad
  // container, and report it. Throttled via canProcess/markProcessed so
  // rotating ad slots are re-examined without permanently marking elements
  // as done. Shared by the top-frame selector scan (processElements) and
  // the sub-frame image sweep (scanFrameImages) below.
  function reportElement(element) {
    if (!canProcess(element)) return;
    markProcessed(element);

    const adData = extractAdData(element);
    if (!adData || !adData.targetUrl) return;

    // Determine type: text ad only if no image AND we have text content
    const isTextAd = !adData.imgSrc;
    const ad = {
      pageUrl: window.location.href,
      pageDomain: window.location.hostname,
      pageTitle: document.title,
      targetUrl: adData.targetUrl,
      foundTs: Date.now(),
      contentType: isTextAd ? 'text' : 'img',
      contentData: isTextAd
        ? { title: adData.title || '', text: adData.text || '', site: window.location.hostname }
        : { src: adData.imgSrc || '', width: adData.imgWidth || -1, height: adData.imgHeight || -1 },
      title: adData.title || (adData.text || '').substring(0, 80) || 'Pending',
      attempts: 0,
      visitedTs: 0,
    };

    logP('Found ad:', ad.contentType, ad.contentType === 'img'
      ? '(' + ad.contentData.width + 'x' + ad.contentData.height + ') src=' + (ad.contentData.src || '')
      : 'title="' + (ad.contentData.title || '').substring(0, 40) + '"',
      'target:', ad.targetUrl);

    // Send to background for registration (dedup, validation, storage).
    sendAd(ad);
  }

  // Inside a cross-origin ad sub-frame that is a bare creative with no
  // .ad-style wrapper at all (nothing matches defaultSelectors/adnAdSelectors,
  // so processElements() below never finds anything to process), scan every
  // image directly and walk up to its click-through ancestor. Mirrors the
  // MV2 parser's all_frames image scan.
  function scanFrameImages() {
    const imgs = document.querySelectorAll(imgSelectors.join(', '));
    if (imgs.length) {
      logP('Sub-frame image scan:', imgs.length, 'images on', window.location.hostname);
    }
    for (const img of imgs) {
      // Require a click-through ancestor — without one there's nothing to visit
      const container = findClickableParent(img);
      if (!container) continue;
      reportElement(container);
    }
  }

  // Process elements matching cosmetic filters
  // This is called by uBlock's cosmetic filter injection
  function processElements() {
    // Hook into uBlock's cosmetic filter mechanism
    // uBlock hides elements matching these selectors
    // We collect them as ads before they're hidden
    
    // Common ad selectors (fallback if we can't hook into uBlock)
    const defaultSelectors = [
      '.ad',
      '.advertisement',
      '[data-ad]',
      '.sponsored',
      '.pla-unit',
      '.clickable-card',
      '.GoogleActiveViewElement',
      // Taboola — only paid units (trc-content-sponsored), not organic recs
      '.trc-content-sponsored',
      '[data-item-syndicated]',
      // Outbrain
      '.ob-rec-link',
      '.ob-dynamic-rec-link',
      '.ob_what',
      // Google AdSense in-feed / matched content
      'ins.adsbygoogle'
    ];

    // The cosmetic scripts (css-specific/css-generic) publish the actual ad
    // selectors uBlock hides into self.adnAdSelectors. Scan those too so we
    // collect exactly the elements being hidden.
    const adnSelectors = self.adnAdSelectors ? Array.from(self.adnAdSelectors) : [];
    const selectorStr = defaultSelectors.concat(adnSelectors).join(', ');
    
    try {
      // A single invalid selector would throw and lose the whole scan; fall
      // back to the safe defaults so baseline collection is never broken.
      let elements;
      try {
        elements = document.querySelectorAll(selectorStr);
      } catch (e) {
        logP('Combined selector invalid, using defaults:', e.message);
        elements = document.querySelectorAll(defaultSelectors.join(', '));
      }
      logP('Scanning', elements.length, 'elements on', window.location.hostname);

      // Throttle, don't block: reportElement() skips an element only if it
      // was processed within REPROCESS_DELAY, so rotating ad slots are
      // re-examined while avoiding per-mutation churn.
      elements.forEach(reportElement);

      // A cross-origin ad sub-frame may have no selector-matching wrapper at
      // all (see scanFrameImages), so sweep its images directly.
      if (window !== window.top) {
        scanFrameImages();
      }
    } catch (error) {
      console.error('[ADN Parser] Error processing elements:', error);
    }
  }
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processElements);
  } else {
    processElements();
  }
  
  // Also run periodically for dynamic content
  pollTimer = setInterval(processElements, 5000);

  // Observe DOM changes
  observer = new MutationObserver((mutations) => {
    // Debounce: only process after 500ms of no mutations
    clearTimeout(observer.timer);
    observer.timer = setTimeout(processElements, 500);
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  
  console.log('[ADN Parser] Ready and observing DOM');
})();