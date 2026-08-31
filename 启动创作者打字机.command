#!/bin/zsh
set -e

PROJECT_DIR="${0:A:h}"
cd "$PROJECT_DIR"

if ! curl -fsS --max-time 1 http://localhost:8642/ >/dev/null 2>&1; then
  python3 serve.py 8642 >/tmp/creator-typewriter-server.log 2>&1 &
  sleep 1
fi

open "http://localhost:8642/"
