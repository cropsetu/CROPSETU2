#!/bin/bash
# Run this once after placing the raw images in this folder.
# Compresses each wx_*.jpg to ~200KB using macOS sips (no install needed).
# Usage: cd assets/weather && bash compress.sh

for f in wx_*.jpg; do
  original=$(du -k "$f" | cut -f1)
  sips -Z 720 "$f" --out "$f" > /dev/null 2>&1   # resize longest edge to 720px
  sips -s format jpeg -s formatOptions 60 "$f" --out "$f" > /dev/null 2>&1  # quality 60
  compressed=$(du -k "$f" | cut -f1)
  echo "✓ $f  ${original}KB → ${compressed}KB"
done
echo "Done."
