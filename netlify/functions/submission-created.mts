import type { Context } from "@netlify/functions";

/**
 * Triggered automatically by Netlify Forms after a verified form submission
 * (filename "submission-created" registers the event handler).
 *
 * Purpose: for every "angebot" submission this function sends TWO emails:
 *   1. an internal notification to GTT containing ALL calculator data (Name,
 *      Telefon, E-Mail, PLZ, Fenster-/Türfläche und berechneter Preis), plus a
 *      copy of the Offertentext below it.
 *   2. an automatic customer email to the address supplied in the form,
 *      formatted as a ready-to-use Offerte and including the calculated price.
 *
 * Both emails always contain the calculated price. The customer email is only
 * sent when the submitted address is syntactically valid.
 *
 * Email delivery uses Resend (https://resend.com) via its HTTP API — no extra
 * dependency required. Configure these environment variables in Netlify:
 *   RESEND_API_KEY  – Resend API key (required; without it the function exits
 *                     gracefully and the submission itself is unaffected)
 *   OFFER_FROM      – verified sender, e.g. "GTT Insektenschutz <offerte@gttgroup.ch>"
 *   GTT_NOTIFY_TO   – internal recipient address (defaults to info@gttgroup.ch)
 */

interface FormPayload {
  form_name: string;
  data: Record<string, string>;
}

const FROM = process.env.OFFER_FROM || "GTT Insektenschutz <info@gttgroup.ch>";
const GTT_TO = process.env.GTT_NOTIFY_TO || "info@gttgroup.ch";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async (req: Request, _context: Context) => {
  let payload: FormPayload | undefined;
  try {
    ({ payload } = (await req.json()) as { payload: FormPayload });
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // Only react to the offer form.
  if (!payload || payload.form_name !== "angebot") {
    return new Response("Ignored");
  }

  const d = payload.data || {};
  const customerEmail = (d.email || "").trim();
  const name = (d.name || "").trim();
  const telefon = (d.telefon || "").trim();
  const preis = (d.berechneter_preis || "Wird von unserem Team bestätigt").trim();
  const plz = (d.plz || "–").trim();
  const fenster = (d.fensterflaeche_m2 || "0").trim();
  const tueren = (d.tuerflaeche_m2 || "0").trim();
  // Seasonal offer applied in the calculator (e.g. "Herbst-/Winteraktion −15% (regulär CHF 1'234.–)").
  const aktion = (d.aktion || "").trim();

  // Current calculator submissions include a label ("Fixpreis: CHF 186.–"
  // or "Orientierungspreis: CHF 186.–"); older submissions start with CHF.
  // Remove either prefix once so subject, HTML and text share one currency.
  const preisBetrag = preis
    .replace(/^(?:(?:Fixpreis|Orientierungspreis)\s*:\s*)?CHF\s*/i, "")
    .trim();

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY not configured – skipping emails. The form submission itself is unaffected.",
    );
    return new Response("Email provider not configured");
  }

  // Shared helper around the Resend HTTP API.
  const send = async (body: Record<string, unknown>) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend send failed:", res.status, detail);
    }
    return res.ok;
  };

  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail);

  // ---------------------------------------------------------------------------
  // Internal notification to GTT — contains the complete calculator dataset
  // (Name, Telefon, E-Mail, PLZ, Flächen, Preis) and, below it, a ready-to-use
  // Offertenvorschlag formatted for forwarding to the customer.
  // ---------------------------------------------------------------------------
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:bold">${escapeHtml(value) || "–"}</td></tr>`;

  const anrede = name ? `Sehr geehrte/r Herr/Frau ${escapeHtml(name)}` : "Sehr geehrte/r Herr/Frau";

  const offerText = `OFFERTENVORSCHLAG FÜR DEN KUNDEN

${anrede}

Vielen Dank für Ihr Interesse an GTT Insektenschutz.

Basierend auf Ihren Angaben beträgt der unverbindliche Richtpreis:

CHF ${escapeHtml(preisBetrag)}

Im Preis enthalten:

✓ Ausmessen vor Ort

✓ Lieferung und Montage

✓ 2 Jahre Garantie

✓ Schweizer Qualitätsprodukt

Freundliche Grüsse

GTT Insektenschutz

GT-Trading GmbH

Quimbystrasse 7

CH-9015 St. Gallen

+41 (0)76 422 92 42

info@gttgroup.ch

www.gtt-insektenschutz.ch`;

  const internalHtml = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1d2b36">
    <h2 style="color:#2f7d12;margin:0 0 12px">Neue Offertanfrage – Kalkulator</h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee">
      ${row("Name", name)}
      ${row("Telefon", telefon)}
      ${row("E-Mail", customerEmail)}
      ${row("PLZ", plz)}
      ${row("Fensterfläche", `${fenster} m²`)}
      ${row("Türfläche", `${tueren} m²`)}
      ${row("Berechneter Preis", preis)}
      ${aktion ? row("Aktion", aktion) : ""}
    </table>
    <pre style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1d2b36;background:#f6f8f4;border:1px solid #e0e8d8;border-radius:8px;padding:18px;margin:20px 0 0">${offerText}</pre>
  </div>`;

  // Plain-text alternative: carries the same calculator data AND the full
  // Offertenvorschlag. Sending both an HTML and a text part improves
  // deliverability (HTML-only mails are more likely to be flagged as spam) and
  // guarantees the offer section is readable in every email client.
  const internalText = [
    "Neue Offertanfrage – Kalkulator",
    "",
    `Name: ${name || "–"}`,
    `Telefon: ${telefon || "–"}`,
    `E-Mail: ${customerEmail || "–"}`,
    `PLZ: ${plz}`,
    `Fensterfläche: ${fenster} m²`,
    `Türfläche: ${tueren} m²`,
    `Berechneter Preis: ${preis}`,
    ...(aktion ? [`Aktion: ${aktion}`] : []),
    "",
    "----------------------------------------",
    "",
    offerText,
  ].join("\n");

  let internalOk = false;
  try {
    internalOk = await send({
      from: FROM,
      to: [GTT_TO],
      reply_to: emailValid ? customerEmail : "info@gttgroup.ch",
      subject: `Neue Offertanfrage – ${name || "Kalkulator"} (${preis})`,
      html: internalHtml,
      text: internalText,
    });
  } catch (err) {
    console.error("Internal notification request error:", err);
  }
  if (!internalOk) {
    console.error("Internal notification email did not send (calculator data not delivered).");
  }

  // ---------------------------------------------------------------------------
  // Customer auto-reply — a ready-to-use Offerte sent directly to the address
  // supplied in the form. Always includes the calculated price. Only sent when
  // the submitted email address is syntactically valid; otherwise it is skipped
  // without affecting the internal notification above.
  // ---------------------------------------------------------------------------
  const customerHtml = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#1d2b36">
    <div style="background:#2f7d12;padding:20px 24px;border-radius:8px 8px 0 0">
      <h1 style="color:#fff;margin:0;font-size:20px">Ihre persönliche Offerte</h1>
      <p style="color:#dceccf;margin:4px 0 0;font-size:14px">GTT Insektenschutz</p>
    </div>
    <div style="border:1px solid #e0e8d8;border-top:none;border-radius:0 0 8px 8px;padding:24px">
      <p style="margin:0 0 16px;font-size:15px">${anrede}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Vielen Dank für Ihr Interesse an GTT Insektenschutz. Basierend auf Ihren Angaben haben wir Ihnen folgende unverbindliche Offerte erstellt:</p>

      <table style="width:100%;border-collapse:collapse;border:1px solid #eee;margin:0 0 20px">
        ${row("PLZ", plz)}
        ${row("Fensterfläche", `${fenster} m²`)}
        ${row("Türfläche", `${tueren} m²`)}
      </table>

      <div style="background:#f6f8f4;border:1px solid #e0e8d8;border-radius:8px;padding:18px 20px;text-align:center;margin:0 0 20px">
        <div style="color:#555;font-size:13px;text-transform:uppercase;letter-spacing:1px">Unverbindlicher Richtpreis</div>
        <div style="color:#2f7d12;font-size:28px;font-weight:bold;margin-top:6px">CHF ${escapeHtml(preisBetrag)}</div>
        ${aktion ? `<div style="color:#9a4513;font-size:13px;font-weight:bold;margin-top:6px">inkl. ${escapeHtml(aktion)}</div>` : ""}
      </div>

      <p style="margin:0 0 8px;font-weight:bold;font-size:15px">Im Preis enthalten:</p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.7;color:#1d2b36">
        <li>Ausmessen vor Ort</li>
        <li>Lieferung und Montage</li>
        <li>2 Jahre Garantie</li>
        <li>Schweizer Qualitätsprodukt</li>
      </ul>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Gerne vereinbaren wir mit Ihnen einen Termin zum kostenlosen Ausmessen vor Ort. Unser Team meldet sich in Kürze bei Ihnen – Sie dürfen uns aber auch jederzeit direkt kontaktieren.</p>

      <p style="margin:0;font-size:15px;line-height:1.6">
        Freundliche Grüsse<br>
        <strong>GTT Insektenschutz</strong><br>
        GT-Trading GmbH<br>
        Quimbystrasse 7, CH-9015 St. Gallen<br>
        +41 (0)76 422 92 42<br>
        <a href="mailto:info@gttgroup.ch" style="color:#2f7d12">info@gttgroup.ch</a> ·
        <a href="https://www.gtt-insektenschutz.ch" style="color:#2f7d12">www.gtt-insektenschutz.ch</a>
      </p>
    </div>
  </div>`;

  // Plain-text alternative — reuses the existing Offertentext so the same offer
  // (including the calculated price) is readable in every email client.
  const customerText = offerText;

  let customerOk = false;
  if (emailValid) {
    try {
      customerOk = await send({
        from: FROM,
        to: [customerEmail],
        reply_to: GTT_TO,
        subject: `Ihre Offerte von GTT Insektenschutz – CHF ${preisBetrag}`,
        html: customerHtml,
        text: customerText,
      });
    } catch (err) {
      console.error("Customer offer email request error:", err);
    }
    if (!customerOk) {
      console.error("Customer offer email did not send.");
    }
  } else {
    console.warn("Customer email skipped – submitted address is not valid:", customerEmail);
  }

  return new Response(JSON.stringify({ internalOk, customerOk }), {
    status: internalOk ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
};
