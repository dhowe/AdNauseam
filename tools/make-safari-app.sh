#!/usr/bin/env bash
#
# Wraps dist/build/ADNLite.safari into a macOS app via Xcode's
# safari-web-extension-converter, builds it with ad-hoc signing, and
# launches it so Safari registers the extension.
#
# Requires macOS with full Xcode installed (xcodebuild, not just the
# command-line tools). Run `make mv3-safari` first, or use the Makefile
# target `make safari-app` which chains both.
#
# Optional args:
#   nobuild     generate the Xcode project only, skip xcodebuild
#   noinstall   build but do not install to /Applications nor launch

set -euo pipefail

APP_NAME="AdNauseam Lite"
# The converter gives the app the id <prefix-of-BUNDLE_ID>.<sanitized APP_NAME>
# and the extension <BUNDLE_ID>.Extension, so BUNDLE_ID's last component must
# equal the sanitized app name or the embedded-binary validation fails.
BUNDLE_ID="org.rednoise.AdNauseam-Lite"
EXT_DIR="dist/build/ADNLite.safari"
OUT_DIR="dist/build/adnauseam-safari"
DERIVED="$OUT_DIR/DerivedData"

NOBUILD=""
NOINSTALL=""
for i in "$@"; do
  case "$i" in
    nobuild)
      NOBUILD="yes"
      ;;
    noinstall)
      NOINSTALL="yes"
      ;;
  esac
done

if [ "$(uname)" != "Darwin" ]; then
    echo "Error: Safari app packaging requires macOS"
    exit 1
fi
if ! xcode-select -p > /dev/null 2>&1; then
    echo "Error: Xcode is required (install Xcode.app from the App Store)"
    exit 1
fi
if [ ! -d "$EXT_DIR" ]; then
    echo "Error: $EXT_DIR not found — run 'make mv3-safari' first"
    exit 1
fi

echo "*** ADNLite.safari: generating Xcode project"
rm -rf "$OUT_DIR"
xcrun safari-web-extension-converter "$EXT_DIR" \
    --macos-only --no-open --no-prompt --force \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --project-location "$OUT_DIR"

if [ "$NOBUILD" = "yes" ]; then
    echo "*** ADNLite.safari: Xcode project ready at $OUT_DIR (build skipped)"
    exit 0
fi

XCODEPROJ=$(find "$OUT_DIR" -maxdepth 2 -name '*.xcodeproj' | head -n 1)
if [ -z "$XCODEPROJ" ]; then
    echo "Error: no .xcodeproj generated under $OUT_DIR"
    exit 1
fi

# Ad-hoc signing: required on Apple Silicon (fully-unsigned binaries will
# not launch) and pairs with Safari's "Allow unsigned extensions" toggle.
echo "*** ADNLite.safari: building $XCODEPROJ"
xcodebuild -project "$XCODEPROJ" \
    -scheme "$APP_NAME" \
    -configuration Debug \
    -derivedDataPath "$DERIVED" \
    CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" \
    build

APP="$DERIVED/Build/Products/Debug/$APP_NAME.app"
echo "*** ADNLite.safari: app built at $APP"

if [ "$NOINSTALL" = "yes" ]; then
    exit 0
fi

# Safari does not list extensions whose parent app lives inside a build
# directory; the app must be installed in /Applications to show up in
# Safari > Settings > Extensions.
INSTALLED_APP="/Applications/$APP_NAME.app"
echo "*** ADNLite.safari: installing to $INSTALLED_APP"
osascript -e "quit app \"$APP_NAME\"" 2>/dev/null || :
# Remove first: ditto merges into an existing bundle, which can leave
# stale files behind and confuse Safari's extension scanning.
rm -rf "$INSTALLED_APP"
ditto "$APP" "$INSTALLED_APP"

# xcodebuild registers the DerivedData copy with LaunchServices at build
# time; two registered apps with the same bundle id confuse Safari's
# extension scanning (it may resolve to the build-directory copy, which
# it refuses to list). Deregister AND delete the build-dir copy so only
# the /Applications app exists on disk (the next build regenerates it).
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
"$LSREGISTER" -u "$APP" 2>/dev/null || :
rm -rf "$APP"
"$LSREGISTER" -f "$INSTALLED_APP"

echo "*** ADNLite.safari: launching app to register extension with Safari"
open "$INSTALLED_APP"

cat << 'EOF'

Manual steps remaining in Safari (cannot be automated):
  1. Settings > Advanced > enable "Show features for web developers"
  2. Settings > Developer > enable "Allow unsigned extensions"
     (admin password required; this resets every time Safari quits)
  3. Settings > Extensions > enable "AdNauseam Lite"
  4. Grant website access: "Always Allow on Every Website"

See platform/mv3/safari/README.md for details and debugging tips.
EOF
