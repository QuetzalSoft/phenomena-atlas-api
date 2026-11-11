/** A GeoJSON MultiPolygon (RFC 7946): longitude, then latitude. */
export interface MultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

/**
 * Whether the multipolygon is well formed: at least one polygon, every ring closed with at
 * least four positions of two or three finite numbers. Topology, such as self-intersection,
 * is checked by the database.
 */
export function isWellFormedMultiPolygon(geometry: MultiPolygon): boolean {
  return (
    geometry.coordinates.length > 0 &&
    geometry.coordinates.every((polygon) => polygon.length > 0 && polygon.every(isClosedRing))
  );
}

function isClosedRing(ring: number[][]): boolean {
  if (ring.length < 4 || !ring.every(isPosition)) {
    return false;
  }
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  return first[0] === last[0] && first[1] === last[1];
}

function isPosition(position: number[]): boolean {
  return (position.length === 2 || position.length === 3) && position.every(Number.isFinite);
}
