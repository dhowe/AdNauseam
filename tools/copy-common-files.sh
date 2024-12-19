#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1
UBLOCK=$( cat dist/version ) # ADN:ublock-version

bash ./tools/pull-assets.sh # ADN

bash ./tools/make-assets.sh        $DES
bash ./tools/make-locales.sh       $DES

cp -R src/css                      $DES/
cp -R src/img                      $DES/
cp -R src/js                       $DES/
cp -R src/lib                      $DES/
cp -R src/web_accessible_resources $DES/
# cp -R src/_locales                 $DES/

cp src/*.html                      $DES/
cp platform/common/*.js            $DES/js/
cp platform/chromium/*.html        $DES/
cp platform/common/*.json          $DES/
cp manifest.json $DES/             # use ADN manifest, not ublock's
cp LICENSE.txt                     $DES/

# ADN
awk -v s=$UBLOCK '{gsub(/{UBLOCK_VERSION}/, s)}1' $DES/links.html > /tmp/links.html && mv /tmp/links.html $DES/links.html

# Remove the following files
rm $DES/js/adn/tests.js
rm -R $DES/lib/qunit
