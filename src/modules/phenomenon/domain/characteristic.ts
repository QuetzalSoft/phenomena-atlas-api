import { err, ok, type Result } from "neverthrow";
import {
  CategoryOptionRemovedError,
  CategoryWithoutOptionsError,
  CharacteristicRemovedError,
  CharacteristicTypeChangedError,
  DuplicateCategoryOptionKeyError,
  DuplicateCharacteristicKeyError,
  InvalidNumberRangeError,
  type PhenomenonDefinitionError,
} from "./phenomenon.errors.js";

interface CharacteristicFields {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  retired: boolean;
}

export interface NumberCharacteristic extends CharacteristicFields {
  type: "number";
  integer: boolean;
  minimum?: number;
  maximum?: number;
  unit?: string;
}

export interface BooleanCharacteristic extends CharacteristicFields {
  type: "boolean";
}

export interface CategoryOption {
  key: string;
  label: string;
  weight: number;
  retired: boolean;
}

export interface CategoryCharacteristic extends CharacteristicFields {
  type: "category";
  options: CategoryOption[];
}

export interface TextCharacteristic extends CharacteristicFields {
  type: "text";
  maxLength: number;
}

export interface DateCharacteristic extends CharacteristicFields {
  type: "date";
}

/** One field every incident report of a phenomenon carries. */
export type Characteristic =
  | NumberCharacteristic
  | BooleanCharacteristic
  | CategoryCharacteristic
  | TextCharacteristic
  | DateCharacteristic;

export type CharacteristicType = Characteristic["type"];

/** The types whose values the weighting function can aggregate. */
export function isAggregable(type: CharacteristicType): boolean {
  return type === "number" || type === "boolean" || type === "category";
}

/**
 * Checks a list of characteristics on its own and, when the phenomenon was saved before,
 * against what was saved: reports may carry any saved characteristic or option, so none may
 * disappear or change type. Shape and lengths were already checked against the contract.
 */
export function checkCharacteristics(
  characteristics: readonly Characteristic[],
  saved: readonly Characteristic[] = [],
): Result<void, PhenomenonDefinitionError> {
  const positions = new Map<string, number>();
  for (const [index, characteristic] of characteristics.entries()) {
    const path = `/characteristics/${index}`;
    if (positions.has(characteristic.key)) {
      return err(new DuplicateCharacteristicKeyError(`${path}/key`, characteristic.key));
    }
    positions.set(characteristic.key, index);

    const own = checkOwnRules(characteristic, path);
    if (own.isErr()) {
      return own;
    }
  }

  for (const before of saved) {
    const index = positions.get(before.key);
    const after = index === undefined ? undefined : characteristics[index];
    if (index === undefined || !after) {
      return err(new CharacteristicRemovedError(before.key));
    }
    const path = `/characteristics/${index}`;
    if (after.type !== before.type) {
      return err(new CharacteristicTypeChangedError(`${path}/type`, before.key));
    }
    if (before.type === "category" && after.type === "category") {
      const kept = new Set(after.options.map((option) => option.key));
      const removed = before.options.find((option) => !kept.has(option.key));
      if (removed) {
        return err(new CategoryOptionRemovedError(`${path}/options`, removed.key));
      }
    }
  }
  return ok(undefined);
}

function checkOwnRules(characteristic: Characteristic, path: string): Result<void, PhenomenonDefinitionError> {
  switch (characteristic.type) {
    case "number":
      if (
        characteristic.minimum !== undefined &&
        characteristic.maximum !== undefined &&
        characteristic.minimum > characteristic.maximum
      ) {
        return err(new InvalidNumberRangeError(path, characteristic.key));
      }
      return ok(undefined);
    case "category": {
      const seen = new Set<string>();
      for (const [index, option] of characteristic.options.entries()) {
        if (seen.has(option.key)) {
          return err(new DuplicateCategoryOptionKeyError(`${path}/options/${index}/key`, option.key));
        }
        seen.add(option.key);
      }
      if (characteristic.options.every((option) => option.retired)) {
        return err(new CategoryWithoutOptionsError(`${path}/options`, characteristic.key));
      }
      return ok(undefined);
    }
    default:
      return ok(undefined);
  }
}
