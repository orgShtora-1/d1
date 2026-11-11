import { describe, expect, test } from "bun:test";
import { createD1 } from "../src/client.js";
import { FakeD1 } from "./fake-d1.js";

describe("createD1", () => {
  test("construction does not perform database work", () => {
    const fake = new FakeD1();
    createD1(fake.asBinding());
    expect(fake.calls).toEqual([]);
    expect(fake.batchCount).toBe(0);
  });

  test("SQL is unchanged and injection-shaped values remain bound values", async () => {
    const fake = new FakeD1();
    const db = createD1(fake.asBinding());
    const input = "Robert'); DROP TABLE users;--";
    const sql = "SELECT id FROM users WHERE name = ? AND email = ?";

    await db.first(sql, input, "O'Reilly@example.com");

    expect(fake.calls).toEqual([{
      sql,
      values: [input, "O'Reilly@example.com"],
      method: "first",
    }]);
  });

  test("D1 binding errors pass through unchanged without wrapper retries", async () => {
    const fake = new FakeD1();
    const db = createD1(fake.asBinding());
    const error = new Error("D1_ERROR: no such table");
    fake.fail = error;

    await expect(db.all("SELECT * FROM missing")).rejects.toBe(error);
    expect(fake.calls).toHaveLength(1);

    await expect(db.batch([db.statement("INSERT INTO t VALUES (?)", 1)])).rejects.toBe(error);
    expect(fake.batchCount).toBe(1);
  });
});
