import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Schemas } from "../src/libs/api/contract.js";
import { signInAs } from "./support/accounts.js";
import { startTestApp } from "./support/app.js";

// grace is the admin who defines phenomena, heidi an analyst and ivan a plain user. No other
// spec creates phenomena, but tests here only assert on the ones they create themselves.

type Definition = Schemas["PhenomenonDefinition"];
type Phenomenon = Schemas["Phenomenon"];
type Characteristic = Schemas["Characteristic"];

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

/** sum(severity) / population * 1000 */
const perThousand: Schemas["WeightingExpression"] = {
  kind: "operation",
  operator: "multiply",
  left: {
    kind: "operation",
    operator: "divide",
    left: { kind: "aggregate", function: "sum", characteristicKey: "severity" },
    right: { kind: "population" },
  },
  right: { kind: "number", value: 1000 },
};

const definition = (overrides: Partial<Definition> = {}): Definition => ({
  name: "Gender violence",
  description: "Reports of gender violence in the metropolitan area.",
  characteristics: [victims, severity, weapon],
  weightingFunction: perThousand,
  ...overrides,
});

describe("phenomena", () => {
  let app: NestExpressApplication;
  let admin: string;
  let analyst: string;
  let user: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await startTestApp();
    [admin, analyst, user] = [await signInAs("grace", "admin"), await signInAs("heidi", "analyst"), await signInAs("ivan", "user")];
  });

  afterAll(async () => {
    await app.close();
  });

  const create = async (body: Definition = definition()): Promise<Phenomenon> =>
    (await http().post("/phenomena").auth(admin, { type: "bearer" }).send(body).expect(201)).body as Phenomenon;

  const publish = async (phenomenon: Phenomenon): Promise<Phenomenon> =>
    (
      await http()
        .put(`/phenomena/${phenomenon.id}/status`)
        .auth(admin, { type: "bearer" })
        .send({ baseRevision: phenomenon.revision, status: "published" })
        .expect(200)
    ).body as Phenomenon;

  const update = (phenomenon: Phenomenon, body: Definition & { refreshIntervalMinutes?: number }, token = admin) =>
    http()
      .put(`/phenomena/${phenomenon.id}`)
      .auth(token, { type: "bearer" })
      .send({ baseRevision: phenomenon.revision, ...body });

  describe("creating", () => {
    it("stores a draft at revision 1, exactly as defined", async () => {
      const created = await create();
      expect(created).toMatchObject({ ...definition(), status: "draft", revision: 1 });
      expect(created.id).toBeGreaterThan(0);

      const read = await http().get(`/phenomena/${created.id}`).auth(admin, { type: "bearer" }).expect(200);
      expect(read.body).toEqual(created);
    });

    it("starts with a refresh interval of 60 minutes", async () => {
      expect(await create()).toMatchObject({ refreshIntervalMinutes: 60 });
    });

    it("keeps a half-built function in a draft", async () => {
      const created = await create(definition({ characteristics: [], weightingFunction: { kind: "blank" } }));
      expect(created.weightingFunction).toEqual({ kind: "blank" });
    });

    it("drops fields the contract does not define", async () => {
      const body = { ...definition(), characteristics: [{ ...weapon, secret: "x" }], weightingFunction: { kind: "population", extra: 1 } };
      const created = await create(body as Definition);
      expect(created.characteristics).toEqual([weapon]);
      expect(created.weightingFunction).toEqual({ kind: "population" });
    });

    it("is refused to analysts, users and anonymous visitors", async () => {
      for (const token of [analyst, user]) {
        const response = await http().post("/phenomena").auth(token, { type: "bearer" }).send(definition()).expect(403);
        expect(response.body).toMatchObject({ code: "forbidden" });
      }
      await http().post("/phenomena").send(definition()).expect(401);
    });

    it("refuses a definition that breaks a rule, pointing at the part at fault", async () => {
      const cases: [Partial<Definition>, string, string][] = [
        [{ characteristics: [weapon, weapon] }, "duplicate_characteristic_key", "/characteristics/1/key"],
        [{ characteristics: [{ ...victims, minimum: 5, maximum: 1 }], weightingFunction: { kind: "population" } }, "invalid_number_range", "/characteristics/0"],
        [{ weightingFunction: { kind: "aggregate", function: "sum", characteristicKey: "ghost" } }, "unknown_characteristic", "/weightingFunction/characteristicKey"],
        [{ weightingFunction: { kind: "aggregate", function: "mean" } }, "invalid_aggregate", "/weightingFunction"],
      ];
      for (const [overrides, code, path] of cases) {
        const response = await http().post("/phenomena").auth(admin, { type: "bearer" }).send(definition(overrides)).expect(400);
        expect(response.body).toMatchObject({ code, details: { path } });
      }
    });

    it("refuses a body that does not match the contract", async () => {
      const response = await http()
        .post("/phenomena")
        .auth(admin, { type: "bearer" })
        .send(definition({ characteristics: [{ ...weapon, key: "Not a key" }] }))
        .expect(400);
      expect(response.body).toMatchObject({ code: "invalid_request" });
    });
  });

  describe("reading", () => {
    it("shows published phenomena to everyone and the rest to admins only", async () => {
      const draft = await create(definition({ name: "Draft only" }));
      const published = await publish(await create(definition({ name: "Published one" })));

      const ids = async (token?: string, status?: string) => {
        let call = http().get("/phenomena");
        if (status) call = call.query({ status });
        if (token) call = call.auth(token, { type: "bearer" });
        return ((await call.expect(200)).body as Schemas["PhenomenonList"]).items.map((item) => item.id);
      };

      for (const token of [undefined, user, analyst]) {
        expect(await ids(token)).toContain(published.id);
        expect(await ids(token)).not.toContain(draft.id);
        const visible = token
          ? http().get(`/phenomena/${published.id}`).auth(token, { type: "bearer" })
          : http().get(`/phenomena/${published.id}`);
        expect((await visible.expect(200)).body).toMatchObject({ id: published.id, status: "published", refreshIntervalMinutes: 60 });
        const hidden = token
          ? http().get(`/phenomena/${draft.id}`).auth(token, { type: "bearer" })
          : http().get(`/phenomena/${draft.id}`);
        expect((await hidden.expect(404)).body).toMatchObject({ code: "phenomenon_not_found" });
      }

      expect(await ids(admin)).toEqual(expect.arrayContaining([draft.id, published.id]));
      expect(await ids(admin, "draft")).toContain(draft.id);
      expect(await ids(admin, "draft")).not.toContain(published.id);
    });

    it("refuses other statuses to anyone but admins", async () => {
      for (const call of [http().get("/phenomena").query({ status: "draft" }), http().get("/phenomena").query({ status: "archived" }).auth(analyst, { type: "bearer" })]) {
        expect((await call.expect(403)).body).toMatchObject({ code: "forbidden" });
      }
      await http().get("/phenomena").query({ status: "published" }).expect(200);
    });

    it("lists by name", async () => {
      await create(definition({ name: "zz last" }));
      await create(definition({ name: "AA first" }));
      const names = ((await http().get("/phenomena").auth(admin, { type: "bearer" }).expect(200)).body as Schemas["PhenomenonList"]).items.map(
        (item) => item.name.toLowerCase(),
      );
      expect(names).toEqual([...names].sort());
    });

    it("lists every phenomenon with its refresh interval", async () => {
      const created = await create(definition({ name: "Listed with its interval" }));
      await update(created, { ...definition({ name: "Listed with its interval" }), refreshIntervalMinutes: 15 }).expect(200);
      const { items } = (await http().get("/phenomena").auth(admin, { type: "bearer" }).expect(200)).body as Schemas["PhenomenonList"];
      expect(items.find((item) => item.id === created.id)).toMatchObject({ refreshIntervalMinutes: 15 });
      for (const item of items) {
        expect(item.refreshIntervalMinutes).toEqual(expect.any(Number));
      }
    });

    it("answers 404 for a phenomenon that does not exist", async () => {
      const response = await http().get("/phenomena/999999").auth(admin, { type: "bearer" }).expect(404);
      expect(response.body).toMatchObject({ code: "phenomenon_not_found" });
    });
  });

  describe("changing", () => {
    it("replaces the definition and increases the revision", async () => {
      const created = await create();
      const response = await update(created, definition({ name: "Renamed", characteristics: [...definition().characteristics, { type: "date", key: "occurred_on", label: "Date", required: false, retired: false }] })).expect(200);
      expect(response.body).toMatchObject({ name: "Renamed", revision: 2 });
      expect(Date.parse((response.body as Phenomenon).updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
    });

    it("saves a new refresh interval, increasing the revision", async () => {
      const created = await create();
      const response = await update(created, { ...definition(), refreshIntervalMinutes: 360 }).expect(200);
      expect(response.body).toMatchObject({ refreshIntervalMinutes: 360, revision: 2 });

      const read = await http().get(`/phenomena/${created.id}`).auth(admin, { type: "bearer" }).expect(200);
      expect(read.body).toMatchObject({ refreshIntervalMinutes: 360, revision: 2 });
    });

    it("keeps the refresh interval when a change leaves it out", async () => {
      const created = await create();
      const changed = (await update(created, { ...definition(), refreshIntervalMinutes: 360 }).expect(200)).body as Phenomenon;

      const response = await update(changed, definition({ name: "Renamed only" })).expect(200);
      expect(response.body).toMatchObject({ name: "Renamed only", refreshIntervalMinutes: 360, revision: 3 });
    });

    it("refuses a refresh interval under 5 minutes or over 30 days, changing nothing", async () => {
      const created = await create();
      for (const refreshIntervalMinutes of [4, 43201]) {
        const response = await update(created, { ...definition({ name: "Not saved" }), refreshIntervalMinutes }).expect(400);
        expect(response.body).toMatchObject({
          code: "invalid_request",
          details: { errors: [expect.objectContaining({ path: "/body/refreshIntervalMinutes" })] },
        });
      }

      const read = await http().get(`/phenomena/${created.id}`).auth(admin, { type: "bearer" }).expect(200);
      expect(read.body).toEqual(created);
    });

    it("refuses a change made against an older revision", async () => {
      const created = await create();
      await update(created, definition({ name: "First" })).expect(200);
      const response = await update(created, definition({ name: "Second" })).expect(409);
      expect(response.body).toMatchObject({ code: "phenomenon_revision_conflict" });
    });

    it("keeps every saved characteristic and its type once published", async () => {
      const published = await publish(await create());

      const removed = await update(published, definition({ characteristics: [victims, severity] })).expect(400);
      expect(removed.body).toMatchObject({ code: "characteristic_removed", details: { key: "weapon" } });

      const retyped = await update(published, definition({ characteristics: [victims, severity, { ...victims, key: "weapon" }] })).expect(400);
      expect(retyped.body).toMatchObject({ code: "characteristic_type_changed", details: { path: "/characteristics/2/type" } });

      const lessOptions = { ...severity, options: severity.options.slice(1) } as Characteristic;
      const dropped = await update(published, definition({ characteristics: [victims, lessOptions, weapon] })).expect(400);
      expect(dropped.body).toMatchObject({ code: "category_option_removed" });

      const retired = await update(published, definition({ characteristics: [victims, severity, { ...weapon, retired: true }] })).expect(200);
      expect((retired.body as Phenomenon).characteristics[2]).toMatchObject({ key: "weapon", retired: true });
    });

    it("refuses a function that uses a retired characteristic", async () => {
      const created = await create();
      const response = await update(created, definition({ characteristics: [victims, { ...severity, retired: true }, weapon] })).expect(400);
      expect(response.body).toMatchObject({ code: "characteristic_retired", details: { path: "/weightingFunction/left/left/characteristicKey" } });
    });

    it("refuses a blank in a published function", async () => {
      const published = await publish(await create());
      const response = await update(published, definition({ weightingFunction: { kind: "blank" } })).expect(400);
      expect(response.body).toMatchObject({ code: "incomplete_weighting_function", details: { path: "/weightingFunction" } });
    });

    it("is refused to analysts and users", async () => {
      const created = await create();
      for (const token of [analyst, user]) {
        expect((await update(created, definition(), token).expect(403)).body).toMatchObject({ code: "forbidden" });
      }
    });

    it("answers 404 for a phenomenon that does not exist", async () => {
      const response = await http().put("/phenomena/999999").auth(admin, { type: "bearer" }).send({ baseRevision: 1, ...definition() }).expect(404);
      expect(response.body).toMatchObject({ code: "phenomenon_not_found" });
    });
  });

  describe("status", () => {
    const changeStatus = (phenomenon: Phenomenon, status: string, token = admin) =>
      http().put(`/phenomena/${phenomenon.id}/status`).auth(token, { type: "bearer" }).send({ baseRevision: phenomenon.revision, status });

    it("publishes, archives and republishes", async () => {
      const published = await publish(await create());
      expect(published).toMatchObject({ status: "published", revision: 2 });
      const archived = (await changeStatus(published, "archived").expect(200)).body as Phenomenon;
      expect(archived.status).toBe("archived");
      await http().get(`/phenomena/${archived.id}`).expect(404);
      expect((await changeStatus(archived, "published").expect(200)).body).toMatchObject({ status: "published", revision: 4 });
    });

    it("refuses to publish a function with a blank", async () => {
      const created = await create(definition({ weightingFunction: { kind: "operation", operator: "divide", left: { kind: "aggregate", function: "count" }, right: { kind: "blank" } } }));
      const response = await changeStatus(created, "published").expect(400);
      expect(response.body).toMatchObject({ code: "incomplete_weighting_function", details: { path: "/weightingFunction/right" } });
    });

    it("refuses a transition the life of a phenomenon does not have", async () => {
      const created = await create();
      expect((await changeStatus(created, "archived").expect(409)).body).toMatchObject({ code: "invalid_status_transition" });
      const published = await publish(created);
      expect((await changeStatus(published, "draft").expect(409)).body).toMatchObject({ code: "invalid_status_transition" });
    });

    it("refuses a change made against an older revision", async () => {
      const created = await create();
      await update(created, definition({ name: "Moved on" })).expect(200);
      expect((await changeStatus(created, "published").expect(409)).body).toMatchObject({ code: "phenomenon_revision_conflict" });
    });

    it("is refused to analysts", async () => {
      const created = await create();
      await changeStatus(created, "published", analyst).expect(403);
    });
  });

  describe("deleting", () => {
    it("deletes a draft for good", async () => {
      const created = await create();
      await http().delete(`/phenomena/${created.id}`).auth(admin, { type: "bearer" }).expect(204);
      await http().get(`/phenomena/${created.id}`).auth(admin, { type: "bearer" }).expect(404);
    });

    it("refuses to delete a phenomenon that was published", async () => {
      const published = await publish(await create());
      const response = await http().delete(`/phenomena/${published.id}`).auth(admin, { type: "bearer" }).expect(409);
      expect(response.body).toMatchObject({ code: "phenomenon_not_draft" });
    });

    it("is refused to analysts and users", async () => {
      const created = await create();
      for (const token of [analyst, user]) {
        await http().delete(`/phenomena/${created.id}`).auth(token, { type: "bearer" }).expect(403);
      }
    });
  });
});
