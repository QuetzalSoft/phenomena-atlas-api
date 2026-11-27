import { type RawBuilder, sql } from "kysely";
import type { Characteristic } from "../domain/characteristic.js";
import type { AggregateFunction, WeightingExpression, WeightingOperator } from "../domain/weighting-expression.js";

/**
 * The aliases the surrounding query gives its tables, so that this file fixes none. They come
 * from code, never from a request.
 */
export interface WeightingSqlSources {
  /** The incident reports, LEFT JOINed so that a region without reports still has a row. */
  report: string;
  /** The region's state in the current partition, which holds its population. */
  regionState: string;
}

/**
 * The weighting function as one SQL expression, evaluated in a query grouped by region. It
 * gives the region's index as double precision, or NULL where the function is undefined,
 * which is not the same as 0. See ADR 0012 and ADR 0016 in the system repository.
 *
 * Every node becomes a fixed fragment. Numbers, characteristic keys, option keys and weights
 * are always parameters: no text from the tree ever reaches the SQL. Everything is double
 * precision, so that no division is an integer division.
 *
 * Throws on a tree the domain should never have let through: a blank, which only a draft may
 * hold and drafts are never computed, or an aggregate the definition does not support.
 */
export function weightingSql(
  expression: WeightingExpression,
  characteristics: readonly Characteristic[],
  sources: WeightingSqlSources,
): RawBuilder<number | null> {
  const byKey = new Map(characteristics.map((characteristic) => [characteristic.key, characteristic]));
  const values = sql.ref(`${sources.report}.characteristic_values`);

  /** One report's value for a characteristic, or NULL when it has none. */
  const valueOf = (key: string): RawBuilder<number | null> => {
    const characteristic = byKey.get(key);
    if (!characteristic) {
      throw new Error(`The weighting function aggregates "${key}", which no characteristic has.`);
    }
    const raw = sql`(${values} ->> ${key}::text)`;
    switch (characteristic.type) {
      case "number":
        return sql`${raw}::double precision`;
      case "boolean":
        // No ELSE: a report without a value must count as no value, not as no.
        return sql`CASE ${raw}::boolean WHEN true THEN 1.0::double precision WHEN false THEN 0.0::double precision END`;
      case "category": {
        if (characteristic.options.length === 0) {
          throw new Error(`The category "${key}" has no options.`);
        }
        // Every option, retired ones included, at its current weight. No ELSE: no value, or an
        // unknown option, is NULL.
        const branches = characteristic.options.map(
          (option) => sql`WHEN ${option.key}::text THEN ${option.weight}::double precision`,
        );
        return sql`CASE ${raw} ${sql.join(branches, sql` `)} END`;
      }
      case "text":
      case "date":
        throw new Error(`The weighting function aggregates "${key}", a ${characteristic.type} characteristic.`);
    }
  };

  const aggregate = (fn: AggregateFunction, key: string | undefined): RawBuilder<number | null> => {
    if (fn === "count") {
      if (key !== undefined) {
        throw new Error("count takes no characteristic.");
      }
      // Counts only matched reports: a region without reports gives 0.
      return sql`count(${sql.ref(`${sources.report}.id`)})::double precision`;
    }
    if (key === undefined) {
      throw new Error(`${fn} needs a characteristic.`);
    }
    const value = valueOf(key);
    switch (fn) {
      case "sum":
        // A sum over no values is 0, as ADR 0012 says.
        return sql`coalesce(sum(${value}), 0)`;
      case "mean":
        return sql`avg(${value})`;
      case "min":
        return sql`min(${value})`;
      case "max":
        return sql`max(${value})`;
    }
  };

  const operation = (operator: WeightingOperator, left: RawBuilder<unknown>, right: RawBuilder<unknown>): RawBuilder<number | null> => {
    switch (operator) {
      case "add":
        return sql`(${left} + ${right})`;
      case "subtract":
        return sql`(${left} - ${right})`;
      case "multiply":
        return sql`(${left} * ${right})`;
      case "divide":
        // A division by zero is undefined, so NULL.
        return sql`(${left} / NULLIF(${right}, 0))`;
    }
  };

  const visit = (node: WeightingExpression): RawBuilder<number | null> => {
    switch (node.kind) {
      case "number":
        return sql`${node.value}::double precision`;
      case "population":
        return sql`${sql.ref(`${sources.regionState}.population`)}::double precision`;
      case "aggregate":
        return aggregate(node.function, node.characteristicKey);
      case "operation":
        return operation(node.operator, visit(node.left), visit(node.right));
      case "blank":
        throw new Error("The weighting function has a blank; only a published phenomenon's function is computed.");
    }
  };

  return visit(expression);
}
