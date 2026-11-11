/*******************************************************************************

    AdNauseam Lite - "Strict-Block List" pane of the dashboard

    Lists the websites on which AdNauseam is in strict mode, one hostname per
    line, as the "Strict-Block List" pane does in MV2. These are the hostnames
    the popup adds when "Strict" is picked for a site.

*******************************************************************************/

import { dom, qs$ } from '../dom.js';
import { hostnamesFromText } from './trusted-sites.js';
import punycode from '../punycode.js';
import { sendMessage } from '../ext.js';

/******************************************************************************/

const textarea = qs$('#strictSites');

// The hostnames as last read from the background, one per line
let cachedHostnames = '';

/******************************************************************************/

function hasChanged() {
    return hostnamesFromText(textarea.value).join('\n') !== cachedHostnames;
}

function onChanged() {
    const changed = hasChanged();
    qs$('#strictSitesApply').disabled = changed === false;
    qs$('#strictSitesRevert').disabled = changed === false;
}

/******************************************************************************/

function renderStrictSites(response) {
    cachedHostnames = response.hostnames.slice().sort().join('\n');
    revertChanges();
    qs$('#strictSitesError').textContent = response.error || '';
}

function revertChanges() {
    const hostnames = cachedHostnames !== '' ? cachedHostnames.split('\n') : [];
    textarea.value = hostnames.map(hn => `${punycode.toUnicode(hn)}\n`).join('');
    onChanged();
}

async function applyChanges() {
    const response = await sendMessage({
        what: 'setAdnStrictSites',
        hostnames: hostnamesFromText(textarea.value),
    });
    if ( response instanceof Object === false ) { return; }
    renderStrictSites(response);
}

// The popup may have changed the list since the last time it was read
async function refresh() {
    if ( hasChanged() ) { return; }
    const response = await sendMessage({ what: 'getAdnStrictSites' });
    if ( response instanceof Object === false ) { return; }
    if ( hasChanged() ) { return; }
    renderStrictSites(response);
}

/******************************************************************************/

dom.on(textarea, 'input', onChanged);
dom.on('#strictSitesApply', 'click', ( ) => { applyChanges(); });
dom.on('#strictSitesRevert', 'click', revertChanges);
dom.on('#dashboard-nav', 'click', '.tabButton[data-pane="strict"]', refresh);
dom.on(self, 'focus', refresh);

refresh();

/******************************************************************************/
