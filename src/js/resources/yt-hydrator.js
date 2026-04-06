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

// Base64 Deep-Scanner for Ad URL Detection
// Detect Base64-encoded ad URLs within JSON payloads and trigger
//          background tracking "clicks" before neutralizing the data

(function() {
    'use strict';

    // Known ad-tracking domains and keywords
    const AD_KEYWORDS = [
        'doubleclick',
        'googleadservices',
        'pagead',
        'ad_type',
        'talkspace',
        'base44',
        'adclick',
        'adservice',
        'googlesyndication',
        'moatads',
        'adroll',
        'criteo',
        'taboola',
        'outbrain',
        'revcontent',
        'mgid',
        'content.ad',
        'adcolony',
        'admob',
        'unity3d.ads',
        'mopub',
        'inmobi'
    ];

    // Base64 regex: matches strings that look like Base64 (length > 20, valid charset)
    const b64Regex = /^(?:[A-Za-z0-9+/]{4}){5,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

    /**
     * Check if a string looks like Base64-encoded ad payload
     * @param {string} str - The string to check
     * @returns {boolean} - True if it appears to be a Base64-encoded ad URL
     */
    function isAdPayload(str) {
        if (!b64Regex.test(str)) return false;
        if (str.length < 20) return false;
        
        try {
            const decoded = atob(str).toLowerCase();
            // Check if decoded string contains ad-related keywords
            return AD_KEYWORDS.some(keyword => decoded.includes(keyword)) ||
                   decoded.includes('http') && (
                       decoded.includes('ad') || 
                       decoded.includes('click') ||
                       decoded.includes('track') ||
                       decoded.includes('pixel')
                   );
        } catch (e) {
            return false;
        }
    }

    /**
     * Recursively scan and neutralize ad payloads in an object
     * @param {*} obj - The object to scan
     * @returns {boolean} - True if any ad payloads were found and neutralized
     */
    function recursiveScrub(obj) {
        let found = false;
        
        if (obj === null || obj === undefined) return found;
        
        if (typeof obj === 'object') {
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const value = obj[key];
                    
                    if (typeof value === 'string') {
                        // Check if this string is a Base64-encoded ad URL
                        if (isAdPayload(value)) {
                            try {
                                const decodedUrl = atob(value);
                                console.log('DarkSonic: Poisoning Ad Tracker ->', decodedUrl.substring(0, 80) + '...');
                                
                                // Trigger background click for data poisoning
                                // Use no-cors to avoid CORS errors while still sending the request
                                fetch(decodedUrl, { 
                                    mode: 'no-cors', 
                                    cache: 'no-cache',
                                    method: 'GET',
                                    keepalive: true
                                }).catch(() => {});
                                
                                // Neutralize the ad payload
                                obj[key] = '';
                                found = true;
                            } catch (e) {
                                // Failed to decode, just neutralize
                                obj[key] = '';
                                found = true;
                            }
                        }
                    } else if (typeof value === 'object' && value !== null) {
                        // Recurse into nested objects
                        if (recursiveScrub(value)) {
                            found = true;
                        }
                    } else if (Array.isArray(value)) {
                        // Handle arrays
                        for (let i = 0; i < value.length; i++) {
                            if (typeof value[i] === 'string' && isAdPayload(value[i])) {
                                try {
                                    const decodedUrl = atob(value[i]);
                                    console.log('DarkSonic: Poisoning Ad Tracker (array) ->', decodedUrl.substring(0, 80) + '...');
                                    fetch(decodedUrl, { 
                                        mode: 'no-cors', 
                                        cache: 'no-cache',
                                        method: 'GET',
                                        keepalive: true
                                    }).catch(() => {});
                                    value[i] = '';
                                    found = true;
                                } catch (e) {
                                    value[i] = '';
                                    found = true;
                                }
                            } else if (typeof value[i] === 'object' && value[i] !== null) {
                                if (recursiveScrub(value[i])) {
                                    found = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        return found;
    }

    /**
     * Intercept JSON.parse to scan for Base64-encoded ad URLs
     */
    const originalParse = JSON.parse;
    JSON.parse = function(text, reviver) {
        let data;
        
        if (reviver) {
            data = originalParse(text, reviver);
        } else {
            data = originalParse(text);
        }
        
        if (data) {
            // Scan the parsed data for ad payloads
            recursiveScrub(data);
            
            // Additional YouTube-specific ad placement clearing
            if (data.adPlacements) {
                data.adPlacements = [];
            }
            if (data.playerAds) {
                data.playerAds = [];
            }
            if (data.ads) {
                data.ads = [];
            }
            if (data.adModule) {
                data.adModule = null;
            }
            if (data.adServerTimeOffset) {
                data.adServerTimeOffset = 0;
            }
        }
        
        return data;
    };

    /**
     * Also intercept Response.json() for fetch API responses
     */
    if (typeof Response !== 'undefined') {
        const originalJson = Response.prototype.json;
        Response.prototype.json = function() {
            return originalJson.call(this).then(data => {
                if (data) {
                    recursiveScrub(data);
                    
                    // Clear YouTube ad arrays
                    if (data.adPlacements) data.adPlacements = [];
                    if (data.playerAds) data.playerAds = [];
                    if (data.ads) data.ads = [];
                }
                return data;
            });
        };
    }

    console.log('DarkSonic: Base64 Deep-Scanner initialized');

})();
