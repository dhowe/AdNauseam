#!/usr/bin/env bash
#
# This script assumes a linux environment

DES=$1/assets

printf "*** Packaging assets in $DES... "

if [ -n "${TRAVIS_TAG}" ]; then
  pushd .. > /dev/null
  git clone https://github.com/uBlockOrigin/uAssets.git
  popd > /dev/null
fi

rm -rf $DES
mkdir $DES

mkdir $DES/thirdparties
cp -R ../uAssets/thirdparties/easylist-downloads.adblockplus.org $DES/thirdparties/
cp -R ../uAssets/thirdparties/mirror1.malwaredomains.com         $DES/thirdparties/
cp -R ../uAssets/thirdparties/pgl.yoyo.org                       $DES/thirdparties/
cp -R ../uAssets/thirdparties/publicsuffix.org                   $DES/thirdparties/
cp -R ../uAssets/thirdparties/www.malwaredomainlist.com          $DES/thirdparties/

mkdir $DES/ublock
cp -R ../uAssets/filters/*                                       $DES/ublock/
cp -R ./assets/ublock/filter-lists.json                          $DES/ublock/

cp assets/ublock/adnauseam.txt                                   $DES/ublock/   # adn

cp ../uAssets/checksums/ublock0.txt                              $DES/checksums.txt

# append our checksum to the uBlock checksum list
# will either use md5sum to create it, or use the value from last time
if hash md5sum 2>/dev/null; then
  #echo appending adnauseam checksum
  ENTRY=assets/ublock/adnauseam.txt
  CS="`md5sum -q $ENTRY` $ENTRY"
  echo $CS >> $DES/checksums.txt    # for build
  echo $CS > assets/checksum-adn.txt # to store
else
  cat assets/checksum-adn.txt >> $DES/checksums.txt
fi

cp $DES/checksums.txt ./assets/checksums/ublock0.txt  # for checking in adn repo

echo "done."

#cat ./assets/checksums.txt
