/**
 * The transaction-level advisory lock that guards the partition. A save holds it exclusively,
 * so saves queue behind each other; anything that must see the partition unchanged until its
 * transaction ends holds it shared. Any number: it only needs to be the same everywhere.
 */
export const partitionLockKey = 4_203_311;
