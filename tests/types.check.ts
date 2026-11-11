import { createD1 } from "../src/client.js";
import type { D1BindValue, D1Client, D1Session } from "../src/client.js";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1SessionBookmark,
} from "@cloudflare/workers-types";

interface User {
  id: number;
  email: string;
}

// A real Workers binding must be accepted without a cast.
function acceptsOfficialBinding(binding: D1Database): D1Client {
  return createD1(binding);
}

async function checksResultTypes(binding: D1Database): Promise<void> {
  const client = createD1(binding);
  const all: D1Result<User> = await client.all<User>("SELECT id, email FROM users");
  const emails: string[] = all.results.map((user) => user.email);
  const rowsRead: number = all.meta.rows_read;
  const one: User | null = await client.first<User>("SELECT id, email FROM users LIMIT 1");
  const run: D1Result<Record<string, unknown>> = await client.run("DELETE FROM users");
  const changes: number = run.meta.changes;
  const statements: D1PreparedStatement[] = [
    client.statement("INSERT INTO users (email) VALUES (?)", "user@example.com"),
  ];
  const batch: D1Result<User>[] = await client.batch<User>(statements);
  const session: D1Session = client.withSession("first-primary");
  const bookmark: D1SessionBookmark | null = session.getBookmark();
  const resumed = client.withSession(bookmark ?? "first-unconstrained");

  void [emails, rowsRead, one, changes, batch, resumed];
}

function checksBindValues(binding: D1Database): void {
  const client = createD1(binding);
  const allowed: D1BindValue[] = [null, true, 1, "text", new Uint8Array([1]), new ArrayBuffer(4)];
  client.run("INSERT INTO values_table (value) VALUES (?)", ...allowed);

  // @ts-expect-error D1 cannot bind undefined.
  client.all("SELECT ?", undefined);
  // @ts-expect-error D1 cannot bind BigInt.
  client.all("SELECT ?", 1n);
}

const bindingCompatibility: (binding: D1Database) => D1Client = acceptsOfficialBinding;
void [checksResultTypes, checksBindValues, bindingCompatibility];
