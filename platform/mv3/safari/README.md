# AdNauseam Lite for Safari (macOS)

Safari only supports Manifest V3 web extensions (no blocking `webRequest`),
so Safari support is provided by the MV3 "ADNLite" build, packaged into a
macOS app as Apple requires.

## Build & install

Prerequisites: macOS, full Xcode (for `safari-web-extension-converter` and
`xcodebuild`), node, jq.

```sh
make safari-app
```

This chains two steps, which can also be run separately:

1. `make mv3-safari` — builds the web extension into `dist/build/ADNLite.safari`
2. `tools/make-safari-app.sh` — generates an Xcode project in
   `dist/build/adnauseam-safari` (via `xcrun safari-web-extension-converter`),
   builds "AdNauseam Lite.app" with ad-hoc signing, installs it to
   `/Applications`, and launches it so Safari registers the extension.
   (Safari does not list extensions whose parent app lives inside a build
   directory, so the install step is required.)

`tools/make-safari-app.sh` accepts `nobuild` (generate the Xcode project
only) and `noinstall` (build but don't install/launch). The Xcode project
references `dist/build/ADNLite.safari` in place, so after changing extension
code, re-running `make safari-app` rebuilds everything.

## Enabling the extension in Safari (manual)

1. Safari > Settings > Advanced > enable **Show features for web developers**
2. Safari > Settings > Developer > enable **Allow unsigned extensions**
   (requires admin password; **resets every time Safari quits** — you must
   re-enable it after each Safari relaunch; the extension itself and its
   collected data persist)
3. Safari > Settings > Extensions > enable **AdNauseam Lite**
4. Grant website access: **Always Allow on Every Website** (required — ad
   blocking and ad visiting need access to arbitrary ad-network hosts)

## Debugging

- Background logs (including `[ADN Visitor]` visit attempts): Develop >
  Web Extension Background Content > AdNauseam Lite
- Popup / dashboard / vault pages can be inspected from the Develop menu
  while open.

## Safari-specific behavior

- The MV3 background runs as a **non-persistent background page** (not a
  service worker) and Safari unloads it aggressively when idle. The ad-visit
  queue polls every 5s while the page is alive and is resurrected by a
  1-minute `alarms` heartbeat, so visit throughput is lower than on Chromium.
- Safari has no `chrome.offscreen` API; ad visits run inline in the
  background page (which has a DOM), instead of in an offscreen document.
- No `userScripts` API: custom user scriptlets are unavailable (the code
  detects this and degrades).
- Strict-blocking is internally disabled on Safari (upstream uBOL behavior).
- DNR ruleset quirks are handled by `ext-compat.js` (e.g. rulesets are
  force-reloaded when a new browsing realm is seen — if filtering seems
  inert right after install, switch windows once).

## Distribution

This build uses ad-hoc dev signing and requires the "Allow unsigned
extensions" toggle above, which is a from-source/developer workflow only.
Real end-user distribution (e.g. a notarized Developer ID build, or a Mac
App Store submission) requires an Apple Developer account and code-signing
setup that is out of scope for this build; that work is intentionally not
part of this change.
