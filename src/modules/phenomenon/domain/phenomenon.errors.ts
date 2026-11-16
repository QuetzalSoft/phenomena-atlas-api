/** Where in the request body a definition breaks a rule, as a JSON Pointer, and the key involved if any. */
export interface DefinitionErrorDetails {
  path: string;
  key?: string;
}

/** A phenomenon definition the rules refuse. Every subclass has a stable code. */
export abstract class PhenomenonDefinitionError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: DefinitionErrorDetails,
  ) {
    super(message);
  }
}

export class DuplicateCharacteristicKeyError extends PhenomenonDefinitionError {
  readonly code = "duplicate_characteristic_key";

  constructor(path: string, key: string) {
    super(`Two characteristics have the key "${key}".`, { path, key });
  }
}

export class DuplicateCategoryOptionKeyError extends PhenomenonDefinitionError {
  readonly code = "duplicate_category_option_key";

  constructor(path: string, key: string) {
    super(`Two options of the category have the key "${key}".`, { path, key });
  }
}

export class CategoryWithoutOptionsError extends PhenomenonDefinitionError {
  readonly code = "category_without_options";

  constructor(path: string, key: string) {
    super(`Every option of the category "${key}" is retired.`, { path, key });
  }
}

export class InvalidNumberRangeError extends PhenomenonDefinitionError {
  readonly code = "invalid_number_range";

  constructor(path: string, key: string) {
    super(`The minimum of "${key}" is greater than its maximum.`, { path, key });
  }
}

export class CharacteristicRemovedError extends PhenomenonDefinitionError {
  readonly code = "characteristic_removed";

  constructor(key: string) {
    super(`The saved characteristic "${key}" is missing. Retire it instead of removing it.`, {
      path: "/characteristics",
      key,
    });
  }
}

export class CategoryOptionRemovedError extends PhenomenonDefinitionError {
  readonly code = "category_option_removed";

  constructor(path: string, key: string) {
    super(`The saved option "${key}" is missing. Retire it instead of removing it.`, { path, key });
  }
}

export class CharacteristicTypeChangedError extends PhenomenonDefinitionError {
  readonly code = "characteristic_type_changed";

  constructor(path: string, key: string) {
    super(`The type of the saved characteristic "${key}" cannot change.`, { path, key });
  }
}

export class UnknownCharacteristicError extends PhenomenonDefinitionError {
  readonly code = "unknown_characteristic";

  constructor(path: string, key: string) {
    super(`No characteristic has the key "${key}".`, { path, key });
  }
}

export class CharacteristicRetiredError extends PhenomenonDefinitionError {
  readonly code = "characteristic_retired";

  constructor(path: string, key: string) {
    super(`The characteristic "${key}" is retired and cannot be used by the weighting function.`, { path, key });
  }
}

export class CharacteristicNotAggregableError extends PhenomenonDefinitionError {
  readonly code = "characteristic_not_aggregable";

  constructor(path: string, key: string) {
    super(`The characteristic "${key}" is text or a date, which the weighting function cannot use.`, { path, key });
  }
}

export class InvalidAggregateError extends PhenomenonDefinitionError {
  readonly code = "invalid_aggregate";

  constructor(path: string) {
    super("`count` takes no characteristic, and every other aggregate function needs one.", { path });
  }
}

export class WeightingFunctionTooLargeError extends PhenomenonDefinitionError {
  readonly code = "weighting_function_too_large";

  constructor() {
    super("The weighting function has more than 100 nodes or more than 20 levels.", { path: "/weightingFunction" });
  }
}

export class IncompleteWeightingFunctionError extends PhenomenonDefinitionError {
  readonly code = "incomplete_weighting_function";

  constructor(path: string) {
    super("The weighting function has a blank, which only a draft may have.", { path });
  }
}

export class PhenomenonNotFoundError extends Error {
  readonly code = "phenomenon_not_found";

  constructor() {
    super("There is no phenomenon with that id.");
  }
}

export class PhenomenonRevisionConflictError extends Error {
  readonly code = "phenomenon_revision_conflict";

  constructor() {
    super("The phenomenon changed since the revision this change was made against. Reload it and try again.");
  }
}

export class InvalidStatusTransitionError extends Error {
  readonly code = "invalid_status_transition";

  constructor(from: string, to: string) {
    super(`A ${from} phenomenon cannot become ${to}.`);
  }
}

export class PhenomenonNotDraftError extends Error {
  readonly code = "phenomenon_not_draft";

  constructor() {
    super("Only a draft can be deleted. Archive a phenomenon that was published.");
  }
}
