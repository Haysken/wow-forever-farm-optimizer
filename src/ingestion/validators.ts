import type {
  NormalizedCreature,
  NormalizedDropObservation,
  NormalizedItem,
  NormalizedItemMarketRow,
} from "@/providers/types";

export interface ValidationResult<T> {
  valid: T[];
  rejected: Array<{ record: T; reason: string }>;
}

export function isValidGameId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

export function validateDropObservations(
  observations: NormalizedDropObservation[],
  knownCreatureIds?: ReadonlySet<number>,
  knownItemIds?: ReadonlySet<number>
): ValidationResult<NormalizedDropObservation> {
  const valid: NormalizedDropObservation[] = [];
  const rejected: Array<{ record: NormalizedDropObservation; reason: string }> = [];

  for (const obs of observations) {
    if (!isValidGameId(obs.creatureId)) {
      rejected.push({ record: obs, reason: `Invalid creatureId: ${obs.creatureId}` });
      continue;
    }
    if (!isValidGameId(obs.itemId)) {
      rejected.push({ record: obs, reason: `Invalid itemId: ${obs.itemId}` });
      continue;
    }
    if (!Number.isFinite(obs.dropRate) || obs.dropRate < 0 || obs.dropRate > 1) {
      rejected.push({
        record: obs,
        reason: `Drop rate out of [0, 1] bounds: ${obs.dropRate}`,
      });
      continue;
    }
    if (obs.killsObserved !== null && obs.killsObserved < 0) {
      rejected.push({
        record: obs,
        reason: `Negative killsObserved: ${obs.killsObserved}`,
      });
      continue;
    }
    if (
      obs.dropsObserved !== null &&
      obs.killsObserved !== null &&
      obs.dropsObserved > obs.killsObserved
    ) {
      rejected.push({
        record: obs,
        reason: `dropsObserved (${obs.dropsObserved}) exceeds killsObserved (${obs.killsObserved})`,
      });
      continue;
    }
    if (knownCreatureIds && !knownCreatureIds.has(obs.creatureId)) {
      rejected.push({
        record: obs,
        reason: `Unknown creatureId not in catalog: ${obs.creatureId}`,
      });
      continue;
    }
    if (knownItemIds && !knownItemIds.has(obs.itemId)) {
      rejected.push({
        record: obs,
        reason: `Unknown itemId not in catalog: ${obs.itemId}`,
      });
      continue;
    }
    valid.push(obs);
  }

  return { valid, rejected };
}

export function validateMarketRows(
  rows: NormalizedItemMarketRow[],
  knownItemIds?: ReadonlySet<number>
): ValidationResult<NormalizedItemMarketRow> {
  const valid: NormalizedItemMarketRow[] = [];
  const rejected: Array<{ record: NormalizedItemMarketRow; reason: string }> = [];

  for (const row of rows) {
    if (!isValidGameId(row.itemId)) {
      rejected.push({ record: row, reason: `Invalid itemId: ${row.itemId}` });
      continue;
    }
    if (row.availableQty < 0 || row.listingCount < 0) {
      rejected.push({ record: row, reason: "Negative availableQty or listingCount" });
      continue;
    }
    if (row.lowestBuyoutCopper !== null && row.lowestBuyoutCopper < 0) {
      rejected.push({ record: row, reason: "Negative lowestBuyoutCopper" });
      continue;
    }
    if (row.medianCopper !== null && row.medianCopper < 0) {
      rejected.push({ record: row, reason: "Negative medianCopper" });
      continue;
    }
    if (knownItemIds && !knownItemIds.has(row.itemId)) {
      rejected.push({
        record: row,
        reason: `Unknown itemId not in catalog: ${row.itemId}`,
      });
      continue;
    }
    valid.push(row);
  }

  return { valid, rejected };
}

export function deduplicateById<T extends { id: number }>(
  records: T[]
): { unique: T[]; duplicateCount: number } {
  const map = new Map<number, T>();
  let duplicateCount = 0;

  for (const record of records) {
    if (!isValidGameId(record.id)) continue;
    if (map.has(record.id)) {
      duplicateCount++;
    }
    map.set(record.id, record);
  }

  return { unique: Array.from(map.values()), duplicateCount };
}

export function indexCatalogIds(
  itemsList: Pick<NormalizedItem, "id">[],
  creaturesList: Pick<NormalizedCreature, "id">[]
): { itemIds: Set<number>; creatureIds: Set<number> } {
  return {
    itemIds: new Set(itemsList.map((i) => i.id)),
    creatureIds: new Set(creaturesList.map((c) => c.id)),
  };
}
