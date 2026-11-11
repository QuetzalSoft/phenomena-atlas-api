/** The roles, lowest first. Each includes everything the roles before it can do. */
export const roles = ["user", "analyst", "admin"] as const;

export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
  return roles.includes(value as Role);
}

/** Whether an account holding `role` may do what `minimum` allows. */
export function roleSatisfies(role: Role, minimum: Role): boolean {
  return roles.indexOf(role) >= roles.indexOf(minimum);
}
