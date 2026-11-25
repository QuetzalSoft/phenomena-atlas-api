import type { Selectable } from "kysely";
import type { Schemas } from "../../libs/api/contract.js";
import type { PhenomenonTable } from "../../libs/db/database.js";
import type { Characteristic } from "./domain/characteristic.js";
import { Phenomenon, type PhenomenonDefinition } from "./domain/phenomenon.entity.js";
import type { WeightingExpression } from "./domain/weighting-expression.js";

export type PhenomenonRow = Selectable<PhenomenonTable>;

/**
 * A definition from a request, rebuilt field by field. The contract's schemas allow extra
 * properties, and this keeps them out of what is stored.
 */
export function definitionFromRequest(body: Schemas["PhenomenonDefinition"]): PhenomenonDefinition {
  return {
    name: body.name,
    description: body.description,
    characteristics: body.characteristics.map(characteristicFrom),
    weightingFunction: expressionFrom(body.weightingFunction),
  };
}

function characteristicFrom(input: Schemas["Characteristic"]): Characteristic {
  const fields = {
    key: input.key,
    label: input.label,
    ...(input.description !== undefined && { description: input.description }),
    required: input.required,
    retired: input.retired,
  };
  switch (input.type) {
    case "number":
      return {
        type: "number",
        ...fields,
        integer: input.integer,
        ...(input.minimum !== undefined && { minimum: input.minimum }),
        ...(input.maximum !== undefined && { maximum: input.maximum }),
        ...(input.unit !== undefined && { unit: input.unit }),
      };
    case "boolean":
      return { type: "boolean", ...fields };
    case "category":
      return {
        type: "category",
        ...fields,
        options: input.options.map((option) => ({
          key: option.key,
          label: option.label,
          weight: option.weight,
          retired: option.retired,
        })),
      };
    case "text":
      return { type: "text", ...fields, maxLength: input.maxLength };
    case "date":
      return { type: "date", ...fields };
  }
}

function expressionFrom(input: Schemas["WeightingExpression"]): WeightingExpression {
  switch (input.kind) {
    case "number":
      return { kind: "number", value: input.value };
    case "population":
      return { kind: "population" };
    case "blank":
      return { kind: "blank" };
    case "aggregate":
      return {
        kind: "aggregate",
        function: input.function,
        ...(input.characteristicKey !== undefined && { characteristicKey: input.characteristicKey }),
      };
    case "operation":
      return { kind: "operation", operator: input.operator, left: expressionFrom(input.left), right: expressionFrom(input.right) };
  }
}

export function phenomenonFromRow(row: PhenomenonRow): Phenomenon {
  return Phenomenon.restore({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    // Only ever written from a checked domain definition.
    characteristics: row.characteristics as Characteristic[],
    weightingFunction: row.weighting_function as WeightingExpression,
    refreshIntervalMinutes: row.refresh_interval_minutes,
    revision: row.revision,
  });
}

/**
 * The contract's Phenomenon. The stored definition was rebuilt field by field on the way in,
 * so it already holds exactly the contract's fields.
 */
export function phenomenonResponse(row: PhenomenonRow): Schemas["Phenomenon"] {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    characteristics: row.characteristics as Schemas["Characteristic"][],
    weightingFunction: row.weighting_function as Schemas["WeightingExpression"],
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
