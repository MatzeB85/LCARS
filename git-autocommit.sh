#!/bin/bash
cd ~/.node-red/projects/LCARS || exit 1

git add .

# Nur committen, wenn es Änderungen gibt
if ! git diff --cached --quiet; then
  git commit -m "Auto-commit after deploy $(date '+%Y-%m-%d %H:%M:%S')"
fi
