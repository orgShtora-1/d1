# @shtora/d1

A small ESM TypeScript client for Cloudflare D1. It wraps prepared statements with `all`, `first`, `run`, ordered `batch`, and session helpers while keeping SQL, bindings, native results, and errors visible. No ORM or runtime dependencies.

**0.1.0, pre-release.** The package is not published to npm. The install commands below describe use after release.

## Installation

```sh
npm install @shtora/d1
# or
pnpm add @shtora/d1
yarn add @shtora/d1
bun add @shtora/d1
```

Choose one package manager. The consuming Workers project needs `@cloudflare/workers-types` `^5.20261110.1`; the package declares it as a peer dependency. There is no CommonJS build.

## D1 setup

Create a remote database and bind it as `DB` in `wrangler.jsonc`:

```sh
npx wrangler d1 create notes
```

Replace `<database-id>` with the ID returned by Wrangler:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "notes-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-10",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "notes",
      "database_id": "<database-id>",
      "migrations_dir": "migrations"
    }
  ]
}
```

Create `migrations/0001_create_notes.sql`:

```sql
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notes_created_at_idx
  ON notes (created_at DESC);
```

Apply the migration with `npx wrangler d1 migrations apply notes --remote`.

## Quick start

The Worker below lists notes and inserts a note from a JSON request:

```ts
import { createD1 } from "@shtora/d1";
import type { D1Database } from "@cloudflare/workers-types";

interface Note {
  id: number;
  body: string;
  created_at: number;
}

export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const db = createD1(env.DB);

    if (request.method === "GET") {
      const { results } = await db.all<Note>(
        "SELECT id, body, created_at FROM notes ORDER BY created_at DESC LIMIT 50",
      );
      return Response.json(results);
    }

    if (request.method === "POST") {
      const input: unknown = await request.json();
      if (typeof input !== "object" || input === null || !("body" in input) || typeof input.body !== "string") {
        return Response.json({ error: "Field 'body' must be a string." }, { status: 400 });
      }

      const { results } = await db.run<Note>(
        "INSERT INTO notes (body, created_at) VALUES (?, ?) RETURNING id, body, created_at",
        input.body,
        Date.now(),
      );
      return Response.json(results[0], { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
```

`createD1()` is synchronous. It performs no database I/O, creates no global state, and does not cache prepared statements.

## Public surface

| Method | Return value | Behavior |
| --- | --- | --- |
| `all<T>(sql, ...values)` | `Promise<D1Result<T>>` | All rows and native D1 metadata. |
| `first<T>(sql, ...values)` | `Promise<T \| null>` | First row or `null`. |
| `run<T>(sql, ...values)` | `Promise<D1Result<T>>` | Native result, including `results` and `meta`. |
| `statement(sql, ...values)` | `D1PreparedStatement` | Prepares and returns a native statement; binds supplied values. |
| `batch<T>(statements)` | `Promise<D1Result<T>[]>` | Runs statements in one D1 batch and preserves their order. |
| `withSession(bookmark?)` | `D1Session` | Creates a D1 session for sequential consistency and replica routing. |
| `session.getBookmark()` | `D1SessionBookmark \| null` | Latest bookmark, or `null` before a query. |

## Batch

Prepare statements through the same client or session, then pass them to `batch()`:

```ts
const results = await db.batch([
  db.statement("INSERT INTO audit_log (action) VALUES (?)", "user-created"),
  db.statement("UPDATE counters SET value = value + 1 WHERE name = ?", "users"),
]);
```

D1 executes a batch as a transaction. A failed statement rolls back the batch and propagates its error. Batches are not interactive `transaction(callback)` APIs, and D1's per-statement and binding limits still apply.

## Sessions and bookmarks

```ts
const session = db.withSession(bookmark ?? "first-unconstrained");
const user = await session.first<User>(
  "SELECT id, email FROM users WHERE id = ?",
  userId,
);
const nextBookmark = session.getBookmark();
```

`"first-unconstrained"` allows the first query to use any available instance; `"first-primary"` sends the first query to the primary. Later queries in the session are sequentially consistent. Read replicas must be enabled for replica routing; sessions also work without them. Store a bookmark if a later request must be at least as fresh, and validate bookmarks supplied by clients according to your application's trust model. See [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

## Behavior and limits

- The `T` row type is a caller assertion. It does not infer a schema or validate returned values at runtime.
- `D1BindValue` accepts `string`, `number`, `boolean`, `null`, `ArrayBuffer`, and `ArrayBufferView`. D1 stores booleans as integers; `undefined` and `BigInt` are not supported. Bind values with `?` placeholders. SQL identifiers cannot be bound as values; use a fixed allowlist when they vary.
- `all()` and `run()` preserve D1's returned metadata, including counters such as `rows_read` and `total_attempts` when present. `first()` returns a row or `null`. The package does not collect telemetry. See [D1 result metadata](https://developers.cloudflare.com/d1/worker-api/return-object/).
- The wrapper adds no retry layer. Cloudflare D1 automatically retries eligible read-only queries up to two additional times for retryable errors ([retry behavior](https://developers.cloudflare.com/d1/best-practices/retry-queries/)).
- D1 binding calls do not accept a per-call timeout or `AbortSignal`. `Promise.race` can stop your code from waiting, but it cannot cancel the query; a timed-out write may still commit. Check the outcome before retrying ([Cloudflare guidance](https://developers.cloudflare.com/d1/observability/debug-d1/#d1-binding-timeout-behavior)).
- Use the original `env.DB` binding for native D1 features not listed here.

## License

MIT. See [LICENSE](LICENSE).
