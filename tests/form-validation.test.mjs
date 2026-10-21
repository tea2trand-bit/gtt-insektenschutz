import assert from 'node:assert/strict';
import test from 'node:test';

import validateFormSubmission, {
  validateSubmission,
} from '../netlify/edge-functions/validate-form-submission.js';

function request(body) {
  return new Request('https://gtt-insektenschutz.ch/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

test('kontakt requires full name, phone and email', () => {
  const result = validateSubmission({
    formName: 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
    name: '',
    telefon: '',
    email: '',
  });

  assert.equal(result.protectedForm, true);
  assert.deepEqual(Object.keys(result.errors).sort(), ['email', 'name', 'telefon']);
});

test('a one-word name is rejected', () => {
  const result = validateSubmission({
    formName: 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
    name: 'Monika',
    telefon: '+41 78 123 45 67',
    email: 'monika@example.ch',
  });

  assert.deepEqual(Object.keys(result.errors), ['name']);
});

test('a normal Swiss contact is accepted', () => {
  const result = validateSubmission({
    formName: 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
    name: 'Monika Thürlemann',
    telefon: '+41 (0)78 684 36 63',
    email: 'monika@example.ch',
  });

  assert.deepEqual(result.errors, {});
});

test('b2b email is required with the complete installation address', () => {
  const result = validateSubmission({
    formName: 'b2b-anfrage', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
    name: 'Hans Müller',
    telefon: '071 123 45 67',
    email: '',
  });

  assert.deepEqual(Object.keys(result.errors), ['email']);
});

test('all inquiry forms reject missing installation address, postcode and email on the server',()=>{
  for(const formName of ['angebot','angebot-netlify-fallback','kontakt','b2b-anfrage']){
    const result=validateSubmission({formName,name:'Test Person',telefon:'+41 79 123 45 67',email:'',adresse:'',plz:''});
    assert.deepEqual(Object.keys(result.errors).sort(),['adresse','email','plz']);
    const invalid=validateSubmission({formName,name:'Test Person',telefon:'+41 79 123 45 67',email:'test@example.invalid',adresse:'Teststrasse 1',plz:'90000'});
    assert.deepEqual(Object.keys(invalid.errors),['plz']);
  }
});

test('direct incomplete POST is rejected before Netlify Forms', async () => {
  const response = await validateFormSubmission(
    request({
      'form-name': 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
      email: 'bot@example.com',
      nachricht: 'Bitte kontaktieren Sie mich.',
    }),
  );

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.deepEqual(payload.fields.sort(), ['name', 'telefon']);
});

test('legacy fallback form cannot bypass contact validation', async () => {
  const response = await validateFormSubmission(
    request({
      'form-name': 'angebot-netlify-fallback', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
      email: 'bot@example.com',
      nachricht: 'Bitte kontaktieren Sie mich.',
    }),
  );

  assert.equal(response.status, 422);
  const payload = await response.json();
  assert.deepEqual(payload.fields.sort(), ['name', 'telefon']);
});

test('valid POST continues to Netlify Forms', async () => {
  const response = await validateFormSubmission(
    request({
      'form-name': 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
      name: 'Anna Meier',
      telefon: '+41 79 123 45 67',
      email: 'anna@example.ch',
    }),
  );

  assert.equal(response, undefined);
});

test('honeypot submission is silently stopped', async () => {
  const response = await validateFormSubmission(
    request({
      'form-name': 'kontakt', adresse: 'Teststrasse 1, St. Gallen', plz: '9000',
      'bot-field': 'spam',
      name: 'Fake Person',
      telefon: '+41 79 123 45 67',
      email: 'fake@example.com',
    }),
  );

  assert.equal(response.status, 204);
});
