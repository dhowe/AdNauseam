# Experimental popup preflight

This proposal addresses a visible flicker when a site calls `window.open()` for an advertising destination: the browser creates a tab, then AdNauseam's existing popup blocker closes it. The aim is to prevent eligible calls before a browsing context exists, while continuing to use the user's enabled AdNauseam lists rather than a separate ad-domain subscription.

The initial implementation was prepared against full uBlock Origin, then adapted to AdNauseam. The motivating report came from video-player pages in Opera. Site-specific `prevent-window-open` and `abort-current-script` rules stopped the observed trigger, but depended on player hostnames or script signatures. A separate prototype extension demonstrated destination-based prevention using its own domain data. This patch moves a conservative subset of that behavior into AdNauseam's existing filter compilation and scriptlet-injection infrastructure.

## Try the patch

Build and temporarily load a modified copy of AdNauseam in a separate test browser profile. Follow the repository's normal build instructions. This is not AdNauseam Lite and is not an official release.

In the Dashboard, enable advanced settings and set:

```text
preventPopupWindows true
```

Apply, then reload the test page. The feature is off by default. Page-related dynamic URL or firewall rules currently disable preflight entirely; the existing popup blocker remains responsible for those configurations. Stock `behind-the-scene` rules do not disable it. Do not interpret a disabled preflight as disabled popup protection.

For a deterministic test, add these to **My filters** and apply:

```text
||popup-preflight.invalid^$popup
@@||popup-preflight.invalid/allowed$popup
```

Serve/open `docs/tests/popup-preflight.html`. The blocked button calls `window.open` with the reserved test domain; it should return `null` without creating a tab. The blank-window control should still open, and the exception control should also open a tab (its `.invalid` hostname intentionally will not resolve). With preflight disabled and the page reloaded, the existing post-creation popup blocker handles the same blocked destination. Compare the tab strip; a `null` return alone is not conclusive because the browser's own popup blocker can also return it. Keep a positive control working.

Test with trusted source/destination sites, first/third-party rules, and `badfilter`. Reload after changing configuration. This proposal does not update already-injected closures in place.

## What is implemented

AdNauseam uses a different scriptlet injection/cache path and the `netWhitelist` model. This port uses those paths and shares its existing whitelist directive semantics through a serializable matcher factory; it does not import uBlock's newer trusted-site manager. Cache invalidation follows changes to filtering behavior while the feature is enabled.

- Collect eligible rules from the actual enabled static network filters during `freeze()`, after removing `badfilter` entries. Persist the derived snapshot with the engine selfie (version bumped).
- Only export hostname-wide, exact `$popup` blocks. First/third-party and `$important` are retained. Generic network filters and `$popunder` are not reinterpreted as popup rules. Pattern-, path-, origin-, and other condition-dependent **blocking** rules remain with the existing implementation.
- Derive popup exceptions from the same compiled filters. Recognized URL-pattern and source/destination hostname conditions are retained. Unsupported conditions and anchors are dropped only from **exceptions**, broadening permission rather than increasing blocking. This can reduce prevention coverage.
- Inject an opt-in `window.open` proxy through the existing scriptlet platform code. Matching happens synchronously against local derived data. No runtime network request, background RPC, additional extension, new permission, or separate list is needed for an opening call.
- Preserve trusted opener/destination sites, a same-frame trusted-link heuristic, ordinary allowed calls and their return values. Restrict preflight to empty/`_blank` target names; other target names can refer to existing windows. Empty URLs and non-HTTP(S) URLs pass through.
- Keep the existing post-creation popup handling intact for fallback coverage. The preflight does not create a tab and then close it. Prevented calls currently do not contribute to background popup counters/logger entries.

## Limits needing maintainer discussion

This is deliberately an opt-in first increment, not a claim of identical behavior to the entire background popup path:

- Blank windows that later navigate, redirects, named targets, links/forms, clean-frame access, hook replacement, and execution before injection are not prevented by this patch.
- Cross-origin frames are skipped if the top context cannot be determined conservatively. Chromium's ancestor-origin information permits hostname trust checks, but a path-specific trust directive causes cross-origin preflight to be skipped. Firefox cross-origin contexts without ancestor-origin information keep the existing fallback.
- Dynamic-rule configurations are left to the existing path. Live changes require reloading documents.
- The local trusted-link heuristic cannot share the background's global `maybeGoodPopup` state across unrelated frames/tabs; browser-level compatibility and the intended interaction with that heuristic need review.
- Existing scriptlet-injection timing and CSP/platform limits still apply. No browser-specific live installation/playback result is claimed by the automated checks.

## Validation

```sh
node --test tools/popup-preflight-tests.mjs
npm run lint
bash tools/pull-assets.sh
bash tools/make-chromium.sh
bash tools/make-firefox.sh
bash tools/make-opera.sh
```

Use the Node version required by `package.json`. The 14 regression tests use the real static network compiler and matcher. They cover zero original opening calls for blocked destinations, permitted arguments/receiver/return values, exception conditions, important precedence, badfilters, exact popup types, blank/named targets, trust, first/third-party contexts, snapshot restoration and URL lookalikes. Across 560 context/URL combinations, every preflight block is checked against `staticNetFilteringEngine.matchRequest(..., 0b0001)`.

Those matcher comparisons do not cover every browser event heuristic in `tab.js`. A real installed-extension test in Opera/Firefox, injection timing and logger integration remain review/validation work before enabling this by default.

The local Chromium, Firefox and Opera build scripts completed and the outputs were inspected for the new module and setting. The existing packaging scripts emit an already-existing `assets/ublock` directory message and an English-locale synchronization notice; no new strings are added by this change. The new module/tests pass ESLint. Modified legacy files have existing diagnostics; comparison against the base commit found no newly introduced diagnostics. A separate 420-case comparison of the shared whitelist matcher against the unchanged background implementation found identical decisions.
