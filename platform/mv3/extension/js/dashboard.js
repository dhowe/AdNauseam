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

import { dom } from './dom.js';
import { runtime } from './ext.js';

/******************************************************************************/

{
    const manifest = runtime.getManifest();
    dom.text('#aboutNameVer', `${manifest.name} ${manifest.version}`);
}

dom.attr('a', 'target', '_blank');

dom.on('#dashboard-nav', 'click', '.tabButton', ev => {
    dom.body.dataset.pane = ev.target.dataset.pane;
});

/******************************************************************************/

export function hashFromIterable(iter) {
    return Array.from(iter).sort().join('\n');
}

/******************************************************************************/
