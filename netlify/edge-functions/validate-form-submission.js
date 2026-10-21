const FORM_RULES = {
  angebot: { emailRequired: true },
  'angebot-netlify-fallback': { emailRequired: true },
  kontakt: { emailRequired: true },
  'b2b-anfrage': { emailRequired: true },
};

function clean(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function validateSubmission(values) {
  const formName = clean(values.formName, 80);
  const rules = FORM_RULES[formName];
  if (!rules) return { protectedForm: false, errors: {} };

  const name = clean(values.name, 100).replace(/\s+/g, ' ');
  const phone = clean(values.telefon, 30);
  const email = clean(values.email, 160);
  const address = clean(values.adresse, 500);
  const nameParts = name.split(' ').filter(Boolean);
  const phoneDigits = phone.replace(/\D/g, '');
  const errors = {};

  if (nameParts.length < 2 || name.length < 5) {
    errors.name = 'Vor- und Nachname sind erforderlich.';
  }

  if (
    !/^[0-9+()\s./-]+$/.test(phone) ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15
  ) {
    errors.telefon = 'Eine gültige Telefonnummer mit 7 bis 15 Ziffern ist erforderlich.';
  }

  if ((rules.emailRequired || email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.email = 'Eine gültige E-Mail-Adresse ist erforderlich.';
  }
  if(address.length<5)errors.adresse='Die Montageadresse ist erforderlich.';
  if(!/^[1-9]\d{3}$/.test(String(values.plz||'').trim()))errors.plz='Eine vierstellige Schweizer PLZ ist erforderlich.';

  return { protectedForm: true, errors };
}

function field(formData, name) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export default async function validateFormSubmission(request) {
  if (request.method !== 'POST') return;

  const contentType = request.headers.get('content-type') || '';
  if (
    !contentType.includes('application/x-www-form-urlencoded') &&
    !contentType.includes('multipart/form-data')
  ) {
    return;
  }

  let formData;
  try {
    formData = await request.clone().formData();
  } catch {
    return;
  }

  const formName = field(formData, 'form-name');
  if (!FORM_RULES[formName]) return;

  // Match Netlify's honeypot behavior, but stop the request before form storage
  // and email notifications are reached.
  if (clean(field(formData, 'bot-field'), 200)) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const validation = validateSubmission({
    formName,
    name: field(formData, 'name'),
    telefon: field(formData, 'telefon'),
    email: field(formData, 'email'),
    adresse: field(formData, 'adresse'),
    plz: field(formData, 'plz'),
  });

  if (Object.keys(validation.errors).length === 0) return;

  return new Response(
    JSON.stringify({
      ok: false,
      message: 'Bitte Name, E-Mail, Telefonnummer, Montageadresse und PLZ vollständig und korrekt ausfüllen.',
      fields: Object.keys(validation.errors),
    }),
    {
      status: 422,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  );
}

export const config = {
  path: '/*',
  method: ['POST'],
};
