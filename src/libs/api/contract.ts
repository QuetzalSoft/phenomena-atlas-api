import { fileURLToPath } from "node:url";
import type { components } from "@quetzalsoft/phenomena-atlas-contract";

/** Response and request shapes come from the pinned contract package, never from this code. */
export type Schemas = components["schemas"];

/** The OpenAPI document of the pinned contract version. Requests are validated against it. */
export const contractSpecPath = fileURLToPath(
  import.meta.resolve("@quetzalsoft/phenomena-atlas-contract/openapi.yaml"),
);
