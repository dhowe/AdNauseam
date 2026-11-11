/*******************************************************************************

    uBlock Origin - a browser extension to block requests.
    Copyright (C) 2014-2018 Raymond Hill

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

/* global CodeMirror, uBlockDashboard */

'use strict';

import { TrustedSiteParser } from '../trusted-sites.js';
import { i18n$ } from '../i18n.js';
import uDom from './uDom.js';

/******************************************************************************/

const reComment = /^\s*#\s*/;

const directiveFromLine = function(line) {
    const match = reComment.exec(line);
    return match === null
        ? line.trim()
        : line.slice(match.index + match[0].length).trim();
};

/******************************************************************************/

CodeMirror.defineMode("ubo-whitelist-directives", function() {
    const reRegex = /^\/.+\/$/;
    return {
        token: function(stream) {
            const line = stream.string.trim();
            stream.skipToEnd();
            if ( reComment.test(line) ) {
                return strictBlockListDefaultSet.has(directiveFromLine(line))
                    ? 'keyword comment'
                    : 'comment';
            }
            if ( line.indexOf('/') === -1 ) {
                if ( TrustedSiteParser.isBadHostname(line) ) { return 'error'; }
                if ( strictBlockListDefaultSet.has(line.trim()) ) {
                    return 'keyword';
                }
                return null;
            }
            if ( reRegex.test(line) ) {
                try {
                    new RegExp(line.slice(1, -1));
                } catch(ex) {
                    return 'error';
                }
                return null;
            }
            if ( TrustedSiteParser.parseDirective(line) === undefined ) {
                return 'error';
            }
            if ( strictBlockListDefaultSet.has(line.trim()) ) {
                return 'keyword';
            }
            return null;
        }
    };
});

let strictBlockListDefaultSet = new Set();

/******************************************************************************/

const messaging = vAPI.messaging;
const noopFunc = function(){};

let cachedStrictBlockList = '';

const cmEditor = new CodeMirror(
    document.getElementById('strictBlockList'),
    {
        autofocus: true,
        lineNumbers: true,
        lineWrapping: true,
        styleActiveLine: true,
    }
);

uBlockDashboard.patchCodeMirrorEditor(cmEditor);

/******************************************************************************/

const getEditorText = function() {
    let text = cmEditor.getValue().replace(/\s+$/, '');
    return text === '' ? text : text + '\n';
};

const setEditorText = function(text) {
    cmEditor.setValue(text.replace(/\s+$/, '') + '\n');
};

/******************************************************************************/

const strictBlockListChanged = function() {
    const strictBlockListElem = uDom.nodeFromId('strictBlockList');
    const bad = strictBlockListElem.querySelector('.cm-error') !== null;
    const changedStrictBlockList = getEditorText().trim();
    const changed = changedStrictBlockList !== cachedStrictBlockList;
    uDom.nodeFromId('strictBlockListApply').disabled = !changed || bad;
    uDom.nodeFromId('strictBlockListRevert').disabled = !changed;
    CodeMirror.commands.save = changed && !bad ? applyChanges : noopFunc;
};

cmEditor.on('changes', strictBlockListChanged);

/******************************************************************************/

const renderStrictBlockList = async function(first = false) {
    const details = await messaging.send('dashboard', {
        what: 'getStrictBlockList',
    });
    if ( first ) {
        strictBlockListDefaultSet = new Set(details.strictBlockListDefault);
    }
    const toAdd = new Set(strictBlockListDefaultSet);
    for ( const line of details.strictBlockList ) {
        const directive = directiveFromLine(line);
        if ( strictBlockListDefaultSet.has(directive) === false ) { continue; }
        toAdd.delete(directive);
        if ( toAdd.size === 0 ) { break; }
    }
    if ( toAdd.size !== 0 ) {
        details.strictBlockList.push(...Array.from(toAdd).map(a => `# ${a}`));
    }
    details.strictBlockList.sort((a, b) => {
        const ad = directiveFromLine(a);
        const bd = directiveFromLine(b);
        const abuiltin = strictBlockListDefaultSet.has(ad);
        if ( abuiltin !== strictBlockListDefaultSet.has(bd) ) {
            return abuiltin ? -1 : 1;
        }
        return ad.localeCompare(bd);
    });
    const strictBlockListStr = details.strictBlockList.join('\n').trim();
    cachedStrictBlockList = strictBlockListStr;
    setEditorText(strictBlockListStr);
    if ( first ) {
        cmEditor.clearHistory();
    }
};

/******************************************************************************/

const handleImportFilePicker = function() {
    const file = this.files[0];
    if ( file === undefined || file.name === '' ) { return; }
    if ( file.type.indexOf('text') !== 0 ) { return; }
    const fr = new FileReader();
    fr.onload = ev => {
        if ( ev.type !== 'load' ) { return; }
        setEditorText(
            [ getEditorText().trim(), fr.result.trim() ].join('\n').trim()
        );
    };
    fr.readAsText(file);
};

/******************************************************************************/

const startImportFilePicker = function() {
    const input = document.getElementById('importFilePicker');
    // Reset to empty string, this will ensure an change event is properly
    // triggered if the user pick a file, even if it is the same as the last
    // one picked.
    input.value = '';
    input.click();
};

/******************************************************************************/

const exportStrictBlockListToFile = function() {
    const val = getEditorText();
    if ( val === '' ) { return; }
    const filename =
        i18n$('strictBlockListExportFilename')
            .replace('{{datetime}}', uBlockDashboard.dateNowToSensibleString())
            .replace(/ +/g, '_');
    vAPI.download({
        'url': `data:text/plain;charset=utf-8,${encodeURIComponent(val + '\n')}`,
        'filename': filename
    });
};

/******************************************************************************/

const applyChanges = async function() {
    cachedStrictBlockList = getEditorText().trim();
    await messaging.send('dashboard', {
        what: 'setStrictBlockList',
        strictBlockList: cachedStrictBlockList,
    });
    renderStrictBlockList();
};

const revertChanges = function() {
    setEditorText(cachedStrictBlockList);
};

/******************************************************************************/

const getCloudData = function() {
    return getEditorText();
};

const setCloudData = function(data, append) {
    if ( typeof data !== 'string' ) { return; }
    if ( append ) {
        data = uBlockDashboard.mergeNewLines(getEditorText().trim(), data);
    }
    setEditorText(data.trim());
};

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.cloud.onPush = getCloudData;
self.cloud.onPull = setCloudData;

/******************************************************************************/

self.hasUnsavedData = function() {
    return getEditorText().trim() !== cachedStrictBlockList;
};

/******************************************************************************/

uDom('#importStrictBlockListFromFile').on('click', startImportFilePicker);
uDom('#importFilePicker').on('change', handleImportFilePicker);
uDom('#exportStrictBlockListToFile').on('click', exportStrictBlockListToFile);
uDom('#strictBlockListApply').on('click', ( ) => { applyChanges(); });
uDom('#strictBlockListRevert').on('click', revertChanges);

renderStrictBlockList(true);

/******************************************************************************/
