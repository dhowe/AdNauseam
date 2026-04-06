/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

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

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

// Operation GHOST-PROTOCOL: UA/Client Hint Spoof Scriptlet
// This prevents "Invisible Magic Tracking Pixels" from detecting the mismatch
// Phase 2: Mobile-specific detection - Edge Mobile for Android on mobile builds

(function() {
    'use strict';

    // Detect mobile build flag
    const isMobile = typeof window.ADNAUSEAM_MOBILE !== 'undefined' && window.ADNAUSEAM_MOBILE === true;

    // Mobile: Edge Mobile for Android (avoids broken "Desktop-only" layouts)
    // Desktop: Windows Edge Stable UA (April 2026)
    const spoofedUA = isMobile
        ? 'Mozilla/5.0 (Linux; Android 10; HD1913) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36 EdgA/146.0.3856.97'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.3856.97';
    
    // Mobile platform
    const spoofedPlatform = isMobile ? 'Android' : 'Win64';
    
    // Mobile appVersion
    const spoofedAppVersion = isMobile
        ? '5.0 (Linux; Android 10; HD1913) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36'
        : '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

    // Spoof navigator.userAgent
    Object.defineProperty(Navigator.prototype, 'userAgent', {
        get: function() {
            return spoofedUA;
        },
        configurable: false
    });

    // Also handle uaDataValues (Client Hints)
    if (Navigator.prototype.userAgentData !== undefined) {
        const originalUAData = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgentData');
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
            get: function() {
                return {
                    brands: isMobile
                        ? [
                            { brand: 'Not_A Brand', version: '8' },
                            { brand: 'Chromium', version: '146' },
                            { brand: 'Microsoft Edge', version: '146' },
                            { brand: 'Edge', version: '146' }
                        ]
                        : [
                            { brand: 'Not_A Brand', version: '8' },
                            { brand: 'Chromium', version: '146' },
                            { brand: 'Microsoft Edge', version: '146' }
                        ],
                    mobile: isMobile,
                    platform: isMobile ? 'Android' : 'Windows',
                    platformVersion: isMobile ? '10' : '10.0'
                };
            },
            configurable: false
        });
    }

    // Additional protection for specific properties
    if (window.navigator.appVersion !== undefined) {
        Object.defineProperty(Navigator.prototype, 'appVersion', {
            get: function() {
                return spoofedAppVersion;
            },
            configurable: false
        });
    }

    if (window.navigator.platform !== undefined) {
        Object.defineProperty(Navigator.prototype, 'platform', {
            get: function() {
                return spoofedPlatform;
            },
            configurable: false
        });
    }

    if (window.navigator.oscpu !== undefined) {
        Object.defineProperty(Navigator.prototype, 'oscpu', {
            get: function() {
                return isMobile ? 'Linux; Android 10; HD1913' : 'Windows NT 10.0; Win64';
            },
            configurable: false
        });
    }
    
    // Mobile-specific: touch points
    if (isMobile && Navigator.prototype.maxTouchPoints !== undefined) {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
            get: function() {
                return 5;  // Standard Android phone spec
            },
            configurable: false
        });
    }
})();
