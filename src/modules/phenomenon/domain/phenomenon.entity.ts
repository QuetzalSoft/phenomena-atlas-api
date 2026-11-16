import { err, ok, type Result } from "neverthrow";
import { type Characteristic, checkCharacteristics } from "./characteristic.js";
import {
  IncompleteWeightingFunctionError,
  InvalidStatusTransitionError,
  type PhenomenonDefinitionError,
  PhenomenonNotDraftError,
  PhenomenonRevisionConflictError,
} from "./phenomenon.errors.js";
import { checkWeightingFunction, findBlank, type WeightingExpression } from "./weighting-expression.js";

export type PhenomenonStatus = "draft" | "published" | "archived";

/** What an admin defines about a phenomenon. */
export interface PhenomenonDefinition {
  name: string;
  description: string;
  characteristics: Characteristic[];
  weightingFunction: WeightingExpression;
}

export interface PhenomenonProps extends PhenomenonDefinition {
  id: number;
  status: PhenomenonStatus;
  revision: number;
}

/** The status changes allowed, by current status. Nothing goes back to draft. */
const transitions: Record<PhenomenonStatus, readonly PhenomenonStatus[]> = {
  draft: ["published"],
  published: ["archived"],
  archived: ["published"],
};

/**
 * Something the atlas maps. Its definition only grows, because the incident reports filed
 * under any earlier definition are immutable and must stay described by it. ADR 0012.
 */
export class Phenomenon {
  private constructor(private props: PhenomenonProps) {}

  /** Checks a new phenomenon's definition. It starts as a draft, which may hold blanks. */
  static checkNew(definition: PhenomenonDefinition): Result<PhenomenonDefinition, PhenomenonDefinitionError> {
    return checkDefinition(definition, [], "draft").map(() => definition);
  }

  static restore(props: PhenomenonProps): Phenomenon {
    return new Phenomenon({ ...props });
  }

  get id(): number {
    return this.props.id;
  }

  get status(): PhenomenonStatus {
    return this.props.status;
  }

  toProps(): PhenomenonProps {
    return { ...this.props };
  }

  /** Replaces the definition as a whole, if it was made against the latest revision. */
  redefine(
    definition: PhenomenonDefinition,
    baseRevision: number,
  ): Result<void, PhenomenonDefinitionError | PhenomenonRevisionConflictError> {
    if (baseRevision !== this.props.revision) {
      return err(new PhenomenonRevisionConflictError());
    }
    const checked = checkDefinition(definition, this.props.characteristics, this.props.status);
    if (checked.isErr()) {
      return err(checked.error);
    }
    this.props = { ...this.props, ...definition, revision: this.props.revision + 1 };
    return ok(undefined);
  }

  /** Publishes, archives or republishes. Publishing needs a function with no blank. */
  changeStatus(
    status: PhenomenonStatus,
    baseRevision: number,
  ): Result<void, PhenomenonRevisionConflictError | InvalidStatusTransitionError | IncompleteWeightingFunctionError> {
    if (baseRevision !== this.props.revision) {
      return err(new PhenomenonRevisionConflictError());
    }
    if (!transitions[this.props.status].includes(status)) {
      return err(new InvalidStatusTransitionError(this.props.status, status));
    }
    const blank = status === "published" ? findBlank(this.props.weightingFunction) : undefined;
    if (blank !== undefined) {
      return err(new IncompleteWeightingFunctionError(blank));
    }
    this.props = { ...this.props, status, revision: this.props.revision + 1 };
    return ok(undefined);
  }

  /** Only a draft can be deleted: one ever published may have reports. */
  checkDeletable(): Result<void, PhenomenonNotDraftError> {
    return this.props.status === "draft" ? ok(undefined) : err(new PhenomenonNotDraftError());
  }
}

function checkDefinition(
  definition: PhenomenonDefinition,
  saved: readonly Characteristic[],
  status: PhenomenonStatus,
): Result<void, PhenomenonDefinitionError> {
  return checkCharacteristics(definition.characteristics, saved).andThen(() =>
    checkWeightingFunction(definition.weightingFunction, definition.characteristics, { complete: status !== "draft" }),
  );
}
