import { type Expression, type RawBuilder, sql } from "kysely";
import type { MultiPolygon } from "../domain/geometry.js";

/**
 * Region geometries live on a fixed grid of 1e-9 degrees, about 0.1 mm, and every overlay
 * (intersection, difference, union) runs on it. In floating-point mode, overlaying hundreds
 * of neighbouring polygons opens and closes slivers of several square metres along their
 * borders; on a fixed grid, borders shared by neighbours stay identical.
 */
export const grid = sql.raw("0.000000001::double precision");

/**
 * A geometry as GeoJSON, always a MultiPolygon. Fifteen decimals keep every coordinate as
 * stored, so a client that edits regions sends back borders that match their neighbours
 * exactly, and the partition rules see no slivers that rounding would have opened.
 */
export function asGeoJson(geometry: Expression<unknown>): RawBuilder<MultiPolygon> {
  return sql<MultiPolygon>`ST_AsGeoJSON(ST_Multi(ST_CollectionExtract(${geometry}, 3)), 15)::json`;
}
