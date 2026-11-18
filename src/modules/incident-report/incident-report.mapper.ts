import type { Schemas } from "../../libs/api/contract.js";
import type { IncidentReportDraft } from "./domain/incident-report.js";

/**
 * A report from a request, rebuilt field by field. The contract's schemas allow extra
 * properties, and this keeps them out of what is stored. Every value is checked against the
 * phenomenon before it is stored.
 */
export function draftFromRequest(body: Schemas["IncidentReportDraft"]): IncidentReportDraft {
  return {
    regionId: body.regionId,
    occurredOn: body.occurredOn,
    description: body.description,
    values: { ...body.values },
  };
}
