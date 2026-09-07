#!/bin/sh

git config --global user.email "paul@beactive.ai"
git config --global user.name "Paul Maszy"

bash scripts/bump-version.sh
git commit -a -m "Vers"
git push origin HEAD:main
