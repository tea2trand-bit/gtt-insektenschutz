import { createHash, randomUUID } from "node:crypto";

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
  if (kind === "decision") {
    if(!['Prihvaćeno','Odbijeno'].includes(body.status))throw new RecordError("Izaberi ishod upita.");
    if(body.status==='Prihvaćeno'){
      const price=body.agreedPrice!==undefined?amount(body.agreedPrice):(d.quotedPrice??d.agreedPrice);
      if(price===null||price===undefined)throw new RecordError("Cena još nije zabeležena. Unesi dogovoreni iznos.");
      d.agreedPrice=price;
    }
    d.status=body.status;
    d.decisionDate=today;
    if(body.reason!==undefined)d.decisionReason=text(body.reason,2000);
    if(body.status==='Odbijeno'&&d.appointmentAt&&d.appointmentStatus!=='cancelled'){
      d.appointmentStatus='cancelled';d.appointmentCancelledAt=new Date().toISOString();d.appointmentCancelReason='Posao je odbijen';
    }
  } else if (kind === "appointment") {
    if(!['Prihvaćeno','Montaža'].includes(d.status))throw new RecordError("Prvo zabeleži da je posao dogovoren.");
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
