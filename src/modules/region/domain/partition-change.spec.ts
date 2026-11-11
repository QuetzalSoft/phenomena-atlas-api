import { describe, expect, it } from "vitest";
import type { MultiPolygon } from "./geometry.js";
import { type PartitionChange, type PartitionState, planChange, type RegionDraft } from "./partition-change.js";

const square: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  ],
};

const state: PartitionState = {
  latestVersion: 3,
  regions: new Map([
    [1, { municipalityCode: "14039" }],
    [2, { municipalityCode: "14039" }],
    [3, { municipalityCode: "14120" }],
  ]),
  municipalityCodes: new Set(["14039", "14120"]),
};

const draft = (overrides: Partial<RegionDraft> = {}): RegionDraft => ({
  municipalityCode: "14039",
  name: "Region",
  population: 10,
  geometry: square,
  ...overrides,
});

const change = (overrides: Partial<PartitionChange> = {}): PartitionChange => ({
  baseVersion: 3,
  regions: [draft({ id: 1 })],
  retiredRegionIds: [],
  ...overrides,
});

const errorCode = (input: PartitionChange) => planChange(input, state).match(() => "ok", (error) => error.code);

describe("planning a partition change", () => {
  it("plans the next version, splitting new, changed and retired regions", () => {
    const planned = planChange(change({ regions: [draft({ id: 1 }), draft()], retiredRegionIds: [2] }), state)._unsafeUnwrap();

    expect(planned.version).toBe(4);
    expect(planned.changed.map(({ id, index }) => ({ id, index }))).toEqual([{ id: 1, index: 0 }]);
    expect(planned.created.map(({ index }) => index)).toEqual([1]);
    expect(planned.retired).toEqual([2]);
  });

  it("refuses a change made against an older version", () => {
    expect(errorCode(change({ baseVersion: 2 }))).toBe("partition_version_conflict");
  });

  it("refuses a change that does nothing", () => {
    expect(errorCode(change({ regions: [] }))).toBe("empty_change");
  });

  it("refuses a region mentioned twice, even once as retired", () => {
    expect(errorCode(change({ regions: [draft({ id: 1 }), draft({ id: 1 })] }))).toBe("duplicate_region_in_change");
    expect(errorCode(change({ regions: [draft({ id: 1 })], retiredRegionIds: [1] }))).toBe("duplicate_region_in_change");
  });

  it("refuses ids that are not current regions", () => {
    const result = planChange(change({ regions: [draft({ id: 9 })] }), state);

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "region_not_found", details: { regionIds: [9] } });
  });

  it("refuses moving a region to another municipality", () => {
    expect(errorCode(change({ regions: [draft({ id: 1, municipalityCode: "14120" })] }))).toBe("region_crosses_municipality");
  });

  it("refuses a new region in a municipality outside the metropolitan area, pointing at its position", () => {
    const result = planChange(change({ regions: [draft({ id: 1 }), draft({ municipalityCode: "14001" })] }), state);

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "region_out_of_area", details: { draftIndexes: [1] } });
  });

  it("refuses malformed geometries", () => {
    const open: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      ],
    };
    const empty: MultiPolygon = { type: "MultiPolygon", coordinates: [] };

    expect(errorCode(change({ regions: [draft({ id: 1, geometry: open })] }))).toBe("invalid_geometry");
    expect(errorCode(change({ regions: [draft({ id: 1, geometry: empty })] }))).toBe("invalid_geometry");
  });
});
