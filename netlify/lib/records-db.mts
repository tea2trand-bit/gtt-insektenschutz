import { getDatabase } from "@netlify/database";
let pool: ReturnType<typeof getDatabase>["pool"];
export function recordsDB() { return pool ??= getDatabase().pool; }
