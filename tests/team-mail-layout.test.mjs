import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTeamNotification} from '../netlify/lib/team-notification.mts';
import {recordsAPI} from '../netlify/lib/records-api.mts';
const record={id:'GTT-123456789012345678901234',source:'Kalkulator',document:{name:'Beispiel Kunde',email:'test@example.invalid',phone:'000',address:'Musterstrasse 1',postalCode:'9000',request:'Private original request '.repeat(100),intake:{version:3,quote:{totalCHF:708},email:{status:'accepted'}},customerAcceptance:{intent:'confirm_corrected_offer'}}};
test('internal messages put event, source and next step first with short authenticated links in both MIME alternatives',()=>{
 const corrected=renderTeamNotification(record,'customer_acceptance');assert.match(corrected.subject,/Korrigierte Offerte bestätigt/);assert.match(corrected.text,/Nächster Schritt: Montagetermin/);assert.match(corrected.text,/Quelle: Kalkulator auf der Website/);assert.match(corrected.html,/Karte öffnen/);assert.ok(corrected.text.includes('https://gtt-insektenschutz.ch/admin?offerte=GTT-003'));assert.doesNotMatch(corrected.text+corrected.html,/Private original request|GTT-123456789012345678901234/);assert.ok(corrected.text.split('\n').length<20);
 const initial=structuredClone(record);initial.document.customerAcceptance.intent='request_measurement';assert.match(renderTeamNotification(initial,'customer_acceptance').text,/Termin zum Ausmessen/);
 assert.match(renderTeamNotification(record,'new_inquiry').text,/Auf die Entscheidung/);assert.match(renderTeamNotification(record,'customer_decline').text,/kein Termin gebucht/);
});
test('offer reference resolver uses a bound exact version, including archived cards, and does not accept SQL input',async()=>{
 let params;const db={query:async(sql,p)=>{assert.equal(sql,'SELECT record_id AS id FROM gtt_quote_versions WHERE version=$1');params=p;return {rows:[{id:record.id}]};}};
 const response=await recordsAPI(new Request('http://local/api/admin/records/resolve?offerte=GTT-003'),db,['resolve']);assert.equal((await response.json()).id,record.id);assert.deepEqual(params,['003']);await assert.rejects(recordsAPI(new Request('http://local/?offerte=GTT-3%27%20OR%201=1'),db,['resolve']),/Ungültige Offertnummer/);
});
