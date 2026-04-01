#!/bin/bash
# Weekly Discovery — press on Tuesdays, Resy on Thursdays
set -e
cd /Users/mauricedweck/Desktop/01-Projects/hot-restaurants-
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
LOG="data/weekly-discovery.log"

DOW=$(date +%u)  # 1=Mon, 2=Tue, 4=Thu

echo "$(date) — Starting weekly discovery (day=$DOW)" >> "$LOG"

[ -f .env ] && export $(grep -v '^#' .env | xargs)

if [ "$DOW" = "2" ]; then
  echo "$(date) — Running press discovery..." >> "$LOG"
  node scripts/discover-from-press.js --force >> "$LOG" 2>&1
  git add data/press_discoveries.json data/press_last_run.json
  git diff --staged --quiet || git commit -m "🔍 new restaurant candidates — press $(date +'%Y-%m-%d')"
elif [ "$DOW" = "4" ]; then
  echo "$(date) — Running Resy discovery..." >> "$LOG"
  node scripts/discover-new-on-resy.js >> "$LOG" 2>&1
  git add data/resy_new_discoveries.json
  git diff --staged --quiet || git commit -m "🔍 new restaurant candidates — resy $(date +'%Y-%m-%d')"
else
  echo "$(date) — Not a discovery day, skipping" >> "$LOG"
  exit 0
fi

git push >> "$LOG" 2>&1
echo "$(date) — Done!" >> "$LOG"
