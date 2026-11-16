import { describe, expect, it } from "vitest";
import type { Characteristic } from "./characteristic.js";
import { Phenomenon, type PhenomenonDefinition, type PhenomenonStatus } from "./phenomenon.entity.js";
import type { WeightingExpression } from "./weighting-expression.js";

const victims: Characteristic = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true, minimum: 0 };
const severity: Characteristic = {
  type: "category",
  key: "severity",
  label: "Severity",
  required: true,
  retired: false,
  options: [
    { key: "low", label: "Low", weight: 1, retired: false },
    { key: "high", label: "High", weight: 3, retired: false },
  ],
};
const weapon: Characteristic = { type: "boolean", key: "weapon", label: "Weapon involved", required: false, retired: false };
const notes: Characteristic = { type: "text", key: "notes", label: "Notes", required: false, retired: false, maxLength: 500 };

const blank: WeightingExpression = { kind: "blank" };
const population: WeightingExpression = { kind: "population" };
const count: WeightingExpression = { kind: "aggregate", function: "count" };
const sumOf = (key: string): WeightingExpression => ({ kind: "aggregate", function: "sum", characteristicKey: key });
const divide = (left: WeightingExpression, right: WeightingExpression): WeightingExpression => ({ kind: "operation", operator: "divide", left, right });
const add = (left: WeightingExpression, right: WeightingExpression): WeightingExpression => ({ kind: "operation", operator: "add", left, right });

const definition = (overrides: Partial<PhenomenonDefinition> = {}): PhenomenonDefinition => ({
  name: "Gender violence",
  description: "",
  characteristics: [victims, severity, weapon, notes],
  weightingFunction: divide(sumOf("severity"), population),
  ...overrides,
});

const saved = (status: PhenomenonStatus = "draft", overrides: Partial<PhenomenonDefinition> = {}) =>
  Phenomenon.restore({ id: 1, status, revision: 3, ...definition(overrides) });

const codeOf = (result: { isErr(): boolean; _unsafeUnwrapErr(): { code: string } }) => (result.isErr() ? result._unsafeUnwrapErr().code : "ok");
const errorOf = <E>(result: { _unsafeUnwrapErr(): E }) => result._unsafeUnwrapErr();

describe("a new phenomenon", () => {
  it("accepts a complete definition", () => {
    expect(codeOf(Phenomenon.checkNew(definition()))).toBe("ok");
  });

  it("may start with no characteristics and a blank function", () => {
    expect(codeOf(Phenomenon.checkNew(definition({ characteristics: [], weightingFunction: blank })))).toBe("ok");
  });

  it("refuses two characteristics with the same key, pointing at the second", () => {
    const result = Phenomenon.checkNew(definition({ characteristics: [victims, weapon, { ...weapon, label: "Again" }] }));
    expect(errorOf(result)).toMatchObject({ code: "duplicate_characteristic_key", details: { path: "/characteristics/2/key", key: "weapon" } });
  });

  it("refuses two options of a category with the same key", () => {
    const repeated: Characteristic = { ...severity, options: [...severity.options, { key: "low", label: "Lower", weight: 0, retired: false }] };
    const result = Phenomenon.checkNew(definition({ characteristics: [repeated] , weightingFunction: count }));
    expect(errorOf(result)).toMatchObject({ code: "duplicate_category_option_key", details: { path: "/characteristics/0/options/2/key" } });
  });

  it("refuses a category whose options are all retired", () => {
    const retired: Characteristic = { ...severity, options: severity.options.map((option) => ({ ...option, retired: true })) };
    expect(codeOf(Phenomenon.checkNew(definition({ characteristics: [retired], weightingFunction: count })))).toBe("category_without_options");
  });

  it("refuses a number whose minimum is above its maximum", () => {
    const inverted: Characteristic = { ...victims, minimum: 10, maximum: 1 };
    expect(codeOf(Phenomenon.checkNew(definition({ characteristics: [inverted], weightingFunction: count })))).toBe("invalid_number_range");
  });
});

describe("the weighting function", () => {
  const check = (weightingFunction: WeightingExpression) => Phenomenon.checkNew(definition({ weightingFunction }));

  it("aggregates numbers, yes/no and categories", () => {
    expect(codeOf(check(add(add(sumOf("victims"), sumOf("weapon")), sumOf("severity"))))).toBe("ok");
  });

  it("refuses a key no characteristic has, pointing at the node", () => {
    expect(errorOf(check(divide(population, sumOf("ghost"))))).toMatchObject({
      code: "unknown_characteristic",
      details: { path: "/weightingFunction/right/characteristicKey", key: "ghost" },
    });
  });

  it("refuses to aggregate text or dates", () => {
    expect(codeOf(check(sumOf("notes")))).toBe("characteristic_not_aggregable");
  });

  it("refuses a retired characteristic", () => {
    const result = Phenomenon.checkNew(definition({ characteristics: [{ ...victims, retired: true }], weightingFunction: sumOf("victims") }));
    expect(codeOf(result)).toBe("characteristic_retired");
  });

  it("refuses count with a characteristic and sum without one", () => {
    expect(codeOf(check({ kind: "aggregate", function: "count", characteristicKey: "victims" }))).toBe("invalid_aggregate");
    expect(codeOf(check({ kind: "aggregate", function: "sum" }))).toBe("invalid_aggregate");
  });

  it("refuses more than 100 nodes or 20 levels", () => {
    let deep: WeightingExpression = population;
    for (let level = 1; level < 20; level += 1) {
      deep = add(deep, population);
    }
    expect(codeOf(check(deep))).toBe("ok");
    expect(codeOf(check(add(deep, population)))).toBe("weighting_function_too_large");

    const wide = (levels: number): WeightingExpression => (levels === 0 ? population : add(wide(levels - 1), wide(levels - 1)));
    expect(codeOf(check(wide(5)))).toBe("ok"); // 63 nodes
    expect(codeOf(check(wide(6)))).toBe("weighting_function_too_large"); // 127 nodes
  });
});

describe("redefining a phenomenon", () => {
  it("increases the revision", () => {
    const phenomenon = saved();
    expect(codeOf(phenomenon.redefine(definition({ name: "Renamed" }), 3))).toBe("ok");
    expect(phenomenon.toProps()).toMatchObject({ name: "Renamed", revision: 4 });
  });

  it("refuses a change made against an older revision", () => {
    expect(codeOf(saved().redefine(definition(), 2))).toBe("phenomenon_revision_conflict");
  });

  it("refuses to remove a saved characteristic", () => {
    const result = saved().redefine(definition({ characteristics: [victims, severity, notes] }), 3);
    expect(errorOf(result)).toMatchObject({ code: "characteristic_removed", details: { key: "weapon" } });
  });

  it("refuses to change a saved characteristic's type", () => {
    const changed: Characteristic = { type: "number", key: "weapon", label: "Weapons", required: false, retired: false, integer: true };
    const result = saved().redefine(definition({ characteristics: [victims, severity, changed, notes] }), 3);
    expect(errorOf(result)).toMatchObject({ code: "characteristic_type_changed", details: { path: "/characteristics/2/type" } });
  });

  it("refuses to remove a saved category option", () => {
    const fewer: Characteristic = { ...severity, options: [severity.options[1] as never] };
    expect(codeOf(saved().redefine(definition({ characteristics: [victims, fewer, weapon, notes] }), 3))).toBe("category_option_removed");
  });

  it("lets characteristics be added, reordered, retired and reweighted", () => {
    const reweighted: Characteristic = { ...severity, options: severity.options.map((option) => ({ ...option, weight: option.weight * 2 })) };
    const added: Characteristic = { type: "date", key: "occurred_on", label: "Date", required: false, retired: false };
    const result = saved().redefine(definition({ characteristics: [added, { ...weapon, retired: true }, reweighted, notes, victims] }), 3);
    expect(codeOf(result)).toBe("ok");
  });

  it("allows a blank only in a draft", () => {
    expect(codeOf(saved("draft").redefine(definition({ weightingFunction: blank }), 3))).toBe("ok");
    const result = saved("published").redefine(definition({ weightingFunction: divide(count, blank) }), 3);
    expect(errorOf(result)).toMatchObject({ code: "incomplete_weighting_function", details: { path: "/weightingFunction/right" } });
    expect(codeOf(saved("archived").redefine(definition({ weightingFunction: blank }), 3))).toBe("incomplete_weighting_function");
  });
});

describe("the status of a phenomenon", () => {
  it("goes from draft to published to archived and back to published", () => {
    const phenomenon = saved("draft");
    expect(codeOf(phenomenon.changeStatus("published", 3))).toBe("ok");
    expect(codeOf(phenomenon.changeStatus("archived", 4))).toBe("ok");
    expect(codeOf(phenomenon.changeStatus("published", 5))).toBe("ok");
    expect(phenomenon.toProps()).toMatchObject({ status: "published", revision: 6 });
  });

  it("never goes back to draft, and a draft is never archived", () => {
    expect(codeOf(saved("published").changeStatus("draft", 3))).toBe("invalid_status_transition");
    expect(codeOf(saved("archived").changeStatus("draft", 3))).toBe("invalid_status_transition");
    expect(codeOf(saved("draft").changeStatus("archived", 3))).toBe("invalid_status_transition");
    expect(codeOf(saved("published").changeStatus("published", 3))).toBe("invalid_status_transition");
  });

  it("refuses to publish a function with a blank", () => {
    expect(errorOf(saved("draft", { weightingFunction: add(count, blank) }).changeStatus("published", 3))).toMatchObject({
      code: "incomplete_weighting_function",
      details: { path: "/weightingFunction/right" },
    });
  });

  it("refuses a change made against an older revision", () => {
    expect(codeOf(saved("draft").changeStatus("published", 1))).toBe("phenomenon_revision_conflict");
  });

  it("lets only a draft be deleted", () => {
    expect(codeOf(saved("draft").checkDeletable())).toBe("ok");
    expect(codeOf(saved("published").checkDeletable())).toBe("phenomenon_not_draft");
    expect(codeOf(saved("archived").checkDeletable())).toBe("phenomenon_not_draft");
  });
});
