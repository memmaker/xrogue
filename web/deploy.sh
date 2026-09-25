#!/bin/sh
# Upload web/dist to https://ruzzoli.de/roguelikes/xrogue/
set -e
cd "$(dirname "$0")"
ssh ruzzoli.de 'sudo mkdir -p /var/www/ruzzoli.de/roguelikes/xrogue && sudo chown -R felix:www-data /var/www/ruzzoli.de/roguelikes'
rsync -rtz --delete dist/ ruzzoli.de:/var/www/ruzzoli.de/roguelikes/xrogue/
