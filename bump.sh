#!/bin/sh
# Marca uma nova versão: app, version.json e cache do service worker.
V=$(date -u +%Y%m%d%H%M)
sed -i "s/^const APP_VER='[^']*';/const APP_VER='$V';/" index.html
printf '{"v":"%s"}\n' "$V" > version.json
sed -i "s/^const CACHE='[^']*';/const CACHE='zone5-$V';/" sw.js
echo "$V"
