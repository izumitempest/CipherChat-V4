// The migration step.
//
// The web container no longer carries the Prisma CLI (it is a big
// package and the app does not need it at runtime). Migrations run in
// their own container, once, before the web container starts.
//
// What this script does, in order:
//
//   1. Back the database up. One backup, beside the file, overwritten
//      on the next run. A migration that breaks the database should
//      not be the end of the story.
//   2. Baseline a database that already has tables but no migration
//      history. That is the shape of every database the old
//      `prisma db push` flow left behind: the tables are right, the
//      history is missing, and Prisma refuses to start a migration
//      against it (P3005). Marking the baseline as applied is the
//      documented way to say "this database is already at 0_init".
//   3. Apply whatever migrations are pending.
//
// Run: bun deploy/entrypoint-migrate.mjs

import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const url = process.env.DATABASE_URL ?? "";
const file = url.replace(/^file:/, "");
if (!file) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

// --- 1. the backup ---------------------------------------------------------
if (existsSync(file)) {
  const backup = `${file}.bak`;
  copyFileSync(file, backup);
  console.log(`[migrate] database backed up to ${backup}`);
}

// --- 2. the baseline -------------------------------------------------------
function tableExists(name) {
  if (!existsSync(file)) return false;
  const db = new Database(file, { readonly: true });
  try {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    return !!row;
  } finally {
    db.close();
  }
}

const hasTables = tableExists("Room");
const hasHistory = tableExists("_prisma_migrations");

if (hasTables && !hasHistory) {
  console.log(
    "[migrate] the database has tables but no migration history (an old db push). Baselining it.",
  );
  execFileSync("bunx", ["prisma", "migrate", "resolve", "--applied", "0_init"], {
    stdio: "inherit",
  });
}

// --- 3. the migrations -----------------------------------------------------
execFileSync("bunx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
console.log("[migrate] database is up to date");
