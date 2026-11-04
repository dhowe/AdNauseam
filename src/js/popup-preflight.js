/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2026 Moa Habtamu

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program. If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/dhowe/AdNauseam
*/

// Shared with the background whitelist implementation. Keep this factory
// serializable so the same directive semantics can be used before window.open.
export function createWhitelistMatcher() {
    const regexpCache = new Map();
    const matchDirective = (url, hostname, directive) => {
        if ( directive.indexOf('/') === -1 ) {
            return hostname.endsWith(directive) && (
                hostname.length === directive.length ||
                hostname.charAt(hostname.length - directive.length - 1) === '.'
            );
        }
        if ( directive.startsWith('/') === false && directive.indexOf('*') === -1 ) {
            return url === directive;
        }
        let re = regexpCache.get(directive);
        if ( re === undefined ) {
            const pattern = directive.startsWith('/') && directive.endsWith('/')
                ? directive.slice(1, -1)
                : directive.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
            re = new RegExp(pattern);
            regexpCache.set(directive, re);
        }
        return re.test(url);
    };
    const matchBucket = (url, hostname, bucket, start) => {
        if ( bucket ) {
            for ( let i = start || 0; i < bucket.length; i++ ) {
                if ( matchDirective(url, hostname, bucket[i]) ) { return i; }
            }
        }
        return -1;
    };
    const matches = (data, url, hostname) => {
        let key = hostname;
        for (;;) {
            if ( matchBucket(url, hostname, data.get(key)) !== -1 ) { return true; }
            const pos = key.indexOf('.');
            if ( pos === -1 ) { break; }
            key = key.slice(pos + 1);
        }
        return matchBucket(url, hostname, data.get('//')) !== -1;
    };
    return { regexpCache, matchBucket, matches };
}

// Stock behind-the-scene rules do not govern a page's popup.
export function canUsePopupPreflight(firewall, urlFiltering) {
    for ( const rules of [ firewall.rules, urlFiltering.rules ] ) {
        for ( const key of rules.keys() ) {
            if ( key.startsWith('behind-the-scene ') === false ) { return false; }
        }
    }
    return true;
}

// Serializable: injected through the existing scriptlet infrastructure.
export function installPopupPreflight(details, trustedSiteMatcher, trustedData) {
    if ( self.uBO_popupPreflight ) { return; }
    const trusted = new Map(trustedData);
    const docloc = document.location;
    let topURL;
    try {
        topURL = new URL(self.top.location.href);
    } catch {
        const origins = docloc.ancestorOrigins;
        if ( origins?.length === undefined || origins.length === 0 ) { return; }
        // An origin cannot establish whether a path-specific trust rule matches.
        for ( const directives of trusted.values() ) {
            if ( directives.some(s => s.includes('/')) ) { return; }
        }
        topURL = new URL(origins.item(origins.length-1));
    }
    if ( trustedSiteMatcher(trusted, topURL.href, topURL.hostname) ) { return; }
    if ( trustedSiteMatcher(trusted, docloc.href, docloc.hostname) ) { return; }

    const URLCtor = URL;
    const apply = Reflect.apply;
    let trustedLink = '';
    document.addEventListener('mousedown', ev => {
        if ( ev.isTrusted !== true ) { return; }
        const elem = ev.target?.closest?.('a[href]');
        if ( typeof elem?.href !== 'string' ) { return; }
        // Like the existing maybeGoodPopup heuristic, ignore scheme changes.
        trustedLink = elem.href.slice(elem.href.indexOf(':') + 1);
    }, true);
    const docHostname = details.hostname;
    const docDomain = details.domain || docHostname;
    const inDomain = (hn, domain) => hn === domain || hn.endsWith(`.${domain}`);
    const inDomains = (hn, domains) => domains.some(domain => inDomain(hn, domain));
    const partyMatches = (party, hn) => party === 0 ||
        (inDomain(hn, docDomain) ? party === 8 : party === 16);
    const blockingHosts = new Map();
    for ( const rule of details.block ) {
        const rules = blockingHosts.get(rule.hostname) ?? [];
        if ( rules.length === 0 ) { blockingHosts.set(rule.hostname, rules); }
        rules.push(rule);
    }
    const exceptions = details.allow.map(rule => ({
        ...rule,
        regexes: rule.patterns.map(s => new RegExp(s, 'i')),
    }));
    const excepted = url => exceptions.some(rule => {
        const hn = url.hostname;
        if ( partyMatches(rule.party, hn) === false ) { return false; }
        if ( rule.initiatorDomains && inDomains(docHostname, rule.initiatorDomains) === false ) { return false; }
        if ( rule.excludedInitiatorDomains && inDomains(docHostname, rule.excludedInitiatorDomains) ) { return false; }
        if ( rule.requestDomains && inDomains(hn, rule.requestDomains) === false ) { return false; }
        if ( rule.excludedRequestDomains && inDomains(hn, rule.excludedRequestDomains) ) { return false; }
        return rule.regexes.every(re => re.test(url.href));
    });
    const blocked = url => {
        if ( /^https?:$/.test(url.protocol) === false ) { return false; }
        if ( url.href.slice(url.protocol.length) === trustedLink ) { return false; }
        if ( trustedSiteMatcher(trusted, url.href, url.hostname) ) { return false; }
        let matched = false;
        let suffix = url.hostname;
        for (;;) {
            for ( const rule of blockingHosts.get(suffix) ?? [] ) {
                if ( partyMatches(rule.party, url.hostname) === false ) { continue; }
                if ( rule.important ) { return true; }
                matched = true;
            }
            const pos = suffix.indexOf('.');
            if ( pos === -1 ) { break; }
            suffix = suffix.slice(pos + 1);
        }
        return matched && excepted(url) === false;
    };
    const original = self.open;
    self.open = new Proxy(original, {
        apply(target, thisArg, originalArgs) {
            const args = originalArgs.slice();
            const rawURL = args[0] === undefined ? '' : `${args[0]}`;
            const windowName = args[1] === undefined ? '_blank' : `${args[1]}`;
            // A named target can refer to an existing window. Only preflight
            // calls which unambiguously request a new browsing context.
            if ( rawURL !== '' && (windowName === '' || /^_blank$/i.test(windowName)) ) {
                let url;
                try { url = new URLCtor(rawURL, document.baseURI); } catch {
                }
                if ( url && blocked(url) ) { return null; }
            }
            if ( args.length > 0 ) { args[0] = rawURL; }
            if ( args.length > 1 ) { args[1] = windowName; }
            return apply(target, thisArg, args);
        },
    });
    self.uBO_popupPreflight = true;
}
