import assert from 'node:assert/strict';
import test from 'node:test';
import handleSubmission from '../netlify/functions/submission-created.mts';

const data = {
  name: 'TEST LOCAL – Demo Customer',
  email: 'customer@example.test',
  telefon: '+41 00 000 00 00',
  plz: '9000',
  fensterflaeche_m2: '1',
  tuerflaeche_m2: '0',
  aktion: 'Herbst-/Winteraktion −15%',
};

function request(preis, formName = 'angebot') {
  return new Request('https://gtt-insektenschutz.ch/.netlify/functions/submission-created', {
    method: 'POST',
    body: JSON.stringify({ payload: { form_name: formName, data: { ...data, berechneter_preis: preis } } }),
  });
}

function provider(t, status = 200) {
  const oldKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 're_local_fixture_only_not_a_real_key';
  t.after(() => {
    if (oldKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldKey;
  });
  const messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    messages.push(JSON.parse(options.body));
    return new Response(JSON.stringify(status === 200 ? { id: 'local-only' } : { message: 'API key is invalid' }), { status });
  });
  t.mock.method(console, 'error', () => {});
  return messages;
}

for (const preis of ['Fixpreis: CHF 186.–', 'Orientierungspreis: CHF 186.–', 'CHF 186.–']) {
  test(`customer offer formats ${preis} with one CHF and preserves calculator data`, async t => {
    const messages = provider(t);
    const response = await handleSubmission(request(preis), {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { internalOk: true, customerOk: true });
    assert.equal(messages.length, 2);
    const customer = messages.find(message => message.to.includes(data.email));
    const internal = messages.find(message => !message.to.includes(data.email));
    assert.ok(internal);
    assert.ok(internal.text.includes(`Berechneter Preis: ${preis}`));
    assert.equal(customer.subject, 'Ihre Offerte von GTT Insektenschutz – CHF 186.–');
    assert.match(customer.html, /9000/);
    assert.match(customer.html, /Fensterfläche/);
    assert.match(customer.html, /1 m²/);
    assert.match(customer.html, /Türfläche/);
    assert.match(customer.html, /0 m²/);
    for (const content of [customer.subject, customer.html, customer.text]) {
      assert.match(content, /CHF 186/);
      assert.doesNotMatch(content, /CHF\s+(?:Fixpreis|Orientierungspreis|CHF)/);
    }
  });
}

test('provider authentication failure cannot be reported as customer delivery', async t => {
  const messages = provider(t, 401);
  const response = await handleSubmission(request('Fixpreis: CHF 186.–'), {});
  assert.equal(messages.length, 2);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { internalOk: false, customerOk: false });
});

test('other forms do not send a calculator offer', async t => {
  const messages = provider(t);
  const response = await handleSubmission(request('CHF 186.–', 'kontakt'), {});
  assert.equal(await response.text(), 'Ignored');
  assert.equal(messages.length, 0);
});
