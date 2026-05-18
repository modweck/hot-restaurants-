#!/bin/bash
# Weekly upcoming restaurants check — runs Monday 3 PM via launchd
cd /Users/mauricedweck/Desktop/hot-restaurants-/scripts
node upcoming-restaurants.js

cd /Users/mauricedweck/Desktop/hot-restaurants-
git add .
git diff --cached --quiet || git commit -m "Auto-update upcoming/new-rising restaurants $(date +%Y-%m-%d)"
git push
