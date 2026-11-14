import { getDatabase } from "./sqlite-runtime.mjs";

export { getRawDatabase } from "./sqlite-runtime.mjs";
export type { SqlDatabase, SqlPreparedStatement, SqlResult } from "./sqlite-runtime.mjs";

/** Lazy by design: static builds and module imports never create a database. */
export const database = getDatabase;
