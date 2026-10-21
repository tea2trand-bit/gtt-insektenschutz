import { getStore, getDeployStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared helpers for the project gallery admin.
 *
 * Storage layout (Netlify Blobs, store "gtt-projects"):
 *   index            JSON array of ProjectItem (display order)
 *   f/<fileId>       JSON FileMeta (content type, size, chunk layout)
 *   c/<fileId>/<n>   raw bytes of chunk n of an uploaded file
 *
 * Files are uploaded in chunks because a single function request body is
 * limited to ~6 MB, while project videos are usually much larger.
 */

export const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MiB (base64-encoded stays well under the 6 MB function payload limit)
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MiB
export const MAX_CHUNKS = Math.ceil(MAX_FILE_SIZE / CHUNK_SIZE);

export interface FileMeta {
  id: string;
  contentType: string;
  size: number;
  chunkSize: number;
  chunks: number;
  createdAt: string;
}

export interface ProjectItem {
  id: string;
  type: "image" | "video";
  title: string;
  subtitle: string;
  file: string; // fileId of the main media
  poster?: string; // fileId of the poster image (videos)
  visible: boolean;
  createdAt: string;
}

export function projectsStore(context?: { deploy?: { context?: string } }) {
  // Live site (and anything we cannot identify) uses the global store so data
  // survives new deploys. Only deploy previews / branch deploys get an isolated
  // deploy-scoped store, so tests never touch the live gallery or offer.
  const ctx =
    context?.deploy?.context ??
    (globalThis as any).Netlify?.context?.deploy?.context ??
    process.env.CONTEXT;
  if (ctx === "deploy-preview" || ctx === "branch-deploy") {
    return getDeployStore({ name: "gtt-projects" });
  }
  return getStore({ name: "gtt-projects", consistency: "strong" });
}

/* --------------------------------------------------------------- offer -- */

export const BASE_RATES = { fenster: 219, tueren: 249 } as const;

export interface Offer {
  active: boolean;
  name: string; // e.g. "Herbst-/Winteraktion"
  percent: number; // 1–50
  fenster: boolean; // applies to window rate
  tueren: boolean; // applies to door/plissee rate
  validFrom: string; // YYYY-MM-DD or ""
  validUntil: string; // YYYY-MM-DD or ""
  text: string; // optional banner text
  updatedAt?: string;
}

export const DEFAULT_OFFER: Offer = {
  active: false,
  name: "Herbst-/Winteraktion",
  percent: 10,
  fenster: true,
  tueren: true,
  validFrom: "",
  validUntil: "",
  text: "",
};

export async function readOffer(store: ReturnType<typeof projectsStore>): Promise<Offer> {
  const o = (await store.get("offer", { type: "json" })) as Partial<Offer> | null;
  return { ...DEFAULT_OFFER, ...(o || {}) };
}

/** Today's date in Switzerland as YYYY-MM-DD. */
export function todayCH(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
}

/** The offer as it applies right now, or null when nothing is running. */
export function currentOffer(o: Offer) {
  if (!o.active || !(o.percent > 0) || (!o.fenster && !o.tueren)) return null;
  const today = todayCH();
  if (o.validFrom && today < o.validFrom) return null;
  if (o.validUntil && today > o.validUntil) return null;
  const rate = (base: number, applies: boolean) => (applies ? Math.round(base * (1 - o.percent / 100)) : base);
  return {
    name: o.name,
    percent: o.percent,
    fenster: o.fenster,
    tueren: o.tueren,
    validUntil: o.validUntil || null,
    text: o.text || null,
    rates: { fenster: rate(BASE_RATES.fenster, o.fenster), tueren: rate(BASE_RATES.tueren, o.tueren) },
    baseRates: { ...BASE_RATES },
  };
}

export async function readIndex(store: ReturnType<typeof projectsStore>): Promise<ProjectItem[]> {
  const list = await store.get("index", { type: "json" });
  return Array.isArray(list) ? (list as ProjectItem[]) : [];
}

export async function writeIndex(store: ReturnType<typeof projectsStore>, items: ProjectItem[]) {
  await store.setJSON("index", items);
}

export const FILE_ID_RE = /^[a-z0-9]{16,40}$/;

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function mediaUrl(fileId: string) {
  return `/media/${fileId}`;
}

/* ------------------------------------------------------------------ auth -- */

function adminPassword(): string | undefined {
  const env = (globalThis as any).Netlify?.env;
  const ctx = (globalThis as any).Netlify?.context?.deploy?.context || process.env.CONTEXT;
  if (ctx === "deploy-preview") return env?.get("ADMIN_PREVIEW_PASSWORD") || process.env.ADMIN_PREVIEW_PASSWORD;
  return env?.get("ADMIN_PASSWORD") || process.env.ADMIN_PASSWORD;
}

function secret(): string | null {
  const env = (globalThis as any).Netlify?.env;
  const pw = adminPassword();
  if (!pw) return null;
  const extra = env?.get("ADMIN_TOKEN_SECRET") || process.env.ADMIN_TOKEN_SECRET || "";
  return `gtt-admin:${pw}:${extra}`;
}

export function adminConfigured() {
  return secret() !== null;
}

export function checkPassword(candidate: unknown): boolean {
  const pw = adminPassword();
  if (!pw || typeof candidate !== "string") return false;
  const a = createHmac("sha256", "cmp").update(candidate).digest();
  const b = createHmac("sha256", "cmp").update(pw).digest();
  return timingSafeEqual(a, b);
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function issueToken(): string {
  const s = secret()!;
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `v1.${exp}`;
  const sig = createHmac("sha256", s).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyRequest(req: Request): boolean {
  const s = secret();
  if (!s) return false;
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", s).update(`v1.${parts[1]}`).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
