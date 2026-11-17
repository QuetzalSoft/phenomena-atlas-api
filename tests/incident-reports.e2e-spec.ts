import type { NestExpressApplication } from "@nestjs/platform-express";
import { sql } from "kysely";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { createDatabase } from "../src/libs/db/database.js";
import { signInAs } from "./support/accounts.js";
import { startTestApp } from "./support/app.js";
import { createIsolatedDatabase } from "./support/database.js";

// Reports need a region partition, and the shared database's partition belongs to
// regions.e2e-spec.ts, so this spec runs against a database of its own. Its accounts live
// there too: alice is the admin, bob an analyst, erin and frank plain users.

type Phenomenon = Schemas["Phenomenon"];
type Draft = Schemas["IncidentReportDraft"];
type Report = Schemas["IncidentReport"];
type Page = Schemas["IncidentReportPage"];

const victims: Schemas["Characteristic"] = { type: "number", key: "victims", label: "Victims", required: true, retired: false, integer: true, minimum: 1 };
const severity: Schemas["Characteristic"] = {
  type: "category",
  key: "severity",
  label: "Severity",
  required: true,
  retired: false,
  options: [
    { key: "low", label: "Low", weight: 1, retired: false },
    { key: "high", label: "High", weight: 3, retired: false },
    { key: "unclear", label: "Unclear", weight: 0, retired: true },
  ],
};
const weapon: Schemas["Characteristic"] = { type: "boolean", key: "weapon", label: "Weapon involved", required: false, retired: false };
const witness: Schemas["Characteristic"] = { type: "text", key: "witness", label: "Old question", required: false, retired: true, maxLength: 100 };

const definition = (name: string): Schemas["PhenomenonDefinition"] => ({
  name,
  description: `${name}, for the incident report tests.`,
  characteristics: [victims, severity, weapon, witness],
  weightingFunction: { kind: "aggregate", function: "count" },
});

/** A square of about a kilometre, as a MultiPolygon in WKT. */
const square = (west: number, south: number) =>
  `MULTIPOLYGON(((${west} ${south}, ${west + 0.01} ${south}, ${west + 0.01} ${south + 0.01}, ${west} ${south + 0.01}, ${west} ${south})))`;

/**
 * Version 1 has Centro (1), Norte (2), Sur (3) and Oeste (4); version 2 retires Norte. The
 * partition rules are the region module's business, so the rows are written directly.
 */
async function seedPartition(databaseUrl: string): Promise<void> {
  const db = createDatabase(databaseUrl);
  try {
    await sql`INSERT INTO municipality (code, name, geometry) VALUES ('14039', 'Guadalajara', ST_GeomFromText(${square(-103.4, 20.6)}, 4326))`.execute(db);
    await sql`INSERT INTO partition_version (number) VALUES (1), (2)`.execute(db);
    await sql`INSERT INTO region (municipality_code, created_in, retired_in) VALUES ('14039', 1, NULL), ('14039', 1, 2), ('14039', 1, NULL), ('14039', 1, NULL)`.execute(db);
    await sql`
      INSERT INTO region_state (region_id, valid_from, valid_to, name, population, geometry) VALUES
        (1, 1, NULL, 'Centro', 100, ST_GeomFromText(${square(-103.4, 20.6)}, 4326)),
        (2, 1, 2, 'Norte', 50, ST_GeomFromText(${square(-103.4, 20.6)}, 4326)),
        (3, 1, NULL, 'Sur', 70, ST_GeomFromText(${square(-103.4, 20.6)}, 4326)),
        (4, 1, NULL, 'Oeste', 20, ST_GeomFromText(${square(-103.4, 20.6)}, 4326))
    `.execute(db);
  } finally {
    await db.destroy();
  }
}

/** YYYY-MM-DD, `days` from today in the metropolitan area. */
const dayFromToday = (days: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(Date.now() + days * 86_400_000));

const draft = (overrides: Partial<Draft> = {}): Draft => ({
  regionId: 1,
  occurredOn: "2026-11-01",
  description: "It happened near the market.",
  values: { victims: 1, severity: "high" },
  ...overrides,
});

describe("incident reports", () => {
  let app: NestExpressApplication;
  let databaseUrl: string;
  let admin: string;
  let analyst: string;
  let user: string;
  let otherUser: string;
  let published: Phenomenon;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    databaseUrl = await createIsolatedDatabase("incident_reports");
    await seedPartition(databaseUrl);
    app = await startTestApp(databaseUrl);
    [admin, analyst, user, otherUser] = [
      await signInAs("alice", "admin", databaseUrl),
      await signInAs("bob", "analyst", databaseUrl),
      await signInAs("erin", "user", databaseUrl),
      await signInAs("frank", "user", databaseUrl),
    ];
    published = await create("Gender violence", "published");
  });

  afterAll(async () => {
    await app.close();
  });

  async function create(name: string, status: Phenomenon["status"]): Promise<Phenomenon> {
    let phenomenon = (await http().post("/phenomena").auth(admin, { type: "bearer" }).send(definition(name)).expect(201)).body as Phenomenon;
    for (const next of status === "draft" ? [] : status === "published" ? ["published"] : ["published", "archived"]) {
      phenomenon = (
        await http()
          .put(`/phenomena/${phenomenon.id}/status`)
          .auth(admin, { type: "bearer" })
          .send({ baseRevision: phenomenon.revision, status: next })
          .expect(200)
      ).body as Phenomenon;
    }
    return phenomenon;
  }

  const file = (body: Draft = draft(), token = user, phenomenonId = published.id) =>
    http().post(`/phenomena/${phenomenonId}/incident-reports`).auth(token, { type: "bearer" }).send(body);

  const filed = async (body: Draft = draft(), token = user, phenomenonId = published.id): Promise<Report> =>
    (await file(body, token, phenomenonId).expect(201)).body as Report;

  const mine = async (token = user, query: Record<string, string | number> = {}): Promise<Page> =>
    (await http().get("/accounts/me/incident-reports").query(query).auth(token, { type: "bearer" }).expect(200)).body as Page;

  const ofPhenomenon = (query: Record<string, string | number> = {}, token = analyst, phenomenonId = published.id) =>
    http().get(`/phenomena/${phenomenonId}/incident-reports`).query(query).auth(token, { type: "bearer" });

  describe("filing", () => {
    it("stores the report as filed, with the names of its phenomenon and region and no author", async () => {
      const report = await filed(draft({ values: { victims: 2, severity: "low", weapon: true } }));
      expect(report).toEqual({
        id: report.id,
        phenomenonId: published.id,
        phenomenonName: "Gender violence",
        regionId: 1,
        regionName: "Centro",
        occurredOn: "2026-11-01",
        description: "It happened near the market.",
        values: { victims: 2, severity: "low", weapon: true },
        createdAt: report.createdAt,
      });
      expect(report.id).toBeGreaterThan(0);
    });

    it("files a report with no description, and returns it without one", async () => {
      const report = await filed({ ...draft(), description: undefined });
      expect(report).not.toHaveProperty("description");
      expect((await mine()).items[0]).toEqual(report);
    });

    it("is open to every role, and refused to anonymous visitors", async () => {
      for (const token of [user, analyst, admin]) {
        await filed(draft(), token);
      }
      await http().post(`/phenomena/${published.id}/incident-reports`).send(draft()).expect(401);
    });

    it("accepts an incident that took place today, and refuses one dated tomorrow", async () => {
      await filed(draft({ occurredOn: dayFromToday(0) }));
      const response = await file(draft({ occurredOn: dayFromToday(1) })).expect(400);
      expect(response.body).toMatchObject({ code: "occurred_in_future", details: { path: "/occurredOn" } });
    });

    it("drops fields the contract does not define", async () => {
      const report = await filed({ ...draft(), latitude: 20.65, longitude: -103.35 } as Draft);
      expect(report).not.toHaveProperty("latitude");
      expect(report).not.toHaveProperty("longitude");
    });

    it("refuses a body that does not match the contract", async () => {
      for (const body of [{ ...draft(), description: "" }, { ...draft(), values: { victims: null } }, { ...draft(), occurredOn: "2026-02-30" }]) {
        const response = await file(body as Draft).expect(400);
        expect(response.body).toMatchObject({ code: "invalid_request" });
      }
    });

    it("refuses each broken rule with its own code, pointing at the value at fault", async () => {
      const cases: [Partial<Draft>, string, string][] = [
        [{ regionId: 2 }, "region_not_found", "/regionId"],
        [{ regionId: 999 }, "region_not_found", "/regionId"],
        [{ values: { victims: 1 } }, "missing_characteristic_value", "/values/severity"],
        [{ values: { victims: 1, severity: "high", ghost: 1 } }, "unknown_characteristic", "/values/ghost"],
        [{ values: { victims: 1, severity: "high", witness: "Me" } }, "characteristic_retired", "/values/witness"],
        [{ values: { victims: 1.5, severity: "high" } }, "invalid_characteristic_value", "/values/victims"],
        [{ values: { victims: 0, severity: "high" } }, "number_out_of_range", "/values/victims"],
        [{ values: { victims: 1, severity: "extreme" } }, "unknown_category_option", "/values/severity"],
        [{ values: { victims: 1, severity: "unclear" } }, "category_option_retired", "/values/severity"],
      ];
      const before = (await mine()).items.length;
      for (const [overrides, code, path] of cases) {
        const response = await file(draft(overrides)).expect(400);
        expect(response.body).toMatchObject({ code, details: { path } });
      }
      expect((await mine()).items).toHaveLength(before);
    });

    it("hides draft and archived phenomena from non-admins, and tells admins they accept no reports", async () => {
      for (const status of ["draft", "archived"] as const) {
        const phenomenon = await create(`Not open, ${status}`, status);
        for (const token of [user, analyst]) {
          const response = await file(draft(), token, phenomenon.id).expect(404);
          expect(response.body).toMatchObject({ code: "phenomenon_not_found" });
        }
        const response = await file(draft(), admin, phenomenon.id).expect(409);
        expect(response.body).toMatchObject({ code: "phenomenon_not_accepting_reports" });
      }
    });

    it("answers 404 for a phenomenon that does not exist", async () => {
      const response = await file(draft(), user, 99_999).expect(404);
      expect(response.body).toMatchObject({ code: "phenomenon_not_found" });
    });
  });

  describe("listing one's own reports", () => {
    it("shows only the caller's reports, most recently filed first, page by page", async () => {
      const other = await create("Contaminated water", "published");
      const first = await filed(draft({ description: "Frank's first" }), otherUser);
      const second = await filed(draft({ description: "Frank's second", regionId: 3 }), otherUser, other.id);
      const third = await filed(draft({ description: "Frank's third" }), otherUser);

      const all = await mine(otherUser);
      expect(all.items.map((report) => report.id)).toEqual([third.id, second.id, first.id]);
      expect(all.nextCursor).toBeUndefined();
      expect((await mine(user)).items.map((report) => report.id)).not.toContain(first.id);

      const pageOne = await mine(otherUser, { limit: 2 });
      expect(pageOne.items.map((report) => report.id)).toEqual([third.id, second.id]);
      const pageTwo = await mine(otherUser, { limit: 2, cursor: pageOne.nextCursor ?? "" });
      expect(pageTwo.items.map((report) => report.id)).toEqual([first.id]);
      expect(pageTwo.nextCursor).toBeUndefined();

      const filtered = await mine(otherUser, { phenomenonId: other.id });
      expect(filtered.items).toEqual([second]);
    });

    it("refuses a cursor it did not hand out", async () => {
      const response = await http().get("/accounts/me/incident-reports").query({ cursor: "nope" }).auth(user, { type: "bearer" }).expect(400);
      expect(response.body).toMatchObject({ code: "invalid_cursor" });
    });

    it("is refused to anonymous visitors", async () => {
      await http().get("/accounts/me/incident-reports").expect(401);
    });

    it("keeps the region's name after a later version retires it", async () => {
      const report = await filed(draft({ regionId: 4, description: "In Oeste, before it was retired" }), otherUser);
      const db = createDatabase(databaseUrl);
      try {
        await sql`INSERT INTO partition_version (number) VALUES (3)`.execute(db);
        await sql`UPDATE region SET retired_in = 3 WHERE id = 4`.execute(db);
        await sql`UPDATE region_state SET valid_to = 3 WHERE region_id = 4 AND valid_to IS NULL`.execute(db);
      } finally {
        await db.destroy();
      }
      const listed = (await mine(otherUser)).items.find((item) => item.id === report.id);
      expect(listed).toMatchObject({ regionId: 4, regionName: "Oeste" });
      const response = await file(draft({ regionId: 4 }), otherUser).expect(400);
      expect(response.body).toMatchObject({ code: "region_not_found" });
    });
  });

  describe("listing a phenomenon's reports", () => {
    let phenomenon: Phenomenon;
    let reports: Report[];

    beforeAll(async () => {
      phenomenon = await create("Noise", "published");
      reports = [];
      for (const [regionId, occurredOn] of [
        [1, "2026-10-01"],
        [1, "2026-10-15"],
        [3, "2026-10-20"],
      ] as const) {
        reports.push(await filed(draft({ regionId, occurredOn }), user, phenomenon.id));
      }
    });

    it("is refused to users and anonymous visitors", async () => {
      const response = await ofPhenomenon({}, user, phenomenon.id).expect(403);
      expect(response.body).toMatchObject({ code: "forbidden" });
      await http().get(`/phenomena/${phenomenon.id}/incident-reports`).expect(401);
    });

    it("shows analysts and admins every report, newest first, without their authors", async () => {
      for (const token of [analyst, admin]) {
        const page = (await ofPhenomenon({}, token, phenomenon.id).expect(200)).body as Page;
        expect(page.items).toEqual([...reports].reverse());
        for (const item of page.items) {
          expect(Object.keys(item).sort()).toEqual(
            ["createdAt", "description", "id", "occurredOn", "phenomenonId", "phenomenonName", "regionId", "regionName", "values"].sort(),
          );
        }
      }
    });

    it("filters by region and by a half-open range of incident dates", async () => {
      const [october1, october15] = reports as [Report, Report, Report];
      const byRegion = (await ofPhenomenon({ regionId: 1 }, analyst, phenomenon.id).expect(200)).body as Page;
      expect(byRegion.items.map((report) => report.id)).toEqual([october15.id, october1.id]);

      const byDate = (await ofPhenomenon({ occurredFrom: "2026-10-15", occurredBefore: "2026-10-20" }, analyst, phenomenon.id).expect(200)).body as Page;
      expect(byDate.items.map((report) => report.id)).toEqual([october15.id]);

      const response = await ofPhenomenon({ occurredFrom: "2026-10-20", occurredBefore: "2026-10-20" }, analyst, phenomenon.id).expect(400);
      expect(response.body).toMatchObject({ code: "invalid_date_range" });
    });

    it("answers 404 for a phenomenon that does not exist", async () => {
      const response = await ofPhenomenon({}, analyst, 99_999).expect(404);
      expect(response.body).toMatchObject({ code: "phenomenon_not_found" });
    });
  });

  describe("removing", () => {
    it("is for admins only, and makes the report disappear everywhere", async () => {
      const report = await filed(draft({ description: "Abusive" }));
      for (const token of [user, analyst]) {
        const response = await http().delete(`/incident-reports/${report.id}`).auth(token, { type: "bearer" }).expect(403);
        expect(response.body).toMatchObject({ code: "forbidden" });
      }
      await http().delete(`/incident-reports/${report.id}`).expect(401);

      await http().delete(`/incident-reports/${report.id}`).auth(admin, { type: "bearer" }).expect(204);
      expect((await mine()).items.map((item) => item.id)).not.toContain(report.id);
      const page = (await ofPhenomenon().expect(200)).body as Page;
      expect(page.items.map((item) => item.id)).not.toContain(report.id);

      const response = await http().delete(`/incident-reports/${report.id}`).auth(admin, { type: "bearer" }).expect(404);
      expect(response.body).toMatchObject({ code: "incident_report_not_found" });
    });
  });
});
