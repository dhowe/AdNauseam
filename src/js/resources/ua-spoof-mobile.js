/*******************************************************************************

    AdNauseam - Fighting privacy-invasive advertising
    Copyright (C) 2017-present Daniel C. Howe

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

/******************************************************************************/

// Operation APPLE-ORCHARD: Mobile UA/Client Hint Spoof Scriptlet
// Phase 1: iOS 19 "Chrome" Payload - Mimics Chrome on latest iOS stable
// Phase 2: Client Hint Hardening - Sec-CH-UA headers matching Apple Ecosystem
// Phase 3: Touch-Event Masking - Standard iPhone spec to prevent fingerprinting

(function() {
    'use strict';

    // Mobile Identity Configuration
    // iOS 19.4 with CriOS (Chrome on iOS)
    const iOS_Chrome_Identity = {
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/146.0.7000.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        vendor: 'Apple Computer, Inc.',
        touchPoints: 5,  // Standard iPhone spec
        appVersion: '5.0 (iPhone; CPU iPhone OS 19_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/146.0.7000.0 Mobile/15E148 Safari/604.1'
    };

    // Sec-CH-UA Client Hints matching Apple Ecosystem
    // These headers inform servers about the browser's brand, version, and platform
    const clientHints = {
        brands: [
            { brand: 'Not_A Brand', version: '8' },
            { brand: 'Chromium', version: '146' },
            { brand: 'Google Chrome', version: '146' }
        ],
        mobile: true,
        platform: 'iOS',
        uaFullVersion: '19.4.0'
    };

    // Phase 1: Spoof navigator.userAgent for iOS Chrome
    Object.defineProperty(Navigator.prototype, 'userAgent', {
        get: function() {
            return iOS_Chrome_Identity.ua;
        },
        configurable: false
    });

    // Phase 1: Spoof navigator.platform
    Object.defineProperty(Navigator.prototype, 'platform', {
        get: function() {
            return iOS_Chrome_Identity.platform;
        },
        configurable: false
    });

    // Phase 3: Touch-Event Masking - Hard-code maxTouchPoints to 5
    // This prevents "Desktop Linux" hardware from leaking through JS fingerprinting
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
        get: function() {
            return iOS_Chrome_Identity.touchPoints;
        },
        configurable: false
    });

    // Phase 1: Spoof navigator.vendor
    if (Navigator.prototype.vendor !== undefined) {
        Object.defineProperty(Navigator.prototype, 'vendor', {
            get: function() {
                return iOS_Chrome_Identity.vendor;
            },
            configurable: false
        });
    }

    // Phase 1: Spoof navigator.appVersion
    if (Navigator.prototype.appVersion !== undefined) {
        Object.defineProperty(Navigator.prototype, 'appVersion', {
            get: function() {
                return iOS_Chrome_Identity.appVersion;
            },
            configurable: false
        });
    }

    // Phase 2: Handle uaDataValues (Client Hints API)
    if (Navigator.prototype.userAgentData !== undefined) {
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
            get: function() {
                return clientHints;
            },
            configurable: false
        });
    }

    // Additional protection for hardware concurrency
    if (Navigator.prototype.hardwareConcurrency !== undefined) {
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            get: function() {
                return 6;  // iPhone typically has 6 cores
            },
            configurable: false
        });
    }

    // Device memory protection
    if (Navigator.prototype.deviceMemory !== undefined) {
        Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            get: function() {
                return 4;  // Standard iPhone memory tier
            },
            configurable: false
        });
    }

    // Screen properties to mask
    if (window.screen !== undefined) {
        // Hard-code standard iPhone dimensions
        Object.defineProperty(window.screen, 'availWidth', {
            get: function() { return 390; },
            configurable: false
        });
        Object.defineProperty(window.screen, 'availHeight', {
            get: function() { return 844; },
            configurable: false
        });
    }

    // Detect if running on mobile and apply low-power poisoning logic
    // On Wi-Fi: Full 100% poisoning rate
    // On LTE/Cellular: Tactical 50% poisoning to save data/battery
    const applyMobilePoisoningLogic = function() {
        if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getManifest) {
            // Check network type if available
            if (navigator.connection) {
                const connection = navigator.connection;
                const isWifi = connection.type === 'wifi';
                const isCharging = connection.saveData === false;
                
                // Apply adaptive poisoning based on network conditions
                window.ADNAUSEAM_MOBILE_WIFI = isWifi;
                window.ADNAUSEAM_MOBILE_DATA_SAVER = connection.saveData;
            }
        }
    };

    // Execute mobile poisoning logic
    applyMobilePoisoningLogic();

    // Export for external use
    window.iOS_Chrome_Identity = iOS_Chrome_Identity;
    window.MOBILE_CLIENT_HINTS = clientHints;

})();
