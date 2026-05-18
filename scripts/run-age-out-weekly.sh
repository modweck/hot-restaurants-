#!/bin/bash
# Weekly age out — runs Wednesday 3 PM via launchd
cd /Users/mauricedweck/Desktop/hot-restaurants-/scripts
node age-out-new-rising.js

cd /Users/mauricedweck/Desktop/hot-restaurants-
git add .
git diff --cached --quiet || git commit -m "Auto age-out new & rising restaurants $(date +%Y-%m-%d)"
git push
