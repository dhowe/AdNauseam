/*******************************************************************************

    AdNauseam Lite - a comprehensive, MV3-compliant content blocker
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

// Important!
// Isolate from global scope
(function uBOL_cssDeclarative() {

/******************************************************************************/

const declarativeImports = self.declarativeImports || [];
self.declarativeImports = undefined;

/******************************************************************************/

const selectors = [];
const exceptions = [];

const lookupHostname = (hostname, details, out) => {
    let seqi = details.hostnamesMap.get(hostname);
    if ( seqi === undefined ) { return; }
    const { argsList, argsSeqs } = details;
    for (;;) {
        const argi = argsSeqs[seqi++];
        const done = argi > 0;
        out.push(...argsList[done ? argi : -argi].split('\n'));
        if ( done ) { break; }
    }
};

const lookupAll = hostname => {
    for ( const details of declarativeImports ) {
        lookupHostname(hostname, details, selectors);
        lookupHostname(`~${hostname}`, details, exceptions);
    }
};

self.isolatedAPI.forEachHostname(lookupAll, {
    hasEntities: declarativeImports.some(a => a.hasEntities)
});

declarativeImports.length = 0;

const exceptedSelectors = exceptions.length !== 0
    ? selectors.filter(a => exceptions.includes(a) === false)
    : selectors;
if ( exceptedSelectors.length === 0 ) { return; }

/******************************************************************************/

const cssRuleFromProcedural = details => {
    const { tasks, action } = details;
    let mq, selector;
    if ( Array.isArray(tasks) ) {
        if ( tasks[0][0] !== 'matches-media' ) { return; }
        mq = tasks[0][1];
        if ( tasks.length > 2 ) { return; }
        if ( tasks.length === 2 ) {
            if ( tasks[1][0] !== 'spath' ) { return; }
            selector = tasks[1][1];
        }
    }
    let style;
    if ( Array.isArray(action) ) {
        if ( action[0] !== 'style' ) { return; }
        selector = selector || details.selector;
        style = action[1];
    }
    if ( mq === undefined && style === undefined && selector === undefined ) { return; }
    if ( mq === undefined ) {
        return `${selector}\n{${style}}`;
    }
    if ( style === undefined ) {
        return `@media ${mq} {\n${selector}\n{display:none!important;}\n}`;
    }
    return `@media ${mq} {\n${selector}\n{${style}}\n}`;
};

const sheetText = [];
for ( const selector of exceptedSelectors ) {
    const details = JSON.parse(selector);
    const ruleText = cssRuleFromProcedural(details);
    if ( ruleText === undefined ) { continue; }
    sheetText.push(ruleText);
}

if ( sheetText.length === 0 ) { return; }

chrome.runtime.sendMessage({
    what: 'insertCSS',
    css: sheetText.join('\n'),
}).catch(( ) => {
});

/******************************************************************************/

})();

void 0;
