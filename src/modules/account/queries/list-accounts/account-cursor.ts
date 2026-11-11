import { err, ok, type Result } from "neverthrow";

/**
 * Where a page of accounts ends: the last account's creation time and id. The time is kept
 * as PostgreSQL renders it, to the microsecond. A JavaScript Date stops at milliseconds, and
 * a cursor rounded down to them would repeat the last account on the next page.
 */
export interface AccountCursor {
  createdAt: string;
  id: string;
}

export class InvalidCursorError extends Error {
  readonly code = "invalid_cursor";

  constructor() {
    super("The cursor is not one this API returned.");
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Opaque to clients, so its format can change without changing the contract. */
export function encodeCursor(cursor: AccountCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString("base64url");
}

export function decodeCursor(value: string): Result<AccountCursor, InvalidCursorError> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === 2) {
      const [createdAt, id] = decoded as unknown[];
      if (typeof createdAt === "string" && timestamp.test(createdAt) && typeof id === "string" && uuid.test(id)) {
        return ok({ createdAt, id });
      }
    }
  } catch {
    // Not base64url JSON: falls through to the error below.
  }
  return err(new InvalidCursorError());
}
