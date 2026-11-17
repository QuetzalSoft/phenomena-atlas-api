import { Query } from "@nestjs/cqrs";
import type { Schemas } from "../../../../libs/api/contract.js";

/** One report as the contract returns it, or undefined. Not an operation of its own: commands read back what they wrote with it. */
export class GetIncidentReportQuery extends Query<Schemas["IncidentReport"] | undefined> {
  constructor(readonly id: number) {
    super();
  }
}
