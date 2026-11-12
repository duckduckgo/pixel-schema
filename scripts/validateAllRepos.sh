#!/bin/bash
USER_MAP="../internal-github-asana-utils/user_map.yml"

# Used for local testing, defaults to test project https://app.asana.com/1/137249556945/project/1210584574754345/list/1210585418929080
# Test Pixel Validation Project: 1210584574754345
# Pixel Validation Project:      1210856607616307
ASANA_PROJECT="1210584574754345"

./scripts/validateRepo.sh ../duckduckgo-privacy-extension/pixel-definitions $USER_MAP $ASANA_PROJECT
./scripts/validateRepo.sh ../windows-browser/PixelDefinitions/ $USER_MAP $ASANA_PROJECT
