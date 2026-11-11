/*******************************************************************************

    AdNauseam Lite - "Trusted sites" pane of the dashboard

    Lists the websites on which AdNauseam is disabled, one hostname per line,
    as the "Trusted sites" pane does in MV2. These are the hostnames of the
    no-filtering mode (`none` in the filtering mode details), the ones the
    popup adds when "Disable" is picked for a site.

*******************************************************************************/

import { dom, qs$ } from '../dom.js';
import punycode from '../punycode.js';
import { sendMessage } from '../ext.js';

/******************************************************************************/

const textarea = qs$('#trustedSites');

// The hostnames as last read from the background, one per line
let cachedHostnames = '';

/******************************************************************************/

// Only hostnames are supported: a pasted URL is reduced to its hostname.
// 'all-urls' is the default filtering mode, it is never listed nor editable.

export function hostnamesFromText(text) {
    const hostnames = new Set();
    for ( const line of text.split(/\s+/) ) {
        if ( line === '' ) { continue; }
        let hostname = '';
        try {
            const url = new URL(`https://${line.replace(/^[a-z-]+:\/\//i, '')}/`);
            hostname = punycode.toASCII(url.hostname);
        } catch {
        }
        if ( hostname === '' || hostname === 'all-urls' ) { continue; }
        hostnames.add(hostname);
    }
    return Array.from(hostnames).sort();
}

function hasChanged() {
    return hostnamesFromText(textarea.value).join('\n') !== cachedHostnames;
}

function onChanged() {
    const changed = hasChanged();
    qs$('#trustedSitesApply').disabled = changed === false;
    qs$('#trustedSitesRevert').disabled = changed === false;
}

/******************************************************************************/

function renderTrustedSites(modes) {
    const hostnames = modes.none.filter(hn => hn !== 'all-urls').sort();
    cachedHostnames = hostnames.join('\n');
    revertChanges();
}

function revertChanges() {
    const hostnames = cachedHostnames !== '' ? cachedHostnames.split('\n') : [];
    textarea.value = hostnames.map(hn => `${punycode.toUnicode(hn)}\n`).join('');
    onChanged();
}

async function applyChanges() {
    // Only the no-filtering hostnames are replaced, the rest is left as is
    const modes = await sendMessage({ what: 'getFilteringModeDetails' });
    if ( modes instanceof Object === false ) { return; }
    const hostnames = hostnamesFromText(textarea.value);
    if ( modes.none.includes('all-urls') ) {
        hostnames.push('all-urls');
    }
    modes.none = hostnames;
    renderTrustedSites(
        await sendMessage({ what: 'setFilteringModeDetails', modes })
    );
}

// The popup may have changed the list since the last time it was read
async function refresh() {
    if ( hasChanged() ) { return; }
    const modes = await sendMessage({ what: 'getFilteringModeDetails' });
    if ( modes instanceof Object === false ) { return; }
    if ( hasChanged() ) { return; }
    renderTrustedSites(modes);
}

/******************************************************************************/

dom.on(textarea, 'input', onChanged);
dom.on('#trustedSitesApply', 'click', ( ) => { applyChanges(); });
dom.on('#trustedSitesRevert', 'click', revertChanges);
dom.on('#dashboard-nav', 'click', '.tabButton[data-pane="trusted"]', refresh);
dom.on(self, 'focus', refresh);

refresh();

/******************************************************************************/
