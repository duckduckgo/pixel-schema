#!/bin/bash
USER_MAP="../internal-github-asana-utils/user_map.yml"
ASANA_PROJECT="1210584574754345"
#Test Pixel Validation Project: 1210584574754345
#Pixel Validation Project:      1210856607616307

./bin/validateRepo.sh ../duckduckgo-privacy-extension/pixel-definitions $USER_MAP $ASANA_PROJECT
./bin/validateRepo.sh ../windows-browsers/PixelDefinitions/ $USER_MAP $ASANA_PROJECT
