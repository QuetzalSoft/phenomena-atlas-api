import { describe, expect, it } from "vitest";
import type { Characteristic } from "../../phenomenon/phenomenon.public.js";
import { type CharacteristicValue, checkIncidentReport, checkReportValues, type IncidentReportDraft } from "./incident-report.js";

const victims: Characteristic = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true, minimum: 0, maximum: 50 };
const depth: Characteristic = { type: "number", key: "depth", label: "Depth", required: false, retired: false, integer: false };
const weapon: Characteristic = { type: "boolean", key: "weapon", label: "Weapon", required: false, retired: false };
const severity: Characteristic = {
  type: "category",
  key: "severity",
  label: "Severity",
  required: true,
  retired: false,
  options: [
    { key: "low", label: "Low", weight: 1, retired: false },
    { key: "medium", label: "Medium", weight: 2, retired: true },
    { key: "high", label: "High", weight: 3, retired: false },
  ],
};
const place: Characteristic = { type: "text", key: "place", label: "Place", required: false, retired: false, maxLength: 5 };
const noticed: Characteristic = { type: "date", key: "noticed", label: "Noticed on", required: false, retired: false };
const old: Characteristic = { type: "boolean", key: "old", label: "Old question", required: true, retired: true };

const characteristics = [victims, depth, weapon, severity, place, noticed, old];
const valid = { victims: 2, severity: "high" };

const codeOf = (values: Record<string, CharacteristicValue>) => {
  const result = checkReportValues(characteristics, values);
  return result.isErr() ? { code: result.error.code, ...result.error.details } : "ok";
};

describe("checkReportValues", () => {
  it("accepts a value of the right type for every active characteristic", () => {
    expect(codeOf({ ...valid, depth: 1.5, weapon: false, place: "Park", noticed: "2026-02-28" })).toBe("ok");
  });

  it("leaves optional characteristics out, and never asks for a retired one", () => {
    expect(codeOf(valid)).toBe("ok");
  });

  it("asks for every required active characteristic", () => {
    expect(codeOf({ victims: 1 })).toEqual({ code: "missing_characteristic_value", path: "/values/severity", key: "severity" });
  });

  it("refuses keys the phenomenon does not have, escaping them in the pointer", () => {
    expect(codeOf({ ...valid, "a/b~c": 1 })).toEqual({ code: "unknown_characteristic", path: "/values/a~1b~0c", key: "a/b~c" });
  });

  it("refuses a retired characteristic", () => {
    expect(codeOf({ ...valid, old: true })).toEqual({ code: "characteristic_retired", path: "/values/old", key: "old" });
  });

  it.each<[string, CharacteristicValue, string]>([
    ["victims", "2", "invalid_characteristic_value"],
    ["victims", 2.5, "invalid_characteristic_value"],
    ["victims", -1, "number_out_of_range"],
    ["victims", 51, "number_out_of_range"],
    ["weapon", "yes", "invalid_characteristic_value"],
    ["weapon", 1, "invalid_characteristic_value"],
    ["severity", 3, "invalid_characteristic_value"],
    ["severity", "extreme", "unknown_category_option"],
    ["severity", "medium", "category_option_retired"],
    ["place", "   ", "invalid_characteristic_value"],
    ["place", "Plaza!", "text_too_long"],
    ["place", false, "invalid_characteristic_value"],
    ["noticed", "2026-02-30", "invalid_characteristic_value"],
    ["noticed", "28/02/2026", "invalid_characteristic_value"],
  ])("refuses %s = %j with %s", (key, value, code) => {
    expect(codeOf({ ...valid, [key]: value })).toEqual({ code, path: `/values/${key}`, key });
  });

  it("counts text length in characters, not UTF-16 units", () => {
    expect(codeOf({ ...valid, place: "🌧🌧🌧🌧🌧" })).toBe("ok");
  });

  it("accepts the limits themselves", () => {
    expect(codeOf({ ...valid, victims: 0 })).toBe("ok");
    expect(codeOf({ ...valid, victims: 50 })).toBe("ok");
  });
});

describe("checkIncidentReport", () => {
  const draft: IncidentReportDraft = { regionId: 1, occurredOn: "2026-11-16", description: "Something happened.", values: valid };

  it("accepts a report about a published phenomenon that happened today or before", () => {
    expect(checkIncidentReport(draft, { status: "published", characteristics }, "2026-11-16").isOk()).toBe(true);
  });

  it.each(["draft", "archived"] as const)("refuses a %s phenomenon", (status) => {
    const result = checkIncidentReport(draft, { status, characteristics }, "2026-11-16");
    expect(result._unsafeUnwrapErr().code).toBe("phenomenon_not_accepting_reports");
  });

  it("refuses an incident dated after today", () => {
    const result = checkIncidentReport(draft, { status: "published", characteristics }, "2026-11-15");
    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "occurred_in_future", details: { path: "/occurredOn" } });
  });

  it("checks the values", () => {
    const result = checkIncidentReport({ ...draft, values: {} }, { status: "published", characteristics }, "2026-11-16");
    expect(result._unsafeUnwrapErr().code).toBe("missing_characteristic_value");
  });
});
