#!/bin/sh
# First boot on a fresh volume: the schema exists only in the template
# baked at build time. Never overwrite a live database.
set -eu
if [ ! -f /app/db/custom.db ]; then
  echo "[entrypoint] empty volume — seeding fresh database"
  cp /app/db/custom.db.template /app/db/custom.db
fi
exec "$@"
