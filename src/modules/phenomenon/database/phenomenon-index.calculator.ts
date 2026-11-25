import { Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { TransactionManager } from "../../../libs/db/transaction-manager.js";
import type { Characteristic } from "../domain/characteristic.js";
import type { WeightingExpression } from "../domain/weighting-expression.js";
import type { PhenomenonIndexCalculatorPort } from "./phenomenon-index.calculator.port.js";
import { weightingSql } from "./weighting-expression.sql.js";

/**
 * The first half of the two-integer advisory lock that guards one phenomenon's index; the
 * second half is the phenomenon's id. Any number: it only needs to be the same everywhere.
 * The two-integer form never collides with the partition's one-integer lock.
 */
export const phenomenonIndexLockSpace = 4_203_312;

/**
 * Recomputes a phenomenon's index and stores it as its last computation. See ADR 0016 in the
 * system repository.
 *
 * Reads the incident report and region tables directly, in one read-only query: an explicit
 * exception to the rule that modules reach each other only through events or a facade,
 * because ADR 0012 requires evaluating the weighting function in SQL.
 */
@Injectable()
export class PhenomenonIndexCalculator implements PhenomenonIndexCalculatorPort {
  constructor(private readonly transactions: TransactionManager) {}

  private get db() {
    return this.transactions.connection;
  }

  /**
   * The published phenomena that are due: never computed, their refresh interval elapsed
   * since the last computation started, their revision changed, or the partition changed.
   * Never computed first, then the most overdue, then by id. Time is Postgres's.
   *
   * None while there is no partition: there is no map to compute, and recompute would skip
   * every one of them. Those never computed are due at the first tick after one is loaded.
   */
  async findDue(): Promise<number[]> {
    const { rows } = await sql<{ id: number }>`
      SELECT phenomenon.id
      FROM phenomenon
      LEFT JOIN phenomenon_index_computation AS computation ON computation.phenomenon_id = phenomenon.id
      WHERE phenomenon.status = 'published'
        AND EXISTS (SELECT 1 FROM partition_version)
        AND (
          computation.phenomenon_id IS NULL
          OR computation.computed_at + make_interval(mins => phenomenon.refresh_interval_minutes) <= now()
          OR computation.phenomenon_revision <> phenomenon.revision
          OR computation.partition_version <> (SELECT max(number) FROM partition_version)
        )
      ORDER BY
        computation.phenomenon_id IS NULL DESC,
        computation.computed_at + make_interval(mins => phenomenon.refresh_interval_minutes),
        phenomenon.id
    `.execute(this.db);
    return rows.map((row) => row.id);
  }

  /**
   * Replaces the phenomenon's index with a new computation over the current partition, in
   * the open transaction or in one of its own. Readers see the previous computation complete
   * until it commits, and a failure leaves the previous one in place.
   *
   * With `wait`, it waits for a computation of the same phenomenon that is under way;
   * without it, it gives up at once. Either way, a phenomenon that is not published is left
   * alone, and so is every phenomenon while there is no partition: with no regions there is
   * no map to compute, and a phenomenon left without a computation is due as soon as one
   * exists. Resolves to whether it computed.
   */
  recompute(phenomenonId: number, { wait }: { wait: boolean }): Promise<"computed" | "skipped"> {
    return this.transactions.run(async () => {
      if (!(await this.lock(phenomenonId, wait))) {
        return "skipped";
      }

      // Not locked for share: whoever publishes holds the row for update and then waits for
      // this lock, so taking the row here would deadlock with them.
      const phenomenon = await this.db
        .selectFrom("phenomenon")
        .select(["status", "revision", "characteristics", "weighting_function"])
        .where("id", "=", phenomenonId)
        .executeTakeFirst();
      if (phenomenon?.status !== "published") {
        return "skipped";
      }

      // The partition's lock is not taken, so a partition saved between this read and the
      // insert below leaves the computation recording the version before the one it used. It
      // corrects itself: the recorded version no longer matches the latest, so the phenomenon
      // is due again at the next tick.
      const { version } = await this.db
        .selectFrom("partition_version")
        .select((eb) => eb.fn.max("number").as("version"))
        .executeTakeFirstOrThrow();
      if (version === null) {
        return "skipped";
      }

      await this.db.deleteFrom("phenomenon_index").where("phenomenon_id", "=", phenomenonId).execute();

      // Before the values, which reference it. now() is when the transaction started.
      const computation = {
        computed_at: sql<Date>`now()`,
        phenomenon_revision: phenomenon.revision,
        partition_version: version,
      };
      await this.db
        .insertInto("phenomenon_index_computation")
        .values({ phenomenon_id: phenomenonId, ...computation })
        .onConflict((conflict) => conflict.column("phenomenon_id").doUpdateSet(computation))
        .execute();

      // Only ever written from a checked domain definition.
      const value = weightingSql(
        phenomenon.weighting_function as WeightingExpression,
        phenomenon.characteristics as Characteristic[],
        { report: "report", regionState: "current_region" },
      );
      await sql`
        WITH current_region AS (
          SELECT region_id, population, geometry FROM region_state WHERE valid_to IS NULL
        ),
        -- Retired regions that hold reports of this phenomenon: each is mapped once, not once
        -- per report.
        retired_region AS (
          SELECT DISTINCT incident_report.region_id
          FROM incident_report
          JOIN region ON region.id = incident_report.region_id
          WHERE incident_report.phenomenon_id = ${phenomenonId} AND region.retired_in IS NOT NULL
        ),
        -- Each to the current region that overlaps most with its last shape; ties go to the
        -- lowest id, so that the computation is reproducible. Some current region always
        -- overlaps it: ADR 0011 keeps the partition covering the whole metropolitan area.
        absorbed_by AS (
          SELECT retired_region.region_id AS retired_id, absorber.region_id AS current_id
          FROM retired_region
          CROSS JOIN LATERAL (
            SELECT geometry FROM region_state
            WHERE region_state.region_id = retired_region.region_id
            ORDER BY valid_from DESC
            LIMIT 1
          ) AS last_shape
          CROSS JOIN LATERAL (
            SELECT current_region.region_id FROM current_region
            WHERE ST_Intersects(current_region.geometry, last_shape.geometry)
            ORDER BY ST_Area(ST_Intersection(current_region.geometry, last_shape.geometry)) DESC, current_region.region_id
            LIMIT 1
          ) AS absorber
        ),
        report AS (
          SELECT incident_report.id, coalesce(absorbed_by.current_id, incident_report.region_id) AS region_id,
            incident_report.characteristic_values
          FROM incident_report
          LEFT JOIN absorbed_by ON absorbed_by.retired_id = incident_report.region_id
          WHERE incident_report.phenomenon_id = ${phenomenonId}
        )
        INSERT INTO phenomenon_index (phenomenon_id, region_id, value)
        SELECT ${phenomenonId}::integer, current_region.region_id, ${value}
        FROM current_region
        -- A region without reports still gets its row.
        LEFT JOIN report ON report.region_id = current_region.region_id
        GROUP BY current_region.region_id, current_region.population
      `.execute(this.db);

      return "computed";
    });
  }

  /** The phenomenon's transaction-level lock, waited for or only tried. Whether it was taken. */
  private async lock(phenomenonId: number, wait: boolean): Promise<boolean> {
    if (wait) {
      await sql`SELECT pg_advisory_xact_lock(${phenomenonIndexLockSpace}::integer, ${phenomenonId}::integer)`.execute(this.db);
      return true;
    }
    const { rows } = await sql<{ locked: boolean }>`
      SELECT pg_try_advisory_xact_lock(${phenomenonIndexLockSpace}::integer, ${phenomenonId}::integer) AS locked
    `.execute(this.db);
    return rows[0]?.locked === true;
  }
}
