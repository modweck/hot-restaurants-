#!/bin/bash
# Run this on the second computer
# Make sure NordVPN is connected first!

cd "$(dirname "$0")/.."
echo "Starting OT availability check — Half 2 of 2"
echo "Make sure NordVPN is connected and laptop stays awake"
echo ""

node netlify/functions/ot-tonight-check.js --all --split 2 --half 2
