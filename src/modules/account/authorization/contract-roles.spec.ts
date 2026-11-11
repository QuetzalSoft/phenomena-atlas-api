import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { contractSpecPath } from "../../../libs/api/contract.js";
import { isRole } from "../domain/role.js";
import { minimumRoleExtension } from "./authorization.guard.js";

interface Operation {
  operationId?: string;
  security?: Record<string, unknown>[];
  [key: string]: unknown;
}

const methods = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

// The guard refuses to serve a protected operation without a minimum role, with a 500. This
// catches that against the pinned contract before a request ever does.
describe("the pinned contract", () => {
  it("states a known minimum role for every operation that needs a token", async () => {
    const document = parse(await readFile(contractSpecPath, "utf8")) as { paths: Record<string, Record<string, Operation>> };
    const operations = Object.values(document.paths).flatMap((path) =>
      Object.entries(path)
        .filter(([method]) => methods.includes(method))
        .map(([, operation]) => operation),
    );

    const unprotected = (operation: Operation) => operation.security?.some((s) => Object.keys(s).length === 0) ?? false;
    const missing = operations
      .filter((operation) => !unprotected(operation) && !isRole(operation[minimumRoleExtension]))
      .map((operation) => operation.operationId);

    expect(operations.length).toBeGreaterThan(1);
    expect(missing).toEqual([]);
  });
});
