/* global vAPI, µBlock */

µBlock.adnauseam = (function () {

  'use strict';

  // for debugging only
  var failAllVisits = 0, // all visits will fail
    clearAdsOnInit = 0, // start with zero ads
    clearVisitData = 0, // reset all ad visit data
    automatedMode = 0; // automated testing ['selenium' or 'sessbench']

  var µb = µBlock,
    production = 0,
    lastActivity = 0,
    lastPageLoad = 0,
    notifications = [],
    allowedExceptions = [],
    maxAttemptsPerAd = 3,
    visitTimeout = 20000,
    pollQueueInterval = 5000,
    profiler = +new Date(),
    strictBlockingDisabled = false,
    repeatVisitInterval = Number.MAX_VALUE;

  var xhr, idgen, admap, inspected, listEntries, firewall;

  // default rules for adnauseam's firewall
  var defaultDynamicFilters = [ ];

  // allow all blocks on requests to/from these domains
  var allowAnyBlockOnDomains = ['youtube.com', 'funnyordie.com'];

  // rules from EasyPrivacy we need to ignore (TODO: strip in load?)
  var disabledBlockingRules = ['||googletagservices.com/tag/js/gpt.js$script',
    '||amazon-adsystem.com/aax2/amzn_ads.js$script', '||stats.g.doubleclick.net^',
    '||googleadservices.com^$third-party', '||pixanalytics.com^$third-party',
  ];

  // allow blocks only from this set of lists
  var enabledBlockLists = ['My filters', 'EasyPrivacy',
    'uBlock filters – Badware risks', 'uBlock filters – Unbreak',
    'uBlock filters – Privacy', 'Malware domains', 'Malware Domain List',
    'Anti-ThirdpartySocial', 'AdNauseam filters', 'Fanboy’s Annoyance List‎',
    'CHN: CJX\'s Annoyance List‎', 'Spam404', 'Anti-Adblock Killer | Reek‎',
    'Fanboy’s Social Blocking List', 'Malware domains (long-lived)‎',
    'Adblock Warning Removal List', 'Malware filter list by Disconnect',
    'Basic tracking list by Disconnect', 'EFF DNT Policy Whitelist'
  ];

  // targets on these domains are never internal (may need to be regex)
  var internalLinkDomains = ['google.com', 'asiaxpat.com', 'nytimes.com',
    'columbiagreenemedia.com','163.com', 'sohu.com','zol.com.cn','baidu.com',
    'yahoo.com','facebook.com'
  ];

  // mark ad visits as failure if any of these are included in title
  var errorStrings = ['file not found', 'website is currently unavailable'];

  var reSpecialChars = /[\*\^\t\v\n]/;

  /**************************** functions ******************************/

  /* called when the addon is first loaded */
  var initialize = function (settings) {

    // modify XMLHttpRequest to store original request/ad
    var XMLHttpRequest_open = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url) {

      this.delegate = null; // store ad here
      this.requestUrl = url; // store original target
      return XMLHttpRequest_open.apply(this, arguments);
    };

    initializeState(settings);

    setTimeout(pollQueue, pollQueueInterval * 2);
  }

  var initializeState = function (settings) {

    admap = (settings && settings.admap) || {};
    (firewall = new µb.Firewall()).fromString(defaultDynamicFilters.join('\n'));

    validateAdStorage();

    if (production) { // disable all test-modes if production

      failAllVisits = clearVisitData = automatedMode = clearAdsOnInit = 0;

    } else if (automatedMode === 'sessbench') { // using sessbench

      setupTesting();
    }
  }

  var setupTesting = function () {

    warn('AdNauseam/sessbench: eid=' + chrome.runtime.id);

    chrome.runtime.onMessageExternal.addListener(
      function (request, sender, sendResponse) {

        if (request.what === 'getAdCount') {
          var url = request.pageURL,
            count = currentCount(),
            json = {
              url: url,
              count: count
            };

          console.log('TEST-FOUND: ', JSON.stringify(json));

          sendResponse({
            what: 'setPageCount',
            pageURL: url,
            count: count
          });

        } else if (request.what === 'clearAds') {
          clearAds();
        }
      });
  }

  /* make sure we have no bad data in ad storage */
  var validateAdStorage = function () {

    var ads = adlist(),
      i = ads.length;

    if (clearAdsOnInit) {

      setTimeout(function () {

        warn("[DEBUG] Clearing all ad data!");
        clearAds();

      }, 2000);

      return ads;
    }

    clearVisitData && clearAdVisits(ads);

    while (i--) {

      if (!validateFields(ads[i])) {

        warn('Invalid ad in storage', ads[i]);
        ads.splice(i, 1);
        continue;
      }

      if (ads[i].visitedTs === 0 && ads[i].attempts) {

        warn('Invalid visitTs/attempts pair', ads[i]);
        ads[i].attempts = 0; // this shouldn't happen
      }
    }

    computeNextId(ads);

    log('[INIT] Initialized with ' + ads.length + ' ads');

    return ads;
  }

  var clearAdVisits = function (ads) {

    warn("[WARN] Clearing all Ad visit data!");

    ads = ads || adlist();

    ads.forEach(function (ad) {

      ad.resolvedTargetUrl = null;
      ad.attemptedTs = 0;
      ad.visitedTs = 0;
      ad.attempts = 0
    });
  }

  // compute the highest id still in the admap
  var computeNextId = function (ads) {

    ads = ads || adlist();
    idgen = Math.max(0, (Math.max.apply(Math,
      ads.map(function (ad) {
        return ad ? ad.id : -1;
      }))));
  }

  var pollQueue = function (interval) {

    interval = interval || pollQueueInterval;

    markActivity();

    var next, pending = pendingAds(),
      settings = µb.userSettings;

    if (pending.length && settings.clickingAds && !isAutomated()) { // no visits if automated

      // check whether an idle timeout has been specified
      var idleMs = settings.clickOnlyWhenIdleFor;
      if (!idleMs || (millis() - lastPageLoad > idleMs)) {

        //idleMs && log("[IDLE] "+(millis() - lastPageLoad)+"ms, clicking resumed...");

        // if an unvisited ad is being inspected, visit it next
        if (visitPending(inspected)) {

          next = inspected;

        } else {

          // else take the most recent ad needing a visit
          next = pending.sort(byField('-foundTs'))[0];
        }

        visitAd(next);
      }
      //else log("[IDLE] "+(millis() - lastPageLoad)+"ms, waiting...");
    }

    // next poll
    setTimeout(pollQueue, Math.max(1, interval - (millis() - lastActivity)));
  }

  var markActivity = function () {

    return (lastActivity = millis());
  }

  var pendingAds = function () {

    return adlist().filter(function (a) {
      return visitPending(a);
    });
  }

  var visitPending = function (ad) {

    return ad && ad.attempts < maxAttemptsPerAd && ad.visitedTs <= 0;
  }

  var getExtPageTabId = function (htmlPage) {

    var pageUrl = vAPI.getURL(htmlPage);

    for (var tabId in µb.pageStores) {

      var pageStore = µb.pageStoreFromTabId(tabId);

      if (pageStore !== null && pageStore.rawURL.startsWith(pageUrl))
        return tabId;
    }
  }

  var updateAdOnFailure = function (xhr, e) {

    var ad = xhr.delegate;

    if (ad && ad.visitedTs <= 0) { // make sure we haven't visited already

      // update the ad
      ad.visitedTs = -millis();

      if (!ad.errors) ad.errors = [];
      ad.errors.push(xhr.status + ' (' +
        xhr.statusText + ')' + (e ? ' ' + e.type : ''));

      if (ad.attempts >= maxAttemptsPerAd) {

        log('[FAILED] ' + adinfo(ad), ad); // this);
        if (ad.title === 'Pending') ad.title = 'Failed';
      }

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

    } else {

      err("No Ad in updateAdOnFailure()", xhr, e);
    }
  }

  /* send to vault/menu/dashboard if open */
  var sendNotifications = function(notes) {
    vAPI.messaging.broadcast({
       what: 'notifications',
       notifications: notes
     });
  }

  var parseTitle = function (xhr) {

    var html = xhr.responseText,
      title = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    if (title && title.length > 1) {

      title = unescapeHTML(title[1].trim());

      for (var i = 0; i < errorStrings.length; i++) {

        // check the title isn't something like 'file not found'
        if (title.toLowerCase().indexOf(errorStrings[i]) > -1) {

          onVisitError.call(xhr, {
            title: title,
            status: xhr.status,
            responseText: html
          });

          throw Error('Bad-title: ' + title + " from: " + xhr.requestUrl);
        }
      }

      return title;
    }

    var shtml = html.length > 100 ? html.substring(0, 100) + '...' : html;
    //console.log('shtml: ' + shtml);
    warn('[VISIT] No title for ' + xhr.requestUrl, 'Html:\n' + shtml);

    return false;
  }

  var updateAdOnSuccess = function (xhr, ad, title) {

    var ad = xhr.delegate;

    if (ad) {

      if (title) ad.title = title;

      if (ad.title === 'Pending')
        ad.title = parseDomain(xhr.requestUrl, true);

      ad.resolvedTargetUrl = xhr.responseURL; // URL after redirects
      ad.visitedTs = millis(); // successful visit time

      vAPI.messaging.broadcast({
        what: 'adVisited',
        ad: ad
      });

      if (ad === inspected) inspected = null;

      log('[VISIT] ' + adinfo(ad), ad.title);
    }

    storeUserData();
  }

  // returns the current active visit attempt or null
  var activeVisit = function (pageUrl) {

    if (xhr && xhr.delegate) {
      if (!pageUrl || xhr.delegate === pageUrl)
        return xhr.delegate;
    }
  }

  var onVisitError = function (e) {

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    // Is it a timeout?
    if (e.type === 'timeout') {

      warn('[TIMEOUT] Visiting ' + this.requestUrl); //, e, this);

    } else {

      // or some other error?
      warn('onVisitError()', e, this.requestUrl, this.statusText); // this);
    }

    if (!this.delegate) {

      err('Request received without Ad: ' + this.responseURL);
      return;
    }

    updateAdOnFailure(this, e);

    xhr = null; // end the visit
  };

  var onVisitResponse = function () {

    /*if (this.responseURL==='http://rednoise.org/adntest/headers.php') // tmp
        log('onVisitResponseHeaders\n', this.responseText);*/

    this.onload = this.onerror = this.ontimeout = null;

    markActivity();

    var ad = this.delegate;

    if (!ad) {

      err('Request received without Ad: ' + this.responseURL);
      return;
    }

    if (!ad.id) {

      warn("Visit response from deleted ad! ", ad);
      return;
    }

    ad.attemptedTs = 0; // reset as visit no longer in progress

    var status = this.status || 200,
      html = this.responseText;

    if (failAllVisits || status < 200 || status >= 300 || !stringNotEmpty(html)) {

      return onVisitError.call(this, {
        status: status,
        responseText: html
      });
    }

    try {
      updateAdOnSuccess(this, ad, parseTitle(this));

    } catch (e) {

      warn(e.message);
    }

    xhr = null; // end the visit
  };

  var visitAd = function (ad) {

    var url = ad.targetUrl,
      now = markActivity();

    // tell menu/vault we have a new attempt
    vAPI.messaging.broadcast({
      what: 'adAttempt',
      ad: ad
    });

    if (xhr) {

      var elapsed = (now - xhr.delegate.attemptedTs);

      // TODO: why does this happen... a redirect?
      warn('[TRYING] Attempt to reuse xhr from ' + elapsed + " ms ago");

      if (elapsed > visitTimeout) {

        return onVisitError.call(xhr, {
          type: 'timeout'
        });
      }
    }

    ad.attempts++;
    ad.attemptedTs = now;

    if (!validateTarget(ad)) return deleteAd(ad);

    return sendXhr(ad);
  };

  var sendXhr = function (ad) {

    log('[TRYING] ' + adinfo(ad), ad.targetUrl);

    xhr = new XMLHttpRequest();

    try {

      xhr.open('get', ad.targetUrl, true);
      xhr.withCredentials = true;
      xhr.delegate = ad;
      xhr.timeout = visitTimeout;
      xhr.onload = onVisitResponse;
      xhr.onerror = onVisitError;
      xhr.ontimeout = onVisitError;
      xhr.responseType = ''; // 'document'?;
      xhr.send();

    } catch (e) {

      onVisitError.call(xhr, e);
    }
  }

  var storeUserData = function (immediate) {

    // TODO: defer if we've recently written and !immediate
    µb.userSettings.admap = admap;
    vAPI.storage.set(µb.userSettings);
  }

  var validateTarget = function (ad) {

    var url = ad.targetUrl;

    if (!/^http/.test(url)) {

      // Here we try to extract an obfuscated URL
      var idx = url.indexOf('http');
      if (idx != -1) {

        ad.targetUrl = decodeURIComponent(url.substring(idx));
        log("Ad.targetUrl updated: " + ad.targetUrl);

      } else {

        warn("Invalid TargetUrl: " + url);
        return false;
      }
    }

    ad.targetUrl = trimChar(ad.targetUrl, '/');
    ad.targetDomain = domainFromURI(ad.resolvedTargetUrl || ad.targetUrl);

    return true;
  }

  var domainFromURI = function (url) { // via uBlock/psl

    return µb.URI.domainFromHostname(µb.URI.hostnameFromURI(url));
  }

  var validateFields = function (ad) { // no side-effects

    return ad && type(ad) === 'object' &&
      type(ad.pageUrl) === 'string' &&
      type(ad.contentType) === 'string' &&
      type(ad.contentData) === 'object';
  }

  var validate = function (ad) {

    if (!validateFields(ad)) {

      warn('Invalid ad-fields: ', ad);
      return false;
    }

    var cd = ad.contentData,
      ct = ad.contentType,
      pu = ad.pageUrl;

    ad.title = unescapeHTML(ad.title); // fix to #31

    if (ct === 'text') {

      cd.title = unescapeHTML(cd.title);
      cd.text = unescapeHTML(cd.text);

    } else if (ct === 'img') {

      if (!/^http/.test(cd.src) && !/^data:image/.test(cd.src)) {

        if (/^\/\//.test(cd.src)) {

          cd.src = 'http:' + cd.src;

        } else {

          log("Relative-image: " + cd.src);
          cd.src = pu.substring(0, pu.lastIndexOf('/')) + '/' + cd.src;
          log("    --> " + cd.src);
        }
      }

    } else {

      warn('Invalid ad type: ' + ct);
    }

    return validateTarget(ad);
  }

  var clearAdmap = function () {

    var pages = Object.keys(admap);

    for (var i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {

        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++) {
          var ad = admap[pages[i]][hashes[j]];
          //ad.id = null; // null the id from deleted ads (?)
          delete admap[pages[i]][hashes[j]];
        }
      }

      delete admap[pages[i]];
    }

    admap = {}; // redundant
  }

  var millis = function () {

    return +new Date();
  }

  var adinfo = function (ad) {

    var id = ad.id || '?';
    return 'Ad#' + id + '(' + ad.contentType + ')';
  }

  var unescapeHTML = function (s) { // hack

    if (s && s.length) {
      var entities = [
        '#0*32', ' ',
        '#0*33', '!',
        '#0*34', '"',
        '#0*35', '#',
        '#0*36', '$',
        '#0*37', '%',
        '#0*38', '&',
        '#0*39', '\'',
        'apos', '\'',
        'amp', '&',
        'lt', '<',
        'gt', '>',
        'quot', '"',
        '#x27', '\'',
        '#x60', '`'
      ];

      for (var i = 0; i < entities.length; i += 2) {
        s = s.replace(new RegExp('\&' + entities[i] + ';', 'g'), entities[i + 1]);
      }
    }

    return s;
  }

  var adById = function (id) {

    var list = adlist();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id)
        return list[i];
    }
  }

  var closeExtPage = function (htmlPage) {

    var tabId = getExtPageTabId(htmlPage)
    tabId && vAPI.tabs.remove(tabId, true);
  }

  var reloadExtPage = function (htmlPage) {

    var tabId = getExtPageTabId(htmlPage)
    tabId && vAPI.tabs.reload(tabId);
  }

  var deleteAd = function (arg) {

    var ad = type(arg) === 'object' ? arg : adById(arg),
      count = adlist().length;

    if (!ad) warn("No Ad to delete", id, admap);

    if (admap[ad.pageUrl]) {

      var hash = computeHash(ad);

      if (admap[ad.pageUrl][hash]) {

        delete admap[ad.pageUrl][hash];
      } else {
        warn('Unable to find ad: ', ad, admap);
      }
    }

    if (adlist().length < count) {

      log('[DELETE] ' + adinfo(ad));
      updateBadges();

    } else {

      warn('Unable to delete: ', ad);
    }

    storeUserData();
  }

  var log = function () {
    if (µb.userSettings.eventLogging || !production)
      console.log.apply(console, arguments);
    return true;
  }

  var warn = function () {
    if (µb.userSettings.eventLogging || !production)
      console.warn.apply(console, arguments);
    return false;
  }

  var err = function () {
    console.error.apply(console, arguments);
    return false;
  }

  // return ALL ads, regardless of pageUrl param
  var adsForUI = function (pageUrl) {

    //console.log('adsForUI.notes: ',notifications);
    return {
      data: adlist(),
      pageUrl: pageUrl,
      prefs: contentPrefs(),
      current: activeVisit(),
      notifications: notifications
    };
  }

  var validateImport = function (map, replaceAll) {

    if (type(map) !== 'object')
      return false;

    var pass = 0,
      newmap = replaceAll ? {} : admap,
      pages = Object.keys(map);

    for (var i = 0; i < pages.length; i++) {

      if (type(map[pages[i]]) !== 'object')
        return false;

      var hashes = Object.keys(map[pages[i]]);
      for (var j = 0; j < hashes.length; j++) {

        if (type(hashes[j]) !== 'string' || hashes[j].indexOf('::') < 0) {

          warn('Bad hash in import: ', hashes[j], ad); // tmp
          return false;
        }

        var ad = map[pages[i]][hashes[j]];
        if (validateFields(ad)) {

          validateTarget(ad); // accept either way

          if (!newmap[pages[i]]) newmap[pages[i]] = {};
          newmap[pages[i]][hashes[j]] = ad;
          pass++;

        } else {

          warn('Invalid ad in import: ', ad); // tmp
        }
      }
    }

    return pass ? newmap : false;
  }

  var validateAdArray = function (ads, replaceAll) {

    var map = replaceAll ? {} : admap;

    for (var j = 0; j < ads.length; j++) {

      var ad = updateLegacyAd(ads[j]),
        hash = computeHash(ad);

      if (!validateFields(ad)) {

        warn('Unable to validate legacy ad', ad);
        continue;
      }

      var page = ad.pageUrl;
      if (!map[page]) map[page] = {};
      map[page][hash] = ad;

      //console.log('converted ad', map[page][hash]);
    }

    return map;
  }

  var validateLegacyImport = function (map) {

    if (type(map) !== 'object') {

      return (type(map) === 'array') ? validateAdArray(map) :
        warn('Import-fail: not object or array', type(map), map);
    }

    var ad, ads, hash, newmap = {},
      pages = Object.keys(map);

    if (!pages || !pages.length) {

      warn('no pages: ', pages);
      return false;
    }

    for (var i = 0; i < pages.length; i++) {

      ads = map[pages[i]];

      if (type(ads) !== 'array') {

        warn('not array', type(ads), ads);
        return false;
      }

      newmap[pages[i]] = {};

      for (var j = 0; j < ads.length; j++) {

        ad = updateLegacyAd(ads[j]);
        hash = computeHash(ad);

        if (!validateFields(ad)) {

          warn('Unable to validate legacy ad', ad);
          continue;
        }

        newmap[pages[i]][hash] = ad;

        //log('converted ad', newmap[pages[i]][hash]);
      }
    }

    return newmap;
  }

  var updateLegacyAd = function (ad) {

    ad.id = ++idgen;
    ad.attemptedTs = 0;
    ad.version = vAPI.app.version;
    ad.attempts = ad.attempts || 0;
    ad.pageDomain = domainFromURI(ad.pageUrl) || ad.pageUrl; // DCH: 8/10
    if (!ad.errors || !ad.errors.length)
      ad.errors = null;
    delete ad.hashkey;
    delete ad.path;

    return ad;
  }

  var postRegister = function (ad, pageUrl, tabId) {

    log('[FOUND] ' + adinfo(ad), ad);

    // if vault/menu is open, send the new ad
    var json = adsForUI(pageUrl);
    json.what = 'adDetected';
    json.ad = ad;

    //if (automatedMode) json.automated = true; // not used ?

    vAPI.messaging.broadcast(json);

    if (µb.userSettings.showIconBadge)
      µb.updateBadgeAsync(tabId);

    storeUserData();
  }

  var activeBlockList = function (test) {

    return enabledBlockLists.indexOf(test) > -1;
  }

  // check that the rule is not disabled in 'disabledBlockingRules'
  var ruleDisabled = function (test) {

    return disabledBlockingRules.indexOf(test) > -1;
  };

  // check target domain against page-domain #337
  var internalTarget = function (ad) {

    if (ad.contentType === 'text') return false;

    // if an image ad's page/target domains match, it's internal
    return (ad.pageDomain === ad.targetDomain);
  };

  var listsForFilter = function (compiledFilter) {

    var entry, content, pos, c, lists = [];

    for (var path in listEntries) {

      entry = listEntries[path];
      //console.log(entry);
      if (entry === undefined) {
        continue;
      }
      content = entry.content;
      pos = content.indexOf(compiledFilter);
      if (pos === -1) {
        continue;
      }
      // We need an exact match.
      // https://github.com/gorhill/uBlock/issues/1392
      if (pos !== 0 && reSpecialChars.test(content.charAt(pos - 1)) === false) {
        continue;
      }
      // https://github.com/gorhill/uBlock/issues/835
      c = content.charAt(pos + compiledFilter.length);
      if (c !== '' && reSpecialChars.test(c) === false) {
        continue;
      }
      lists.push(entry.title); // only need titles
      /*{ title: entry.title
      supportURL: entry.supportURL }*/
    }

    return lists;
  };

  var isBlockableDomain = function (context) {

    //console.log('isBlockableDomain',context.rootDomain, context);

    var domain = context.rootDomain,
      host = context.requestHostname;

    for (var i = 0; i < allowAnyBlockOnDomains.length; i++) {

      var dom = allowAnyBlockOnDomains[i];
      if (dom === domain || host.indexOf(dom) > -1) {
        return true;
      }
    }
    return false;
  };

  /**
   *  NOTE: this is called AFTER our firewall rules, and checks the following:
   *  1) whether we are blocking at all
   *  		if not, return false
   *  2) whether domain is blockable (allowAnyBlockOnDomains)
   *  		if so, return true;
   *  3) if it is in the globally disabled rules (disabledBlockingRules)
   *  		if so return false
   *  4) if any list it was found on allows blocks
   *  		if so, return true;
   */
  var isBlockableRequest = function (context) {

    if (µb.userSettings.blockingMalware === false) {

      logNetAllow('NoBlock', context.rootDomain + ' => ' + context.requestURL);
      return false;
    }

    if (!strictBlockingDisabled) {

      logNetAllow('Loading', context.rootDomain  + ' => ' + context.requestURL);
      return false;
    }

    if (isBlockableDomain(context)) {

      logNetBlock('Domains', context.rootDomain + ' => ' + context.requestURL);
      return true;
    }

    var snfe = µb.staticNetFilteringEngine,
      compiled = snfe.toResultString(1).slice(3),
      raw = snfe.filterStringFromCompiled(compiled),
      url = context.requestURL;

    if (ruleDisabled(raw)) {

      // TODO: check that the rule hasn't been added in 'My filters' ?
      return allowRequest('RuleOff', raw, url);
    }

    // always allow redirect blocks from lists (?)
    if (µb.redirectEngine.toURL(context)) {

      return true;
    }

    /*
      Check active rule(s) to see if we should block or allow
      Cases:
        A) no lists:      allow
        B) exception hit: allow
        C) block hit:     block
        D) no valid hits: allow, but no cookies later

        Note: not sure why case A) ever happens, but appears to
        only soon after an update to MyRules, perhaps before rule is compiled
     */
    var lists = listsForFilter(compiled);

    if (lists.length === 0) {                                // case A

      logNetAllow('NoList', raw, url);
      return false;
    }

    for (var i = 0; i < lists.length; i++) {

      var name = lists[0];

      if (activeBlockList(name)) {

        if (raw.indexOf('@@') === 0) {                       // case B

          logNetAllow(name, raw + ': ', url);
          return false;
        }

        logNetBlock(name, raw + ': ', url);                  // case C
        return true; // blocked, no need to continue
      }
      else {

        if (!misses) var misses = [];
        if (!misses.contains(name)) misses.push(name);
      }
    }

    return allowRequest(misses.join(','), raw + ': ', url);  // case D
  }

  var allowRequest = function (msg, raw, url) {

    // Note: need to store allowed requests here so that we can
    // block any incoming cookies later (see #301)
    allowedExceptions[url] = +new Date();
    if (msg !== 'EasyList')
      logNetEvent('[ALLOW!]', msg, raw + ': ', url);
    return false;
  }

  // start by grabbing user-settings, then calling initialize()
  vAPI.storage.get(µb.userSettings, function (settings) {

    // this for backwards compatibility only ---------------------
    var mapSz = Object.keys(settings.admap).length;
    if (!mapSz && µb.adnSettings && µb.adnSettings.admap) {

      settings.admap = µb.adnSettings.admap;
      log("[IMPORT] Using legacy admap...");
      setTimeout(function () {
        storeUserData(true);
      }, 2000);
    } // ---------------------------------------------------------

    initialize(settings);
  });

  /********************************** API *************************************/

  var exports = {};

  exports.adsForVault = function (request, pageStore, tabId) {

    return adsForUI();
  }

  exports.mustAllow = function (result, context) {

    return result && result.length && !isBlockableRequest(context);
  }

  exports.itemInspected = function (request, pageStore, tabId) {

    if (request.id) {
      var ad = adById(request.id)
      inspected = ad;
    }
  };

  var contentPrefs = exports.contentPrefs = function () {

    // preferences relevant to our ui/content-scripts
    var r = {
      //production: production, // not needed
      hidingDisabled: !µb.userSettings.hidingAds,
      textAdsDisabled: !µb.userSettings.parseTextAds,
      logEvents: µb.userSettings.eventLogging
    };

    return r;
  };

  exports.toggleEnabled = function (request, pageStore, tabId) {

    var store = µb.pageStoreFromTabId(request.tabId);
    if (store) {

      store.toggleNetFilteringSwitch(request.url, request.scope, request.state);
      updateBadges();

      // close whitelist if open (see gh #113)
      var wlId = getExtPageTabId("dashboard.html#whitelist.html")
      wlId && vAPI.tabs.replace(wlId, vAPI.getURL("dashboard.html"));
    }
  };

  // Called when new top-level page is loaded
  exports.onPageLoad = function (tabId, requestURL) {

    var ads = adlist(requestURL); // all ads for url

    //console.log('PAGE: ', requestURL, ads.length);

    ads.forEach(function (ad) {
      ad.current = false;
    });

    if (automatedMode === 'selenium' && requestURL === 'http://rednoise.org/ad-auto-export')
      exportAds();

    lastPageLoad = millis();
  };

  exports.onListsLoaded = function (firstRun) {

    µb.staticFilteringReverseLookup.initWorker(function (entries) {

      listEntries = entries;
      var keys = Object.keys(entries);
      log("[LOAD] Compiled " + keys.length +
        " 3rd-party lists in " + (+new Date() - profiler) + "ms");
      strictBlockingDisabled = true;
      verifyAdBlockers();
      verifySettings(); // check settings/lists
      verifyLists(µBlock.remoteBlacklists);
    });

    if (firstRun && !isAutomated()) {

      vAPI.tabs.open({
        url: 'firstrun.html',
        index: -1
      });

      // collapses 'languages' group in dashboard:3rd-party
      vAPI.localStorage.setItem('collapseGroup5', 'y');
    }
  };

  var isAutomated = function () {
    return (automatedMode && automatedMode.length);
  }

  var logNetAllow = exports.logNetAllow = function () {

    var args = Array.prototype.slice.call(arguments);
    args.unshift('[ALLOW]')
    logNetEvent.apply(this, args);
  };

  var logNetBlock = exports.logNetBlock = function () {

    var args = Array.prototype.slice.call(arguments);
    args.unshift('[BLOCK]');
    logNetEvent.apply(this, args);
  };

  var logRedirect = exports.logRedirect = function (from, to) {

    if (µb.userSettings.eventLogging && arguments.length)
      log('[REDIRECT] ' + from + ' => ' + to);
  };

  var logNetEvent = exports.logNetEvent = function () {

    if (µb.userSettings.eventLogging && arguments.length) {

      var args = Array.prototype.slice.call(arguments);
      var action = args.shift();
      args[0] = action + ' (' + args[0] + ')';
      log.apply(this, args);
    }
  }

  exports.lookupAd = function (url, requestId) {

    url = trimChar(url, '/'); // no trailing slash

    var ads = adlist();

    for (var i = 0; i < ads.length; i++) {

      if (ads[i].attemptedTs) {
        //console.log('check: '+ads[i].requestId+'/'+ads[i].targetUrl+' ?= '+requestId+'/'+url);
        if (ads[i].requestId === requestId || ads[i].targetUrl === url) {
          return ads[i];
        }
      }
    }
  };

  exports.registerAd = function (request, pageStore, tabId) {

    if (!request.ad) return;

    var json, adhash, msSinceFound, orig,
      pageUrl = pageStore.rawURL,
      ad = request.ad;

    ad.current = true;
    ad.attemptedTs = 0;
    ad.pageUrl = pageUrl;
    ad.pageTitle = pageStore.title;
    ad.pageDomain = µb.URI.domainFromHostname(pageStore.tabHostname); // DCH: 8/10
    ad.version = vAPI.app.version;

    //console.log('registerAd: '+pageStore.tabHostname+' -> '+ad.pageDomain);

    if (!validate(ad)) {

      warn("Invalid Ad: ", ad);
      return;
    }

    if (internalLinkDomains.indexOf(ad.pageDomain) < 0 && internalTarget(ad)) {

      warn('[INTERN] Ignoring Ad on '+ad.pageDomain+', target: '+ad.targetUrl);
      return; // testing this
    }

    if (!admap[pageUrl]) admap[pageUrl] = {};

    adhash = computeHash(ad);

    if (admap[pageUrl][adhash]) { // may be a duplicate

      orig = admap[pageUrl][adhash];
      msSinceFound = millis() - orig.foundTs;

      if (msSinceFound < repeatVisitInterval) {

        log('[EXISTS] ' + adinfo(ad) + ' found ' + msSinceFound + ' ms ago');
        return;
      }
    }

    ad.id = ++idgen; // gets an id only if its not a duplicate

    // this will overwrite an older ad with the same key
    admap[pageUrl][adhash] = ad;

    postRegister(ad, pageUrl, tabId);
  };

  // update tab badges if we're showing them
  var updateBadges = exports.updateBadges = function () {

    var optionsUrl = vAPI.getURL('options.html');

    for (var tabId in µb.pageStores) {

      var store = µb.pageStoreFromTabId(tabId);
      if (store !== null && !store.rawURL.startsWith(optionsUrl)) {
        µb.updateBadgeAsync(tabId);
      }
    }
  };

  exports.injectContentScripts = function (request, pageStore, tabId, frameId) {

    if (µb.userSettings.eventLogging)
      log('[INJECT] Dynamic-iFrame: ' + request.parentUrl, request, tabId + '/' + frameId);

    // Firefox already handles this correctly
    vAPI.chrome && vAPI.onLoadAllCompleted(tabId, frameId);
  };

  exports.checkAllowedException = function (url, headers) {

    if (typeof allowedExceptions[url] !== 'undefined')
      return blockIncomingCookies(headers, url);
    return false;
  };

  var blockIncomingCookies = exports.blockIncomingCookies = function (headers, requestUrl, originalUrl) {

    var modified = false, dbug = 0;

    dbug && console.log('[HEADERS] (Incoming' + (requestUrl===originalUrl ? ')' : '-redirect)'), requestUrl);

    for (var i = headers.length - 1; i >= 0; i--) {

      var name = headers[i].name.toLowerCase();

      dbug && console.log(i + ') '+name, headers[i].value);

      if (name === 'set-cookie' || name === 'set-cookie2') {

        log('[COOKIE] (Block)', headers[i].value);
        headers.splice(i, 1);
        modified = true;
      }
    }

    return modified;
  };

  exports.shutdown = function () {

    firewall.reset();
  };

  exports.checkFirewall = function (context) {

    firewall.evaluateCellZY(context.rootHostname, context.requestHostname, context.requestType);

    var result = '';
    if (firewall.mustBlockOrAllow()) {

      result = firewall.toFilterString();
      var action = firewall.mustBlock() ? 'BLOCK' : 'ALLOW';

      logNetEvent('[' + action + ']', ['Firewall', ' ' + context.rootHostname + ' => ' +
        context.requestHostname, '(' + context.requestType + ') ', context.requestURL
      ]);
    }

    return result;
  };

  exports.deleteAdSet = function (request, pageStore, tabId) {

    request.ids.forEach(function (id) {
      deleteAd(id);
    });
  };

  exports.logAdSet = function (request, pageStore, tabId) {

    var data = '';

    request.ids.forEach(function (id) {
      data += JSON.stringify(adById(id));
    });

    log('ADSET #' + request.gid + '\n', data);

    vAPI.messaging.broadcast({
      what: 'logJSON',
      data: data
    });

    return data;
  };

  /*
   * Returns all ads for a page, or all pages, if 'pageUrl' arg is null
   * If 'currentOnly' is true, returns only current-marked ads
   *
   * Omits text-ads if specified in preferences
   * Called also from tab.js::µb.updateBadgeAsync()
   */
  var adlist = exports.adlist = function (pageUrl, currentOnly) {

    var result = [], pages = pageUrl ? [pageUrl]
      : Object.keys(admap || µb.userSettings.admap);

    for (var i = 0; i < pages.length; i++) {

      if (admap[pages[i]]) {

        var hashes = Object.keys(admap[pages[i]]);

        for (var j = 0; j < hashes.length; j++) {

          var ad = admap[pages[i]][hashes[j]];

          // ignore text-ads according to parseTextAds prefe
          if (ad && (µb.userSettings.parseTextAds || ad.contentType !== 'text')) {
              if (!currentOnly || ad.current) {
                result.push(ad);
              }
          }
        }
      }
    }

    return result;
  };

     /*
   * Verify if other ad blockers are already installed & enabled
   * If yes, we don't let the user turn on any features
   * (hide,click,block) until it is disabled
   * TODO: Shall be handled differently on different browser
   */
  var verifyAdBlockers = exports.verifyAdBlockers = function() {
      var notes = notifications,
          dirty = false;

      vAPI.getAddonInfo(function(UBlockConflict, AdBlockPlusConflict) {
          // console.log(UBlockConflict, AdBlockPlusConflict);
          if (AdBlockPlusConflict) {

              dirty = addNotification(notes, AdBlockPlusEnabled);
          } else {
              dirty = removeNotification(notes, AdBlockPlusEnabled);
          }

          if (UBlockConflict) {

              dirty = dirty || addNotification(notes, UBlockEnabled);
          } else {
              dirty = dirty || removeNotification(notes, UBlockEnabled);
          }

          dirty && sendNotifications(notes);

      });
  }


  var verifySettings = exports.verifySettings = function () {

    verifySetting(HidingDisabled,   !µb.userSettings.hidingAds);
    verifySetting(ClickingDisabled, !µb.userSettings.clickingAds);
    verifySetting(BlockingDisabled, !µb.userSettings.blockingMalware);
    //verifyList(EasyList, µb.userSettings.remoteBlacklists);
  }

  var verifyLists = exports.verifyLists = function (lists) {

    verifyList(EasyList, lists);
  }

  var verifyList = exports.verifyList = function (note, lists) {

    var notes = notifications,
      dirty = false,
      path, entry;

    for (path in lists) {
      if (lists.hasOwnProperty(path) === false) {
        continue;
      }
      entry = lists[path];
      if (path === note.listUrl) {

        if (entry.off === true && notes.indexOf(note) < 0) {

          dirty = addNotification(notes, note);
          //console.log('AddNotify', entry.title, 'dirty='+dirty);
        }
        else if (entry.off === false) {

          dirty = removeNotification(notes, note);
          //console.log('RemoveNotify', entry.title, 'dirty='+dirty);
        }
      }
    }

    if (dirty) sendNotifications(notes);
  }

  var verifySetting = exports.verifySetting = function (note, state) {

    var notes = notifications, dirty = false;

    if (state && notes.indexOf(note) < 0) {

      dirty = addNotification(notes, note);
    }
    else if (!state) {

      dirty = removeNotification(notes, note);
    }

    if (dirty) {

      // check whether DNT list state needs updating
      if (note === ClickingDisabled || note === HidingDisabled) {

        //console.log('clicking: ', state, µb.userSettings.clickingAds || µb.userSettings.clickingAds
        var off = !(µb.userSettings.clickingAds || µb.userSettings.hidingAds);
        µb.selectFilterLists({ location: 'https://www.eff.org/files/effdntlist.txt', off: off })
      }

      sendNotifications(notes);
    }
  }

  // Returns the count for current-marked ads for the url
  // or if none exists, then all ads stored for the url
  var currentCount = exports.currentCount = function (url) {

    return adlist(url, true).length || adlist(url).length;
  }

  var clearAds = exports.clearAds = function () {

    var pre = adlist().length;

    clearAdmap();
    reloadExtPage('vault.html');
    updateBadges();
    storeUserData();
    computeNextId();

    log('[CLEAR] ' + pre + ' ads cleared');
  };

  exports.importAds = function (request) {

    // try to parse imported ads in current format
    var importedCount = 0,
      count = adlist().length,
      map = validateImport(request.data);

    if (!map) {

      // no good, try to parse in legacy-format
      map = validateLegacyImport(request.data);

      if (map) {

        // check that legacy ads were converted ok
        map = validateImport(map);
        if (map) {

          // ok, legacy ads converted and verified
          log('[IMPORT] Updating legacy ads');
        }

      } else {

        warn('[IMPORT] Unable to parse legacy-format:', request.data);
        return { // give up and show 0 ads imported
          what: 'importConfirm',
          count: 0
        };
      }
    }

    admap = map;
    computeNextId();
    clearVisitData && clearAdVisits();
    storeUserData();

    importedCount = adlist().length - count;
    log('[IMPORT]: ' + importedCount + ' ads from ' + request.file);
    reloadExtPage('vault.html'); // reload Vault page if open

    return {
      what: 'importConfirm',
      count: importedCount
    };
  };

  exports.getNotifications = function () {

    return notifications;
  }

  var exportAds = exports.exportAds = function (request) {

    var count = adlist().length,
      filename = (request && request.filename) || getExportFileName();

    vAPI.download({
      'url': 'data:text/plain;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(admap, null, '  ')),
      'filename': filename
    });

    if (true) saveVaultImages(filename);

    log('[EXPORT] ' + count + ' ads to ' + filename);
  };


  function getBase64Image(img) {

		// Create an empty canvas element
		var canvas = document.createElement("canvas");
		canvas.width = img.width;
		canvas.height = img.height;

		// Copy the image contents to the canvas
		var ctx = canvas.getContext("2d");
		ctx.drawImage(img, 0, 0);

		// Get the data-URL formatted image
		// Firefox supports PNG and JPEG. You could check img.src to
		// guess the original format, but be aware the using "image/jpg"
		// will re-encode the image.
        try{
			var dataURL = canvas.toDataURL("image/png");
			return dataURL.replace(/^data:image\/(png|jpg);base64,/, "");
		}catch(err){
			console.log(err);
			return '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';
		}

    }


  var saveVaultImages = function (jsonName) {

    var imgURLs = []; // extract image urls
    adlist().forEach(function (ad) {
      if (ad.contentType === 'img')
        imgURLs.push(ad.contentData.src);
    });

    // download them to a folder next to the export file (with same name -json)
    // handle #639 here

    var zipNameParts = jsonName.split(".");
    var zipName = zipNameParts.splice(0, zipNameParts.length - 2).join('_');


    var files = [];
    for (var i = 0; i < imgURLs.length; i++) {
        var url = imgURLs[i];

		(function(url){
            var parts = url.split("/");
            var filename = parts[parts.length - 1];
            // for now:
            filename = "image_"+i+".jpg"
			var img = new Image();
			img.onload = function() {

				var a = document.createElement('a');
				a.href = this.src;

				// Add to file array [{name, data}]
				files.push({name: filename, data: getBase64Image(img) });
			}
			img.src = url;
		})(url);

	}

	var check = setInterval(function(){
		if(files.length==imgURLs.length) {
			clearInterval(check);

            var zip = new JSZip();
            var img = zip.folder(zipName);

            var zipcount = 0;
            for(var i = 0; i < files.length; i++){
                img.file(files[i].name, files[i].data, {base64: true});
            }
            zip.generateAsync({
                type:"base64"
            }).then(function(content) {

                // vAPI.download({
                //   'url': "data:application/zip;base64,"+content,
                //   'filename': zipName+"_"+zipcount
                // });

                chrome.downloads.download({
                  url: "data:application/zip;base64,"+content,
                  filename: zipName+".zip" // Optional
                });
            });

		}
	}, 500);



  };

  exports.adsForPage = function (request, pageStore, tabId) {

    var reqPageStore = request.tabId &&
      µb.pageStoreFromTabId(request.tabId) || pageStore;

    if (!reqPageStore)
      warn('No pageStore', request, pageStore, tabId);

    return adsForUI(reqPageStore.rawURL);
  };

  return exports;

})();

/****************************** messaging ********************************/

(function () { // pass all incoming messages directly to exported functions

  'use strict';

  vAPI.messaging.listen('adnauseam', function (request, sender, callback) {

    //console.log("adnauseam.MSG: "+request.what, sender.frameId);

    switch (request.what) {
      default: break;
    } // Async

    var pageStore, tabId, frameId, µb = µBlock;

    if (sender && sender.tab) {

      tabId = sender.tab.id;
      frameId = sender.frameId;
      pageStore = µb.pageStoreFromTabId(tabId);
    }

    if (typeof µb.adnauseam[request.what] === 'function') {

      request.url && (request.url = trimChar(request.url, '/')); // no trailing slash
      callback(µb.adnauseam[request.what](request, pageStore, tabId, frameId));

    } else {

      return vAPI.messaging.UNHANDLED;
    }
  });

})();

/*************************************************************************/
