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

/* AdNauseam MV3 Log API */

'use strict';

let eventLogging = false; // "Debug mode" checkbox in the dashboard

// Load logging preference from storage (defensive: chrome may not be available
// in all contexts, e.g. content scripts loaded before APIs are ready)
try {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['adnSettings']).then(data => {
      if (data.adnSettings && typeof data.adnSettings.eventLogging === 'boolean') {
        eventLogging = data.adnSettings.eventLogging;
      }
    }).catch(() => {});

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.adnSettings && changes.adnSettings.newValue) {
        const newSettings = changes.adnSettings.newValue;
        if (typeof newSettings.eventLogging === 'boolean') {
          eventLogging = newSettings.eventLogging;
        }
      }
    });
  }
} catch (e) {
  // Silently ignore - logging defaults to disabled
}

export const isEventLogging = () => eventLogging;

export const log = function () {
  if (eventLogging) {
    console.log.apply(console, arguments);
  }
  return true;
};

export const warn = function () {
  if (eventLogging) {
    console.warn.apply(console, arguments);
  }
  return false;
};

export const err = function () {
  console.error.apply(console, arguments);
  return false;
};

export const logNetAllow = function () {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('[ALLOW]');
  logNetEvent.apply(this, args);
};

export const logNetBlock = function () {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('[BLOCK]');
  logNetEvent.apply(this, args);
};

export const logNetEvent = function () {
  if (eventLogging && arguments.length) {
    const args = Array.prototype.slice.call(arguments);
    const action = args.shift();
    args[0] = action + ' (' + args[0] + ')';
    log.apply(this, args);
  }
};
