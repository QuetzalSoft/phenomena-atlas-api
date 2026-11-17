import { err, ok, type Result } from "neverthrow";

/**
 * Where a page of reports ends: the last report's filing time and id. The time is kept as
 * PostgreSQL renders it, to the microsecond. A JavaScript Date stops at milliseconds, and a
 * cursor rounded to them would skip or repeat reports filed in the same millisecond.
 */
export interface ReportCursor {
  createdAt: string;
  id: number;
}

export class InvalidCursorError extends Error {
  readonly code = "invalid_cursor";

  constructor() {
    super("The cursor is not one this API returned.");
  }
}

const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Opaque to clients, so its format can change without changing the contract. */
export function encodeCursor(cursor: ReportCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id])).toString("base64url");
}

export function decodeCursor(value: string): Result<ReportCursor, InvalidCursorError> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === 2) {
      const [createdAt, id] = decoded as unknown[];
      if (typeof createdAt === "string" && timestamp.test(createdAt) && Number.isSafeInteger(id) && (id as number) > 0) {
        return ok({ createdAt, id: id as number });
      }
    }
  } catch {
    // Not base64url JSON: falls through to the error below.
  }
  return err(new InvalidCursorError());
}
