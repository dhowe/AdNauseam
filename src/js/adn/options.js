/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2016 Daniel C. Howe

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

/* global vAPI, uDom */

(function () {

  'use strict';

  /******************************************************************************/

  var messager = vAPI.messaging;

  /******************************************************************************/

  var resetUserData = function() {
      var msg = vAPI.i18n('aboutResetDataConfirm').replace(/uBlock₀/g, 'AdNauseam');
      var proceed = vAPI.confirm(msg);
      if ( proceed ) {
          messager.send('dashboard', { what: 'resetUserData' });
      }
  };

  /******************************************************************************/

  var changeUserSettings = function (name, value) {
    //console.log('changeUserSettings',name, value);
    messager.send('dashboard', {
      what: 'userSettings',
      name: name,
      value: value
    });
  };

  /******************************************************************************/

  var onInputChanged = function (ev) {
    var input = ev.target;
    var name = this.getAttribute('data-setting-name');
    var value = input.value;
    if (name === 'largeMediaSize') {
      value = Math.min(Math.max(Math.floor(parseInt(value, 10) || 0), 0), 1000000);
    }
    if (value !== input.value) {
      input.value = value;
    }
    changeUserSettings(name, value);
  };

  /******************************************************************************/

  // TODO: use data-* to declare simple settings

  var onUserSettingsReceived = function (details) {

    uDom('[data-setting-type="bool"]').forEach(function (uNode) {

      uNode.prop('checked', details[uNode.attr('data-setting-name')] === true)
        .on('change', function () {
          changeUserSettings(
            this.getAttribute('data-setting-name'),
            this.checked
          );
        });
    });

    uDom('[data-setting-name="noLargeMedia"] ~ label:first-of-type > input[type="number"]')
      .attr('data-setting-name', 'largeMediaSize')
      .attr('data-setting-type', 'input');

    uDom('[data-setting-type="input"]').forEach(function (uNode) {
      uNode.val(details[uNode.attr('data-setting-name')])
        .on('change', onInputChanged);
    });


    //callback functions that are called in the next 4 lines are located in js/adn/shared.js
    uDom('#export').on('click', exportToFile);
    uDom('#import').on('click', startImportFilePicker);
    uDom('#importFilePicker').on('change', handleImportFilePicker);
    uDom('#reset').on('click', clearAds);


    uDom('#resetOptions').on('click', resetUserData);
    uDom('#confirm-close').on('click', function (e) {
      e.preventDefault();
      window.open(location, '_self').close();
    });
  };

  /******************************************************************************/

  uDom.onLoad(function () {

    messager.send('dashboard', {
      what: 'userSettings'
    }, onUserSettingsReceived);

    messager.send('dashboard', {
      what: 'getLocalData'
    }, onLocalDataReceived);

  });

  /******************************************************************************/

})();
