import { applyD1Migrations, env } from "cloudflare:test";

/**
 * Rebuilds the test D1 database from `api/migrations`, applied in
 * migration-number order — the same files, and the same wrangler SQL splitter,
 * that `wrangler d1 migrations apply` uses in production. Nothing here names a
 * table or a migration, so a new migration file is picked up with no edit to
 * this helper: that is the whole point, since a hand-maintained list would
 * reintroduce the drift it exists to close.
 *
 * Callers get a database seeded exactly as production is: migration 0000 seeds
 * `ingest_lock`, and 0003 seeds the `usr_single` row that AUTH_MODE=single
 * binds to. A test that needs an empty `users` table must delete that row
 * explicitly rather than skip the migration.
 */
export async function resetSchema(): Promise<void> {
  await dropEverything();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

/**
 * Foreign keys are enforced on the D1 test binding, so a table cannot be
 * dropped while a surviving table still references it. Rather than encode a
 * dependency order (another hand-maintained list that would drift), drop what
 * succeeds and retry the rest: each pass frees at least one referent until
 * nothing is left.
 */
async function dropEverything(): Promise<void> {
  let remaining = await userTables();
  while (remaining.length > 0) {
    const failed: string[] = [];
    for (const table of remaining) {
      try {
        await env.DB.prepare(`DROP TABLE "${table}"`).run();
      } catch {
        failed.push(table);
      }
    }
    if (failed.length === remaining.length) {
      throw new Error(`could not drop test tables: ${failed.join(", ")}`);
    }
    remaining = failed;
  }
}

/** Everything `api/migrations` defines, as a shape to hold the live DB against. */
export interface ExpectedSchema {
  /** table name -> column names, in declaration order */
  columns: Map<string, string[]>;
  /** index name -> the table it is declared on */
  indexes: Map<string, string>;
  /** table name -> `column->referenced_table` for each declared foreign key */
  foreignKeys: Map<string, Set<string>>;
}

/**
 * Reads the migration SQL — not the database — for what production's schema is
 * supposed to contain. Held against the live test DB by `schemaDrift`, this is
 * what makes a test that quietly builds its own tables fail instead of passing
 * against a schema production does not have.
 */
export function expectedSchema(): ExpectedSchema {
  const columns = new Map<string, string[]>();
  const indexes = new Map<string, string>();
  const foreignKeys = new Map<string, Set<string>>();
  for (const migration of env.TEST_MIGRATIONS) {
    for (const query of migration.queries) {
      const create = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)["`\]]?\s*\(/i.exec(
        query,
      );
      if (create) {
        const parsed = parseTableBody(query.slice(create[0].length));
        columns.set(create[1], parsed.columns);
        foreignKeys.set(create[1], parsed.foreignKeys);
        continue;
      }
      const addColumn =
        /^\s*ALTER\s+TABLE\s+["`[]?(\w+)["`\]]?\s+ADD\s+(?:COLUMN\s+)?["`[]?(\w+)["`\]]?([\s\S]*)$/i.exec(
          query,
        );
      if (addColumn) {
        const [, table, column, rest] = addColumn;
        columns.get(table)?.push(column);
        const ref = /\bREFERENCES\s+["`[]?(\w+)["`\]]?/i.exec(rest);
        if (ref) foreignKeys.get(table)?.add(`${column}->${ref[1]}`);
        continue;
      }
      const index =
        /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)["`\]]?\s+ON\s+["`[]?(\w+)["`\]]?/i.exec(
          query,
        );
      if (index) indexes.set(index[1], index[2]);
    }
  }
  return { columns, indexes, foreignKeys };
}

/**
 * Everything the migrations define that the live test database is missing, as
 * `table`, `table.column`, `index`, and `table.column->referenced_table` names.
 * Empty means no drift.
 */
export async function schemaDrift(): Promise<string[]> {
  const expected = expectedSchema();
  const missing: string[] = [];
  const present = new Set(await userTables());
  for (const [table, wanted] of expected.columns) {
    if (!present.has(table)) {
      missing.push(table);
      continue;
    }
    const info = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
    const actual = new Set(info.results.map((c) => c.name));
    for (const column of wanted) if (!actual.has(column)) missing.push(`${table}.${column}`);

    const fks = await env.DB.prepare(`PRAGMA foreign_key_list("${table}")`).all<{
      from: string;
      table: string;
    }>();
    const actualFks = new Set(fks.results.map((r) => `${r.from}->${r.table}`));
    for (const fk of expected.foreignKeys.get(table) ?? []) {
      if (!actualFks.has(fk)) missing.push(`${table}.${fk}`);
    }
  }
  const liveIndexes = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
  ).all<{ name: string }>();
  const actualIndexes = new Set(liveIndexes.results.map((r) => r.name));
  for (const [index, table] of expected.indexes) {
    if (present.has(table) && !actualIndexes.has(index)) missing.push(index);
  }
  return missing;
}

/**
 * Column names and foreign keys from a CREATE TABLE body. Table constraints
 * (`PRIMARY KEY (a, b)`, `FOREIGN KEY`, `CHECK`, ...) are entries in the same
 * comma-separated list as columns and are dropped by keyword; nested parens are
 * why the split cannot be `body.split(",")`.
 */
function parseTableBody(body: string): { columns: string[]; foreignKeys: Set<string> } {
  const columns: string[] = [];
  const foreignKeys = new Set<string>();
  let depth = 0;
  let item = "";
  const take = () => {
    const parsed = parseTableBodyItem(item);
    if (parsed) {
      columns.push(parsed.column);
      if (parsed.references) foreignKeys.add(`${parsed.column}->${parsed.references}`);
    }
    item = "";
  };
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    else if (ch === ")") break; // closes the CREATE TABLE body
    if (depth === 0 && ch === ",") take();
    else item += ch;
  }
  take();
  return { columns, foreignKeys };
}

function parseTableBodyItem(item: string): { column: string; references?: string } | null {
  const CONSTRAINTS = /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i;
  const column = item.trim().split(/[\s(]+/)[0]?.replace(/^["`[]|["`\]]$/g, "");
  if (!column || CONSTRAINTS.test(column)) return null;
  const ref = /\bREFERENCES\s+["`[]?(\w+)["`\]]?/i.exec(item);
  return ref ? { column, references: ref[1] } : { column };
}

async function userTables(): Promise<string[]> {
  // sqlite_sequence is owned by SQLite (locate_log.id is AUTOINCREMENT) and is
  // not droppable; _cf_* are D1's own bookkeeping.
  const res = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'`,
  ).all<{ name: string }>();
  return res.results.map((r) => r.name);
}
