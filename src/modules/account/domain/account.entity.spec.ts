import { describe, expect, it } from "vitest";
import { Account } from "./account.entity.js";
import { OwnRoleChangeForbiddenError } from "./account.errors.js";
import { type Role, roleSatisfies, roles } from "./role.js";

const account = (id: string, role: Role) => Account.restore({ id, subject: `subject-${id}`, role, createdAt: new Date() });

describe("roles", () => {
  it("form a hierarchy: each role includes the ones below it", () => {
    const allowed = roles.flatMap((role) => roles.filter((minimum) => roleSatisfies(role, minimum)).map((m) => `${role}>=${m}`));

    expect(allowed).toEqual([
      "user>=user",
      "analyst>=user",
      "analyst>=analyst",
      "admin>=user",
      "admin>=analyst",
      "admin>=admin",
    ]);
  });
});

describe("Account", () => {
  it("lets someone else change its role", () => {
    const target = account("a", "user");

    expect(target.changeRole("analyst", account("b", "admin")).isOk()).toBe(true);
    expect(target.role).toBe("analyst");
  });

  it("does not let an account change its own role", () => {
    const admin = account("a", "admin");

    const result = admin.changeRole("user", admin);

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(OwnRoleChangeForbiddenError);
    expect(admin.role).toBe("admin");
  });
});
