/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
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
*/

'use strict';

import uDom from './uDom.js';

import { i18n$ } from "../i18n.js";
import { onBroadcast } from '../broadcast.js';
import { renderNotifications } from './notifications.js';

import {
  byField,
  exportToFile,
  setCost,
  arrayRemove,
  rand,
  showVaultAlert,
  computeHash,
  parseHostname,
  targetDomain,
  handleImportAds,
  purgeDeadAds,
  decodeEntities,
  clearAds,
  getExportFileName,
  generateCaptureSvg
} from './adn-utils.js';

// note: this code is a mess and needs to be refactored

const States = ['pending', 'visited', 'failed', 'dnt-allowed', 'image-error'],
  Zooms = [400, 200, 150, 100, 75, 50, 25, 12.5, 7.5, 5],
  EnableContextMenu = 1,
  MaxStartNum = 300;

const margin = {
  top: 50,
  right: 40,
  bottom: 20,
  left: 20
};

const animateMs = 2000;
const viewState = {};
const messager = vAPI.messaging;

// determined by mousewheel
let userZoomScale = Zooms[Zooms.indexOf(100)];

// determined by zoom in / out buttons
let zoomIdx = 0;

let animatorId, resizeId, selectedAdSet;
let showInterface = true;
let draggingVault = false;
let vaultLoading = false;

const container_div = document.getElementById('container');
const $container = $('#container');
const $ratio = $('#ratio');

let transitionTimeout = null;

let gAds, gAdSets, gMin, gMax, gSliderRight, gSliderLeft, settings, pack;
let lastAdDetectedTime, waitingAds = []; // stateful

let hideDeadAds = false;

onBroadcast(request => {
  //console.log("GOT BROADCAST", request);
  switch (request.what) {
    case 'adAttempt':
      setCurrent(request.ad);
      break;

    case 'adDetected':
      waitingAds.push(request.ad);
      lastAdDetectedTime = new Date();
      const brush = document.getElementsByClassName('chart-bg')[0];
      const w = brush ? parseInt(brush.attributes.width.value) : null,
        sliderPos = gSliderLeft !== undefined ? gSliderLeft : null;

      // only when the slider covers 'now' or when there is no slider (empty vault or one ad)
      if (w - sliderPos <= 1 || sliderPos == 0) setTimeout(autoUpdateVault, 3000);

      //  updateVault() would normally be triggered by the 'adDetected' message (above),
      //  which contains the new ads, and is sent ONLY if the the vault is open
      break;

    case 'adVisited':
      updateAd(request);
      break;

    case 'notifications':
      renderNotifications(request.notifications, 'vault');
      adjustHeight();
      createSlider();
      break;

    case 'hideNotifications':
      uDom('#notifications').addClass("hide");
      adjustHeight();
      break;

    case 'showNotifications':
      uDom('#notifications').removeClass("hide");
      adjustHeight();
      break;
  }
});

/********************************************************************/

const renderAds = function (json, purge) {
  gAds = json.data; // store
  addInterfaceHandlers();
  settings = json.prefs;
  if (purge) {
    createSlider("update");
  } else {
    createSlider();
  }
  setCurrent(json.current);

  vAPI.messaging.send(
    'adnauseam', {
    what: 'verifyAdBlockers'
  }).then(n => {
    vAPI.messaging.send(
      'adnauseam', {
      what: 'getNotifications'
    }).then(data => {
      if (data.notifications && data.notifications.length) {
        renderNotifications(data.notifications, 'vault');
      }
      adjustHeight();
    })
  });

  // disable warnings #1910
  // Notifications need to be hidden right away for the correct height to be calculated
  vAPI.messaging.send(
    'adnauseam', { what: 'getWarningDisabled' })
    .then(isDisabled => {
      if (isDisabled) {
        uDom("#notifications").addClass('hide');
      } else {
        uDom("#notifications").removeClass('hide');
      }
      adjustHeight();
    })

  vAPI.messaging.send(
    'adnauseam', {
    what: 'getBlurCollectedAds'
  }).then(blurCollectedAds => {
    if (blurCollectedAds) {
      uDom("#stage").addClass('blur');
    } else {
      uDom("#stage").removeClass('blur');
    }
  });

  $('#show-dead-ads').on('click', function () {
    hideDeadAds = false;
    $('#show-dead-ads').hide();
    $('#hide-dead-ads').show();
    createSlider();
  });
  
  $('#hide-dead-ads').on('click', function () {
    hideDeadAds = true;
    $('#show-dead-ads').show();
    $('#hide-dead-ads').hide();
    createSlider();
  });

  if (settings.devMode || settings.logEvents) {
    console.log("DevMode: enabling capture button");
    $('#capture').on('click', onCapture);
    $('#capture').removeClass('item-hidden');

    if (hideDeadAds) {
      $('#show-dead-ads').show();
      $('#hide-dead-ads').hide();
    } else {
      $('#show-dead-ads').hide();
      $('#hide-dead-ads').show();
    }
  } else {
    $('#show-dead-ads').hide();
    $('#hide-dead-ads').hide();
  }
};

const autoUpdateVault = function () {
  const gap = new Date() - lastAdDetectedTime;
  if (waitingAds != [] && gap >= 3000) {
    updateVault(waitingAds, true);
    // console.log("autoupdate", gap)
  } else {
    // console.log("skip-update", gap)
  }
}

const getHash = function (ad) {
  return ad.hash ? ad.hash : computeHash(ad);
}

const updateVault = function (ads, newAdsOnly) {
  if (vaultLoading) return;
  if (gAdSets == null) {
    gAds = ads;
    createSlider();
    return;
  }

  // console.log('updateAds: ', json);
  if (newAdsOnly) {
    gAds = gAds.concat(ads);
    for (let i = 0; i < ads.length; i++) {
      let ad = ads[i];
      const key = getHash(ad);
      if (!key) continue;

      for (let j = 0; j < gAdSets.length; j++) {
        if (gAdSets[j].gid === key) {
          gAdSets[j].children.append(ad);
          ad = null
        }
      }

      ad != null && gAdSets.push(new AdSet(ad));
    }
    // clear waitingAds
    waitingAds = []
  } else {
    // replace all gAds
    gAds = ads; // store
    gAdSets = null; // reset
  }

  createSlider("update");
  waitingAds = [];
}

const updateAd = function (json) {
  doUpdate(json.ad);
  computeStats(gAdSets);
}

const setAttempting = function (ad) {
  if (!ad) return;

  const groupInfo = findAdById(ad.id);
  let $item;

  if (groupInfo) {

    $item = findItemDivByGid(groupInfo.group.gid);

    // update the class for ad being attempted
    $item && $item.addClass('attempting');
  }
};

function setCurrent(ad) {

  $('.item').removeClass('attempting just-visited just-failed');
  setAttempting(ad);
}

function doLayout(adsets, update) {

  adsets = adsets || [];
  //console.log('Vault.doLayout: ' + adsets.length + " ad-sets, total=" + numFound(adsets));
  vaultLoading = true;
  if (!update) $('.item').remove();

  createDivs(adsets, update);
  computeStats(adsets);
  analyze(gAds);
  enableLightbox();
  repack();
}

function parseAd(ad, data) {
  if (ad.contentType == "img") data.totalImg++;
  else if (ad.contentType == "text") data.totalText++;
  try {
    let network = ad.adNetwork ? ad.adNetwork : parseHostname(ad.targetUrl);
    // merge common ad system
    if (network.indexOf("adssettings.google") > -1) {
      //ignore adsettings
      return data;
    } else if (network.indexOf("doubleclick") > -1 || network.indexOf("google") > -1 || ad.pageUrl.indexOf("google.com/search") > -1 || network.indexOf("youtube") > -1) {
      // Merge double click, google ads, google search
      network = "google ads";
    } else if (network.indexOf("amazon") > -1) {
      network = "amazon ad system";
    } else if (network.indexOf("facebook") > -1) {
      network = "facebook";
    } else {
      // no ad network detected
      return data;
    }
    addToDict(network, data.adNetworks);
  }
  catch {
    // can't parse
  }
  try {
    const domain = parseDomain(ad.pageUrl);
    addToDict(domain, data.sites);
  }
  catch {
    // can't parse
  }
  return data;
}

function analyze(adsets) {
  displayStatistics(extractData(adsets));
}

function extractData(adsets) {
  let data = {
    totalImg: 0,
    totalText: 0,
    sites: {},
    adNetworks: {},
  };

  for (let i = 0, j = adsets && adsets.length; i < j; i++) {
    //gAds
    if (!adsets[i].children) {
      const ad = adsets[i];
      data = parseAd(ad, data);
    } else {
      //adsets
      console.log(i + ') multiple');
      for (const key in adsets[i].children) {
        const ad = adsets[i].children[key];
        data = parseAd(ad, data);
      }
    }
  }
  data.sites = sortDict(data.sites);
  data.adNetworks = sortDict(data.adNetworks);
  data.total = data.totalImg + data.totalText;

  //console.log(data);
  return data;
}

function displayStatistics(data) {
  // clear old data
  $('#myStatistics ul').html("");
  $('#myStatistics #desc').text("");

  if (data.total < gAds.length) {
    // partial stats
    $('#myStatistics #desc').text("Statistics for " + data.total + "/" + gAds.length + " total ads");
  }

  // Top Ad Network

  for (var i = 0; i < data.adNetworks.length; i++) {
    const $li = $('<li/>', {
      class: 'entry',
    }).appendTo('#topAdnetworks');
    const site = data.adNetworks[i][0].replace(/^www\./g, '');
    const $siteName = $('<span/>', {
      class: 'label',
      text: site
    }).appendTo($li);
    const $number = $('<span/>', {
      class: 'number',
      text: data.adNetworks[i][1]
    }).appendTo($li);
  }

  // Top Site
  for (var i = 0; i < data.sites.length; i++) {
    const $li = $('<li/>', {
      class: 'entry',
    }).appendTo('#topSites');
    const site = data.sites[i][0].replace(/^www\./g, '');
    const $link = $('<a/>', {
      href: "http://" + data.sites[i][0],
      target: "_blank"
    }).appendTo($li);
    const $siteName = $('<span/>', {
      class: 'label',
      text: site
    }).appendTo($link);
    const $number = $('<span/>', {
      class: 'number',
      text: data.sites[i][1]
    }).appendTo($li);
  }

  //Ad Type
  const $imgAd = $('<li/>', {
    class: 'entry',
  }).appendTo('#adTypes');
  const $label = $('<span/>', {
    class: 'label',
    text: i18n$('adTypesImageAds')
  }).appendTo($imgAd);
  const $number = $('<span/>', {
    class: 'number',
    text: data.totalImg
  }).appendTo($imgAd);

  const $textAd = $('<li/>', {
    class: 'entry',
  }).appendTo('#adTypes');
  const $label2 = $('<span/>', {
    class: 'label',
    text: i18n$('adTypesTextAds')
  }).appendTo($textAd);
  const $number2 = $('<span/>', {
    class: 'number',
    text: data.totalText
  }).appendTo($textAd);

  $('.myStatistics-panel').show(300);
  $('#myStatistics').addClass("show");
  $('#myStatistics').removeClass("min");

}

function sortDict(dict) {
  var items = Object.keys(dict).map(function (key) {
    return [key, dict[key]];
  });

  // Sort the array based on the second element
  items.sort(function (first, second) {
    return second[1] - first[1];
  });

  return items.slice(0, 3)
}

function addToDict(key, dict) {
  if (key == undefined) return;
  if (key in dict) dict[key]++;
  else dict[key] = 1
}

function createDivs(adsets, update) {

  function hoverOnDiv(e) { // on

    const $this = $(this);

    if ($this.hasClass('inspected')) {

      // pause animation on mouse-over image
      const inspectedGid = parseInt($this.attr('data-gid'));
      selectedAdSet = findAdSetByGid(inspectedGid); // throws
      bulletIndex($this, selectedAdSet);
      animateInspector(false);
    }

    e.stopPropagation();
  }

  function hoverOffDiv(e) { // off

    if ($(this).hasClass('inspected')) {

      animateInspector($(this));
    }
  }

  function addAd(ad) {
    const $div = $('<div/>', {

      'class': 'item dup-count-' + ad.count(),
      'data-gid': ad.gid

    }).appendTo('#container');

    layoutAd($div, ad);

    $div.hover(hoverOnDiv, hoverOffDiv);
  }

  // // Hide #container while appending new divs from 0
  if (!update) $container.css('opacity', '0');

  for (let i = 0; i < adsets.length; i++) {

    if (update) {
      if ($('div[data-gid=' + adsets[i].gid + ']').length < 1) addAd(adsets[i]);
    } else {
      addAd(adsets[i])
    }

  }
}

function layoutAd($div, adset) {
  // append the display
  if (adset.child(0).private && adset.child(0).adNetwork) {
    if ($('.privateAds').length == 0) {
      appendPrivatePlaceHolder($div, adset);
    } else {
      // TODO: private ads count
      //$('.privateAds #index-counter').text(parseInt($('.privateAds .counter').text()) + 1);
    }
    return;
  }
  (adset.child(0).contentType === 'text' ?
    appendTextDisplayTo : appendDisplayTo)($div, adset);

  setItemClass($div, adset.groupState());
}

function doUpdate(updated) {
  const groupInfo = findAdById(updated.id);
  let adset;
  let itemClass;
  let $item;

  for (let i = 0, j = gAds && gAds.length; i < j; i++)
    if (gAds[i].id === updated.id) gAds[i] = updated;

  if (groupInfo) {

    adset = groupInfo.group;
    $item = findItemDivByGid(groupInfo.group.gid);

    // update the adgroup
    adset.index = groupInfo.index;
    adset.children[adset.index] = updated;
  }

  if (!$item) {

    //console.log("Item not currently visible", $item);
    return;
  }

  $('.item').removeClass('attempting just-visited just-failed');

  // update the ad data
  updateMetaTarget($item.find('.target[data-idx=' + adset.index + ']'), updated);

  // update the class
  $item.addClass(updated.visitedTs > 0 ? 'just-visited' : 'just-failed');

  setItemClass($item, adset.groupState());

  (adset.count() > 1) && bulletIndex($item, adset);
}

function setItemClass($item, state) {

  States.map(function (d) {
    $item.removeClass(d);
  }); // remove-all

  $item.addClass(state);
}

function appendMetaTo($div, adset) {

  //log('appendMetaTo:' + adset.gid);
  const $meta = $('<div/>', {
    class: 'meta'
  }).appendTo($div);

  const $ul = $('<ul/>', {

    class: 'meta-list',
    style: 'margin-top: 0px'

  }).appendTo($meta);

  for (let i = 0; i < adset.count(); i++) {

    const ad = adset.child(i);

    const $li = $('<li/>', {

      'class': 'meta-item',
      'style': 'margin-top: 0px'

    }).appendTo($ul);

    const $target = $('<div/>', {

      class: 'target',
      'data-idx': i

    }).appendTo($li);

    if (!ad.adNetwork) appendTargetTo($target, ad, adset); // tmp, remove adset

    const $detected = $('<div/>', {
      class: 'detected-on'
    }).appendTo($li);

    appendDetectedTo($detected, ad);
  }
}

function appendDetectedTo($detected, ad) {

  $('<h3/>', {
    text: i18n$('adnFoundOn') + ":"
  }).appendTo($detected);

  $('<a/>', {
    class: 'inspected-title',
    href: ad.pageUrl,
    text: decodeEntities(ad.pageTitle),
    target: '_blank'

  }).appendTo($detected);

  $('<cite/>', {
    text: ad.pageUrl
  }).appendTo($detected);

  $('<span/>', {

    class: 'inspected-date',
    text: formatDate(ad.foundTs)

  }).appendTo($detected);
}

function appendTargetTo($target, ad, adset) {

  $('<h3/>', {
    text: i18n$('adnTarget') + ":"
  }).appendTo($target);

  //log("Creating target #"+ad.id+" title="+ad.title);
  $('<a/>', {

    id: 'target-title',
    class: 'inspected-title',
    href: ad.targetUrl,
    text: decodeEntities(ad.title),
    target: '_blank'

  }).appendTo($target);

  $('<cite/>', {

    id: 'target-domain',
    class: 'target-cite',
    text: targetDomain(ad)

  }).appendTo($target);

  $('<span/>', {

    id: 'target-date',
    class: 'inspected-date',
    html: formatTargetDate(ad)

  }).appendTo($target);
}

function updateMetaTarget($target, ad) {

  $target.find('#target-domain').text(targetDomain(ad));
  $target.find('#target-date').text(formatDate(ad.visitedTs));
  const $titleA = $target.find('#target-title').text(ad.title);
  if (ad.resolvedTargetUrl)
    $titleA.attr('href', ad.resolvedTargetUrl);
}

/**
 * Resets current bullet class to [active, ad.state]
 * Shifts meta list to show correct item
 * Updates index-counter for the bullet
 */
function bulletIndex($div, adset) {
  // adset.index must be updated first

  const $bullet = $div.find('.bullet[data-idx=' + (adset.index) + ']');

  const state = adset.state();
  let $ul;

  if (!state) console.warn('[WARN] undefined state (dont we need an arg here?)');

  //log('bulletIndex: c["+adset.index+"]="+adset.child().id+"-> "+ adset.state());

  // set the state for the bullet
  setItemClass($bullet, state);

  // set the active class for bullet
  $bullet.addClass('active')
    .siblings().removeClass('active');

  // shift the meta-list to show correct info
  $ul = $div.find('.meta-list');
  $ul.css('margin-top', (adset.index * -110) + 'px');

  // update the counter bubble
  $div.find('#index-counter').text(indexCounterText(adset));

  if ($div.hasClass('inspected')) {

    // (temporarily) add the state-class to the div
    setItemClass($div, state);
  }
}

var loadImageTimeout;

function appendDisplayTo($div, adset) {

  var type = adset.type();
  var domain = adset.domain();
  var pageTitle = adset.pageTitle();
  var pageUrl = adset.pageUrl();
  var targetHostname = adset.targetHostname();
  var failedCount = adset.failedCount();
  var dntCount = adset.dntCount();
  var visitedCount = adset.visitedCount();
  var deadCount = adset.deadCount();
  var foundTs = adset.foundTs();
  var w = adset.width();
  var h = adset.height();
  let img_src = adset.child(0).contentData.src;

  if (deadCount > 0 && hideDeadAds) {
    // still try to load the image in case it is not dead
    let img = new Image();
    img.src = img_src;
    img.onload = function () {
      messager.send('adnauseam', {
        what: 'notDeadAd',
        ad: adset.children[0]
      });
    }
    // dont display add
    return;
  } 
  

  var hasSize = w && h;

  const max_size = 800;
  // Adjust dimensions to max size
  if (w > max_size) {
    const prop = max_size / w;
    w = max_size;
    h = h * prop;
  } else if (h > max_size) {
    const prop = max_size / h;
    h = max_size;
    w = w * prop;
  }

  // set attributes
  $div.attr('data-width', w);
  $div.attr('data-height', h);
  $div.attr('data-domain', domain);
  $div.attr('data-pageTitle', pageTitle);
  $div.attr('data-pageUrl', pageUrl);
  $div.attr('data-targetHostname', targetHostname);
  $div.attr('data-foundTs', foundTs);

  $div.width(w);
  $div.height(h);

  const $ad = $('<div/>', {
    class: 'ad'
  }).appendTo($div);

  $('<span/>', {

    class: 'counter',
    text: adset.count()

  }).appendTo($ad);

  $('<span/>', {

    id: 'index-counter',
    class: 'counter counter-index',
    text: indexCounterText(adset)

  }).appendTo($ad).hide();

  // add white background to transparent ads that are saved data strings 
  // https://github.com/dhowe/AdNauseam/issues/1978
  var isPNGdata = img_src.includes('data:image/png');
  var cl = isPNGdata ? "white-bg" : "";
  const $img = $('<img/>', {
    src: img_src,
    class: cl,
    width: w,
    height: h
  }).appendTo($ad);

  $img.width(w);
  $img.height(h);

  let isLoaded = false;

  $img.on("error", function () {
    isLoaded = true;
    setItemClass($div, 'image-error');
    $img.attr('src', 'img/placeholder.svg');
    $img.attr('alt', 'Unable to load image');
    $img.attr('data-error', 'error');
    $img.off("error");
    $div.addClass('loaded');
    // tell the addon
    messager.send('adnauseam', {
      what: 'deadAd',
      ad: adset.children[0]
    });
  });

  $img.on('load', function () {
    isLoaded = true;
    $div.addClass('loaded');
  });
}

function appendPrivatePlaceHolder($pdiv, adset) {

  const total = adset.count(), ad = adset.child(0);

  $pdiv.addClass('item-text');

  const $div = $('<div/>', {

    class: 'item-text-div privateAds',
    width: rand(TEXT_MINW, TEXT_MAXW)

  }).appendTo($pdiv);

  $('<span/>', {

    class: 'counter',
    text: total

  }).appendTo($div);

  $('<span/>', {

    id: 'index-counter',
    class: 'counter counter-index',
    text: indexCounterText(adset)

  }).appendTo($div).hide();

  const $h3 = $('<h3/>', {}).appendTo($div);

  $('<div/>', { // title

    class: 'title',
    text: 'Private Ads',
    target: '_blank'

  }).appendTo($h3);

  $('<div/>', { // text

    class: 'ads-creative',
    text: "Ads collected in private/incognito mode."

  }).appendTo($div);

  // cache the dimensions of the text-item
  $pdiv.attr('data-width', $div.width());
  $pdiv.attr('data-height', $div.height());

  // text/private items have no <img> load event, so reveal them here
  // (otherwise they stay at opacity:0/scale(0,0) from the base .item rule)
  $pdiv.addClass('loaded');
}

function appendTextDisplayTo($pdiv, adset) {

  const total = adset.count(), ad = adset.child(0);

  $pdiv.addClass('item-text');

  const $div = $('<div/>', {

    class: 'item-text-div',
    width: rand(TEXT_MINW, TEXT_MAXW)

  }).appendTo($pdiv);

  $('<span/>', {

    class: 'counter',
    text: total

  }).appendTo($div);

  $('<span/>', {

    id: 'index-counter',
    class: 'counter counter-index',
    text: indexCounterText(adset)

  }).appendTo($div).hide();

  const $h3 = $('<h3/>', {}).appendTo($div);

  $('<div/>', { // title

    class: 'title',
    text: ad.title,
    target: '_blank'

  }).appendTo($h3);

  $('<cite/>', {
    text: ad.contentData.site
  }).appendTo($div); // site

  $('<div/>', { // text

    class: 'ads-creative',
    text: ad.contentData.text

  }).appendTo($div);

  // cache the dimensions of the text-item
  $pdiv.attr('data-width', $div.width());
  $pdiv.attr('data-height', $div.height());

  // text/private items have no <img> load event, so reveal them here
  // (otherwise they stay at opacity:0/scale(0,0) from the base .item rule)
  $pdiv.addClass('loaded');
}

function indexCounterText(adset) {

  return (adset.index + 1) + '/' + adset.count();
}

function appendBulletsTo($div, adset) {

  //log('appendBulletsTo: ' + adset.gid);

  function hoverOnLi(e) { // on

    e.stopPropagation();

    adset.index = parseInt($(this).attr('data-idx'));
    bulletIndex($div, adset);

    animateInspector(false);
  }

  function hoverOffLi(e) { // off

    animateInspector($div);
  }

  const count = adset.count();

  if (count > 1) {

    const $bullets = $('<div/>', {
      class: 'bullets'
    }).appendTo($div);

    // find the height of the image for bullet layout (#291)
    const adHeight = $div.attr('data-height');

    //log($div.find('img').height(), '?=', adHeight);

    const $ul = $('<ul/>', {
      height: adHeight
    }).appendTo($bullets);

    // add items based on count/state
    for (let i = 0; i < adset.count(); i++) {

      const $li = $('<li/>', {

        'data-idx': i,
        'class': 'bullet ' + adset.state(i)

      }).appendTo($ul);

      $li.hover(hoverOnLi, hoverOffLi);
    }
  }

  appendMetaTo($div, adset)
}

function computeStats(adsets) {
  const numVisits = numVisited(gAds);

  $('.since').text(i18n$("adnVaultSince").replace('{{datetime}}', sinceTime(adsets)));
  $('.clicked').text(i18n$("adnMenuAdsClicked").replace('{{number}}', numVisits));
  $('.total').text(i18n$("adnVaultFound").replace('{{total}}', numTotal()));
  $('#detected').text(numFound(adsets));

  if (numTotal() != numFound(adsets)) {
    $('.showing').show();
  }
  else {
    $('.showing').hide();
  }
  setCost(numVisits);
}

function numVisited(adsets) {
  let numv = 0;
  for (let i = 0, j = adsets && adsets.length; i < j; i++) {
    numv += (adsets[i].visitedTs > 0);
  }
  return numv;
}

function numFound(adsets) {
  let numv = 0;
  for (let i = 0, j = adsets && adsets.length; i < j; i++) {
    numv += (adsets[i].count());
  }
  return numv;
}

function numTotal() {
  return gAds.length;
}

function sinceTime(adsets) {
  let oldest = +new Date();
  for (let i = 0, j = adsets && adsets.length; i < j; i++) {
    let foundTs;
    if (!adsets[i].children) {
      foundTs = adsets[i].foundTs;
    } else {
      foundTs = adsets[i].child(0).foundTs;
    }
    if (foundTs < oldest) {
      oldest = foundTs;
    }
  }
  return formatDate(oldest);
}

function untilTime(adsets) {
  let youngest = 0;
  for (let i = 0, j = adsets && adsets.length; i < j; i++) {
    let foundTs;
    if (!adsets[i].children) {
      foundTs = adsets[i].foundTs;
    } else {
      foundTs = adsets[i].child(0).foundTs;
    }
    if (foundTs > youngest) {
      youngest = foundTs;
    }
  }
  return formatDate(youngest);
}

function formatTargetDate(ad) {
  const dntNote = i18n$('adnAllowedByDNT') + "<a class='help-mark dnt' href='https://github.com/dhowe/AdNauseam/wiki/FAQ#what-is-the-effs-do-not-track-standard-and-how-it-is-supported-in-adnauseam'> ? </a>", frequencyNote = i18n$('adnAdClickingStatusSkippedFrequency'), userNote = i18n$('adnAdClickingStatusSkippedUser');

  const domainNote = i18n$('adnAdClickingStatusSkippedDomain');
  return ad.noVisit ? (ad.clickedByUser ? userNote : (ad.dntAllowed ? dntNote : (ad.domainExcluded ? domainNote : frequencyNote))) : formatDate(ad.visitedTs);
}

function formatDate(ts) {
  if (!ts) return settings.clickingDisabled ?
    i18n$('adnAdClickingStatusSkippedDisabled')
    : i18n$('adnNotYetVisited');

  function getLocale() {
    return navigator.languages[0] || navigator.language;
  }

  const date = new Date(Math.abs(ts));
  const options = {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: 'numeric'
  };

  return typeof Intl === "object" ? new Intl.DateTimeFormat(getLocale(), options).format(date) : date;
}

function enableLightbox() {

  $('.item').click(function (e) {

    // disable interaction click when the user clicks on the ad information
    if ($(e.target).parents('.meta-item').length > 0) {
      return
    }

    if (!draggingVault) {
      e.stopPropagation();
      lightboxMode($(this));
    } else {
      draggingVault = false;
    }


  });

  if (EnableContextMenu) {

    $('.item').bind("contextmenu", function (e) {

      const $this = $(this);

      if (!$this.hasClass('inspected')) {

        // show normal ff-context menu in inspector for now
        e.stopPropagation();
        e.preventDefault();

        const inspectedGid = parseInt($this.attr('data-gid'));
        selectedAdSet = findAdSetByGid(inspectedGid); // throws

        // show custom contextmenu
        $(".custom-menu").finish().toggle(100).

          // in correct position (according to mouse)
          css({
            top: (e.pageY - 25) + "px",
            left: e.pageX + "px"
          });
      }
    });
  }
}

function computeZoom(items) {
  // autozoom

  setZoom(zoomIdx = Zooms.indexOf(100), true);

  let i = 0;
  const percentVis = 0.55;
  const winW = $(window).width();
  const winH = $('#svgcon').offset().top;

  while (i < items.length) {

    const $this = $(items[i++]), scale = Zooms[zoomIdx] / 100;

    if (!onscreen($this, winW, winH, scale, percentVis)) {

      // console.log("Too-large @ " + Zooms[zoomIdx] + "%", percentVis);
      setZoom(++zoomIdx, true);

      if (zoomIdx === Zooms.length - 1)
        break; // at smallest size, done

      i = 0;

      continue; // else try next smaller
    }
  }

  // OK at current size, done
}

// Starts a CSS transition on the container and cleans up after it completes
function beginTransition(durationMs) {
  if (transitionTimeout !== null) {
    clearTimeout(transitionTimeout);
  }
  $container.addClass("posTransition");
  transitionTimeout = setTimeout(() => {
    $container.removeClass("posTransition");
    // Clean up translate(0,0) from FLIP animations so setScale works cleanly
    const currentScale = userZoomScale / 100;
    $container.css({ transform: 'scale(' + currentScale + ')' });
    transitionTimeout = null;
  }, durationMs || 600);
}

// Smoothly animate the container from current position/scale to a target using FLIP:
// 1. Instantly set target margins (no visual change yet thanks to translate offset)
// 2. Animate transform from translate(offset)+scale(old) → translate(0)+scale(new)
function animateContainerTo(ml_target, mt_target, scaleTarget) {
  const ml_current = parseFloat(container_div.style.marginLeft) || -10000;
  const mt_current = parseFloat(container_div.style.marginTop) || -10000;
  const scaleCurrent = userZoomScale / 100;

  // FLIP step 1: set target margins instantly
  $container.addClass('notransition');
  $container.css({
    "margin-left": ml_target + "px",
    "margin-top": mt_target + "px"
  });
  // Compensate with translate so visually nothing changes yet
  const tx = ml_current - ml_target;
  const ty = mt_current - mt_target;
  $container.css({
    transform: 'translate(' + tx + 'px,' + ty + 'px) scale(' + scaleCurrent + ')'
  });
  $container[0].offsetHeight; // force reflow to lock the "before" frame
  $container.removeClass('notransition');

  // FLIP step 2: animate to final transform (translate 0, target scale)
  beginTransition(600);
  $container.css({
    transform: 'translate(0px,0px) scale(' + scaleTarget + ')'
  });
}

function centerZoom($ele) {

  if ($ele) {

    const metaOffset = 110;
    const elWidth = parseInt($ele.attr('data-width'));
    const elHeight = parseInt($ele.attr('data-height'));
    const element_div = $ele[0];

    // Save current view state before changing
    storeViewState(true);

    // Compute scale to fit the ad in the viewport
    const posX = element_div.offsetLeft + elWidth / 2;
    const posY = element_div.offsetTop + (elHeight + metaOffset) / 2;

    let rescale = Math.min(window.innerHeight / elHeight, window.innerWidth / elWidth);
    rescale = Math.min(rescale, 1) * 0.8;

    // Target margins that center the ad
    const ml_target = -10000 - (posX - 10000) * rescale;
    const mt_target = -10000 - (posY - 10000) * rescale;

    // Smoothly animate from current position/scale to target
    animateContainerTo(ml_target, mt_target, rescale);

    userZoomScale = rescale * 100;
    $ratio.text(Math.round(userZoomScale) + '%');

  } else { // restore zoom-state
    storeViewState(false);
  }
}

// stores zoom/drag-offset for container, or restores it
function storeViewState(saving) {

  if (saving) {
    viewState.zoomScale = userZoomScale;
    viewState.left = parseFloat(container_div.style.marginLeft) || -10000;
    viewState.top = parseFloat(container_div.style.marginTop) || -10000;
  } else {
    // Smoothly animate back to saved position/scale
    const s_target = viewState.zoomScale / 100;
    animateContainerTo(viewState.left, viewState.top, s_target);
    userZoomScale = viewState.zoomScale;
    $ratio.text(Math.round(userZoomScale) + '%');
  }
}

function logAdSetInfo() {
  if (selectedAdSet) {
    console.log("Logging JSON for AdSet #" + selectedAdSet.gid);
    messager.send('adnauseam', {
      what: 'logAdSet',
      gid: selectedAdSet.gid,
      ids: selectedAdSet.childIds()
    }).then(data => {
      location.href = "data:text/plain," + encodeURI(data);
    });
  }
}

const ifs = ['#logo', '#ratio', '#stats', '#svgcon', '#x-close-button', '.zoom', '#bottom-text'];

function toggleInterface() {

  showInterface = !showInterface;
  if (!showInterface) {

    $("body")
      .css('background-image', 'none')
      .css({ 'background-color': '#fff'})
      .css({ 'pointer-events': 'none'});

    ifs.forEach(s => $(s).hide());

    // remove all duplicate classes (TODO: just hide them)
    $(".item").removeClass(function (i, css) {
      return (css.match(/dup-count-/g) || []).join(' ');
    }).addClass('dup-count-1');

  } else {
    $("body")
      .css('background-image', 'url(../img/gray_grid.png)')
      .css({ 'background-color': '#000' })
      .css({ 'pointer-events': 'all'});
    ifs.forEach(s => $(s).show());
  }
}

function lightboxMode($selected) {

  if ($selected && !$selected.hasClass('inspected')) {

    if ($container.hasClass("posTransition")) {
      return;
    }

    const inspectedGid = parseInt($selected.attr('data-gid'));
    selectedAdSet = findAdSetByGid(inspectedGid); // throws

    // lazy-create the meta data for the adset (#61)
    if (!$selected.children('div.meta').length) {
      appendBulletsTo($selected, selectedAdSet);
    }

    $selected.addClass('inspected').siblings().removeClass('inspected');

    if (selectedAdSet.count() > 1) {

      $selected.find('span.counter-index').show(); // show index-counter
      bulletIndex($selected, selectedAdSet);
      animateInspector($selected);
    }

    const next = selectedAdSet.nextPending(); // tell the addon

    if (next) {
      messager.send('adnauseam', {
        what: 'itemInspected',
        id: next.id
      });
    }

    centerZoom($selected);
    $container.addClass('lightbox');

  } else if ($container.hasClass('lightbox')) {

    const $item = $('.item.inspected');

    // reset the class to the group class
    setItemClass($item, selectedAdSet.groupState());

    // remove inspected & re-hide index-counter
    $item.removeClass('inspected');
    $item.find('span.counter-index').hide();

    selectedAdSet = null;

    // stop animation and restore view
    animateInspector(false);
    centerZoom(false);

    $container.removeClass('lightbox');
  }
}

function animateInspector($inspected) {

  animatorId && clearTimeout(animatorId); // stop

  // animate if we have a dup-ad being inspected
  if ($inspected && selectedAdSet && selectedAdSet.count() > 1) {

    animatorId = setInterval(function () {

      //log("selectedAdSet.count():" +selectedAdSet.index, $inspected.length);

      if (++selectedAdSet.index === selectedAdSet.count())
        selectedAdSet.index = 0;

      bulletIndex($inspected, selectedAdSet);

    }, animateMs);
  }
}

function findAdById(id) {
  if (gAdSets === undefined || gAdSets === null) return

  for (let i = 0, j = gAdSets.length; i < j; i++) {
    const childIdx = gAdSets[i].childIdxForId(id);
    if (childIdx > -1) {
      return {
        ad: gAdSets[i].child(childIdx),
        group: gAdSets[i],
        index: childIdx
      };
    }
  }

  //console.error('[ERROR] Vault: No ad for ID#' + id + " gAdSets: ", gAdSets);
}

function findItemDivByGid(gid) {
  let $item;
  const items = $('.item');
  for (let i = 0; i < items.length; i++) {

    $item = $(items[i]);
    if (parseInt($item.attr('data-gid')) === gid)
      return $item;
  }

  return null; // item may not be available if filtered
}

function findAdSetByGid(gid) {

  for (let i = 0, j = gAdSets.length; i < j; i++) {
    if (gAdSets[i].gid === gid) {
      return gAdSets[i];
    }
  }

  throw Error('No group for gid: ' + gid);
}

function zoomIn(immediate) {

  // calculate the suitable zoomIdx by userZoomScale
  const previousState = zoomIdx;
  for (let i = 0; zoomIdx === previousState && i < Zooms.length; i++) {
    if (userZoomScale === Zooms[i]) {
      zoomIdx = i;
    }
    else if (userZoomScale < Zooms[i] && userZoomScale > Zooms[i + 1]) {
      zoomIdx = i + 1;
    }
  }

  if (zoomIdx > 0) setZoom(--zoomIdx, immediate);
}

function zoomOut(immediate) {

  // calculate the suitable zoomIdx by userZoomScale
  const previousState = zoomIdx;
  for (let i = 0; zoomIdx === previousState && i < Zooms.length - 1; i++) {
    if (userZoomScale === Zooms[i]) {
      zoomIdx = i;
    }
    else if (userZoomScale < Zooms[i] && userZoomScale > Zooms[i + 1]) {
      zoomIdx = i;
    }
  }

  if (zoomIdx < Zooms.length - 1) setZoom(++zoomIdx, immediate);
}

// focus: optional screen point {x, y} to zoom around (default: stage center)
function setScale(scale, targetPos, focus) {
  const s = scale / 100;
  $container.css({ transform: 'scale(' + s + ')' });
  $ratio.text(Math.round(scale) + '%');

  let marginLeft, marginTop;

  if (targetPos) {
    marginLeft = targetPos.marginLeft;
    marginTop = targetPos.marginTop;
  } else {
    const center = -10000;
    const ml = parseFloat(container_div.style.marginLeft) || center;
    const mt = parseFloat(container_div.style.marginTop) || center;
    const prevZoom = $container.data("zoom") || 100;
    const zoomProp = scale / prevZoom;

    $container.data("zoom", scale);

    let offsetLeft = (center - ml) * (1 - zoomProp);
    let offsetTop = (center - mt) * (1 - zoomProp);

    if (focus) {
      // keep the point under the focus fixed: scaling is around the container's center
      const r = container_div.getBoundingClientRect();
      offsetLeft = (focus.x - (r.left + r.width / 2)) * (1 - zoomProp);
      offsetTop = (focus.y - (r.top + r.height / 2)) * (1 - zoomProp);
    }

    marginLeft = (ml + offsetLeft) + "px";
    marginTop = (mt + offsetTop) + "px";
  }

  $container.css({ "margin-left": marginLeft, "margin-top": marginTop });
}

function dynamicZoom(scaleInterval, targetPos, focus) {

  userZoomScale += scaleInterval;
  if (userZoomScale > Zooms[0])
    userZoomScale = Zooms[0];
  else if (userZoomScale < Zooms[Zooms.length - 1])
    userZoomScale = Zooms[Zooms.length - 1];

  setScale(userZoomScale, targetPos, focus);

  // set zoom-text to 2 decimal places
  $ratio.text(Math.round(userZoomScale * 100) / 100 + '%');
}

function setZoom(idx, immediate, targetPos) {

  // Disable transitions
  immediate && $container.addClass('notransition');

  setScale(Zooms[idx], targetPos); // set CSS scale for zooming

  userZoomScale = Zooms[idx]; // update userZoomScale

  $ratio.text(Zooms[idx] + '%'); // set zoom-text

  // Trigger reflow, flush cached CSS
  $container[0].offsetHeight;

  // Re-enable transitions
  immediate && $container.removeClass('notransition');
}

function onscreen($this, winW, winH, scale, percentVisible) {

  const off = $this.offset();
  const w = $this.width() * scale;
  const h = $this.height() * scale;
  const minX = (-w * (1 - percentVisible));
  const minY = (-h * (1 - percentVisible));
  const maxX = (winW - (w * percentVisible));
  const maxY = (winH - (h * percentVisible));
  return !(off.left < minX || off.left > maxX || off.top < minY || off.top > maxY);
}

function openInNewTab(url) {
  window.open(url, '_blank').focus();
}

function addInterfaceHandlers(ads) {

  $('#x-close-button').click(function (e) {
    e.preventDefault();
    messager.send('adnauseam', {
      what: 'closeExtPage',
      page: 'vault.html'
    });
  });

  $('#myStatistics .myStatistics-label').click(function (e) {
    $('.myStatistics-panel').toggle(300);
    $('#myStatistics').toggleClass("show");
    $('#myStatistics').toggleClass("min");
  });

  $('#logo').click(function (e) {
    e.preventDefault();
    openInNewTab('http://adnauseam.io');
  });

  $(document).click(function (e) {
    if (e.which === 1) // Left-button only
      if ($(e.target).parents('.meta-item').length > 0) {
        return
      }
    lightboxMode(false);
  });

  $(document).keyup(function (e) {
    (e.keyCode === 27) && lightboxMode(false); // esc
    (e.keyCode === 73) && toggleInterface(); // 'i'
    (e.keyCode === 68) && logAdSetInfo(); // 'd'
    (e.keyCode === 80) && repack(); // 'p'
    (e.keyCode === 85) && updateVault(waitingAds, true); // 'u'
  });

  /////////// DRAG-STAGE ///////////
  let offsetX = 0, offsetY = 0;
  container_div.addEventListener('mousedown', mouseDown, false);
  container_div.addEventListener('touchstart', touchStart, false);
  window.addEventListener('touchend', touchEnd, false);
  window.addEventListener('mouseup', mouseUp, false);

  function mouseUp() {
    window.removeEventListener('mousemove', divMove, true);
  }

  function touchEnd() {
    window.removeEventListener('touchmove', divMove, true);
  }

  function mouseDown(e) {
    // check if interface is in lightbox
    if ($container.hasClass('lightbox')) return
    // add move event
    window.addEventListener('mousemove', divMove, true);
    offsetX = e.pageX;
    offsetY = e.pageY;
  }

  function touchStart(e) {
    // check if interface is in lightbox
    if ($container.hasClass('lightbox')) return
    // add move event
    window.addEventListener('touchmove', divMove, true);
    offsetX = e.pageX;
    offsetY = e.pageY;
  }

  function mouseOnAd(mouseX, mouseY) {
    const ads = $(".ad");
    for (let i = 0; i < ads.length; i++) {
      const itemTop = ads[i].getBoundingClientRect().top;
      const itemRight = ads[i].getBoundingClientRect().left + ads[i].getBoundingClientRect().width;
      const itemBottom = ads[i].getBoundingClientRect().top + ads[i].getBoundingClientRect().height;
      const itemLeft = ads[i].getBoundingClientRect().left;
      if (mouseX > itemLeft && mouseX < itemRight && mouseY > itemTop && mouseY < itemBottom) return true;
    }
    return false;
  }


  const divMove = function (evt) {
    var e = evt.targetTouches ? evt.targetTouches[0] : evt
    draggingVault = false;
    if (mouseOnAd(e.pageX, e.pageY)) {
      draggingVault = true;
    }

    const x_change = e.pageX - offsetX;
    const y_change = e.pageY - offsetY;

    let ml = parseInt(container_div.style.getPropertyValue("margin-left"));
    let mt = parseInt(container_div.style.getPropertyValue("margin-top"));

    container_div.style.marginLeft = (ml += x_change) + 'px';
    container_div.style.marginTop = (mt += y_change) + 'px';

    offsetX = e.pageX;
    offsetY = e.pageY;
  }

  /////////// ZOOM-STAGE ///////////

  $('#z-in').click(function (e) {

    e.preventDefault();
    zoomIn();
  });

  $('#z-out').click(function (e) {

    e.preventDefault();
    zoomOut();
  });

  $(window).resize(function () {

    adjustHeight();
    if ($container.hasClass('lightbox')) {
      centerZoom($('.inspected'));
      return;
    }

    clearTimeout(resizeId); // only when done
    resizeId = setTimeout(function () {
      createSlider("resize");
    }, 100);

  });

  if (EnableContextMenu) {

    // if the document is clicked somewhere
    $(document).bind("mousedown", function (e) {

      // if the clicked element is not the delete-menu
      if ($(e.target).parents(".custom-menu").length < 1) {

        $(".custom-menu").hide(50);
      }
    });

    // if a context-menu element is right-clicked
    $(".custom-menu li").click(function () {

      if (!selectedAdSet) {

        error("No selectedAdSet!");
        return;
      }

      switch ($(this).attr("data-action")) {

        case "delete":

          const ids = selectedAdSet.childIds(), $item = findItemDivByGid(selectedAdSet.gid);

          // remove the adset item from the DOM
          $item.remove();

          // remove each ad from the full-adset
          gAds = gAds.filter(function (ad) {
            for (let i = 0, len = ids.length; i < len; i++) {
              if (ad.id === ids[i])
                return false;
            }
            return true;
          });

          // remove the adSet
          arrayRemove(gAdSets, selectedAdSet);

          // tell the addon
          messager.send('adnauseam', {
            what: 'deleteAdSet',
            ids: selectedAdSet.childIds()
          });

          createSlider("delete");

          break;
      }

      selectedAdSet = null;

      $(".custom-menu").hide(100); // close context-menu
    });
  }

  $("body").mousewheel(function (e) {

    if ($container.hasClass('lightbox')) {

      lightboxMode(false);
      return;
    }

    // rawDeltaY denotes how fast the mousewheel got scrolled
    const rawDeltaY = e.deltaY * e.deltaFactor;
    const scale = (Math.abs(rawDeltaY) >= 100) ? rawDeltaY / 100 : rawDeltaY / 10;

    // zoom around the mouse position
    dynamicZoom(scale, undefined, { x: e.clientX, y: e.clientY });
  });
}

/********************************************************************/

// Here is where we group individual ads into AdSets, based on their hash,
// created from the domain it was found on, and its content-data
// If we get too many cross-domain duplicate images, we may need to revisit
// Note: called just once per layout
function createAdSets(ads) {
  //console.log('Vault-Slider.createAdSets: ' + ads.length + '/' + gAds.length + ' ads');
  let key, ad;
  const hash = {};
  const adsets = [];

  // set hidden val for each ad
  for (let i = 0; i < ads.length; i++) {
    ad = ads[i];
    key = getHash(ad);
    if (!key) continue;
    if (!hash[key]) {
      // new: add a hash entry
      hash[key] = new AdSet(ad);
      adsets.push(hash[key]);
    } else {
      // dup: add as child
      hash[key].add(ad);
    }
  }

  // sort adset children by foundTs
  for (let i = 0; i < adsets.length; i++) {
    adsets[i].children.sort(byField('-foundTs'));
  }

  return adsets;
}

function repack() {
  $container.css('opacity', '0');
  document.querySelector('#loading-img').style = '';
  const $items = $(".item");
  const visible = $items.length;
  // it seems that the packing needs to happen on a separate thread so that the css 
  // changes can be applied before the packery is initiated, therefore the setTimeout
  setTimeout(function () {
    showVaultAlert(visible ? false : 'no ads found');
    if (visible > 1) {
      pack = new Packery('#container', {
        centered: {
          y: 10000
        }, // centered at half min-height
        itemSelector: '.item',
        gutter: 1
      })
      computeZoom($items);

    } else if (visible === 1) {
      $items.css({ // center single
        top: (10000 - $items.height() / 2) + 'px',
        left: (10000 - $items.width() / 2) + 'px'
      });
    }
    $('#loading-img').hide();
    // Show #container after repack
    $container.css('opacity', '1');
    vaultLoading = false;

  }, 1000);
}

/********************************************************************/

function createSlider(mode) {
  //console.log('Vault-Slider.createSlider: ' + gAds.length);
  // three special modes:
  // all three special modes: remember brush

  let lastBrush = null;

  if (mode != undefined && !d3.select('.brush').empty()) {
    const sel = d3.brushSelection(d3.select('.brush').node());
    if (sel) {
      lastBrush = {};
      lastBrush.w = sel[0];
      lastBrush.e = sel[1];
      lastBrush.width = d3.select('.chart-bg').attr("width");
    }
  }

  // clear all the old svg
  d3.select("g.parent").selectAll("*").remove();
  d3.select("svg").remove();

  if (!gAds || !gAds.length) {
    computeStats();
    showVaultAlert('no ads found');
    $('#loading-img').hide();
    return;
  }

  // setting up the position of the chart
  const iconW = 100;
  let width;
  try {
    width = parseInt(d3.select("#stage").style("width")) -
      (margin.left + margin.right + iconW);
  } catch (e) {
    throw Error("[D3] NO STAGE (page-not-ready?)");
  }

  // finding the first and last ad
  const minDate = d3.min(gAds, function (d) {
    return d.foundTs;
  });

  const maxDate = d3.max(gAds, function (d) {
    return d.foundTs;
  });

  // mapping the scales
  const xScale = d3.scaleTime()
    .domain([minDate, maxDate])
    .range([0, width]);

  // create an array of dates
  const map = gAds.map(function (d) {
    return parseInt(xScale(d.foundTs));
  });

  // setup the histogram layout (400 equal bins, as d3 v3 did)
  const histogram = d3.bin()
    .domain([0, width])
    .thresholds(d3.range(1, 400).map(i => i * width / 400))(map);

  // pick the first format whose test passes (was d3.time.format.multi in v3)
  const multiFormat = function (formats) {
    formats = formats.map(f => [d3.timeFormat(f[0]), f[1]]);
    return function (d) {
      return formats.find(f => f[1](d))[0](d);
    };
  };

  // setup the x axis
  const xAxis = d3.axisBottom(xScale)
    .tickFormat(multiFormat([
      [".%L", function (d) {
        return d.getMilliseconds();
      }],
      [":%S", function (d) {
        return d.getSeconds();
      }],
      ["%I:%M", function (d) {
        return d.getMinutes();
      }],
      ["%I %p", function (d) {
        return d.getHours();
      }],
      ["%a %d", function (d) {
        return d.getDay() && d.getDate() != 1;
      }],
      ["%b %d", function (d) {
        return d.getDate() != 1;
      }],
      ["%B", function (d) {
        return d.getMonth();
      }],
      ["%Y", function () {
        return true;
      }]
    ])).ticks(7);

  // position the SVG
  const svg = d3.select("#svgcon")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", /*height +*/ margin.top + margin.bottom)
    .append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  // append the x axis
  svg.append("g") // [ONCE]
    .attr("class", "x axis")
    .call(xAxis);

  svg.append("rect") // [ONCE]
    .attr("class", "chart-bg")
    .attr("height", 50)
    .attr("width", width)
    .attr("y", -50)
    .attr("fill", "#000")
    .attr("fill-opacity", ".5");

  const barw = histogram[0].x1 - histogram[0].x0 - 1; //relative width

  // Create groups for the bars
  const bars = svg.selectAll(".bar")
    .data(histogram)
    .enter()
    .append("g");

  // Y scale
  const yScale = d3.scaleLinear()
    .domain([0, d3.max(histogram, function (d) { return d.length; })])
    .range([-2, -46]);

  bars.append("line")
    .attr("x1", function (d) {
      return d.x0 + barw / 2;
    })
    .attr("y1", -2)
    .attr("x2", function (d) {
      return d.x0 + barw / 2;
    })
    .attr("y2", function (d) {
      return yScale(d.length);
    })
    .attr("style", "stroke-width:" + barw + "; stroke-dasharray: 1,0.5; stroke: #999");

  // setup the brush
  // the brush covers the height of the chart
  const bExtent = [computeMinDateFor(gAds, minDate), maxDate],
    brush = d3.brushX()
      .extent([[0, -50], [width, -1]])
      .on("brush", moveHandles)
      .on("end", brushend);

  const gBrush = svg.append("g")
    .attr("class", "brush")
    .call(brush);

  // clicking the background does not start a new selection (as in v3)
  gBrush.select(".overlay")
    .attr("pointer-events", "none");

  gBrush.select(".selection")
    .attr("fill", "#0076FF")
    .attr("fill-opacity", ".25")
    .attr("stroke", null);

  // attach handle images (dragging is done by the brush's own handles)
  const handleImgs = gBrush.selectAll(".handle-img")
    .data(["w", "e"])
    .enter().append("image")
    .attr("class", "handle-img")
    .attr("href", "../img/timeline-handle.svg")
    .attr("width", 5)
    .attr("height", 50)
    .attr("y", -50)
    .attr("pointer-events", "none");

  // position the slider: last position, or the default extent
  let bSel = bExtent.map(xScale);
  if (lastBrush && mode != undefined) {
    // map all values if resize
    const r = mode == "resize" ? d3.select('.chart-bg').attr("width") / lastBrush.width : 1;
    bSel = [lastBrush.w * r, lastBrush.e * r];
  }
  // an empty selection would hide the sliders, so use the full width
  if (bSel[1] - bSel[0] < 1) bSel = [0, width];
  gBrush.call(brush.move, bSel);

  // cases:
  // 1) [default] reload vault: doLayout, update slider - runFilter()
  // 2) "update": updateLayout, same slider
  // 3) "delete": skipLayout, same slider
  // 4) "resize": repack, remap slider

  // do filter, then call either doLayout or computeStats

  switch (mode) {
    case "delete":
      computeStats(gAdSets);
      analyze(gAdSets);
      vaultLoading = false;
      break;
    case "resize":
      // repack();
      runFilter([gMin, gMax])
      break;
    case "update":
      const ext = [gMin, new Date()];
      doLayout(runFilter(ext), true)
      break;
    default:
      doLayout(runFilter(bExtent));
      analyze(gAds);
  }
  // ---------------------------- functions ------------------------------

  // this is called on brushend() and createSlider()
  function runFilter(ext) {

    centerContainer();
    gMin = ext[0], gMax = ext[1];

    [gSliderRight, gSliderLeft] = d3.brushSelection(gBrush.node());

    if (gAds.length >= MaxStartNum) {
      uDom("a[class=showing-help]").text("?")
      uDom("a[class=showing-help]").addClass("help-mark")
    }

    const filtered = dateFilter(gMin, gMax);

    return gAdSets && gAds.length < MaxStartNum ? filterAdSets(filtered) :
      (gAdSets = createAdSets(filtered));
  }

  function centerContainer() {
    $container.addClass('notransition')
      .css({
        marginLeft: '-10000px',
        marginTop: '-10000px'
      })
      .removeClass('notransition');
  }

  function filterAdSets(ads) {

    //console.log('Vault-slider.filterAdSets: ' + ads.length + '/' + gAds.length + ' ads');

    const sets = [];
    for (let i = 0, j = ads.length; i < j; i++) {
      for (let k = 0, l = gAdSets.length; k < l; k++) {

        if (gAdSets[k].childIdxForId(ads[i].id) > -1) {

          if (sets.indexOf(gAdSets[k]) < 0)
            sets.push(gAdSets[k]);
        }
      }
    }
    return sets;
  }

  function computeMinDateFor(ads, min) {

    if (ads && ads.length) {

      ads.sort(byField('-foundTs')); // or slice?
      const subset = ads.slice(0, MaxStartNum);
      return subset[subset.length - 1].foundTs;
    }
    return min;
  }

  function dateFilter(min, max) {

    const filtered = [];

    // NOTE: always need to start from full-set (all) here
    for (let i = 0, j = gAds.length; i < j; i++) {
      if (!(gAds[i].foundTs < min || gAds[i].foundTs > max)) {
        filtered.push(gAds[i]);
      }
    }

    return filtered;
  }

  function moveHandles(event) {
    if (!event.selection) return;
    handleImgs.attr("x", (d, i) => event.selection[i] - 3);
  }

  function brushend(event) {
    if (!event.sourceEvent) return; // programmatic brush.move

    // collapsed to nothing: put the sliders back where they were
    if (!event.selection) {
      gBrush.call(brush.move, [gSliderRight, gSliderLeft]);
      return;
    }

    const lastgSliderRight = gSliderRight;
    const lastgSliderLeft = gSliderLeft;
    [gSliderRight, gSliderLeft] = event.selection;

    if (lastgSliderRight === undefined || lastgSliderLeft === undefined) return;

    if (gSliderRight === lastgSliderRight && gSliderLeft === lastgSliderLeft) {
      return;
    } else {
      const filtered = runFilter(event.selection.map(xScale.invert));
      filtered && doLayout(filtered);
    }
  }
}

function parsePackElements(packElements, gMin, gMax) {
  const ads = packElements.filter(packEl => {
    let error = packEl.element.getAttribute('data-error');
    if (error) return false;
    let foundTs = packEl.element.getAttribute('data-foundTs');
    if (foundTs < gMin || foundTs > gMax) return false;
    return true;
  }).map(packEl => {
    let type = packEl.element.querySelector('img') ? 'image' : 'text';
    let pos = { x: packEl.position.x - 10000, y: packEl.position.y - 10000 };
    let height = packEl.rect.height;
    let width = packEl.rect.width;
    let foundTs = packEl.element.getAttribute('data-foundTs');
    let gid = packEl.element.getAttribute('data-gid');
    if (type == 'image') { // image
      let src = packEl.element.querySelector('img').src;
      return { src, pos, height, width, foundTs, gid, type }
    } else {
      let text = packEl.element.querySelector('.ads-creative').innerText;
      let title = packEl.element.querySelector('.title').innerText;
      let href = packEl.element.querySelector('cite');
      return { pos, height, width, foundTs, gid, text, title, href, type }
    }
  })
  return ads
}

function onCapture() { // save screenshot
  let dbug = true;
  if (dbug) console.log('onCapture');
  toggleInterface(showInterface = true);
  setTimeout(() => {
    const ads = parsePackElements(pack.items, gMin, gMax)
    if (dbug) console.log("parsedPackElements", ads)
    if (dbug) console.log('captureVisibleTab');
    browser.tabs.captureVisibleTab(null, {}, imgUrl => {
      if (dbug) console.log('callback');
      const saveImageToFile = (image, meta) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // create a meta data string and fname for the image
        let metaText = `Clicked ${meta.clicked} of ${meta.count} ads, from ${meta.minDate} to ${meta.maxDate}, costing $${meta.cost}.`;
        let metaName = `${meta.clicked}-${meta.count}-${meta.minTs}-${meta.maxTs}-${meta.cost}.png`;
        console.log('Saving image: ' + metaName);

        // write meta data to upper left corner
        ctx.fillStyle = 'black';
        ctx.fillText(metaText, 20, 20);

        // Convert canvas to data URL
        const dataURL = canvas.toDataURL();

        // Create a link element and trigger a download
        const anchor = document.createElement('a');
        anchor.href = dataURL;
        anchor.download = metaName;
        anchor.click();
      };

      // create a subset of visited ads where foundTs is within the range gMin to gMax
      let subset = gAds.filter(ad => ad.foundTs >= gMin && ad.foundTs <= gMax);

      //console.log('subset:', subset.length, gMin, gMax);

      let meta = extractData(subset);
      meta.count = subset.length;
      meta.clicked = numVisited(subset);
      meta.cost = (meta.clicked * 1.03).toFixed(2);
      meta.minDate = gMin ? gMin : sinceTime(subset);
      meta.maxDate = gMax ? gMax : untilTime(subset);
      meta.minTs = formatDate(meta.minDate);
      meta.maxTs = formatDate(meta.maxDate);
      if (dbug) console.log('meta:', meta);

      let capture = {
        ads: ads,
        meta: meta
      }

      generateCaptureSvg(capture, userZoomScale/100, $("#svg-loaded"), $("#svg-total")).then(svgUrl => {

        let exportData = JSON.stringify(capture, null, '  ')
        let filename = getExportFileName();
        const url = URL.createObjectURL(new Blob([exportData], { type: "text/plain" }));

        filename = "AdNauseam_Capture" + filename.substr(9, filename.length);

        // download svg
        vAPI.download({
          'url': svgUrl,
          'filename': filename.replace(/.json/g, ".svg")
        });

        // download json
        vAPI.download({
          'url': url,
          'filename': filename
        });

        $("#svg-progress").hide();

        const screenshot = new Image();
        screenshot.src = imgUrl;
        screenshot.onload = () => {
          saveImageToFile(screenshot, meta);
          setTimeout(() => {
            toggleInterface(showInterface = false);
          }, 5000);
        };
      });

    });
  }, 1000);
};

function onPurgeDeadAds() {
  let deadAds = getDeadAds()
  if (deadAds.length > 0) {
    purgeDeadAds(getDeadAds(), function (response) {
      renderAds(response, true)
    })
  } else {
    console.log("no dead ads to purge")
  }
}

function getDeadAds() {
  return gAdSets.filter(adset => adset.deadCount() > 0)
}

/********************************************************************/

const TEXT_MINW = 150,
  TEXT_MAXW = 450;

function AdSet(ad) {
  this.gid = Math.abs(createGid(ad));
  this.children = [];
  this.index = 0;
  this.add(ad);
}

AdSet.prototype.id = function (i) {
  return this.child(i).id;
};

AdSet.prototype.childIds = function () {
  const ids = [];
  for (let i = 0, j = this.children.length; i < j; i++) {
    this.children[i] && ids.push(this.children[i].id);
  }
  return ids;
};

AdSet.prototype.childIdxForId = function (id) {
  for (let i = 0, j = this.children.length; i < j; i++) {
    if (this.children[i].id === id) return i;
  }
  return -1;
};

AdSet.prototype.child = function (i) {
  return this.children[(typeof i === 'undefined') ? this.index : i];
};

AdSet.prototype.state = function (i) {
  const ad = this.child(i) || i;
  if (!ad) console.warn('invalid index!');
  if (ad.dntAllowed) return 'dnt-allowed';

  // ad should not be 'failed' until 3 failed visits (gh #64)
  if (ad.visitedTs === 0 || (ad.attempts < 3 && ad.visitedTs < 0)) {
    return 'pending';
  }
  return ad.visitedTs < 0 ? 'failed' : 'visited';
};

AdSet.prototype.type = function () {
  return this.children[0].contentType; // same-for-all
};

AdSet.prototype.domain = function () {
  return this.children[0].domain;
}

AdSet.prototype.pageTitle = function () {
  return this.children[0].pageTitle;
}

AdSet.prototype.pageUrl = function () {
  return this.children[0].pageUrl;
}

AdSet.prototype.targetHostname = function () {
  return this.children[0].targetHostname;
}

AdSet.prototype.failedCount = function () {
  const containerObj = this;
  return this.children.filter((d) => containerObj.state(d) === 'failed').length;
};

AdSet.prototype.deadCount = function () {
  const containerObj = this;
  return this.children[0]?.dead;
};

AdSet.prototype.dntCount = function () {
  const containerObj = this;
  return this.children.filter((d) => containerObj.state(d) === 'dnt-allowed').length;
};

AdSet.prototype.visitedCount = function () {
  return this.children.filter((d) => d.visitedTs > 0).length;
};

AdSet.prototype.nextPending = function () {
  const ads = this.children.slice();
  ads.sort(byField('-foundTs'));
  for (let i = 0, j = ads.length; i < j; i++) {
    if (ads[i].visitedTs === 0) // pending
      return ads[i];
  }
  return null;
};

AdSet.prototype.count = function () {
  return this.children.length;
};

AdSet.prototype.foundTs = function () {
  return this.children[0].foundTs;
}

AdSet.prototype.add = function (ad) {
  ad && this.children.push(ad);
};

AdSet.prototype.width = function () {
  return this.children[0].contentData.width;
};

AdSet.prototype.height = function () {
  return this.children[0].contentData.height;
};

function createGid(ad) {
  let hash = 0;
  const key = getHash(ad);

  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + code;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

const adjustHeight = function () {
  let notificationsHeight = $("#notifications#capture").hasClass("hide") ? 0 : $("#notifications").height();
  $("#stage").css('height', String($(window).height() - notificationsHeight) + "px");
}

const startImportFilePicker = function () {
  const input = document.getElementById('importFilePicker');
  // Reset to empty string, this will ensure an change event is properly
  // triggered if the user pick a file, even if it is the same as the last
  // one picked.
  input.value = '';
  input.click();
};

// @cqx931 use the existing $(document).keyup function

/*
  * returns 'visited' if any are visited,
  *      'dnt-allowed' if all are dnt-allowed
  *      'failed' if all are failed or pending or dnt-allowed,
  *      'pending' if all are pending or dnt-allowed.
  *
  * what about dnt here ?
  */
AdSet.prototype.groupState = function () {

  const visited = this.visitedCount();

  if (visited) return 'visited';

  const dnts = this.dntCount();

  if (dnts === this.children.length) {
    return 'dnt-allowed';
  }

  const failed = this.failedCount();
  return failed ? 'failed' : 'pending';
};

vAPI.messaging.send(
  'adnauseam', {
  what: 'getHideDeadAds'
}).then(_hideDeadAds => {
  hideDeadAds = _hideDeadAds;
  messager.send('adnauseam', {
    what: 'adsForVault'
  }).then(details => {
    renderAds(details);
  })  
});

$('#export').on('click', exportToFile);
$('#import').on('click', startImportFilePicker);
$('#importFilePicker').on('change', handleImportAds);
$('#reset').on('click', clearAds);
$('#purge').on('click', onPurgeDeadAds);