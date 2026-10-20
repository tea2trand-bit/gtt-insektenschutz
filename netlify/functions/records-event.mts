import { recordsDB } from "../lib/records-db.mts";
import { createRecord, fromSubmission } from "../lib/records.mts";
import type { FormSubmittedEvent } from "@netlify/functions";
import type { QueryDB } from "../lib/records.mts";

export async function recordSubmission(data: Record<string,string>, db: QueryDB) {
  const input = fromSubmission(data);
  return input ? createRecord(db,input) : null;
}

// Netlify verifies the platform event signature before invoking this handler.
// Independent of customer email: a provider failure cannot prevent the record.
export default {
  async formSubmitted(event: FormSubmittedEvent) {
    await recordSubmission(event.data,recordsDB());
  },
};
