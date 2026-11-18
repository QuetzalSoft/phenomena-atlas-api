import { err, ok, type Result } from "neverthrow";
import type { Characteristic, PhenomenonStatus } from "../../phenomenon/phenomenon.public.js";
import {
  CategoryOptionRetiredError,
  CharacteristicRetiredError,
  type IncidentReportRejectedError,
  InvalidCharacteristicValueError,
  MissingCharacteristicValueError,
  NumberOutOfRangeError,
  OccurredInFutureError,
  PhenomenonNotAcceptingReportsError,
  TextTooLongError,
  UnknownCategoryOptionError,
  UnknownCharacteristicError,
} from "./incident-report.errors.js";

/** A number, a yes/no, or a string: an option key, a text or a YYYY-MM-DD date, by characteristic type. */
export type CharacteristicValue = number | boolean | string;

/** What a person states when filing a report. ADR 0013: a region and a day, never a point or a time. */
export interface IncidentReportDraft {
  regionId: number;
  /** YYYY-MM-DD, already a valid calendar date: the contract checks it. */
  occurredOn: string;
  /** Optional, so a report can be filed with no free text at all (ADR 0013). */
  description: string | undefined;
  values: Record<string, CharacteristicValue>;
}

/** What filing needs to know about the phenomenon a report is about. */
export interface ReportedPhenomenon {
  status: PhenomenonStatus;
  characteristics: readonly Characteristic[];
}

/**
 * Checks a report against its phenomenon. `today` is the date in the metropolitan area, as
 * YYYY-MM-DD. Whether the region is current is the caller's to check, against the partition.
 */
export function checkIncidentReport(
  draft: IncidentReportDraft,
  phenomenon: ReportedPhenomenon,
  today: string,
): Result<void, IncidentReportRejectedError | PhenomenonNotAcceptingReportsError> {
  if (phenomenon.status !== "published") {
    return err(new PhenomenonNotAcceptingReportsError());
  }
  // Both are YYYY-MM-DD, so comparing the text compares the dates.
  if (draft.occurredOn > today) {
    return err(new OccurredInFutureError());
  }
  return checkReportValues(phenomenon.characteristics, draft.values);
}

/**
 * Checks a report's values against the characteristics of its phenomenon: every required
 * active one has a value, and every value belongs to an active characteristic and matches
 * its type and settings. ADR 0012 and ADR 0013.
 */
export function checkReportValues(
  characteristics: readonly Characteristic[],
  values: Readonly<Record<string, CharacteristicValue>>,
): Result<void, IncidentReportRejectedError> {
  const byKey = new Map(characteristics.map((characteristic) => [characteristic.key, characteristic]));

  for (const [key, value] of Object.entries(values)) {
    const path = `/values/${escapePointer(key)}`;
    const characteristic = byKey.get(key);
    if (!characteristic) {
      return err(new UnknownCharacteristicError(path, key));
    }
    if (characteristic.retired) {
      return err(new CharacteristicRetiredError(path, key));
    }
    const checked = checkValue(characteristic, value, path);
    if (checked.isErr()) {
      return checked;
    }
  }

  const missing = characteristics.find((characteristic) => characteristic.required && !characteristic.retired && !Object.hasOwn(values, characteristic.key));
  if (missing) {
    return err(new MissingCharacteristicValueError(`/values/${missing.key}`, missing.key));
  }
  return ok(undefined);
}

function checkValue(characteristic: Characteristic, value: CharacteristicValue, path: string): Result<void, IncidentReportRejectedError> {
  const { key } = characteristic;
  switch (characteristic.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return err(new InvalidCharacteristicValueError(path, key, "a number"));
      }
      if (characteristic.integer && !Number.isInteger(value)) {
        return err(new InvalidCharacteristicValueError(path, key, "a whole number"));
      }
      if (
        (characteristic.minimum !== undefined && value < characteristic.minimum) ||
        (characteristic.maximum !== undefined && value > characteristic.maximum)
      ) {
        return err(new NumberOutOfRangeError(path, key));
      }
      return ok(undefined);
    }
    case "boolean":
      return typeof value === "boolean" ? ok(undefined) : err(new InvalidCharacteristicValueError(path, key, "true or false"));
    case "category": {
      if (typeof value !== "string") {
        return err(new InvalidCharacteristicValueError(path, key, "the key of one of its options"));
      }
      const option = characteristic.options.find((candidate) => candidate.key === value);
      if (!option) {
        return err(new UnknownCategoryOptionError(path, key));
      }
      return option.retired ? err(new CategoryOptionRetiredError(path, key)) : ok(undefined);
    }
    case "text": {
      if (typeof value !== "string" || value.trim() === "") {
        return err(new InvalidCharacteristicValueError(path, key, "a text that is not empty"));
      }
      // Counted in code points, as the contract's maxLength is.
      return [...value].length > characteristic.maxLength ? err(new TextTooLongError(path, key, characteristic.maxLength)) : ok(undefined);
    }
    case "date":
      return typeof value === "string" && isCalendarDate(value)
        ? ok(undefined)
        : err(new InvalidCharacteristicValueError(path, key, "a date written YYYY-MM-DD"));
  }
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A key as one JSON Pointer segment (RFC 6901). Characteristic keys need no escaping, unknown ones might. */
function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
