import type { MultiPolygon } from "./geometry.js";

/**
 * What a failed save points at, so a client can highlight it: existing regions by id, new
 * ones by their position in the change's `regions`, and the offending area when there is one.
 */
export interface PartitionErrorDetails {
  regionIds?: number[];
  draftIndexes?: number[];
  geometry?: MultiPolygon;
}

/** A save the partition rules refuse. Every subclass has a stable code. */
export abstract class PartitionChangeError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    public details: PartitionErrorDetails = {},
  ) {
    super(message);
  }
}

export class PartitionVersionConflictError extends PartitionChangeError {
  readonly code = "partition_version_conflict";

  constructor() {
    super("The partition changed since the version this change was made against. Reload it and try again.");
  }
}

export class EmptyChangeError extends PartitionChangeError {
  readonly code = "empty_change";

  constructor() {
    super("The change creates, changes and retires no region.");
  }
}

export class DuplicateRegionInChangeError extends PartitionChangeError {
  readonly code = "duplicate_region_in_change";

  constructor(regionIds: number[]) {
    super("A region appears more than once in the change.", { regionIds });
  }
}

export class RegionNotFoundError extends PartitionChangeError {
  readonly code = "region_not_found";

  constructor(regionIds: number[]) {
    super("No current region has that id.", { regionIds });
  }
}

export class InvalidGeometryError extends PartitionChangeError {
  readonly code = "invalid_geometry";

  constructor(details: PartitionErrorDetails) {
    super("A region's geometry is empty or not a valid multipolygon.", details);
  }
}

export class RegionCrossesMunicipalityError extends PartitionChangeError {
  readonly code = "region_crosses_municipality";

  constructor(details: PartitionErrorDetails) {
    super("A region reaches into another municipality, or would move to another one.", details);
  }
}

export class RegionOutOfAreaError extends PartitionChangeError {
  readonly code = "region_out_of_area";

  constructor(details: PartitionErrorDetails) {
    super("A region reaches outside the metropolitan area.", details);
  }
}

export class RegionOverlapError extends PartitionChangeError {
  readonly code = "region_overlap";

  constructor(details: PartitionErrorDetails) {
    super("Two regions overlap.", details);
  }
}

export class PartitionGapError extends PartitionChangeError {
  readonly code = "partition_gap";

  constructor(details: PartitionErrorDetails) {
    super("Part of a municipality is left without a region.", details);
  }
}

export class PartitionNotLoadedError extends Error {
  readonly code = "partition_not_loaded";

  constructor() {
    super("The initial region partition has not been loaded yet.");
  }
}

export class PartitionVersionNotFoundError extends Error {
  readonly code = "partition_version_not_found";

  constructor() {
    super("There is no partition version with that number.");
  }
}
