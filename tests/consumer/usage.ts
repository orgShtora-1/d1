import { createD1 } from "@shtora/d1";
import type {
  D1BindValue,
  D1Client,
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1Session,
  D1SessionBookmark,
} from "@shtora/d1";

interface User {
  id: number;
  email: string;
}

declare const binding: D1Database;
const client: D1Client = createD1(binding);
const all: Promise<D1Result<User>> = client.all<User>(
  "SELECT id, email FROM users WHERE id = ?",
  1,
);
const first: Promise<User | null> = client.first<User>(
  "SELECT id, email FROM users WHERE id = ?",
  1,
);
const run: Promise<D1Result<Record<string, unknown>>> = client.run(
  "DELETE FROM users WHERE id = ?",
  1,
);
const statement: D1PreparedStatement = client.statement(
  "INSERT INTO users (email) VALUES (?)",
  "user@example.com",
);
const batch: Promise<D1Result<User>[]> = client.batch<User>([statement]);
const session: D1Session = client.withSession("first-primary");
const bookmark: D1SessionBookmark | null = session.getBookmark();
const resumed: D1Session = client.withSession(bookmark ?? "first-unconstrained");
const bindValues: D1BindValue[] = [
  null,
  true,
  1,
  "text",
  new Uint8Array([1]),
  new ArrayBuffer(4),
];
client.run("INSERT INTO values_table (value) VALUES (?)", ...bindValues);

// @ts-expect-error D1 does not accept undefined bind values.
client.all("SELECT ?", undefined);
// @ts-expect-error D1 does not accept BigInt bind values.
client.all("SELECT ?", 1n);

void [all, first, run, batch, resumed];
