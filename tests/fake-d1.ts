import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

export interface RecordedCall {
  sql: string;
  values: unknown[];
  method: "all" | "first";
}

class FakeStatement {
  private values: unknown[] = [];

  constructor(
    private readonly executor: FakeExecutor,
    readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    this.executor.record(this.sql, this.values, "all");
    if (this.executor.fail) throw this.executor.fail;
    throw new Error("Successful queries are covered by the Miniflare integration tests.");
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.executor.record(this.sql, this.values, "first");
    if (this.executor.fail) throw this.executor.fail;
    return null;
  }
}

class FakeExecutor {
  readonly calls: RecordedCall[] = [];
  batchCount = 0;
  fail: Error | null = null;

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  record(sql: string, values: unknown[], method: RecordedCall["method"]): void {
    this.calls.push({ sql, values: [...values], method });
  }

  async batch<T>(_statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.batchCount += 1;
    if (this.fail) throw this.fail;
    throw new Error("Successful batches are covered by the Miniflare integration tests.");
  }
}

export class FakeD1 extends FakeExecutor {
  /** Test seam for satisfying the official binding type with a recording fake. */
  asBinding(): D1Database {
    return this as unknown as D1Database;
  }
}
