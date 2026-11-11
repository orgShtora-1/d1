import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  D1SessionBookmark,
  D1SessionConstraint,
} from "@cloudflare/workers-types";

/**
 * Values supported by D1 statement binding. D1 converts booleans to integers;
 * `undefined` and `BigInt` are rejected by D1 and excluded here.
 */
export type D1BindValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;

interface D1Executor {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1Queryable {
  /**
   * Runs a query and returns the native `D1Result` (`results` plus `meta`).
   * The row type `T` is a caller assertion; no runtime validation happens.
   */
  all<T = Record<string, unknown>>(
    sql: string,
    ...values: D1BindValue[]
  ): Promise<D1Result<T>>;
  /** Runs a query and returns the first row, or `null` when there is none. */
  first<T = Record<string, unknown>>(
    sql: string,
    ...values: D1BindValue[]
  ): Promise<T | null>;
  /**
   * Runs a statement for its side effects. Returns the native `D1Result`
   * with `meta` (`changes`, `last_row_id`, ...) untouched.
   */
  run<T = Record<string, unknown>>(
    sql: string,
    ...values: D1BindValue[]
  ): Promise<D1Result<T>>;
  /**
   * Prepares and binds a statement without executing it, for later use in
   * {@link D1Queryable.batch}. Values travel as bind parameters, never as
   * SQL text.
   */
  statement(sql: string, ...values: D1BindValue[]): D1PreparedStatement;
  /**
   * Executes statements from this same binding/session in one round trip.
   * D1 runs the batch as a single transaction: if any statement fails, the
   * whole batch is rolled back and the error propagates. This is not an
   * interactive transaction API; this wrapper adds no retry policy.
   */
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
}

/** Thin, stateless wrapper over a `D1Database` binding. */
export interface D1Client extends D1Queryable {
  /**
   * Creates a sequentially-consistent session (D1 read replication).
   *
   * - Omitted or `"first-unconstrained"`: the first query may hit any
   *   replica; later queries stay consistent with the session bookmark.
   * - `"first-primary"`: the first query hits the primary.
   * - A bookmark string: the session starts at least as fresh as that
   *   bookmark (e.g. from a cookie in the previous request).
   *
   * Requires read replication enabled on the database; without it every
   * query goes to the primary and the session still works.
   */
  withSession(
    constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint,
  ): D1Session;
}

/** Session view created by {@link D1Client.withSession}. */
export interface D1Session extends D1Queryable {
  /**
   * Latest bookmark seen by this session, or `null` if no query has run
   * yet. Store it (e.g. in a cookie) to resume consistency in a later
   * request.
   */
  getBookmark(): D1SessionBookmark | null;
}

function prepareStatement(
  executor: D1Executor,
  sql: string,
  values: D1BindValue[],
): D1PreparedStatement {
  const statement = executor.prepare(sql);
  return values.length > 0 ? statement.bind(...values) : statement;
}

function queryable(executor: D1Executor): D1Queryable {
  return {
    statement(sql: string, ...values: D1BindValue[]): D1PreparedStatement {
      return prepareStatement(executor, sql, values);
    },

    all<T = Record<string, unknown>>(
      sql: string,
      ...values: D1BindValue[]
    ): Promise<D1Result<T>> {
      return prepareStatement(executor, sql, values).all<T>();
    },

    first<T = Record<string, unknown>>(
      sql: string,
      ...values: D1BindValue[]
    ): Promise<T | null> {
      return prepareStatement(executor, sql, values).first<T>();
    },

    run<T = Record<string, unknown>>(
      sql: string,
      ...values: D1BindValue[]
    ): Promise<D1Result<T>> {
      return prepareStatement(executor, sql, values).run<T>();
    },

    batch<T = Record<string, unknown>>(
      statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> {
      return executor.batch<T>(statements);
    },
  };
}

/**
 * Wraps a Cloudflare D1 binding with a smaller, prepared-by-default API.
 *
 * No database I/O happens here, and prepared statements are not cached.
 * Create the wrapper where the request's binding is available. D1 results,
 * errors, and metadata pass through unchanged; the wrapper adds no retry policy.
 *
 * ```ts
 * const db = createD1(env.DB);
 * const user = await db.first<User>("SELECT * FROM users WHERE id = ?", id);
 * ```
 */
export function createD1(binding: D1Database): D1Client {
  return {
    ...queryable(binding),

    withSession(
      constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint,
    ): D1Session {
      const session = binding.withSession(constraintOrBookmark);
      return {
        ...queryable(session),
        getBookmark: () => session.getBookmark(),
      };
    },
  };
}
