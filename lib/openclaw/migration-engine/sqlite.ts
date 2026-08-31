import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqliteInspection = {
  path: string;
  bytes: number;
  sha256: string;
  userVersion: number | null;
  journalMode: string | null;
  integrity: "ok" | "failed";
  foreignKeys: "ok" | "failed";
  sidecars: string[];
};

export async function inspectSqliteDatabase(databasePath: string): Promise<SqliteInspection> {
  const fileStat = await stat(databasePath);
  if (!fileStat.isFile()) throw new Error(`SQLite path is not a regular file: ${databasePath}`);
  const sidecars = await findSqliteSidecars(databasePath);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=30000; PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;");
    const integrity = readSingleText(db, "PRAGMA integrity_check;");
    const foreignKeys = readSingleText(db, "PRAGMA foreign_key_check;");
    const userVersion = readSingleNumber(db, "PRAGMA user_version;");
    const journalMode = readSingleText(db, "PRAGMA journal_mode;");
    return {
      path: databasePath,
      bytes: fileStat.size,
      sha256: await hashFile(databasePath),
      userVersion,
      journalMode,
      integrity: integrity === "ok" ? "ok" : "failed",
      foreignKeys: foreignKeys === "" ? "ok" : "failed",
      sidecars
    };
  } finally {
    db.close();
  }
}

export async function createWalAwareSqliteSnapshot(input: {
  sourcePath: string;
  destinationPath: string;
}): Promise<SqliteInspection> {
  const destinationPath = path.resolve(input.destinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  await rm(destinationPath, { force: true });
  const sourceInspection = await inspectSqliteDatabase(input.sourcePath);
  const db = new DatabaseSync(input.sourcePath, { readOnly: true });
  try {
    // VACUUM INTO is a read-only source operation, but SQLite rejects it when
    // connection-local query_only is enabled. The source remains opened
    // read-only and the resulting file is validated below.
    db.exec("PRAGMA busy_timeout=30000; PRAGMA trusted_schema=OFF;");
    // VACUUM INTO uses SQLite's online read path and includes committed WAL pages.
    db.exec(`VACUUM INTO '${quoteSqliteString(destinationPath)}';`);
  } finally {
    db.close();
  }

  const snapshot = await inspectSqliteDatabase(destinationPath);
  if (snapshot.integrity !== "ok" || snapshot.foreignKeys !== "ok") {
    await rm(destinationPath, { force: true });
    throw new Error(`SQLite snapshot failed integrity validation: ${input.sourcePath}`);
  }
  return { ...snapshot, sidecars: sourceInspection.sidecars };
}

export async function hashFile(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function findSqliteSidecars(databasePath: string) {
  const sidecars: string[] = [];
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const candidate = `${databasePath}${suffix}`;
    if (await stat(candidate).then((value) => value.isFile()).catch(() => false)) sidecars.push(candidate);
  }
  return sidecars;
}

function readSingleText(db: DatabaseSync, sql: string) {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : null;
  return typeof value === "string" ? value.trim() : "";
}

function readSingleNumber(db: DatabaseSync, sql: string) {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : null;
  return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : null;
}

function quoteSqliteString(value: string) {
  return value.replaceAll("'", "''");
}
