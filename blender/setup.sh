#!/usr/bin/env bash
# Set up the 고쳐 입기 asset pipeline on a Windows machine (Git Bash): portable Blender 4.5 LTS + MPFB + MakeHuman CC0 packs.
# Everything goes in ~/tools (no admin rights needed). Afterwards:
#   ~/tools/blender-4.5.14-windows-x64/blender.exe -b -P blender/export_web.py -- kind=f   (and kind=m)
set -euo pipefail
T=~/tools
B=$T/blender-4.5.14-windows-x64
mkdir -p "$T"
cd "$T"
if [ ! -x "$B/blender.exe" ]; then
  curl -L -o blender.zip https://download.blender.org/release/Blender4.5/blender-4.5.14-windows-x64.zip
  unzip -q blender.zip && rm blender.zip
fi
mkdir -p "$B/portable"   # keep Blender's settings and extensions next to it, not in AppData
MPFB_SHA=c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad
curl -L -o mpfb.zip "https://extensions.blender.org/download/sha256:$MPFB_SHA/add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0"
echo "$MPFB_SHA  mpfb.zip" | sha256sum -c -
"$B/blender.exe" -b --factory-startup -c extension install-file -r user_default --enable mpfb.zip
D="$B/portable/extensions/.user/user_default/mpfb/data"
mkdir -p "$D"
for p in makehuman_system_assets shirts01 pants01 skirts01 shoes01; do
  curl -L -o "$p.zip" "https://files.makehumancommunity.org/asset_packs/$p/${p}_cc0.zip"
  unzip -q -o "$p.zip" -d "$D" && rm "$p.zip"
done
rm -f mpfb.zip
echo "done: $B/blender.exe"
