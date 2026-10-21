import type { Config, Context } from "@netlify/functions";
import { recordsAPI } from "../lib/records-api.mts";
import { recordsDB } from "../lib/records-db.mts";
import { RecordError } from "../lib/records.mts";
import { importApprovedHistory } from "../lib/approved-history.mts";
import {recordMessageDE} from '../lib/record-messages-de.mts';
import {
  CHUNK_SIZE,
  FILE_ID_RE,
  MAX_CHUNKS,
  MAX_FILE_SIZE,
  type FileMeta,
  type ProjectItem,
  type Offer,
  DEFAULT_OFFER,
  adminConfigured,
  checkPassword,
  currentOffer,
  readOffer,
  todayCH,
  issueToken,
  json,
  projectsStore,
  readIndex,
  verifyRequest,
  writeIndex,
} from "../lib/projects-store.mts";

/**
 * Admin API for the "Abgeschlossene Projekte" gallery.
 *
 *   POST   /api/admin/login                 { password } -> { token }
 *   GET    /api/admin/items                 all items (incl. hidden)
 *   PUT    /api/admin/chunk/:fileId/:n      raw bytes of one chunk
 *   POST   /api/admin/file/:fileId          { contentType, size, chunks } finalize upload
 *   POST   /api/admin/items                 { type, title, subtitle, file, poster? }
 *   PATCH  /api/admin/items/:id             { title?, subtitle?, visible? }
 *   DELETE /api/admin/items/:id
 *   PUT    /api/admin/order                 { ids: [...] }
 *   GET    /api/admin/offer                 seasonal offer settings
 *   PUT    /api/admin/offer                 { active, name, percent, fenster, tueren, validFrom, validUntil, text }
 */

const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/;

function newId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function cleanText(v: unknown, max = 120): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

async function deleteFile(store: ReturnType<typeof projectsStore>, fileId: string) {
  const meta = (await store.get(`f/${fileId}`, { type: "json" })) as FileMeta | null;
  const { blobs } = await store.list({ prefix: `c/${fileId}/` });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
  if (meta) await store.delete(`f/${fileId}`);
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const method = req.method.toUpperCase();

  if (!adminConfigured()) {
    return json({ error: "ADMIN_PASSWORD ist in Netlify nicht gesetzt." }, 503);
  }

  // ---- login (public) ------------------------------------------------------
  if (parts[0] === "login" && method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    if (!checkPassword(body?.password)) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return json({ error: "Falsches Passwort" }, 401);
    }
    return json({ token: issueToken() });
  }

  // ---- everything below requires a valid token ------------------------------
  if (!verifyRequest(req)) return json({ error: "Nicht angemeldet" }, 401);

  if (parts[0] === "records") {
    try {
      const db=recordsDB();
      if(method==='GET'&&parts.length===1)await importApprovedHistory(db,context);
      return await recordsAPI(req, db, parts.slice(1));
    } catch (err) {
      if (err instanceof RecordError) return json({ error: recordMessageDE(err.message) }, err.status, { "Cache-Control": "no-store" });
      console.error("Admin records operation failed");
      return json({ error: "Die Anfragen sind derzeit nicht verfügbar. Bitte die Verbindung prüfen und erneut versuchen." }, 503, { "Cache-Control": "no-store" });
    }
  }

  const store = projectsStore(context);

  // PUT /chunk/:fileId/:n
  if (parts[0] === "chunk" && method === "PUT") {
    const fileId = parts[1] || "";
    const n = Number(parts[2]);
    if (!FILE_ID_RE.test(fileId) || !Number.isInteger(n) || n < 0 || n >= MAX_CHUNKS) {
      return json({ error: "Ungültiger Chunk" }, 400);
    }
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > CHUNK_SIZE) {
      return json({ error: "Chunk-Grösse ungültig" }, 400);
    }
    await store.set(`c/${fileId}/${n}`, buf);
    return json({ ok: true, n, bytes: buf.byteLength });
  }

  // POST /file/:fileId  (finalize)
  if (parts[0] === "file" && method === "POST") {
    const fileId = parts[1] || "";
    if (!FILE_ID_RE.test(fileId)) return json({ error: "Ungültige Datei" }, 400);
    const body: any = await req.json().catch(() => ({}));
    const contentType = String(body.contentType || "");
    const size = Number(body.size);
    const chunks = Number(body.chunks);
    if (!ALLOWED_TYPES.test(contentType)) return json({ error: "Dateityp nicht erlaubt" }, 400);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_FILE_SIZE) {
      return json({ error: "Datei zu gross (max. 500 MB)" }, 400);
    }
    if (chunks !== Math.ceil(size / CHUNK_SIZE)) return json({ error: "Chunk-Anzahl stimmt nicht" }, 400);
    const { blobs } = await store.list({ prefix: `c/${fileId}/` });
    const have = new Set(blobs.map((b) => b.key));
    for (let i = 0; i < chunks; i++) {
      if (!have.has(`c/${fileId}/${i}`)) return json({ error: `Chunk ${i} fehlt` }, 409);
    }
    const meta: FileMeta = {
      id: fileId,
      contentType: contentType === "video/quicktime" ? "video/mp4" : contentType,
      size,
      chunkSize: CHUNK_SIZE,
      chunks,
      createdAt: new Date().toISOString(),
    };
    await store.setJSON(`f/${fileId}`, meta);
    return json({ ok: true, file: meta });
  }

  // GET /items
  if (parts[0] === "items" && !parts[1] && method === "GET") {
    return json({ items: await readIndex(store) }, 200, { "Cache-Control": "no-store" });
  }

  // POST /items
  if (parts[0] === "items" && !parts[1] && method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const type = body.type === "video" ? "video" : body.type === "image" ? "image" : null;
    const file = String(body.file || "");
    const poster = body.poster ? String(body.poster) : undefined;
    if (!type || !FILE_ID_RE.test(file)) return json({ error: "Ungültige Angaben" }, 400);
    if (!(await store.get(`f/${file}`))) return json({ error: "Datei nicht gefunden" }, 404);
    if (poster && (!FILE_ID_RE.test(poster) || !(await store.get(`f/${poster}`)))) {
      return json({ error: "Vorschaubild nicht gefunden" }, 404);
    }
    const item: ProjectItem = {
      id: newId(),
      type,
      title: cleanText(body.title) || (type === "video" ? "GTT Video" : "GTT Montage"),
      subtitle: cleanText(body.subtitle, 200) || (type === "video" ? "Reale Montage · Video" : "Abgeschlossenes Projekt"),
      file,
      ...(poster ? { poster } : {}),
      visible: body.visible !== false,
      createdAt: new Date().toISOString(),
    };
    const items = await readIndex(store);
    items.unshift(item); // newest first
    await writeIndex(store, items);
    return json({ item }, 201);
  }

  // PATCH /items/:id
  if (parts[0] === "items" && parts[1] && method === "PATCH") {
    const body: any = await req.json().catch(() => ({}));
    const items = await readIndex(store);
    const item = items.find((i) => i.id === parts[1]);
    if (!item) return json({ error: "Nicht gefunden" }, 404);
    if (typeof body.title === "string") item.title = cleanText(body.title) || item.title;
    if (typeof body.subtitle === "string") item.subtitle = cleanText(body.subtitle, 200);
    if (typeof body.visible === "boolean") item.visible = body.visible;
    await writeIndex(store, items);
    return json({ item });
  }

  // DELETE /items/:id
  if (parts[0] === "items" && parts[1] && method === "DELETE") {
    const items = await readIndex(store);
    const idx = items.findIndex((i) => i.id === parts[1]);
    if (idx === -1) return json({ error: "Nicht gefunden" }, 404);
    const [removed] = items.splice(idx, 1);
    await writeIndex(store, items);
    await deleteFile(store, removed.file);
    if (removed.poster) await deleteFile(store, removed.poster);
    return json({ ok: true });
  }

  // GET /offer
  if (parts[0] === "offer" && method === "GET") {
    const offer = await readOffer(store);
    return json({ offer, current: currentOffer(offer), today: todayCH() }, 200, { "Cache-Control": "no-store" });
  }

  // PUT /offer
  if (parts[0] === "offer" && method === "PUT") {
    const body: any = await req.json().catch(() => ({}));
    const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
    const percent = Math.round(Number(body.percent));
    if (!Number.isFinite(percent) || percent < 1 || percent > 50) {
      return json({ error: "Rabatt muss zwischen 1 und 50 % liegen" }, 400);
    }
    const offer: Offer = {
      active: body.active === true,
      name: cleanText(body.name, 60) || DEFAULT_OFFER.name,
      percent,
      fenster: body.fenster !== false,
      tueren: body.tueren !== false,
      validFrom: date(body.validFrom),
      validUntil: date(body.validUntil),
      text: cleanText(body.text, 160),
      updatedAt: new Date().toISOString(),
    };
    if (!offer.fenster && !offer.tueren) return json({ error: "Wähle mindestens Fenster oder Türen" }, 400);
    if (offer.validFrom && offer.validUntil && offer.validFrom > offer.validUntil) {
      return json({ error: "Datum „bis“ liegt vor „von“" }, 400);
    }
    await store.setJSON("offer", offer);
    return json({ offer, current: currentOffer(offer), today: todayCH() });
  }

  // PUT /order
  if (parts[0] === "order" && method === "PUT") {
    const body: any = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const items = await readIndex(store);
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered: ProjectItem[] = [];
    for (const id of ids) {
      const it = byId.get(id);
      if (it) {
        ordered.push(it);
        byId.delete(id);
      }
    }
    ordered.push(...byId.values()); // anything not mentioned keeps its place at the end
    await writeIndex(store, ordered);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = {
  path: "/api/admin/*",
};
