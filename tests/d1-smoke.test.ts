import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";
import type { D1Database } from "@cloudflare/workers-types";
import { createD1 } from "../src/client.js";

interface Note {
  id: number;
  body: string;
}

const miniflare = new Miniflare({
  modules: true,
  script: "export default {};",
  d1Databases: { DB: "shtora-d1-smoke" },
});
let binding: D1Database;
let db: ReturnType<typeof createD1>;

beforeAll(async () => {
  binding = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  db = createD1(binding);
});

beforeEach(async () => {
  await binding.exec("DROP TABLE IF EXISTS notes");
  await binding.exec(
    "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)",
  );
  await db.run("INSERT INTO notes (body) VALUES (?)", "first note 'quoted'");
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("Cloudflare D1 integration", () => {
  test("executes prepared queries and preserves native result metadata", async () => {
    const inserted = await db.run<Note>(
      "INSERT INTO notes (body) VALUES (?) RETURNING id, body",
      "inserted note 'quoted'",
    );
    expect(inserted.meta.changes).toBe(1);
    expect(inserted.meta.last_row_id).toBe(2);
    expect(inserted.results).toEqual([{ id: 2, body: "inserted note 'quoted'" }]);

    const injectionInput = "Robert'); DROP TABLE notes;--";
    const injectionResult = await db.run<Note>(
      "INSERT INTO notes (body) VALUES (?) RETURNING id, body",
      injectionInput,
    );
    expect(injectionResult.results).toEqual([{ id: 3, body: injectionInput }]);

    const found = await db.first<Note>("SELECT id, body FROM notes WHERE id = ?", 1);
    expect(found).toEqual({ id: 1, body: "first note 'quoted'" });
    expect(await db.first<Note>("SELECT id, body FROM notes WHERE id = ?", 404)).toBeNull();
    expect((await db.all<Note>("SELECT id FROM notes WHERE id = ?", 404)).results).toEqual([]);
    const active = await db.first<{ active: number }>("SELECT ? AS active", true);
    expect(active?.active).toBe(1);

    const all = await db.all<Note>("SELECT id, body FROM notes ORDER BY id");
    expect(all.results).toEqual([
      { id: 1, body: "first note 'quoted'" },
      { id: 2, body: "inserted note 'quoted'" },
      { id: 3, body: injectionInput },
    ]);
    expect(all.meta.rows_read).toBeGreaterThanOrEqual(1);
    const rawRows = await db
      .statement("SELECT body FROM notes WHERE id = ?", 1)
      .raw();
    expect(rawRows).toEqual([["first note 'quoted'"]]);
  }, 30_000);

  test("batch executes statements in order and rolls back on failure", async () => {
    const results = await db.batch([
      db.statement("INSERT INTO notes (body) VALUES (?)", "second"),
      db.statement("INSERT INTO notes (body) VALUES (?)", "third"),
    ]);
    expect(results).toHaveLength(2);

    await expect(db.batch([
      db.statement("INSERT INTO notes (body) VALUES (?)", "must roll back"),
      db.statement("INSERT INTO notes (body) VALUES (?)", null),
    ])).rejects.toBeTruthy();

    const rows = await db.all<Note>("SELECT id, body FROM notes ORDER BY id");
    expect(rows.results.map((row) => row.body)).toEqual([
      "first note 'quoted'",
      "second",
      "third",
    ]);
  }, 30_000);

  test("sessions expose bookmarks and run queries with and without a constraint", async () => {
    const session = db.withSession("first-primary");
    expect(session.getBookmark()).toBeNull();
    expect(await session.first<Note>("SELECT id, body FROM notes WHERE id = ?", 1)).toEqual({
      id: 1,
      body: "first note 'quoted'",
    });
    const bookmark = session.getBookmark();
    expect(bookmark === null || typeof bookmark === "string").toBe(true);

    const unconstrainedSession = db.withSession();
    expect(await unconstrainedSession.first<Note>("SELECT id, body FROM notes WHERE id = ?", 1)).toEqual({
      id: 1,
      body: "first note 'quoted'",
    });
  }, 30_000);
});
