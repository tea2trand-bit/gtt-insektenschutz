import type {Config,Context} from '@netlify/functions';
import {recordsDB} from '../lib/records-db.mts';
import {dispatchPendingInvoices} from '../lib/invoices.mts';
export default async(_req:Request,context:Context)=>{await dispatchPendingInvoices(recordsDB(),context);return new Response(null,{status:204});};
export const config:Config={schedule:'*/5 * * * *'};
