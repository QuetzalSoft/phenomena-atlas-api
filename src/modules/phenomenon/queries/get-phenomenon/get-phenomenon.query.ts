import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";

/** One phenomenon. Resolves to undefined when there is none the caller may see. */
export class GetPhenomenonQuery extends Query<Schemas["Phenomenon"] | undefined> {
  constructor(
    readonly id: number,
    /** Whether drafts and archived phenomena count, which only admins see. */
    readonly visibility: { includeUnpublished: boolean },
  ) {
    super();
  }
}
