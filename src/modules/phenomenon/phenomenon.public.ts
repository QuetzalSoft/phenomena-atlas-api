// What other modules may use from the phenomenon module. Anything not exported here is internal.
export { type PhenomenonSummary, PhenomenonReader } from "./database/phenomenon.reader.js";
export type { CategoryOption, Characteristic, CharacteristicType } from "./domain/characteristic.js";
export type { PhenomenonStatus } from "./domain/phenomenon.entity.js";
export { PhenomenonNotFoundError } from "./domain/phenomenon.errors.js";
export { PhenomenonModule } from "./phenomenon.module.js";
