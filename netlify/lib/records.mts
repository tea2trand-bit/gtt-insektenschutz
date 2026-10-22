import { createHash, randomUUID } from "node:crypto";
import {INVOICE_ACCOUNT_CONFIRMED} from './invoice-settings.mts';

export const STATUSES = ["Novi upit", "Ponuda poslata", "Čeka odgovor", "Prihvaćeno", "Odbijeno", "Montaža", "Završeno"];
export class RecordError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const text = (v: unknown, max = 6000) => typeof v === "string" ? v.trim().slice(0, max) : "";
export function amount(v: unknown): number | null {
  if (v === "" || v == null) return null;
  if (typeof v !== "number" && typeof v !== "string") throw new RecordError("Unesi ispravan iznos u CHF.");
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new RecordError("Unesi ispravan iznos u CHF.");
  return Math.round(n * 100) / 100;
}
export function date(v: unknown): string {
  const s = text(v, 10);
  if (s && (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s)) throw new RecordError("Datum nije ispravan.");
  return s;
}
function calcAmount(v: string): number | null {
  const clean = v.replace(/^(?:Fixpreis|Orientierungspreis|Richtpreis)\s*:\s*/i, "").replace(/CHF/gi, "").replace(/[’'\s]/g, "").replace(/\.?[–—-]$/, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(clean) ? amount(clean) : null;
}
export function fromSubmission(data: Record<string, unknown>, meta: {id?: string; form?: string; at?: string} = {}) {
  const form = text(meta.form || data.record_source || data["form-name"]);
  const sources: Record<string, string> = { angebot: "Kalkulator", "angebot-netlify-fallback": "Kalkulator", "b2b-anfrage": "B2B", kontakt: "Kontakt", manual: "Ručni unos" };
  if (!sources[form]) return null;
  const raw = Object.fromEntries(Object.entries(data).filter(([k]) => !["bot-field", "ip", "user_agent"].includes(k)).map(([k,v]) => [k, typeof v==='string'?v:""]));
  const inquiryId = text(data.inquiry_id, 100);
  // New forms carry an ID through transport retries. Historical imports use the
  // actual Netlify submission ID; no customer/email matching can merge jobs.
  const stable = inquiryId || meta.id;
  if (!stable) throw new RecordError("Upit nema stabilan ID; proveri formu ili Netlify submission ID.");
  const id = "GTT-" + createHash("sha256").update(stable).digest("hex").slice(0, 24);
  const original = { form, submissionId: meta.id || "", inquiryId, fields: raw, price: calcAmount(text(data.berechneter_preis)), action: text(data.aktion), receivedAt: meta.at || new Date().toISOString() };
  const document = {
    name: text(data.name, 200), company: text(data.firma, 200), email: text(data.email, 250), phone: text(data.telefon, 100), channel: text(data.kanal,100),
    address: text(data.adresse, 500), postalCode: text(data.plz, 80), products: form.startsWith("angebot") ? `Prozori: ${text(data.fensterflaeche_m2) || "0"} m²; vrata: ${text(data.tuerflaeche_m2) || "0"} m²` : "",
    request: text(data.nachricht), notes: "", status: "Novi upit", isTest: /^TEST\b/i.test(text(data.name)),
    quotedPrice: original.price, extraCosts: 0, discount: text(data.aktion, 400), agreedPrice: null,
    offerText: "", offerSentAt: "", decisionDate: "", decisionReason: "", decisionEvidence: "",
    measuredAt: "", orderedAt: "", appointmentAt: "", appointmentTime: "", appointmentNote: "", appointmentStatus: "", installedAt: "", workNotes: "",
    invoiceNumber: "", invoiceAmount: null, invoiceDate: "", invoiceDue: "", payments: [], complaints: [],
  };
  return { id, source: sources[form], original, document };
}
const texts: Record<string, number> = { name:200, company:200, email:250, phone:100, channel:100, address:500, postalCode:80, products:3000, request:6000, notes:6000, discount:400, offerText:10000, decisionReason:2000, decisionEvidence:2000, workNotes:6000, invoiceNumber:100 };
const dates = ["offerSentAt", "decisionDate", "measuredAt", "orderedAt", "appointmentAt", "installedAt", "invoiceDate", "invoiceDue"];
export function applyChange(current: any, body: any, today = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'})) {
  const d = structuredClone(current);
  const kind = body.action || "update";
  if(d.billing){
    if(!['update','archive','restore','complaint'].includes(kind))throw new RecordError('Für diesen Auftrag existiert bereits eine Rechnung. Bitte die Rechnungsaktionen verwenden.',409);
    if(kind==='update'&&Object.keys(body.patch||{}).some(k=>!['name','company','email','phone','channel','address','postalCode','notes','workNotes'].includes(k)))throw new RecordError('Die ausgestellte Rechnung und ihr Betrag können nicht überschrieben werden.',409);
  }
  if(kind==='complete'&&d.intake?.quote&&INVOICE_ACCOUNT_CONFIRMED)throw new RecordError('Bitte den Auftrag mit der Zahlungsart Rechnung, Bar oder TWINT abschliessen.');
  if(d.archivedAt&&!['archive','restore'].includes(kind))throw new RecordError("Upit je uklonjen iz aktivne evidencije. Prvo ga vrati iz arhive.",409);
  if(kind==='archive'){
    if(d.archivedAt)throw new RecordError("Upit je već u arhivi.",409);
    d.archivedAt=new Date().toISOString();
  }else if(kind==='restore'){
    if(!d.archivedAt)throw new RecordError("Upit nije u arhivi.",409);
    d.archivedAt='';d.restoredAt=new Date().toISOString();
  }else if(kind==='historical-complete'){
    d.status='Završeno';d.historicalClosedAt=new Date().toISOString();
  }else if(kind==='cancel-order'||kind==='decision'&&body.status==='Odbijeno'&&['Prihvaćeno','Montaža'].includes(d.status)){
    if(!['Prihvaćeno','Montaža'].includes(d.status))throw new RecordError('Nur angenommene Aufträge oder laufende Montagen können storniert werden.',409);
    const reason=text(body.reason,2000);
    d.orderCancellation={cancelledAt:new Date().toISOString(),previousStatus:d.status,previousDecisionDate:d.decisionDate,quoteVersion:d.intake?.version||null,reason};
    d.status='Odbijeno';d.decisionDate=today;d.decisionReason=body.reason===undefined?(kind==='cancel-order'?'Auftrag nach Zusage storniert':d.decisionReason):reason;
    if(d.appointmentAt&&d.appointmentStatus!=='cancelled'){
      d.appointmentStatus='cancelled';d.appointmentCancelledAt=new Date().toISOString();d.appointmentCancelReason='Auftrag storniert';
    }
  }else if(kind==='start-installation'||kind==='complete'){
    if(d.orderCancellation&&!d.orderCancellation.reopenedAt)throw new RecordError('Dieser Auftrag wurde storniert.',409);
    if(!d.decisionDate||d.agreedPrice==null)throw new RecordError("Prvo zabeleži dogovor i cenu.");
    if(kind==='start-installation'){
      if(d.status!=='Prihvaćeno')throw new RecordError("Montaža počinje posle prihvatanja ponude.");
      d.status='Montaža';
    }else{
      if(d.status!=='Montaža')throw new RecordError("Prvo zabeleži montažu.");
      d.status='Završeno';d.installedAt=d.installedAt||today;
    }
  }else if (kind === "decision") {
    if(!['Prihvaćeno','Odbijeno'].includes(body.status))throw new RecordError("Izaberi ishod upita.");
    if(body.status==='Prihvaćeno'){
      const price=body.agreedPrice!==undefined?amount(body.agreedPrice):(d.quotedPrice??d.agreedPrice);
      if(price===null||price===undefined)throw new RecordError("Cena još nije zabeležena. Unesi dogovoreni iznos.");
      d.agreedPrice=price;
      if(d.orderCancellation&&!d.orderCancellation.reopenedAt)d.orderCancellation.reopenedAt=new Date().toISOString();
    }
    d.status=body.status;
    d.decisionDate=today;
    if(body.reason!==undefined)d.decisionReason=text(body.reason,2000);
    if(body.status==='Odbijeno'&&d.appointmentAt&&d.appointmentStatus!=='cancelled'){
      d.appointmentStatus='cancelled';d.appointmentCancelledAt=new Date().toISOString();d.appointmentCancelReason='Posao je odbijen';
    }
  } else if (kind === "appointment") {
    if(!['Prihvaćeno','Montaža'].includes(d.status))throw new RecordError("Prvo zabeleži da je posao dogovoren.");
    if(d.orderCancellation&&!d.orderCancellation.reopenedAt)throw new RecordError('Dieser Auftrag wurde storniert.',409);
    const at=date(body.date),time=text(body.time,5);
    if(!at||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw new RecordError("Izaberi datum i vreme montaže.");
    d.appointmentAt=at;d.appointmentTime=time;d.appointmentNote=text(body.note,2000);d.appointmentStatus='scheduled';
    d.appointmentChangedAt=new Date().toISOString();
  } else if (kind === "cancel-appointment") {
    if(!d.appointmentAt||d.appointmentStatus==='cancelled')throw new RecordError("Nema aktivnog termina za otkazivanje.");
    d.appointmentStatus='cancelled';d.appointmentCancelledAt=new Date().toISOString();d.appointmentCancelReason=text(body.reason,2000);
  } else if (kind === "update") {
    const patch = body.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new RecordError("Nedostaju polja kartona.");
    const allowed = [...Object.keys(texts), ...dates, "quotedPrice", "extraCosts", "agreedPrice", "invoiceAmount", "status"];
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) throw new RecordError("Polje se ne može menjati: " + key);
      if (key in texts) d[key] = text(patch[key], texts[key]);
      else if (dates.includes(key)) d[key] = date(patch[key]);
      else if (key !== "status") d[key] = amount(patch[key]);
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new RecordError("Nepoznat status.");
      d.status = patch.status;
    }
    if (d.status === "Prihvaćeno" && (d.agreedPrice === null || !d.decisionDate)) throw new RecordError("Za prihvatanje unesi dogovorenu cenu i datum dogovora.");
    if (d.status === "Odbijeno" && !d.decisionDate) throw new RecordError("Za odbijanje unesi datum odluke.");
    if (d.status === "Ponuda poslata" && !d.offerSentAt) throw new RecordError("Unesi datum kada je ponuda poslata.");
    if (current.status !== d.status && ["Montaža", "Završeno"].includes(d.status) && (!d.decisionDate || d.agreedPrice === null)) throw new RecordError("Pre izvođenja zabeleži datum dogovora i dogovorenu cenu.");
  } else if (kind === "payment") {
    const n = amount(body.amount);
    if (!n) throw new RecordError("Uplata mora biti veća od nule.");
    const at = date(body.date); if (!at) throw new RecordError("Unesi datum uplate.");
    d.payments.push({ id: randomUUID(), amount: n, date: at, note: text(body.note, 1000) });
  } else if (kind === "complaint") {
    const c = body.complaint || {};
    const description = text(c.description, 4000); if (!description) throw new RecordError("Unesi opis reklamacije.");
    if (!["Otvorena", "U radu", "Rešena"].includes(c.status)) throw new RecordError("Nepoznat status reklamacije.");
    const at = date(c.date); if (!at) throw new RecordError("Unesi datum reklamacije.");
    const item = { id: text(c.id, 50) || randomUUID(), date: at, description, owner:text(c.owner,200), due:date(c.due), status:c.status, resolution:text(c.resolution,4000), resolvedAt:date(c.resolvedAt) };
    if (item.status === "Rešena" && (!item.resolution || !item.resolvedAt)) throw new RecordError("Za rešenu reklamaciju unesi datum i način rešavanja.");
    const idx = d.complaints.findIndex((x:any) => x.id === item.id);
    if (idx < 0 && c.id) throw new RecordError("Reklamacija nije pronađena.",404);
    if (idx < 0) d.complaints.push(item); else d.complaints[idx] = item;
  } else throw new RecordError("Nepoznata izmena.");
  return { document:d, kind };
}

export interface QueryDB { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }
export async function deleteArchivedTestRecord(db: QueryDB,id:string,revision:number){
  const current=await readRecord(db,id);
  if(current.document.billing)throw new RecordError('Eine ausgestellte Rechnung bleibt zusammen mit dem Auftrag erhalten.',409);
  if(!Number.isInteger(revision)||revision!==current.revision)throw new RecordError("Karton je u međuvremenu izmenjen. Osveži ga pre čuvanja.",409);
  if(!current.document.archivedAt||current.document.isTest!==true)throw new RecordError("Trajno uklanjanje važi samo za arhivirane TEST upite.",403);
  // One statement is atomic. Recheck state under the row lock and remove dependent
  // admin rows before their parents. Never contact Forms or an email provider.
  const {rows}=await db.query(`WITH target AS MATERIALIZED (
    SELECT id FROM gtt_records r WHERE id=$1 AND revision=$2
      AND document->'isTest'='true'::jsonb AND COALESCE(document->>'archivedAt','')<>''
      AND NOT EXISTS(SELECT 1 FROM gtt_quote_outbox WHERE record_id=r.id AND status IN ('queued','processing'))
      AND NOT EXISTS(SELECT 1 FROM gtt_team_outbox WHERE record_id=r.id AND status IN ('queued','processing'))
    FOR UPDATE
  ), removed_team AS (
    DELETE FROM gtt_team_outbox o USING target t WHERE o.record_id=t.id RETURNING o.id
  ), removed_outbox AS (
    DELETE FROM gtt_quote_outbox o USING target t WHERE o.record_id=t.id RETURNING o.id
  ), removed_versions AS (
    DELETE FROM gtt_quote_versions v USING target t WHERE v.record_id=t.id
      AND (SELECT count(*) FROM removed_outbox)>=0 RETURNING v.version
  ), removed_history AS (
    DELETE FROM gtt_record_history h USING target t WHERE h.record_id=t.id RETURNING h.record_id
  ), removed_files AS (
    DELETE FROM gtt_record_files f USING target t WHERE f.record_id=t.id RETURNING f.id
  ), removed_pending AS (
    DELETE FROM gtt_pending_inquiries p USING target t WHERE p.id=t.id RETURNING p.id
  ) DELETE FROM gtt_records r USING target t WHERE r.id=t.id
    AND (SELECT count(*) FROM removed_team)+(SELECT count(*) FROM removed_versions)
      +(SELECT count(*) FROM removed_history)+(SELECT count(*) FROM removed_files)
      +(SELECT count(*) FROM removed_pending)>=0 RETURNING r.id`,[id,revision]);
  if(!rows.length)throw new RecordError("Upit je izmenjen ili slanje još nije završeno. Osveži evidenciju.",409);
  return {deleted:rows[0].id};
}
export async function createRecord(db: QueryDB, input: NonNullable<ReturnType<typeof fromSubmission>>, actor = "Netlify Forms") {
  const {rows} = await db.query(`WITH added AS (
    INSERT INTO gtt_records(id,source,received_at,original,document) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)
    ON CONFLICT (id) DO NOTHING RETURNING *
  ), audit AS (
    INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot)
    SELECT id,revision,$6,'created',document FROM added RETURNING record_id
  ) SELECT id FROM added`, [input.id,input.source,input.original.receivedAt,JSON.stringify(input.original),JSON.stringify(input.document),actor]);
  return {id:input.id, created:rows.length > 0};
}
export async function readRecord(db: QueryDB, id: string) {
  const {rows} = await db.query("SELECT * FROM gtt_records WHERE id=$1",[id]);
  if (!rows[0]) throw new RecordError("Karton nije pronađen.",404);
  const history = await db.query("SELECT revision,at,actor,kind,snapshot FROM gtt_record_history WHERE record_id=$1 ORDER BY revision DESC",[id]);
  const files = await db.query("SELECT id,name,content_type,created_at FROM gtt_record_files WHERE record_id=$1 ORDER BY created_at",[id]);
  return {...rows[0],history:history.rows,files:files.rows};
}
export async function changeRecord(db: QueryDB, id: string, body: any, actor = "Admin (zajednička prijava)") {
  const current = await readRecord(db,id);
  if (!Number.isInteger(body.revision) || body.revision !== current.revision) throw new RecordError("Karton je u međuvremenu izmenjen. Osveži ga pre čuvanja.",409);
  if(body.action==='historical-complete'&&(!current.original.submissionId||current.original.inquiryId))throw new RecordError("Prečica za završetak važi samo za ranije prenete upite.",403);
  const change = applyChange(current.document,body);
  const {rows} = await db.query(`WITH changed AS (
    UPDATE gtt_records SET document=$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING *
  ), audit AS (
    INSERT INTO gtt_record_history(record_id,revision,actor,kind,snapshot)
    SELECT id,revision,$4,$5,document FROM changed RETURNING record_id
  ) SELECT id FROM changed`,[id,body.revision,JSON.stringify(change.document),actor,change.kind]);
  if (!rows.length) throw new RecordError("Karton je u međuvremenu izmenjen. Osveži ga pre čuvanja.",409);
  return readRecord(db,id);
}
