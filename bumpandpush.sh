#!/bin/sh

bash scripts/bump-version.sh
git commit -a -m "Vers"
git push origin HEAD:main
