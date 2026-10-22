// The configured percentage is the only discount number in promotional copy.
// Keep legacy free text intact in storage, but omit its old discount clauses.
(function(root){
  const percentage = /\d+(?:[.,]\d+)?\s*(?:%|Prozent\b)/i;
  root.gttOfferCopy = function(offer){
    const name = String(offer.name || 'Aktion').replace(/[−–-]?\s*\d+(?:[.,]\d+)?\s*(?:%|Prozent\b)/gi, '').replace(/[\s:–−-]+$/g, '').trim() || 'Aktion';
    const label = name + ' −' + offer.percent + '%';
    const scope = offer.fenster && offer.tueren ? 'auf Fenster und Türen' : offer.fenster ? 'auf Fenster' : 'auf Türen / Plissee';
    const until = offer.validUntil ? ' – gültig bis ' + offer.validUntil.split('-').reverse().join('.') : '';
    const custom = String(offer.text || '').split(/\s+[–—-]\s+|,\s+(?!\d)|;\s*|\n+/).filter(part => !percentage.test(part)).map(part => part.trim()).filter(Boolean).join(' – ');
    return {label, detail:custom || ('Rabatt ' + scope + until)};
  };
})(globalThis);
