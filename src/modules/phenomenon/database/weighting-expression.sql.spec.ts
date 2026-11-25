import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";
import { describe, expect, it } from "vitest";
import type { Characteristic } from "../domain/characteristic.js";
import type { WeightingExpression } from "../domain/weighting-expression.js";
import { weightingSql } from "./weighting-expression.sql.js";

// Compiles Postgres SQL without connecting to anything.
const db = new Kysely<unknown>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (kysely) => new PostgresIntrospector(kysely),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const victims: Characteristic = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true, minimum: 0 };
const weapon: Characteristic = { type: "boolean", key: "weapon", label: "Weapon involved", required: false, retired: false };
const severity: Characteristic = {
  type: "category",
  key: "severity",
  label: "Severity",
  required: true,
  retired: false,
  options: [
    { key: "low", label: "Low", weight: 1, retired: false },
    { key: "high", label: "High", weight: 3, retired: false },
    { key: "extreme", label: "Extreme", weight: 7.5, retired: true },
  ],
};
const notes: Characteristic = { type: "text", key: "notes", label: "Notes", required: false, retired: false, maxLength: 500 };
const characteristics = [victims, weapon, severity, notes];

const population: WeightingExpression = { kind: "population" };
const count: WeightingExpression = { kind: "aggregate", function: "count" };
const of = (fn: "sum" | "mean" | "min" | "max", key: string): WeightingExpression => ({ kind: "aggregate", function: fn, characteristicKey: key });
const op = (operator: "add" | "subtract" | "multiply" | "divide", left: WeightingExpression, right: WeightingExpression): WeightingExpression => ({
  kind: "operation",
  operator,
  left,
  right,
});

const compile = (expression: WeightingExpression, defined: readonly Characteristic[] = characteristics) =>
  weightingSql(expression, defined, { report: "r", regionState: "s" }).compile(db);

/** A report's raw value for the characteristic whose key is the first parameter. */
const firstValue = `("r"."characteristic_values" ->> $1::text)`;

describe("the weighting function in SQL", () => {
  it("passes a constant as a parameter, as double precision", () => {
    expect(compile({ kind: "number", value: 2.5 })).toMatchObject({ sql: "$1::double precision", parameters: [2.5] });
  });

  it("reads the population from the region's state, as double precision", () => {
    expect(compile(population)).toMatchObject({ sql: `"s"."population"::double precision`, parameters: [] });
  });

  it("counts the region's reports, as double precision", () => {
    expect(compile(count)).toMatchObject({ sql: `count("r"."id")::double precision`, parameters: [] });
  });

  it("reads a number as double precision", () => {
    expect(compile(of("mean", "victims"))).toMatchObject({
      sql: `avg(${firstValue}::double precision)`,
      parameters: ["victims"],
    });
  });

  it("turns yes/no into 1 or 0, and no value into NULL rather than 0", () => {
    const { sql } = compile(of("mean", "weapon"));
    expect(sql).toBe(`avg(CASE ${firstValue}::boolean WHEN true THEN 1.0::double precision WHEN false THEN 0.0::double precision END)`);
    expect(sql).not.toContain("ELSE");
  });

  it("turns a category into the current weight of every option, retired ones included", () => {
    const { sql, parameters } = compile(of("max", "severity"));
    expect(sql).toBe(
      `max(CASE ${firstValue} WHEN $2::text THEN $3::double precision WHEN $4::text THEN $5::double precision WHEN $6::text THEN $7::double precision END)`,
    );
    expect(sql).not.toContain("ELSE");
    expect(parameters).toEqual(["severity", "low", 1, "high", 3, "extreme", 7.5]);
  });

  it("makes a sum over no reports 0, and leaves mean, min and max NULL", () => {
    expect(compile(of("sum", "victims")).sql).toBe(`coalesce(sum(${firstValue}::double precision), 0)`);
    expect(compile(of("mean", "victims")).sql).toMatch(/^avg\(/);
    expect(compile(of("min", "victims")).sql).toMatch(/^min\(/);
    expect(compile(of("max", "victims")).sql).toMatch(/^max\(/);
  });

  it("adds, subtracts and multiplies, and makes a division by zero NULL", () => {
    const one: WeightingExpression = { kind: "number", value: 1 };
    expect(compile(op("add", one, population)).sql).toBe(`($1::double precision + "s"."population"::double precision)`);
    expect(compile(op("subtract", one, population)).sql).toBe(`($1::double precision - "s"."population"::double precision)`);
    expect(compile(op("multiply", one, population)).sql).toBe(`($1::double precision * "s"."population"::double precision)`);
    expect(compile(op("divide", count, population)).sql).toBe(`(count("r"."id")::double precision / NULLIF("s"."population"::double precision, 0))`);
  });

  it("numbers the parameters of a whole tree in reading order", () => {
    expect(compile(op("divide", of("sum", "severity"), op("multiply", { kind: "number", value: 1000 }, population))).parameters).toEqual([
      "severity",
      "low",
      1,
      "high",
      3,
      "extreme",
      7.5,
      1000,
    ]);
  });
});

describe("text from the tree", () => {
  const hostile = "x'); DROP TABLE y";

  it("never reaches the SQL: keys, option keys and numbers are only parameters", () => {
    const sneaky: Characteristic[] = [
      { ...victims, key: hostile },
      { ...severity, key: `${hostile} 2`, options: [{ key: `${hostile} 3`, label: "Bad", weight: 123.456, retired: false }] },
    ];
    const { sql, parameters } = compile(op("add", op("multiply", of("sum", hostile), { kind: "number", value: 987.654 }), of("max", `${hostile} 2`)), sneaky);

    for (const text of [hostile, "DROP", "987.654", "123.456"]) {
      expect(sql).not.toContain(text);
    }
    expect(parameters).toEqual([hostile, 987.654, `${hostile} 2`, `${hostile} 3`, 123.456]);
  });
});

describe("a tree the domain should have refused", () => {
  it("throws on a blank instead of producing SQL", () => {
    expect(() => compile(op("add", count, { kind: "blank" }))).toThrow(/blank/);
  });

  it("throws on a key no characteristic has", () => {
    expect(() => compile(of("sum", "ghost"))).toThrow(/"ghost"/);
  });

  it("throws on a characteristic that holds no numbers", () => {
    expect(() => compile(of("sum", "notes"))).toThrow(/text/);
  });

  it("throws on count with a characteristic, and on sum without one", () => {
    expect(() => compile({ kind: "aggregate", function: "count", characteristicKey: "victims" })).toThrow(/count/);
    expect(() => compile({ kind: "aggregate", function: "sum" })).toThrow(/sum/);
  });
});
