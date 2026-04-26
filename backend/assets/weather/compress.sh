#!/bin/bash
# Run this once after placing the raw images in this folder.
# Compresses each wx_*.jpg to ~200KB using macOS sips (no install needed).
# Usage: cd assets/weather && bash compress.sh

for f in wx_*.jpg; do
  original=$(du -k "$f" | cut -f1)
  sips -Z 800 "$f" --out "$f" > /dev/null 2>&1   # resize longest edge to 800px
  sips -s format jpeg -s formatOptions 72 "$f" --out "$f" > /dev/null 2>&1  # quality 72
  compressed=$(du -k "$f" | cut -f1)
  echo "✓ $f  ${original}KB → ${compressed}KB"
done
echo "Done."
