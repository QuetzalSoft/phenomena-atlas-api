import { err, ok, type Result } from "neverthrow";

export class InvalidVersionCursorError extends Error {
  readonly code = "invalid_cursor";

  constructor() {
    super("The cursor is not one this API returned.");
  }
}

/** Where a page of versions ends: the last version's number. Opaque to clients. */
export function encodeVersionCursor(number: number): string {
  return Buffer.from(JSON.stringify([number])).toString("base64url");
}

export function decodeVersionCursor(value: string): Result<number, InvalidVersionCursorError> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Array.isArray(decoded) && decoded.length === 1 && Number.isInteger(decoded[0]) && (decoded[0] as number) >= 1) {
      return ok(decoded[0] as number);
    }
  } catch {
    // Not base64url JSON: falls through to the error below.
  }
  return err(new InvalidVersionCursorError());
}
