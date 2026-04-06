/*******************************************************************************

    AdNauseam - Fight back against advertising surveillance.
    Copyright (C) 2014-2024 Daniel C. Howe

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

// Adnauseam Notification functions

import { isFirefox, openPage } from "./adn-utils.js";
import uDom from "./uDom.js";

/***************************************************************************/

// local namespaces
const WARNING = "warning",
	ERROR = "error",
	INFO = "info",
	SUCCESS = "success",
	DNT = "dnt",
	FAQ = "https://github.com/dhowe/AdNauseam/wiki/FAQ",
	DNTFAQ =
		"https://github.com/dhowe/AdNauseam/wiki/FAQ#what-is-the-effs-do-not-track-standard-and-how-it-is-supported-in-adnauseam";

const Notification = function (m) {
	function opt(opts, name, def) {
		return opts && opts.hasOwnProperty(name) ? opts[name] : def;
	}

	this.prop = opt(m, "prop", "");
	this.name = opt(m, "name", "");
	this.text = opt(m, "text", "");

	this.isDNT = opt(m, "isDNT", "");

	this.link = opt(m, "link", this.isDNT ? DNTFAQ : FAQ);

	this.listName = opt(m, "listName", "");
	this.expected = opt(m, "expected", true);
	this.firstrun = opt(m, "firstrun", false);

	this.type = opt(m, "type", this.isDNT ? DNT : WARNING);
	this.button = opt(m, "button", this.isDNT ? "adnMenuSettings" : "adnNotificationReactivate");

	// default function to be called on click
	this.func = opt(m, "func", (this.isDNT ? openSettings : reactivateSetting).bind(this));
};

const modifyDNTNotifications = function () {
	const text = document.querySelectorAll('div[id^="DNT"] #notify-text');
	const link = uDom('div[id^="DNT"] #notify-link').nodes;
	const newlink = uDom("span>#notify-link").nodes;

	if (text.length > 0 && link.length > 0 && newlink.length === 0) {
		const sections =
			text[0].innerText.includes(",") > 0 ? text[0].innerText.split(",") : text[0].innerText.split("，");
		text[0].innerHTML = sections[0] + link[0].outerHTML + "," + sections[1];
		uDom('div[id^="DNT"]>#notify-link').css("display", "none");
	}
};

const appendNotifyDiv = function (notify, template) {
	const node = template.clone(false);
	const text_node = node.descendants("#notify-text");

	node.addClass(notify.type);
	node.attr("id", notify.name);
	const text = document.querySelectorAll("span[data-i18n=" + notify.text + "]");
	text.length > 0 && text_node.text(text[0].innerHTML);

	const button = document.querySelectorAll("span[data-i18n=" + notify.button + "]");
	if (button && button[0]) {
		node.descendants("#notify-button").text(button[0].innerHTML).removeClass("hidden");
	} else {
		node.descendants("#notify-button").addClass("hidden");
	}

	node.descendants("#notify-link").attr("href", notify.link);

	/*
	 * Slide text on hover, addressing texts not fitting in the menu
	 * https://github.com/dhowe/AdNauseam/issues/2026
	 */

	// timeout variables to be able to clearTimeout() later
	notify.add_timeout = null;
	notify.remove_timeout = null;

	// these variables we catch after hover, since some are not yet rendered
	var text_width = null;
	var width_diff = null;
	var button_width = null;

	// constant values
	const reading_width = 251;
	const remove_time = 2500;
	const add_time = 500;
	const ad_list_height = 360;

	// mouseover event to create slide animation
	uDom(node.nodes[0]).on("mouseover", "#notify-text", function (e) {
		// set width value of text
		if (text_width == null && width_diff == null) {
			text_width = text_node.nodes[0].scrollWidth;
		}
		// add indent timeout
		if (notify.add_timeout == null) {
			notify.add_timeout = setTimeout(function () {
				// get button width to check what width need to slide
				button_width = node.descendants("#notify-button").nodes[0].clientWidth;
				width_diff = reading_width - button_width - text_width;
				node.addClass("hover");
				// only apply if needed
				if (width_diff < 0) {
					text_node.css("text-indent", `${width_diff}px`);
				}
				// clear add class timeout
				clearTimeout(notify.add_timeout);
				notify.add_timeout = null;

				// clear remove indent timeout if any
				if (notify.remove_timeout !== null) {
					clearTimeout(notify.remove_timeout);
					notify.remove_timeout = null;
				}
				// create a fresh "remove" timeout
				notify.remove_timeout = setTimeout(function () {
					node.removeClass("hover");
					text_node.css("text-indent", `0px`);
					clearTimeout(notify.remove_timeout);
					notify.remove_timeout = null;
				}, remove_time);
			}, add_time);
		}
	});
	// end of text sliding code

	// add click handler to reactivate button (a better way to do this??)
	uDom(node.nodes[0]).on("click", "#notify-button", function (e) {
		notify.func.apply(this); // calls reactivateSetting or reactivateList
	});
	uDom("#notifications").append(node);

	const h = document.getElementById("notifications").offsetHeight;
	const newh = ad_list_height - h;
	uDom("#ad-list").css("height", newh + "px");
};

const openExtPage = function () {
	openPage(isFirefox() ? "about:addons" : "chrome://extensions/");
};

const openAdnPage = function () {
	openPage(isFirefox() ? "about:addons" : "chrome://extensions/?id=pnjfhlmmeapfclcplcihceboadiigekg");
};

const openSettings = function () {
	openPage("/dashboard.html#options.html");
};

const openLatestRelease = function () {
	openPage("https://github.com/supersonic-xserver/DarkSonicAdNauseam/releases");
};

const navigateToOpenLetter = function () {
  openPage("https://github.com/orgs/supersonic-xserver/repositories");
}

const reloadOptions = function () {
	browser.tabs.query({}, (tabs) => {
		tabs.filter((t) => t.url.endsWith("options.html")).forEach((t) => browser.tabs.reload(t.id));
	});
};

const reloadPane = function () {
	if (window && window.location) {
		const pane = window.location.href;
		if (pane.indexOf("dashboard.html") > -1) {
			window.location.reload();
		}
	}
};

const reactivateSetting = function () {
	console.log("[adn] reactivateSetting", this.prop + "=>" + this.expected);
	Promise.resolve(
		vAPI.messaging.send("dashboard", {
			what: "userSettings",
			name: this.prop,
			value: this.expected,
		})
	).then(() => {
		reloadOptions();
		reloadPane();
	});
};

const reactivateList = function () {
	Promise.resolve(
		vAPI.messaging.send("dashboard", {
			what: "reactivateList",
			list: this.listName,
		})
	).then(() => {
		vAPI.messaging.send("adnauseam", { what: "verifyLists" });
		vAPI.messaging.send("dashboard", { what: "reloadAllFilters" });
		reloadPane();
	});
};

const reloadCurrentTab = function () {
	browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
		browser.tabs.reload(tabs[0].id, { bypassCache: true });
	});
};

const reloadNotificationAction = function () {
	document.querySelector("#RefreshTab").classList.add("hide");
	reloadCurrentTab();
	// dispatch refresh event on current window for menu.js variable update
	window.dispatchEvent(new Event("adnRefresh"));
};

/***************************************************************************/
/* exports                                                                 */
/***************************************************************************/

/**************************** Notifications *********************************/

export const DNTAllowed = new Notification({
	isDNT: true,
	name: "DNTAllowed",
	text: "adnNotificationDNTAllowed",
});

export const DNTHideNotClick = new Notification({
	isDNT: true,
	name: "DNTHideNotClick",
	text: "adnNotificationDNTHidingNotClicking",
});

export const DNTClickNotHide = new Notification({
	isDNT: true,
	name: "DNTClickNotHide",
	text: "adnNotificationDNTClickingNotHiding",
	type: WARNING,
});

export const DNTNotify = new Notification({
	isDNT: true,
	name: "DNTNotify",
	text: "adnNotificationDNTJustSoYouKnow",
});

export const HidingDisabled = new Notification({
	name: "HidingDisabled",
	text: "adnNotificationActivateHiding",
	prop: "hidingAds",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#how-does-adnauseam-hide-ads",
});
HidingDisabled.func = reactivateSetting.bind(HidingDisabled);

export const ClickingDisabled = new Notification({
	name: "ClickingDisabled",
	text: "adnNotificationActivateClicking",
	prop: "clickingAds",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#how-does-adnauseam-click-ads",
});
ClickingDisabled.func = reactivateSetting.bind(ClickingDisabled);

export const BlockingDisabled = new Notification({
	name: "BlockingDisabled",
	text: "adnNotificationActivateBlocking",
	prop: "blockingMalware",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#how-does-adnauseam-block-malicious-ads",
	type: ERROR,
});
BlockingDisabled.func = reactivateSetting.bind(BlockingDisabled);

export const EasyList = new Notification({
	name: "EasyListDisabled",
	text: "adnNotificationActivateEasyList",
	listName: "easylist",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#what-is-the-easylist-filter-and-why-do-i-get-a-warning-when-it-is-disabled",
});
EasyList.func = reactivateList.bind(EasyList);

export const AdNauseamTxt = new Notification({
	name: "AdNauseamTxtDisabled",
	text: "adnNotificationActivateAdNauseamList",
	listName: "adnauseam-filters",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#what-is-the-adnauseam-filter-list",
});
AdNauseamTxt.func = reactivateList.bind(AdNauseamTxt);

export const AdBlockerEnabled = new Notification({
	name: "AdBlockerEnabled",
	text: "adnNotificationDisableAdBlocker",
	button: isFirefox() ? undefined : "adnNotificationDisable",
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#can-i-combine-adnauseam-with-another-blocker",
	firstrun: true,
});
AdBlockerEnabled.func = openExtPage.bind(AdBlockerEnabled);

export const FirefoxSetting = new Notification({
	name: "FirefoxSetting",
	text: "adnNotificationBrowserSetting",
	button: undefined,
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#why-adnauseam-does-not-work-with-certain-browser-settings",
	firstrun: true,
});

export const OperaSetting = new Notification({
	name: "OperaSetting",
	text: "adnNotificationOperaSetting",
	button: undefined,
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#why-adnauseam-does-not-work-on-search-engines-in-opera",
	firstrun: false,
});

const PrivacyMode = new Notification({
	name: "privacyMode",
	text: "adnNotificationPrivacyMode",
	button: undefined,
	link: "https://github.com/dhowe/AdNauseam/wiki/FAQ#does-adnauseam-respect-the-browsers-private-browsingincognito-modes",
	firstrun: true,
});
PrivacyMode.func = openAdnPage.bind(PrivacyMode);

export const ShowAdsDebug = new Notification({
	name: "showAdsDebug",
	text: "adnNotificationShowAdsDebug",
	prop: "showAdsDebug",
	button: undefined,
	expected: false,
	type: WARNING,
});

// https://github.com/dhowe/AdNauseam/issues/2263
export const ReloadTab = new Notification({
	name: "RefreshTab",
	text: "adnRefreshNotification",
	button: "adnRefreshButton",
	type: INFO,
});
ReloadTab.func = reloadNotificationAction.bind(ReloadTab);

// https://github.com/dhowe/AdNauseam/issues/2488
export const NewerVersionAvailable = new Notification({
	name: "NewVersionAvailable",
	text: "adnNewerVersionAvailableNotification",
	button: "adnUpdateButton",
	type: WARNING,
});
NewerVersionAvailable.func = openLatestRelease.bind(NewerVersionAvailable);

export const OpenLetter = new Notification({
	name: "OpenLetter",
	text: "adnOpenLetterNotification",
	button: "adnOpenLetterButton",
	type: INFO,
});
OpenLetter.func = navigateToOpenLetter.bind(OpenLetter);

export const Notifications = [
	AdBlockerEnabled,
	HidingDisabled,
	ClickingDisabled,
	BlockingDisabled,
	EasyList,
	AdNauseamTxt,
	DNTAllowed,
	DNTHideNotClick,
	DNTClickNotHide,
	DNTNotify,
	FirefoxSetting,
	OperaSetting,
	PrivacyMode,
	ShowAdsDebug,
	ReloadTab,
	NewerVersionAvailable,
	OpenLetter,
];

/**************************** exports *********************************/

export const hasDNTNotification = function (notes) {
	for (let i = 0; i < notes.length; i++) {
		if (notes[i].isDNT) return notes[i];
	}
	return false;
};

export const renderNotifications = function (visibleNotes, thePage) {
	// disable warnings option #1910
	vAPI.messaging
		.send("adnauseam", {
			what: "getWarningDisabled",
		})
		.then((isDisabled) => {
			if (isDisabled) {
				uDom("#notifications").addClass("hide");
			} else {
				uDom("#notifications").removeClass("hide");
			}
		});

	const page = thePage || "menu";
	let notifications = Notifications;

	if (page !== "menu") {
		notifications = notifications.filter(function (n) {
			return !n.isDNT;
		});
	}

	if (page === "firstrun") {
		notifications = notifications.filter(function (n) {
			return n.firstrun;
		});
	}

	const template = uDom("#notify-template");

	if (!template.length) throw Error("no template");

	for (let i = 0; i < notifications.length; i++) {
		const notify = notifications[i];

		const match =
			visibleNotes &&
			visibleNotes.filter(function (n) {
				// console.log(notify.name, n.name);
				return notify.name === n.name;
			});

		const note = uDom("#" + notify.name),
			exists = note.length;

		if (match && match.length) {
			//console.log("MATCH: "+notify.name, match);
			if (exists) note.toggleClass("hide", false);
			else appendNotifyDiv(notify, template, uDom);

			if (notify.isDNT) modifyDNTNotifications();
		} else {
			exists && note.toggleClass("hide", true);
		}
	}
};

export const addNotification = function (notes, note) {
	for (let i = 0; i < notes.length; i++) {
		if (notes[i].name === note.name) return false;
	}
	notes.push(note);
	return true;
};

export const removeNotification = function (notes, note) {
	for (let i = 0; i < notes.length; i++) {
		if (notes[i].name === note.name) {
			notes.splice(i, 1);
			return true;
		}
	}
	return false;
};
