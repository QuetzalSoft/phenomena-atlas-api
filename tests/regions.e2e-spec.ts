import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { createDatabase } from "../src/libs/db/database.js";
import type { InitialPartitionSources } from "../src/modules/region/commands/load-initial-partition/initial-partition.sources.js";
import {
  loadInitialPartition,
  PartitionAlreadyLoadedError,
} from "../src/modules/region/commands/load-initial-partition/load-initial-partition.js";
import { signInAs } from "./support/accounts.js";
import { startTestApp } from "./support/app.js";

// The partition is one shared state, so this is the only spec that touches it, and its tests
// run in order: the initial load first, then saves that build on each other. erin is the
// admin who saves, frank a plain user.

type MultiPolygon = Schemas["GeoJson.MultiPolygon"];
type Region = Schemas["Region"];
type Draft = Schemas["RegionDraft"];

/** A rectangle from west to east longitude and south to north latitude. */
const box = (west: number, south: number, east: number, north: number): MultiPolygon => ({
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  ],
});

// Two neighbouring municipalities, about 10 km across, sharing the meridian -103.30.
const guadalajara = box(-103.4, 20.6, -103.3, 20.7);
const zapopan = box(-103.3, 20.6, -103.2, 20.7);

/** The distinct positions of a geometry, sorted: equal for the same shape however its rings run. */
const corners = (geometry: MultiPolygon) =>
  [...new Set(geometry.coordinates.flat(2).map((position) => position.join(",")))].sort();

/** A block of a few metres around a point, with its population. */
const block = (key: string, longitude: number, latitude: number) => ({
  key,
  geometry: box(longitude, latitude, longitude + 0.0001, latitude + 0.0001),
});

const sources: InitialPartitionSources = {
  inegiSrid: 4326,
  municipalities: [
    { code: "14039", name: "Guadalajara", geometry: guadalajara },
    { code: "14120", name: "Zapopan", geometry: zapopan },
  ],
  colonias: [
    // A thin strip, under a hectare, separates Alpha and Beta: one of them absorbs it.
    { name: "Alpha", imeplanMunicipality: 41, geometry: box(-103.4, 20.6, -103.35, 20.7) },
    { name: "Beta", imeplanMunicipality: 41, geometry: box(-103.349995, 20.6, -103.3, 20.7) },
    // IMEPLAN files Gamma under Guadalajara, but it lies in Zapopan, and pokes over the border.
    { name: "Gamma", imeplanMunicipality: 41, geometry: box(-103.302, 20.6, -103.25, 20.7) },
    // Delta overlaps Gamma and is smaller, so it keeps the overlap.
    { name: "Delta", imeplanMunicipality: 120, geometry: box(-103.26, 20.6, -103.24, 20.62) },
    // Entirely outside both municipalities.
    { name: "Far away", imeplanMunicipality: 120, geometry: box(-100, 20, -99.9, 20.1) },
  ],
  blocks: [
    block("A1", -103.38, 20.65),
    block("B1", -103.32, 20.65),
    block("B2", -103.31, 20.62),
    block("G1", -103.27, 20.68),
    block("D1", -103.25, 20.61),
    block("R1", -103.21, 20.69),
  ],
  blockPopulation: new Map([
    ["A1", 100],
    ["B1", 150],
    ["B2", 50],
    ["G1", null],
    ["D1", 30],
    ["R1", 7],
  ]),
  municipalityPopulation: new Map([
    ["14039", 300],
    ["14120", 40],
  ]),
};

describe("regions", () => {
  let app: NestExpressApplication;
  let admin: string;
  let user: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startTestApp();
    [admin, user] = [await signInAs("erin", "admin"), await signInAs("frank", "user")];
  });

  afterAll(async () => {
    await app.close();
  });

  const current = async () => (await http().get("/region-partition").expect(200)).body as Schemas["RegionPartition"];
  const named = (partition: Schemas["RegionPartition"], name: string): Region => {
    const region = partition.features.find((feature) => feature.properties.name === name);
    if (!region) {
      throw new Error(`No region named ${name}.`);
    }
    return region;
  };
  const draftOf = (region: Region, overrides: Partial<Draft> = {}): Draft => ({
    id: region.id,
    ...region.properties,
    geometry: region.geometry,
    ...overrides,
  });
  const save = (change: Schemas["PartitionChange"], token = admin) =>
    http().post("/region-partition/versions").auth(token, { type: "bearer" }).send(change);

  describe("before the initial load", () => {
    it("has no partition to read", async () => {
      const response = await http().get("/region-partition").expect(404);

      expect(response.body).toMatchObject({ code: "partition_not_loaded" });
    });

    it("refuses a save, as there is no version to base it on", async () => {
      const response = await save({ baseVersion: 1, regions: [], retiredRegionIds: [] }).expect(409);

      expect(response.body).toMatchObject({ code: "partition_version_conflict" });
    });
  });

  describe("the initial load", () => {
    it("builds version 1 from the colonias, and covers the rest of each municipality", async () => {
      const db = createDatabase(inject("databaseUrl"));
      try {
        const summary = await loadInitialPartition(db, sources);

        expect(summary).toEqual({
          municipalities: [
            { code: "14039", name: "Guadalajara", colonias: 2, remainder: false, population: 300, censusPopulation: 300 },
            { code: "14120", name: "Zapopan", colonias: 2, remainder: true, population: 37, censusPopulation: 40 },
          ],
          coloniasDropped: 1,
          coloniasReassigned: 1,
          suppressedBlocks: 1,
        });
      } finally {
        await db.destroy();
      }

      const partition = await current();
      expect(partition.version).toBe(1);
      expect(
        partition.features.map(({ properties }) => [properties.municipalityCode, properties.name, properties.population]),
      ).toEqual([
        ["14039", "Alpha", 100],
        ["14039", "Beta", 200],
        ["14120", "Delta", 30],
        ["14120", "Gamma", 0],
        ["14120", "Zapopan - outside colonias", 7],
      ]);
      expect(partition.features.map((feature) => feature.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it("runs only once", async () => {
      const db = createDatabase(inject("databaseUrl"));
      try {
        await expect(loadInitialPartition(db, sources)).rejects.toBeInstanceOf(PartitionAlreadyLoadedError);
      } finally {
        await db.destroy();
      }
    });
  });

  describe("reading", () => {
    it("lists the municipalities to anyone", async () => {
      const response = await http().get("/municipalities").expect(200);
      const municipalities = response.body as Schemas["MunicipalityCollection"];

      expect(municipalities.features.map((feature) => [feature.id, feature.properties.name])).toEqual([
        ["14039", "Guadalajara"],
        ["14120", "Zapopan"],
      ]);
    });

    it("gives the history only to admins", async () => {
      await http().get("/region-partition/versions").expect(401);
      const refused = await http().get("/region-partition/versions").auth(user, { type: "bearer" }).expect(403);
      expect(refused.body).toMatchObject({ code: "forbidden" });
      await http().get("/region-partition/versions/1").auth(user, { type: "bearer" }).expect(403);
    });

    it("lists version 1 as the initial load, with no author", async () => {
      const response = await http().get("/region-partition/versions").auth(admin, { type: "bearer" }).expect(200);

      expect(response.body).toEqual({
        items: [{ number: 1, createdAt: expect.any(String) as string, added: [1, 2, 3, 4, 5], changed: [], retired: [] }],
      });
    });

    it("answers 404 for a version that does not exist", async () => {
      const response = await http().get("/region-partition/versions/99").auth(admin, { type: "bearer" }).expect(404);

      expect(response.body).toMatchObject({ code: "partition_version_not_found" });
    });

    it("is compressed when the client accepts it", async () => {
      const response = await http().get("/region-partition").set("Accept-Encoding", "gzip").expect(200);

      expect(response.headers["content-encoding"]).toBe("gzip");
    });
  });

  describe("saving a change", () => {
    it("is refused to non-admins", async () => {
      await save({ baseVersion: 1, regions: [], retiredRegionIds: [] }, user).expect(403);
    });

    it("refuses each broken rule with its own code, and saves nothing", async () => {
      const partition = await current();
      const beta = named(partition, "Beta");
      const delta = named(partition, "Delta");
      const cases: [Schemas["PartitionChange"], number, string, Record<string, unknown>][] = [
        [{ baseVersion: 2, regions: [draftOf(beta)], retiredRegionIds: [] }, 409, "partition_version_conflict", {}],
        [{ baseVersion: 1, regions: [], retiredRegionIds: [] }, 400, "empty_change", {}],
        [{ baseVersion: 1, regions: [draftOf(beta, { id: 999 })], retiredRegionIds: [] }, 400, "region_not_found", { regionIds: [999] }],
        [{ baseVersion: 1, regions: [draftOf(beta)], retiredRegionIds: [beta.id] }, 400, "duplicate_region_in_change", { regionIds: [beta.id] }],
        // Beta's west half on its own leaves its east half uncovered.
        [{ baseVersion: 1, regions: [draftOf(beta, { geometry: box(-103.349995, 20.6, -103.325, 20.7) })], retiredRegionIds: [] }, 400, "partition_gap", { regionIds: [beta.id] }],
        // Beta stretched over Zapopan's Gamma.
        [{ baseVersion: 1, regions: [draftOf(beta, { geometry: box(-103.349995, 20.6, -103.29, 20.7) })], retiredRegionIds: [] }, 400, "region_crosses_municipality", { regionIds: [beta.id] }],
        // Delta stretched south, out of the metropolitan area.
        [{ baseVersion: 1, regions: [draftOf(delta, { geometry: box(-103.26, 20.5, -103.24, 20.62) })], retiredRegionIds: [] }, 400, "region_out_of_area", { regionIds: [delta.id] }],
        // A new region over part of Beta.
        [{ baseVersion: 1, regions: [{ name: "Intruder", population: 0, municipalityCode: "14039", geometry: box(-103.32, 20.6, -103.31, 20.61) }], retiredRegionIds: [] }, 400, "region_overlap", { regionIds: [beta.id], draftIndexes: [0] }],
        // A bow tie crosses itself.
        [
          {
            baseVersion: 1,
            regions: [draftOf(beta, { geometry: { type: "MultiPolygon", coordinates: [[[[-103.34, 20.6], [-103.3, 20.7], [-103.3, 20.6], [-103.34, 20.7], [-103.34, 20.6]]]] } })],
            retiredRegionIds: [],
          },
          400,
          "invalid_geometry",
          { regionIds: [beta.id] },
        ],
      ];

      for (const [change, status, code, details] of cases) {
        const response = await save(change).expect(status);
        expect(response.body, code).toMatchObject({ code, ...(Object.keys(details).length > 0 && { details }) });
      }
      expect((await current()).version).toBe(1);
    });

    it("splits a region: the original keeps its id and the new piece gets a new one", async () => {
      const beta = named(await current(), "Beta");

      const response = await save({
        baseVersion: 1,
        regions: [
          draftOf(beta, { geometry: box(-103.349995, 20.6, -103.325, 20.7), population: 150 }),
          { name: "Beta East", population: 50, municipalityCode: "14039", geometry: box(-103.325, 20.6, -103.3, 20.7) },
        ],
        retiredRegionIds: [],
      }).expect(201);

      const version = response.body as Schemas["PartitionVersion"];
      expect(version).toEqual({
        number: 2,
        createdAt: expect.any(String) as string,
        author: { id: expect.any(String) as string, username: "erin", name: "Erin Tester" },
        added: [expect.any(Number) as number],
        changed: [beta.id],
        retired: [],
      });
      // Above every id so far, including those the refused saves drew and rolled back.
      const [added] = version.added;
      expect(added).toBeGreaterThan(5);
      const partition = await current();
      expect(partition.version).toBe(2);
      expect(named(partition, "Beta").id).toBe(beta.id);
      expect(named(partition, "Beta East")).toMatchObject({ id: added, properties: { population: 50 } });
    });

    it("moves a shared border by changing both neighbours together", async () => {
      const partition = await current();
      const [beta, east] = [named(partition, "Beta"), named(partition, "Beta East")];

      await save({
        baseVersion: 2,
        regions: [
          draftOf(beta, { geometry: box(-103.349995, 20.6, -103.32, 20.7) }),
          draftOf(east, { geometry: box(-103.32, 20.6, -103.3, 20.7) }),
        ],
        retiredRegionIds: [],
      }).expect(201);
    });

    it("renames a region and sets its population, keeping its id", async () => {
      const alpha = named(await current(), "Alpha");

      await save({ baseVersion: 3, regions: [draftOf(alpha, { name: "Alpha Centro", population: 120 })], retiredRegionIds: [] }).expect(201);

      expect(named(await current(), "Alpha Centro")).toMatchObject({ id: alpha.id, properties: { population: 120 } });
    });

    it("merges two regions, retiring one id for good", async () => {
      const partition = await current();
      const [beta, east] = [named(partition, "Beta"), named(partition, "Beta East")];

      const merged = await save({
        baseVersion: 4,
        regions: [draftOf(beta, { geometry: box(-103.349995, 20.6, -103.3, 20.7), population: 200 })],
        retiredRegionIds: [east.id],
      }).expect(201);
      expect(merged.body).toMatchObject({ number: 5, added: [], changed: [beta.id], retired: [east.id] });

      // Splitting again hands out a new id, never the retired one.
      const split = await save({
        baseVersion: 5,
        regions: [
          draftOf(beta, { geometry: box(-103.349995, 20.6, -103.325, 20.7) }),
          { name: "Beta East again", population: 0, municipalityCode: "14039", geometry: box(-103.325, 20.6, -103.3, 20.7) },
        ],
        retiredRegionIds: [],
      }).expect(201);
      const [added] = (split.body as Schemas["PartitionVersion"]).added;
      expect(added).toBeGreaterThan(east.id);

      const retired = await save({ baseVersion: 6, regions: [draftOf(beta, { id: east.id })], retiredRegionIds: [] }).expect(400);
      expect(retired.body).toMatchObject({ code: "region_not_found", details: { regionIds: [east.id] } });
    });

    it("keeps every past version readable as it was", async () => {
      const second = (await http().get("/region-partition/versions/2").auth(admin, { type: "bearer" }).expect(200))
        .body as Schemas["RegionPartition"];

      expect(second.version).toBe(2);
      expect(corners(named(second, "Beta East").geometry)).toEqual(corners(box(-103.325, 20.6, -103.3, 20.7)));
      expect(named(second, "Alpha").properties.population).toBe(100);
    });

    it("lists the versions newest first, page by page", async () => {
      const first = await http().get("/region-partition/versions?limit=2").auth(admin, { type: "bearer" }).expect(200);
      const page = first.body as Schemas["PartitionVersionPage"];
      expect(page.items.map((version) => version.number)).toEqual([6, 5]);

      const next = await http()
        .get(`/region-partition/versions?limit=2&cursor=${page.nextCursor}`)
        .auth(admin, { type: "bearer" })
        .expect(200);
      expect((next.body as Schemas["PartitionVersionPage"]).items.map((version) => version.number)).toEqual([4, 3]);

      const invalid = await http().get("/region-partition/versions?cursor=nonsense").auth(admin, { type: "bearer" }).expect(400);
      expect(invalid.body).toMatchObject({ code: "invalid_cursor" });
    });
  });
});
