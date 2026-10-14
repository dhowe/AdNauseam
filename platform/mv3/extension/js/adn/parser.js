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
  
  // Logs only when "Debug mode" (adnSettings.eventLogging) is on
  let debug = false;
  const debugReady = chrome.storage.local.get('adnSettings').then(data => {
    debug = data.adnSettings?.eventLogging === true;
    logP('Loaded on:', window.location.hostname);
  }).catch(() => {});
  
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

  // Known non-ad images, from MV2 parser.js. The data: entry is a transparent
  // spacer GIF, matched by prefix so we don't carry the whole 1.5KB literal.
  const ignorableImages = [
    'mgid_logo_mini_43x20.png',
    'data:image/gif;base64,R0lGODlh7AFIAfAAAAAAAAAAACH5BAEAAAAALAAAAADsAUgBAAL+hI+py+0P'
  ];

  // Min 31x65, as in MV2's createImageAd — excludes ad-choice logos and beacons.
  const MIN_MINOR_DIM = 31, MIN_MAJOR_DIM = 65;
  // A base64 1x1 GIF/PNG is ~70-100 bytes.
  const MIN_DATA_URI_LEN = 200;
  const PROBE_TIMEOUT_MS = 5000;
  const MAX_CANDIDATES = 12;

  const imageExtRe = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)(?:[?#]|$)/i;

  function logP(...args) {
    if (!debug) return;
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

  // Screen out values that can never load before we spend a request on them:
  // the lazy-load data attributes hold element ids, template placeholders and
  // srcset fragments as often as they hold URLs.
  function looksLikeImageUrl(src) {
    if (typeof src !== 'string') return false;
    const s = src.trim();
    if (s.length < 6) return false;

    if (/^data:/i.test(s)) {
      return /^data:image\//i.test(s) && s.length >= MIN_DATA_URI_LEN;
    }
    // blob: is scoped to the page that created it; the rest aren't images.
    if (/^(?:blob|javascript|about|mailto|tel|file):/i.test(s)) return false;
    if (/\s/.test(s)) return false;                       // leftover srcset or prose
    if (/[{}]|\$\{|%%|\[[A-Z_]+\]/.test(s)) return false; // unexpanded template

    if (/^(?:https?:)?\/\//i.test(s) || s.startsWith('/')) return true;
    return imageExtRe.test(s) || s.includes('/');
  }

  function isIgnorable(src) {
    return ignorableImages.some(s => src.includes(s));
  }

  // Resolve against document.baseURI so <base href> and, inside a frame, the
  // frame's own URL are honoured — the background used to rebuild relative srcs
  // from the *top-level tab* URL, the wrong base for any ad in a frame. Returns
  // null unless the result is something the vault could actually render.
  function toDisplayableSrc(raw) {
    const s = raw.trim();
    if (/^data:/i.test(s)) return s;
    try {
      const url = new URL(s, document.baseURI).href;
      return /^https?:/i.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  // Cached per-src: processElements() re-runs every 5s and on every mutation, so
  // without this the same URLs would be re-requested continuously. Resolves to
  // {w,h} if the image decodes, null if it doesn't.
  const probeCache = new Map();

  function probeImage(src) {
    let pending = probeCache.get(src);
    if (pending) return pending;

    pending = new Promise(resolve => {
      const img = new Image();
      const done = dims => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        img.src = ''; // abort anything still in flight
        resolve(dims);
      };
      const timer = setTimeout(() => done(null), PROBE_TIMEOUT_MS);
      img.onload = () => done(img.naturalWidth > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : null);
      img.onerror = () => done(null);
      img.src = src;
    });

    if (probeCache.size > 500) probeCache.clear();
    probeCache.set(src, pending);
    return pending;
  }

  // Dimensions we can trust: this element decoded *this* src. A broken <img>
  // keeps its layout box, so width/clientWidth report a plausible 300x250 for an
  // image that never loaded — which is how broken creatives passed the size gate.
  function decodedDims(el, src) {
    if (!el || el.tagName !== 'IMG' || !el.complete || !el.naturalWidth) return null;
    if ((el.currentSrc || el.src) !== src) return null;
    return { w: el.naturalWidth, h: el.naturalHeight };
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

    // Common lazy-load / native-ad data attributes. Values are screened by
    // looksLikeImageUrl() upstream, so we no longer take any string over 5 chars.
    const attrs = [
      'data-src', 'data-lazy-src', 'data-original', 'data-original-src',
      'data-imgsrc', 'data-bgset', 'data-background-image',
      'data-thumb', 'data-thumbnail', 'data-image-url', 'data-image',
      'src'
    ];
    for (const attr of attrs) {
      let val = el.getAttribute && el.getAttribute(attr);
      if (!val) continue;
      val = val.trim();
      // lazysizes-style attributes often hold a srcset rather than a bare URL
      if (/\s/.test(val)) val = parseSrcset(val);
      if (val && looksLikeImageUrl(val)) return val;
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

  // Every image URL worth trying for this ad element. Nothing is accepted here —
  // acceptance requires a proven load, which pickUsableImage() does.
  function collectImageCandidates(element) {
    const seen = new Set(), out = [];

    const add = (el, raw) => {
      // i-amphtml-intrinsic-sizer is a transparent sizer, never a creative (#1843).
      if (!raw || (el && el.className === 'i-amphtml-intrinsic-sizer')) return;
      if (!looksLikeImageUrl(raw)) return;
      const src = toDisplayableSrc(raw);
      if (!src || isIgnorable(src) || seen.has(src)) return;
      seen.add(src);
      out.push({
        el, src,
        isDataUri: src.startsWith('data:'),
        area: el ? (el.clientWidth || 0) * (el.clientHeight || 0) : 0
      });
    };

    const addImagesIn = root => {
      if (!root || !root.querySelectorAll) return false;
      const before = out.length;
      for (const el of root.querySelectorAll(imgSelectors.join(', '))) {
        add(el, resolveImageSrc(el));
      }
      return out.length > before;
    };

    addImagesIn(element);
    add(element, getBackgroundImageUrl(element));
    for (const child of element.querySelectorAll('[style*="background"]')) {
      add(child, getBackgroundImageUrl(child));
    }

    // Nothing of its own — look outward, closest first: ancestors, then (inside
    // an iframe) the whole document, since the iframe is usually the creative.
    if (out.length === 0) {
      let node = element.parentElement, depth = 0;
      while (node && depth++ < 8 && addImagesIn(node) === false) {
        node = node.parentElement;
      }
      if (out.length === 0 && window !== window.top) {
        addImagesIn(document.body || document.documentElement);
      }
    }

    // Data URIs are usually placeholders, so real URLs first, then largest.
    out.sort((a, b) => (a.isDataUri - b.isDataUri) || (b.area - a.area));
    return out.slice(0, MAX_CANDIDATES);
  }

  // The first candidate we can prove renders at a usable size.
  async function pickUsableImage(candidates) {
    for (const cand of candidates) {
      // Already decoded in the page? Proven — no extra request needed.
      const dims = decodedDims(cand.el, cand.src) || await probeImage(cand.src);
      if (dims === null) {
        logP('  Rejected (will not load):', cand.src.substring(0, 100));
        continue;
      }
      if (Math.min(dims.w, dims.h) < MIN_MINOR_DIM ||
          Math.max(dims.w, dims.h) < MIN_MAJOR_DIM) {
        logP('  Rejected (' + dims.w + 'x' + dims.h + ', too small):', cand.src.substring(0, 100));
        continue;
      }
      return { src: cand.src, w: dims.w, h: dims.h, el: cand.el };
    }
    return null;
  }

  // Extract ad data from element
  async function extractAdData(element) {
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

    // --- Image search ---
    // Only screened, absolute URLs get this far; pickUsableImage() then proves
    // one decodes at a usable size, so a stored src is one we know renders.
    // Nothing usable falls through to the text branch below rather than being
    // dropped, so we keep the click even when the creative is unreachable.

    const candidates = collectImageCandidates(element);
    logP('  Found', candidates.length, 'image candidate(s)');

    const image = await pickUsableImage(candidates);

    let chosenImg = null;
    if (image) {
      data.imgSrc = image.src;
      data.imgWidth = image.w;
      data.imgHeight = image.h;
      chosenImg = image.el;
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

  // Find clickable parent
  function findClickableParent(node) {
    let checkNode = node;
    let depth = 0;
    while (checkNode && checkNode.nodeType === 1 && depth < 10) {
      if (checkNode.tagName === 'A' || checkNode.hasAttribute('href')) {
        return checkNode;
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

    // Prefer links with specific ad-link classes (Google PLA, etc.)
    const adLinkSelectors = [
      'a.clickable-card',
      'a.pla-unit-single-clickable-target',
      'a.plantl[href^="http"]',
      'a[data-agdh]',
      'a[href^="http"]'
    ];

    for (const sel of adLinkSelectors) {
      const link = node.querySelector(sel);
      if (link) {
        const href = link.getAttribute('href');
        // Skip internal tracking redirects — we want the actual destination
        if (href && href.startsWith('http')) {
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
      // Stop at the closing paren: a value with two backgrounds (or a gradient
      // plus an image) would otherwise be captured whole as one bogus URL.
      const match = /url\((['"]?)([^'")]+)\1\)/.exec(bgImage);
      if (match && match[2]) {
        return match[2];
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

  // Timestamps live in a WeakMap, not a DOM attribute: writing an attribute can
  // trip the page's own MutationObserver into rebuilding nodes, which re-triggers
  // our scan, which writes the attribute again (see dhowe/AdNauseam#2847). Weak
  // keys let removed elements be garbage-collected.
  const processedElements = new WeakMap();

  function canProcess(element) {
    const last = processedElements.get(element);
    if (last === undefined) return true;
    return (Date.now() - last) >= REPROCESS_DELAY;
  }

  function markProcessed(element) {
    processedElements.set(element, Date.now());
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
      '.GoogleActiveViewElement'
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

      elements.forEach(element => {
        // Throttle, don't block: skip only if processed within REPROCESS_DELAY,
        // so rotating ad slots are re-examined while avoiding per-mutation churn.
        if (!canProcess(element)) return;
        markProcessed(element);

        // Image verification is async, so each element resolves on its own.
        // Elements are marked processed synchronously above, so a re-entrant
        // scan can't double-process one while its probes are in flight.
        processElement(element).catch(error => {
          console.error('[ADN Parser] Error processing element:', error);
        });
      });
    } catch (error) {
      console.error('[ADN Parser] Error processing elements:', error);
    }
  }

  async function processElement(element) {
    const adData = await extractAdData(element);
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


  // Run on page load (once the debug setting is known, so the first scan logs)
  debugReady.then(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', processElements);
    } else {
      processElements();
    }
  });
  
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
})();