# https://stackoverflow.com/a/6273809
run_options := $(filter-out $@,$(MAKECMDGOALS))

.PHONY: all clean cleanassets test lint chromium opera firefox npm dig mobile FORCE \
	mv3-chromium mv3-firefox mv3-edge mv3-safari ubol-codemirror \
	compare maxcost medcost mincost modifiers record wasm \
	publish-chromium publish-edge publish-firefox \
	publish-dev-chromium publish-dev-firefox \
	upload-firefox upload-dev-firefox

sources := ./dist/version $(shell find ./assets -type f) $(shell find ./src -type f)
platform := $(wildcard platform/*/*)
assets := dist/build/uAssets
mv3-sources := \
	$(shell find ./src -type f) \
	$(wildcard platform/mv3/*) \
	$(shell find ./platform/mv3/extension -name codemirror-ubol -prune -o -type f) \
	platform/mv3/extension/lib/codemirror/codemirror-ubol/dist/cm6.bundle.ubol.min.js
mv3-data := $(shell find ./dist/build/mv3-data -type f)

mv3-edge-deps := $(wildcard platform/mv3/edge/*)
mv3-safari-deps := $(wildcard platform/mv3/safari/*)

all: chromium firefox npm

dist/build/uBlock0.chromium: tools/make-chromium.sh $(sources) $(platform) $(assets)
	tools/make-chromium.sh

# Build the extension for Chromium.
chromium: dist/build/uBlock0.chromium

dist/build/uBlock0.opera: tools/make-opera.sh $(sources) $(platform) $(assets)
	tools/make-opera.sh

# Build the extension for Opera.
opera: dist/build/uBlock0.opera

dist/build/uBlock0.firefox: tools/make-firefox.sh $(sources) $(platform) $(assets)
	tools/make-firefox.sh all

# Build the extension for Firefox.
firefox: dist/build/uBlock0.firefox

# Build for Mobile Browsers (Android/iOS)
# Phase 3: Mobile-specific build with minification

# Define mobile sources explicitly
mobile_sources := $(shell find ./platform/mobile -type f)

# Ensure dist/build directory exists
dist/build:
	mkdir -p dist/build

# Mobile target - always runs (phony)
mobile: FORCE
	@echo "*** DarkSonic: Building Mobile Artifact (iOS/Android) ***"
	rm -rf dist/build/adnauseam.mobile
	mkdir -p dist/build/adnauseam.mobile
	cp -r src/* dist/build/adnauseam.mobile/
	cp -r platform/mobile/* dist/build/adnauseam.mobile/
	# Inject the mobile flag directly into the build
	echo "window.ADNAUSEAM_MOBILE = true;" > dist/build/adnauseam.mobile/js/mobile-flag.js
	cp platform/mobile/manifest.json dist/build/adnauseam.mobile/manifest.json
	# Set mobile flag for UA spoofing
	@if command -v terser >/dev/null 2>&1; then \
		find dist/build/adnauseam.mobile/js -name '*.js' -exec terser --compress --mangle {} -o {} \; \
		|| echo "Minification skipped"; \
	else \
		echo "Minification skipped (terser not found)"; \
	fi
	@echo "Mobile build complete at dist/build/adnauseam.mobile"

# Always force rebuild
FORCE:

dist/build/uBlock0.npm: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-npm.sh

npm: dist/build/uBlock0.npm

# Dev tools
node_modules:
	npm install

init: node_modules

lint: init
	npm run lint

dist/build/uBlock0.dig: tools/make-nodejs.sh $(sources) $(platform) $(assets)
	tools/make-dig.sh

dig: dist/build/uBlock0.dig
	cd dist/build/uBlock0.dig && npm install

dig-snfe: dig
	cd dist/build/uBlock0.dig && npm run snfe $(run_options)

dist/build/mv3-data:
	mkdir -p dist/build/mv3-data

ubol-codemirror:
	$(MAKE) -sC platform/mv3/extension/lib/codemirror/codemirror-ubol/ ubol.bundle

dist/build/uBOLite.chromium: tools/make-mv3.sh $(mv3-sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh chromium

mv3-chromium: ubol-codemirror dist/build/uBOLite.chromium

dist/build/uBOLite.firefox: tools/make-mv3.sh $(mv3-sources) $(platform) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh firefox

mv3-firefox: ubol-codemirror dist/build/uBOLite.firefox

dist/build/uBOLite.edge: tools/make-mv3.sh $(mv3-sources) $(mv3-edge-deps) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh edge

mv3-edge: ubol-codemirror dist/build/uBOLite.edge

dist/build/uBOLite.safari: tools/make-mv3.sh $(mv3-sources) $(mv3-safari-deps) $(mv3-data) dist/build/mv3-data
	tools/make-mv3.sh safari

mv3-safari: ubol-codemirror dist/build/uBOLite.safari

dist/build/uAssets:
	tools/pull-assets.sh

clean:
	rm -rf dist/build tmp/node_modules node_modules

cleanassets:
	rm -rf dist/build/mv3-data dist/build/uAssets

# Usage: make publish-publish version=?
publish-chromium:
	node publish-extension/publish-chromium.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=chromium \
		storeid=cjpalhdlnbpafiamejdnhcphjbkeiagm

# Usage: make publish-edge version=?
publish-edge:
	node publish-extension/publish-edge.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=chromium \
		datebasedmajor=1 \
		storeid=odfafepnkmbhccpbejgmiehpchacaeak \
		productid=$(shell secret-tool lookup token ubo_edge_id) \
		notes="See release notes at https://github.com/gorhill/uBlock/releases"

# Usage: make publish-firefox version=?
publish-firefox:
	node publish-extension/publish-firefox.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=uBlock0@raymondhill.net \
		channel=listed

# Usage: make publish-dev-chromium version=?
publish-dev-chromium:
	node publish-extension/publish-chromium.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=chromium \
		storeid=cgbcahbpdhpcegmbfconppldiemgcoii

# Usage: make publish-dev-firefox version=?
publish-dev-firefox:
	node publish-extension/publish-firefox.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=uBlock0@raymondhill.net \
		channel=unlisted

# Usage: make upload-firefox version=?
upload-firefox:
	node publish-extension/upload-firefox.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=uBlock0@raymondhill.net \
		channel=listed

# Usage: make upload-dev-firefox version=?
upload-dev-firefox:
	node publish-extension/upload-firefox.js \
		ghowner=gorhill \
		ghrepo=uBlock \
		ghtag=$(version) \
		ghasset=firefox \
		storeid=uBlock0@raymondhill.net \
		channel=unlisted \
		updatepath=./dist/firefox/updates.json

# Not real targets, just convenient for auto-completion at shell prompt
compare:
	@echo
maxcost:
	@echo
medcost:
	@echo
mincost:
	@echo
modifiers:
	@echo
record:
	@echo
wasm:
	@echo
