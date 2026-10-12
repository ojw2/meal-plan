#!/bin/sh
# Nightly pg_dump at 03:00 (container TZ), keeping the newest $KEEP dumps.
set -eu
KEEP="${KEEP:-14}"
mkdir -p /backups

while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%Y-%m-%d) 03:00" +%s)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))

  file="/backups/mealplan-$(date +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$file.tmp"; then
    mv "$file.tmp" "$file"
    echo "backup: wrote $file"
  else
    rm -f "$file.tmp"
    echo "backup: pg_dump failed" >&2
  fi
  ls -1t /backups/mealplan-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
done
