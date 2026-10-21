export type ElementType = "window" | "door";
export type Unit = "mm" | "cm" | "m";
export interface Measurement {
  type: ElementType;
  quantity: number;
  width: number | null;
  height: number | null;
  widthUnit: Unit | null;
  heightUnit: Unit | null;
  areaM2: number;
  mode: "dimensions" | "area";
  source: string;
}
export interface IntakeIssue { code: string; question: string }
export interface Extraction {
  method: "deterministic" | "openai";
  measurements: Measurement[];
  issues: IntakeIssue[];
  postalCode: string | null;
  special: boolean;
}

const number = String.raw`\d+(?:[.,]\d+)?`;
const unit = String.raw`(?:mm|cm|m)(?![\p{L}\d²])`;
const element = /\b(fenster|windows?|tür(?:e|en)?|tuer(?:e|en)?|tueren|doors?|plissee(?:tür(?:e|en)?|tueren)?)\b/giu;
const pair = new RegExp(String.raw`(?:(\d+)\s*[x×*]\s*)?(${number})\s*(${unit})?\s*[x×*]\s*(${number})\s*(${unit})?`, "giu");
const area = new RegExp(String.raw`(${number})\s*(mm²|cm²|m²|mm2|cm2|m2|qm|quadratmeter)(?![\p{L}\d])`, "giu");
const toNumber = (s: string) => Number(s.replace(",", "."));
const factor: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1 };
const words: Record<string, number> = { ein:1, eine:1, einen:1, eins:1, zwei:2, drei:3, vier:4, fünf:5, fuenf:5, sechs:6, sieben:7, acht:8, neun:9, zehn:10 };
const roundArea = (n: number) => Math.round(n * 1e8) / 1e8;
const classify = (s: string): ElementType => /fenster|window/i.test(s) ? "window" : "door";
export function addIssue(issues: IntakeIssue[], code: string, question: string) {
  if (!issues.some(i => i.code === code)) issues.push({ code, question });
}
function countBeforeType(prefix: string, token: RegExpMatchArray | undefined): number | null {
  if (!token) return null;
  const before = prefix.slice(0, token.index).match(/(?:^|[^\d.,])(\d+|ein|eine|einen|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*(?:[x×]|Stück|Stk\.?)?\s*$/iu);
  const after = prefix.slice((token.index || 0) + token[0].length).match(/^\s*:?\s*(\d+)\s*(?:Stück|Stk\.?|[x×])\s*$/iu);
  const raw = before?.[1] || after?.[1];
  return raw ? (words[raw.toLowerCase()] || Number(raw)) : null;
}

export function parseMeasurements(text: string, postalField = ""): Extraction {
  const result: Extraction = { method:"deterministic", measurements:[], issues:[], postalCode:null, special:false };
  if (text.length > 6000) addIssue(result.issues,"text_too_long","Bitte senden Sie die Masse als kurze Liste mit Stückzahl, Elementtyp und Einheit.");
  const source = text.slice(0,6000);
  if(/[-−]\s*\d+(?:[.,]\d+)?\s*(?:mm|cm|m\b|[x×])/iu.test(source) || /\d[.,]?\d*[eE][+-]?\d/.test(source))addIssue(result.issues,"invalid_number_format","Bitte prüfen Sie die Masse und schreiben Sie positive Werte mit Einheit, ohne negative Werte oder Exponentialschreibweise.");
  const explicitPostal = [...source.matchAll(/\b(?:PLZ|Postleitzahl)\s*[:=]?\s*([1-9]\d{3})\b/giu)].map(m=>m[1]);
  for(const m of source.matchAll(/\b([1-9]\d{3})\s+([A-ZÄÖÜ][\p{L}.-]+(?:\s+[A-ZÄÖÜ][\p{L}.-]+)?)/gu)) if(!/^(?:mm|cm|m)\b/i.test(m[2]))explicitPostal.push(m[1]);
  const field = postalField.trim();
  const codes = new Set([...explicitPostal, ...(/^[1-9]\d{3}$/.test(field) ? [field] : [])]);
  if (codes.size === 1) result.postalCode = [...codes][0];
  if (codes.size > 1) addIssue(result.issues,"conflicting_postal_codes","Welche Postleitzahl gilt für den Montageort? In Ihrer Anfrage stehen unterschiedliche PLZ.");
  if (field && !/^[1-9]\d{3}$/.test(field)) addIssue(result.issues,"invalid_postal_code","Bitte nennen Sie die vierstellige Schweizer PLZ des Montageorts.");
  result.special = /\b(sonder\w*|rund\w*|bogen\w*|dreieck\w*|dachfenster|reparatur\w*|reklamation\w*|defekt\w*|nur\s+material|ohne\s+montage)\b/iu.test(source);
  if (/\b(oder|alternativ|vielleicht|ungefähr|ca\.?|circa)\b/iu.test(source)) addIssue(result.issues,"uncertain_dimensions","Bitte bestätigen Sie die endgültigen Masse und Stückzahlen; Ihre Angaben enthalten Alternativen oder ungefähre Werte.");
  const measurementLanguage=source.replace(/\b(?:keine\s+Bestellung|kein\s+Auftrag|nicht\s+anrufen|kein\s+Rückruf|kein\s+Rueckruf)\b/giu," ");
  if (/\b(nicht|keine?|falsch|statt|sondern|korrigier\w*)\b/iu.test(measurementLanguage)) addIssue(result.issues,"negation_or_correction","Bitte senden Sie die gültigen Masse als eindeutige Liste; Ihre Nachricht enthält eine Verneinung oder Korrektur.");

  const atoms = [
    ...[...source.matchAll(pair)].map(m=>({m,mode:"dimensions" as const})),
    ...[...source.matchAll(area)].map(m=>({m,mode:"area" as const})),
  ].sort((a,b)=>a.m.index!-b.m.index!);
  let previousEnd = 0;
  let inheritedType: ElementType | null = null;
  let blockHasCount = false;
  let blockAtomCount = 0;
  for (let i=0;i<atoms.length;i++) {
    const {m,mode} = atoms[i];
    const start = m.index!;
    const end = start + m[0].length;
    const prefix = source.slice(previousEnd,start);
    const suffix = source.slice(end, atoms[i+1]?.m.index ?? source.length);
    const typesBefore = [...prefix.matchAll(element)];
    const typeBefore = typesBefore.at(-1);
    // A type after the measurement is accepted only before a separator or a
    // following quantity. Never borrow the next element's type across a list.
    const afterMatch = suffix.match(/^\s*(fenster|windows?|tür(?:e|en)?|tuer(?:e|en)?|tueren|doors?|plissee)\b/iu);
    const typeAfter = afterMatch ? classify(afterMatch[1]) : null;
    const totalClaim = mode === "area" && /\b(insgesamt|gesamt|total|zusammen)\s*:?\s*$/iu.test(prefix);
    if (totalClaim && result.measurements.length) {
      const targetType = typeBefore ? classify(typeBefore[0]) : inheritedType;
      const known = result.measurements.filter(x=>!targetType || x.type===targetType).reduce((sum,x)=>sum+x.areaM2,0);
      const value = toNumber(m[1]) * (/^mm/i.test(m[2]) ? 1e-6 : /^cm/i.test(m[2]) ? 1e-4 : 1);
      if (Math.abs(known-value)>1e-6) addIssue(result.issues,"conflicting_total","Die angegebene Gesamtfläche passt nicht zu den Einzelmassen. Bitte bestätigen Sie die korrekten Angaben.");
      previousEnd=end;
      continue;
    }
    const type = typeBefore ? classify(typeBefore[0]) : typeAfter || inheritedType;
    if (typeBefore || typeAfter) { blockAtomCount=0; blockHasCount=false; }
    const explicitCount = countBeforeType(prefix,typeBefore);
    if (explicitCount !== null) blockHasCount = true;
    blockAtomCount++;
    if (!type) addIssue(result.issues,"missing_type","Sind die genannten Masse für Fenster oder Türen/Plissee bestimmt?");
    let quantity = explicitCount ?? 1;
    if (mode === "dimensions" && m[1]) {
      if (explicitCount !== null && explicitCount !== Number(m[1])) addIssue(result.issues,"conflicting_quantity","Die Stückzahlen widersprechen sich. Bitte nennen Sie pro Elementtyp die gültige Anzahl.");
      quantity = Number(m[1]);
    }
    if (!Number.isSafeInteger(quantity) || quantity<=0 || quantity>10000) addIssue(result.issues,"invalid_quantity","Bitte bestätigen Sie eine positive, ganze Stückzahl pro Element.");
    if (blockAtomCount>1 && blockHasCount) addIssue(result.issues,"quantity_distribution","Wie verteilen sich die Stückzahlen auf die unterschiedlichen Masse? Bitte nennen Sie die Anzahl je Mass.");
    if (mode === "dimensions") {
      const width=toNumber(m[2]), height=toNumber(m[4]);
      const widthUnit=(m[3] || m[5] || null) as Unit | null;
      const heightUnit=(m[5] || m[3] || null) as Unit | null;
      if (!widthUnit || !heightUnit) addIssue(result.issues,"missing_unit","Sind die Masse in mm, cm oder m angegeben? Bitte ergänzen Sie die Einheit.");
      if (explicitCount === null && !m[1] && !/\b(eine?|einen|1)\b/iu.test(prefix) && !/\b(tür|tuer|türe|door)\b/iu.test(typeBefore?.[0] || afterMatch?.[1] || "")) addIssue(result.issues,"missing_quantity","Wie viele Elemente benötigen Sie je Mass? Bitte ergänzen Sie die Stückzahl.");
      if (!(width>0 && height>0)) addIssue(result.issues,"invalid_dimensions","Breite und Höhe müssen grösser als null sein.");
      const areaM2=widthUnit && heightUnit ? roundArea(width*factor[widthUnit]*height*factor[heightUnit]*quantity) : 0;
      if (widthUnit && heightUnit && (width*factor[widthUnit]>10 || height*factor[heightUnit]>10)) addIssue(result.issues,"unusual_dimensions","Bitte prüfen Sie die ungewöhnlich grossen Masse und deren Einheiten; unser Team klärt die Sonderanfertigung.");
      if (type) result.measurements.push({type,quantity,width,height,widthUnit,heightUnit,areaM2,mode,source:source.slice(previousEnd,end).trim()});
    } else {
      const value=toNumber(m[1]) * (/^mm/i.test(m[2]) ? 1e-6 : /^cm/i.test(m[2]) ? 1e-4 : 1);
      const perPiece=/\b(je|jeweils|pro\s+(?:stück|element|fenster|tür))\b/iu.test(prefix);
      if (explicitCount !== null && quantity>1 && !perPiece) addIssue(result.issues,"area_quantity_ambiguous","Ist die Fläche pro Stück oder insgesamt gemeint? Bitte bestätigen Sie die Gesamtfläche je Elementtyp.");
      if (!(value>0)) addIssue(result.issues,"invalid_area","Die Fläche muss grösser als null sein.");
      if (type) result.measurements.push({type,quantity:perPiece?quantity:1,width:null,height:null,widthUnit:null,heightUnit:null,areaM2:roundArea(value*(perPiece?quantity:1)),mode,source:source.slice(previousEnd,end+(afterMatch?.[0].length||0)).trim()});
    }
    inheritedType=type;
    previousEnd=end+(afterMatch?.[0].length||0);
  }
  if (!atoms.length) addIssue(result.issues,"missing_dimensions","Bitte senden Sie pro Fenster oder Tür Stückzahl, Breite × Höhe mit Einheit (mm/cm/m) oder die Gesamtfläche in m².");
  // Unparsed dimension/unit claims must not silently disappear from a quote.
  const removed = atoms.reduceRight((s,a)=>s.slice(0,a.m.index!)+" ".repeat(a.m[0].length)+s.slice(a.m.index!+a.m[0].length),source);
  if (new RegExp(String.raw`${number}\s*(?:mm|cm|m|m²|m2)\b`,"iu").test(removed)) addIssue(result.issues,"unparsed_measurements","Ein Mass konnte nicht eindeutig zugeordnet werden. Bitte nennen Sie pro Element Stückzahl, Breite und Höhe mit Einheit.");
  return result;
}

export function calculatorMeasurements(data: Record<string,string>): Extraction {
  const result: Extraction={method:"deterministic",measurements:[],issues:[],postalCode:/^[1-9]\d{3}$/.test(data.plz?.trim()||"")?data.plz.trim():null,special:false};
  for (const [key,type] of [["fensterflaeche_m2","window"],["tuerflaeche_m2","door"]] as const) {
    const raw=(data[key]||"0").trim();
    const n=/^\d+(?:[.,]\d+)?$/.test(raw)?toNumber(raw):NaN;
    if (!Number.isFinite(n) || n<0 || n>10000) addIssue(result.issues,"invalid_area","Bitte prüfen Sie die eingegebene Fläche in m².");
    else if(n>0) result.measurements.push({type,quantity:1,width:null,height:null,widthUnit:null,heightUnit:null,areaM2:n,mode:"area",source:`${key}: ${raw} m²`});
  }
  if (!result.measurements.length) addIssue(result.issues,"missing_dimensions","Bitte nennen Sie die Fenster- oder Türfläche in m².");
  return result;
}

export function redactMeasurementText(text: string, contacts: Record<string,string> = {}) {
  let safe=text.slice(0,6000);
  for (const key of ["name","email","telefon","firma","adresse"]) {
    const value=contacts[key]?.trim();
    if(value && value.length>=3) safe=safe.replaceAll(value,"[Kontakt entfernt]");
  }
  safe=safe.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,"[E-Mail entfernt]").replace(/\+\d[\d ()/.-]{6,}\d/g,"[Telefon entfernt]");
  return safe.split(/\n|(?<=[.!?])\s+/).filter(line=>/fenster|tür|tuer|plissee|breit|höh|hoehe|height|width|\d\s*[x×]|\d\s*(?:cm|mm|m²|m2|qm)/iu.test(line)).join("\n");
}

// Structured output is a proposal. Evidence and arithmetic are rechecked here.
// In particular, AI cannot supply a missing unit or silently resolve a conflict.
export function validateAIExtraction(candidate: unknown, text: string, baseline: Extraction): Extraction {
  const output: Extraction={...baseline,method:"openai",measurements:[],issues:baseline.issues.filter(i=>!["missing_dimensions","unparsed_measurements","missing_quantity"].includes(i.code))};
  const items=(candidate as any)?.measurements;
  if(!Array.isArray(items) || !items.length || items.length>100) { addIssue(output.issues,"ai_unverified","Bitte senden Sie eine eindeutige Liste der Masse mit Stückzahl und Einheit."); return output; }
  const ranges: [number,number][]=[];
  for(const item of items){
    const source=typeof item.source==="string"?item.source.trim():"";
    const start=text.indexOf(source),end=start+source.length;
    if(!source || start<0 || !["window","door"].includes(item.type) || ranges.some(([a,b])=>start<b && end>a)) { addIssue(output.issues,"ai_unverified","Die automatisch gelesenen Masse benötigen eine Bestätigung."); continue; }
    ranges.push([start,end]);
    const tokens=[...source.matchAll(element)];
    const type=tokens.length>0 && tokens.every(t=>classify(t[0])===item.type);
    const q=Number(item.quantity);
    const qtyMatch=source.match(/\b(\d+|ein|eine|einen|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\s*(?:Stück|Stk\.?|Fenster|Türen?|Tueren|Doors?|Windows?)/iu);
    const qty=qtyMatch?(words[qtyMatch[1].toLowerCase()]||Number(qtyMatch[1])):null;
    const evidence=(value:unknown,u:unknown)=> typeof value==="number" && value>0 && ["mm","cm","m"].includes(String(u)) && [...source.matchAll(new RegExp(String.raw`(${number})\s*(${unit})`,"giu"))].some(m=>toNumber(m[1])===value && m[2]===u);
    if(!type || !Number.isSafeInteger(q) || q<=0 || q>10000 || qty!==q || !evidence(item.width,item.widthUnit) || !evidence(item.height,item.heightUnit)) { addIssue(output.issues,"ai_unverified","Bitte bestätigen Sie Stückzahl, Breite, Höhe und Einheit der automatisch gelesenen Masse."); continue; }
    const width=Number(item.width), height=Number(item.height), widthUnit=item.widthUnit as Unit,heightUnit=item.heightUnit as Unit;
    if(width*factor[widthUnit]>10 || height*factor[heightUnit]>10) addIssue(output.issues,"unusual_dimensions","Bitte prüfen Sie die ungewöhnlich grossen Masse und Einheiten.");
    output.measurements.push({type:item.type,quantity:q,width,height,widthUnit,heightUnit,areaM2:roundArea(q*width*factor[widthUnit]*height*factor[heightUnit]),mode:"dimensions",source});
  }
  let uncovered=text;
  for(const [start,end]of ranges.sort((a,b)=>b[0]-a[0]))uncovered=uncovered.slice(0,start)+" ".repeat(end-start)+uncovered.slice(end);
  if([...uncovered.matchAll(element)].length || new RegExp(String.raw`${number}\s*(?:mm|cm|m)\b`,"iu").test(uncovered))addIssue(output.issues,"ai_omitted_measurement","Nicht alle Elementangaben konnten sicher übernommen werden. Bitte bestätigen Sie die vollständige Massliste.");
  // Existing clear measurements must still be represented with the same areas.
  for(const known of baseline.measurements) if(!output.measurements.some(m=>m.type===known.type && Math.abs(m.areaM2-known.areaM2)<1e-6)) addIssue(output.issues,"ai_conflicts_with_parser","Die automatisch gelesenen Masse stimmen nicht mit den eindeutigen Angaben überein. Bitte bestätigen Sie die Masse.");
  return output;
}
