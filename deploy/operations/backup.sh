#!/usr/bin/env bash
# Install/configure manually; never run in CI or application startup.
set -euo pipefail
umask 077
test "${MAD_BACKUP_APPROVED:-}" = yes
test -d "${MAD_BACKUP_DIR:?Provision a private backup directory}"
test -n "${PGSERVICE:?Use a dedicated read-only backup service}"
test -r "${PGPASSFILE:?Use a protected password file}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${MAD_BACKUP_DIR}/mad-owned-${stamp}.dump"
# pg_dump uses a consistent snapshot; no source-system tables are copied here.
if ! pg_dump --format=custom --no-owner --no-acl --table='public.mad_*' --file="${archive}.partial" 2>/dev/null; then
  echo 'MAD backup failed; restricted operator diagnosis required.' >&2
  exit 1
fi
pg_restore --list "${archive}.partial" >/dev/null 2>&1
mv -- "${archive}.partial" "$archive"
sha256sum "$archive" > "${archive}.sha256"
echo 'MAD-owned archive created; off-host replication and restore verification remain required.'
