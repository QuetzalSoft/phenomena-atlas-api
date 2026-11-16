import { err, ok, type Result } from "neverthrow";
import { type Characteristic, isAggregable } from "./characteristic.js";
import {
  CharacteristicNotAggregableError,
  CharacteristicRetiredError,
  IncompleteWeightingFunctionError,
  InvalidAggregateError,
  type PhenomenonDefinitionError,
  UnknownCharacteristicError,
  WeightingFunctionTooLargeError,
} from "./phenomenon.errors.js";

export type AggregateFunction = "count" | "sum" | "mean" | "min" | "max";
export type WeightingOperator = "add" | "subtract" | "multiply" | "divide";

/** The weighting function of a phenomenon, as a tree. See ADR 0012 in the system repository. */
export type WeightingExpression =
  | { kind: "number"; value: number }
  | { kind: "population" }
  | { kind: "aggregate"; function: AggregateFunction; characteristicKey?: string }
  | { kind: "operation"; operator: WeightingOperator; left: WeightingExpression; right: WeightingExpression }
  | { kind: "blank" };

export const maxNodes = 100;
export const maxDepth = 20;

/** Where the function sits in a request body, so errors point into it. */
const rootPath = "/weightingFunction";

interface CheckOptions {
  /** Whether a blank is refused: everywhere but in a draft. */
  complete: boolean;
}

/**
 * Checks a weighting function against the characteristics it may use: each aggregate takes
 * a characteristic exactly when its function needs one, and that characteristic exists, is
 * not retired and holds numbers. Reports the first problem in reading order.
 */
export function checkWeightingFunction(
  expression: WeightingExpression,
  characteristics: readonly Characteristic[],
  { complete }: CheckOptions,
): Result<void, PhenomenonDefinitionError> {
  if (!withinSize(expression)) {
    return err(new WeightingFunctionTooLargeError());
  }
  const byKey = new Map(characteristics.map((characteristic) => [characteristic.key, characteristic]));

  const visit = (node: WeightingExpression, path: string): PhenomenonDefinitionError | undefined => {
    switch (node.kind) {
      case "number":
      case "population":
        return undefined;
      case "blank":
        return complete ? new IncompleteWeightingFunctionError(path) : undefined;
      case "operation":
        return visit(node.left, `${path}/left`) ?? visit(node.right, `${path}/right`);
      case "aggregate": {
        const key = node.characteristicKey;
        if ((node.function === "count") !== (key === undefined)) {
          return new InvalidAggregateError(path);
        }
        if (key === undefined) {
          return undefined;
        }
        const keyPath = `${path}/characteristicKey`;
        const characteristic = byKey.get(key);
        if (!characteristic) {
          return new UnknownCharacteristicError(keyPath, key);
        }
        if (!isAggregable(characteristic.type)) {
          return new CharacteristicNotAggregableError(keyPath, key);
        }
        if (characteristic.retired) {
          return new CharacteristicRetiredError(keyPath, key);
        }
        return undefined;
      }
    }
  };

  const problem = visit(expression, rootPath);
  return problem ? err(problem) : ok(undefined);
}

/** The first blank of the function in reading order, as a path into the request body. */
export function findBlank(expression: WeightingExpression, path = rootPath): string | undefined {
  if (expression.kind === "blank") {
    return path;
  }
  if (expression.kind === "operation") {
    return findBlank(expression.left, `${path}/left`) ?? findBlank(expression.right, `${path}/right`);
  }
  return undefined;
}

/** Whether the tree stays within the node and depth limits. Stops counting as soon as it does not. */
function withinSize(expression: WeightingExpression): boolean {
  let nodes = 0;
  const stack: { node: WeightingExpression; depth: number }[] = [{ node: expression, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop() as { node: WeightingExpression; depth: number };
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth) {
      return false;
    }
    if (node.kind === "operation") {
      stack.push({ node: node.right, depth: depth + 1 }, { node: node.left, depth: depth + 1 });
    }
  }
  return true;
}
