#!/bin/sh
# CipherChat database backup script.
#
#   deploy/backup.sh            # create a timestamped backup, rotate old ones
#   deploy/backup.sh --s3       # also upload to S3 (requires AWS creds)
#   deploy/backup.sh restore <file>   # restore a backup over the live database
#
# Backups are written to deploy/backups/ with a timestamp:
#   cipherchat-20260101-120000.db
#   cipherchat-20260101-120000.db.sha256   (checksum file)
#
# Rotation: keeps the last KEEP_COUNT backups (default 14), deletes older.
#
# Environment:
#   DATABASE_URL        SQLite database file (default: deploy/db/custom.db)
#   BACKUP_DIR          Backup directory (default: deploy/backups)
#   KEEP_COUNT          Number of backups to keep (default 14)
#   AWS_ACCESS_KEY_ID   S3 upload (optional)
#   AWS_SECRET_ACCESS_KEY   S3 upload (optional)
#   AWS_DEFAULT_REGION  S3 region (optional)
#   S3_BUCKET           S3 bucket name (optional)
#   S3_PREFIX           S3 key prefix (optional, default: cipherchat-backups/)

set -eu

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DEPLOY_DIR"

DATABASE_URL="${DATABASE_URL:-file:./db/custom.db}"
DB_FILE="${DATABASE_URL#file:}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_COUNT="${KEEP_COUNT:-14}"
MODE="${1:-backup}"

die() { echo "backup.sh: $1" >&2; exit 1; }

timestamp() { date +%Y%m%d-%H%M%S; }

ensure_dir() {
  mkdir -p "$BACKUP_DIR"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "no sha256 tool found"
  fi
}

upload_s3() {
  local file="$1"
  local key="$2"
  [ -n "${S3_BUCKET:-}" ] || die "S3_BUCKET not set"
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] || die "AWS_ACCESS_KEY_ID not set"
  [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || die "AWS_SECRET_ACCESS_KEY not set"
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$file" "s3://${S3_BUCKET}/${S3_PREFIX:-cipherchat-backups/}${key}"
  else
    die "aws cli not found; cannot upload to S3"
  fi
}

rotate() {
  # List backups sorted by name (timestamp = sortable), delete oldest.
  local count
  count=$(ls -1 "$BACKUP_DIR"/cipherchat-*.db 2>/dev/null | wc -l)
  while [ "$count" -gt "$KEEP_COUNT" ]; do
    local oldest
    oldest=$(ls -1t "$BACKUP_DIR"/cipherchat-*.db | tail -1)
    rm -f "$oldest" "${oldest}.sha256"
    count=$((count - 1))
  done
}

cmd_backup() {
  [ -f "$DB_FILE" ] || die "database file not found: $DB_FILE"
  ensure_dir
  local ts; ts="$(timestamp)"
  local backup="$BACKUP_DIR/cipherchat-${ts}.db"
  cp "$DB_FILE" "$backup"
  local hash; hash="$(sha256_file "$backup")"
  echo "$hash  cipherchat-${ts}.db" > "$BACKUP_DIR/cipherchat-${ts}.db.sha256"
  echo "backup.sh: backup written to $backup (sha256: $hash)"
  rotate
  if [ "${MODE_S3:-0}" = 1 ]; then
    upload_s3 "$backup" "cipherchat-${ts}.db"
    upload_s3 "$BACKUP_DIR/cipherchat-${ts}.db.sha256" "cipherchat-${ts}.db.sha256"
    echo "backup.sh: uploaded to S3"
  fi
}

cmd_restore() {
  local backup_file="$2"
  [ -n "$backup_file" ] || die "usage: backup.sh restore <file>"
  [ -f "$backup_file" ] || die "backup file not found: $backup_file"
  # Verify checksum if a .sha256 file exists
  if [ -f "${backup_file}.sha256" ]; then
    local expected actual
    expected=$(awk '{print $1}' "${backup_file}.sha256")
    actual=$(sha256_file "$backup_file")
    [ "$expected" = "$actual" ] || die "checksum mismatch; backup may be corrupt"
  fi
  echo "backup.sh: restoring $backup_file over $DB_FILE"
  cp "$backup_file" "$DB_FILE"
  echo "backup.sh: restore complete"
}

case "$MODE" in
  backup)
    cmd_backup
    ;;
  --s3)
    MODE_S3=1
    cmd_backup
    ;;
  restore)
    cmd_restore "$@"
    ;;
  *)
    die "usage: backup.sh [backup|--s3|restore <file>]"
    ;;
esac
