/** Where in the request body a report breaks a rule, as a JSON Pointer, and the characteristic key involved if any. */
export interface ReportErrorDetails {
  path: string;
  key?: string;
}

/** An incident report the rules refuse. Every subclass has a stable code. */
export abstract class IncidentReportRejectedError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: ReportErrorDetails,
  ) {
    super(message);
  }
}

export class RegionNotFoundError extends IncidentReportRejectedError {
  readonly code = "region_not_found";

  constructor() {
    super("The region is not part of the current partition.", { path: "/regionId" });
  }
}

export class OccurredInFutureError extends IncidentReportRejectedError {
  readonly code = "occurred_in_future";

  constructor() {
    super("The incident cannot have taken place after today.", { path: "/occurredOn" });
  }
}

export class MissingCharacteristicValueError extends IncidentReportRejectedError {
  readonly code = "missing_characteristic_value";

  constructor(path: string, key: string) {
    super(`The characteristic "${key}" is required.`, { path, key });
  }
}

export class UnknownCharacteristicError extends IncidentReportRejectedError {
  readonly code = "unknown_characteristic";

  constructor(path: string, key: string) {
    super(`No characteristic of the phenomenon has the key "${key}".`, { path, key });
  }
}

export class CharacteristicRetiredError extends IncidentReportRejectedError {
  readonly code = "characteristic_retired";

  constructor(path: string, key: string) {
    super(`The characteristic "${key}" is retired and takes no new values.`, { path, key });
  }
}

export class InvalidCharacteristicValueError extends IncidentReportRejectedError {
  readonly code = "invalid_characteristic_value";

  constructor(path: string, key: string, expected: string) {
    super(`The value of "${key}" must be ${expected}.`, { path, key });
  }
}

export class NumberOutOfRangeError extends IncidentReportRejectedError {
  readonly code = "number_out_of_range";

  constructor(path: string, key: string) {
    super(`The value of "${key}" is outside the characteristic's limits.`, { path, key });
  }
}

export class TextTooLongError extends IncidentReportRejectedError {
  readonly code = "text_too_long";

  constructor(path: string, key: string, maxLength: number) {
    super(`The value of "${key}" is longer than ${maxLength} characters.`, { path, key });
  }
}

export class UnknownCategoryOptionError extends IncidentReportRejectedError {
  readonly code = "unknown_category_option";

  constructor(path: string, key: string) {
    super(`No option of "${key}" has that key.`, { path, key });
  }
}

export class CategoryOptionRetiredError extends IncidentReportRejectedError {
  readonly code = "category_option_retired";

  constructor(path: string, key: string) {
    super(`That option of "${key}" is retired and takes no new reports.`, { path, key });
  }
}

export class PhenomenonNotAcceptingReportsError extends Error {
  readonly code = "phenomenon_not_accepting_reports";

  constructor() {
    super("Only a published phenomenon accepts incident reports.");
  }
}

export class IncidentReportNotFoundError extends Error {
  readonly code = "incident_report_not_found";

  constructor() {
    super("There is no incident report with that id.");
  }
}
