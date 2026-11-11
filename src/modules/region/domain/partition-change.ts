import { err, ok, type Result } from "neverthrow";
import { isWellFormedMultiPolygon, type MultiPolygon } from "./geometry.js";
import {
  DuplicateRegionInChangeError,
  EmptyChangeError,
  InvalidGeometryError,
  type PartitionChangeError,
  PartitionVersionConflictError,
  RegionCrossesMunicipalityError,
  RegionNotFoundError,
  RegionOutOfAreaError,
} from "./region.errors.js";

/** A region as a change sends it: new without an id, an existing region with one. */
export interface RegionDraft {
  id?: number;
  municipalityCode: string;
  name: string;
  population: number;
  geometry: MultiPolygon;
}

export interface PartitionChange {
  baseVersion: number;
  regions: RegionDraft[];
  retiredRegionIds: number[];
}

/** What the partition holds before the change: its latest version and its current regions. */
export interface PartitionState {
  latestVersion: number;
  /** Current, not retired, regions by id, with the municipality each lies in. */
  regions: ReadonlyMap<number, { municipalityCode: string }>;
  municipalityCodes: ReadonlySet<string>;
}

export interface PlannedDraft extends RegionDraft {
  /** The draft's position in the change, so errors about new regions can point at it. */
  index: number;
}

/** A change that passed every rule the database is not needed for, ready to apply. */
export interface PlannedChange {
  version: number;
  created: PlannedDraft[];
  changed: (PlannedDraft & { id: number })[];
  retired: number[];
}

/**
 * Checks a change against the rules that need no geometry operations, and plans it as the
 * next version. Overlaps, gaps and containment are checked after the change is applied.
 */
export function planChange(change: PartitionChange, state: PartitionState): Result<PlannedChange, PartitionChangeError> {
  if (change.baseVersion !== state.latestVersion) {
    return err(new PartitionVersionConflictError());
  }
  if (change.regions.length === 0 && change.retiredRegionIds.length === 0) {
    return err(new EmptyChangeError());
  }

  const mentioned = [...change.regions.flatMap((draft) => (draft.id === undefined ? [] : [draft.id])), ...change.retiredRegionIds];
  const duplicates = unique(mentioned.filter((id, position) => mentioned.indexOf(id) !== position));
  if (duplicates.length > 0) {
    return err(new DuplicateRegionInChangeError(duplicates));
  }
  const missing = mentioned.filter((id) => !state.regions.has(id));
  if (missing.length > 0) {
    return err(new RegionNotFoundError(missing));
  }

  const drafts = change.regions.map((draft, index) => ({ ...draft, index }));
  const moved = drafts.filter((draft) => draft.id !== undefined && state.regions.get(draft.id)?.municipalityCode !== draft.municipalityCode);
  if (moved.length > 0) {
    return err(new RegionCrossesMunicipalityError(pointAt(moved)));
  }
  const outside = drafts.filter((draft) => !state.municipalityCodes.has(draft.municipalityCode));
  if (outside.length > 0) {
    return err(new RegionOutOfAreaError(pointAt(outside)));
  }
  const malformed = drafts.filter((draft) => !isWellFormedMultiPolygon(draft.geometry));
  if (malformed.length > 0) {
    return err(new InvalidGeometryError(pointAt(malformed)));
  }

  return ok({
    version: state.latestVersion + 1,
    created: drafts.filter((draft) => draft.id === undefined),
    changed: drafts.filter((draft): draft is PlannedDraft & { id: number } => draft.id !== undefined),
    retired: change.retiredRegionIds,
  });
}

/** Error details naming existing drafts by id and new ones by position. */
export function pointAt(drafts: PlannedDraft[]): { regionIds?: number[]; draftIndexes?: number[] } {
  const regionIds = drafts.flatMap((draft) => (draft.id === undefined ? [] : [draft.id]));
  const draftIndexes = drafts.flatMap((draft) => (draft.id === undefined ? [draft.index] : []));
  return {
    ...(regionIds.length > 0 && { regionIds }),
    ...(draftIndexes.length > 0 && { draftIndexes }),
  };
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
