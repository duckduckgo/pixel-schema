#!/bin/bash
USER_MAP="../internal-github-asana-utils/user_map.yml"
ASANA_PROJECT="1210584574754345"

./validateRepo.sh ../duckduckgo-privacy-extension/pixel-definitions $USER_MAP $ASANA_PROJECT
./validateRepo.sh ../apple-browsers/macOS/PixelDefinitions/ $USER_MAP $ASANA_PROJECT
./validateRepo.sh ../apple-browsers/iOS/PixelDefinitions/ $USER_MAP $ASANA_PROJECT
./validateRepo.sh ../windows-browsers/PixelDefinitions/ $USER_MAP $ASANA_PROJECT
