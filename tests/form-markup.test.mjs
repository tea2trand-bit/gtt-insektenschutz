import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function formMarkup(name) {
  const match = html.match(new RegExp(`<form[^>]*name="${name}"[\\s\\S]*?<\\/form>`));
  assert.ok(match, `form ${name} exists`);
  return match[0];
}

for (const formName of ['angebot', 'kontakt', 'b2b-anfrage']) {
  test(`${formName} requires email and installation address`,()=>{
    const form=formMarkup(formName);
    assert.match(form,/<input[^>]*name="email"[^>]*required/);
    assert.match(form,/<input[^>]*name="adresse"[^>]*required/);
    if(formName!=='angebot')assert.match(form,/<input[^>]*name="plz"[^>]*required/);
  });
  test(`${formName} requires full name and telephone`, () => {
    const form = formMarkup(formName);
    assert.match(form, /<input[^>]*name="name"[^>]*required/);
    assert.match(form, /<input[^>]*name="telefon"[^>]*required/);
    assert.match(form, /Vor- und Nachname/);
  });

  test(`${formName} does not submit technical lead fields`, () => {
    const form = formMarkup(formName);
    assert.doesNotMatch(form, /name="lead_/);
  });
}

test('form behavior loads after all form markup is parsed', () => {
  assert.match(html, /<script[^>]*src="script\.js[^>]*\bdefer\b[^>]*><\/script>/);
});
