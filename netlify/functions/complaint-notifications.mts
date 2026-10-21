import type {Config,Context} from '@netlify/functions';
import {recordsDB} from '../lib/records-db.mts';
import {dispatchPendingComplaints} from '../lib/complaint-notification.mts';
export default async(_req:Request,context:Context)=>{await dispatchPendingComplaints(recordsDB(),context);return new Response(null,{status:204});};
export const config:Config={schedule:'*/5 * * * *'};
