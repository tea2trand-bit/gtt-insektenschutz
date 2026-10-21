/** Offline preparation only. No account access, invoice creation or sending. */
export function prepareSmallinvoiceDraft(record:any){
 const d=record.document;
 if(d.status!=='Završeno')throw Error('Die Rechnung kann nach Abschluss des Auftrags vorbereitet werden.');
 if(d.agreedPrice==null||!Number.isFinite(d.agreedPrice)||d.agreedPrice<0)throw Error('Für die Rechnung fehlt der bestätigte Betrag.');
 return {
  recordId:record.id,
  customer:{name:d.name,company:d.company,email:d.email,phone:d.phone,address:d.address,postalCode:d.postalCode},
  currency:'CHF',language:'de',totalCHF:d.agreedPrice,
  positions:[{name:'Insektenschutz nach Mass',description:'Vereinbarter Gesamtbetrag einschliesslich Ausmessen, Lieferung und Montage',amount:1,price:d.agreedPrice}],
  requiredAccountConfiguration:['issuer_profile','contact_and_address_ids','invoice_numbering','payment_terms','bank_account','vat_configuration','unit_id'],
  sendAutomatically:false
 };
}
