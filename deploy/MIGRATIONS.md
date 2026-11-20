# Database migrations: downgrade story

CipherChat uses Prisma migrations for schema changes. The migration step
runs once per deploy, before the web container starts
(`deploy/entrypoint-migrate.mjs`). It always backs up the database
first, so a bad migration is never the end of the story.

## What the migrate step does

1. **Backup** — copies the SQLite database file to `*.bak` beside it.
   One backup, overwritten on the next run.
2. **Baseline** — if the database was created with the old
   `prisma db push` flow (tables exist, no `_prisma_migrations` table),
   it marks `0_init` as already applied so Prisma doesn't refuse to
   start.
3. **Apply** — runs `prisma migrate deploy` for any pending migrations.

## If a migration breaks the database

The `.bak` file is your rollback point. From inside the deploy folder:

```bash
# Stop the stack
docker compose down

# Restore the backup over the live database volume
# The db-data volume mounts at /app/db inside the web container.
docker run --rm -v cipherchat_db-data:/data -v $(pwd):/backup alpine sh -c \
  "cp /backup/custom.db.bak /data/custom.db"

# Start the stack again
docker compose up -d
```

The backup is a plain SQLite file; the volume path is `db-data` and the
database file inside it is `custom.db` (see
`deploy/docker-compose.yml`).

## If a migration applies but is logically wrong

Prisma migrations are not designed to be downgraded (there is no
`down` SQL). The supported recovery is:

1. Restore the `.bak` backup as above.
2. Fix the migration SQL in `prisma/migrations/`.
3. Re-deploy: the migrate step will re-baseline and re-apply from the
   restored baseline.

## Never do

- Do not edit a migration file that has already been applied to a
  production database. Prisma stores a checksum of each migration and
  will refuse to run against a modified one.
- Do not delete `_prisma_migrations`. That table is the migration
  history; without it, Prisma thinks every migration is pending and
  will try to re-create tables that already exist.

## Creating a new migration

```bash
bunx prisma migrate dev --name describe_the_change
```

This creates a new migration folder under `prisma/migrations/` and
updates the local database. Commit the new migration folder with your
change. The deploy pipeline applies it automatically on the next
`docker compose up -d`.

## Current migrations

| Migration | Purpose |
|-----------|---------|
| `0_init` | Baseline: Room and Member tables |
| `1_join_proof` | Adds `joinProof` column to Room (password-proof join) |
