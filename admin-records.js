(() => {
  const root = document.getElementById('recordsRoot');
  const STATUSES=['Novi upit','Ponuda poslata','Čeka odgovor','Prihvaćeno','Odbijeno','Montaža','Završeno'];
  const historyTitle=kind=>({created:'Karton otvoren',payment:'Zabeležena uplata',complaint:'Izmenjena reklamacija',decision:'Zabeležen ishod upita',appointment:'Zabeležen termin montaže','cancel-appointment':'Otkazan termin montaže',quote:'Pripremljena nova ponuda',quote_intake:'Automatski izdvojene mere i obračun',quote_email:'Obrađeno slanje poruke kupcu'}[kind]||'Sačuvan karton');
  const $=(s)=>root.querySelector(s);
  const money=n=>n==null?'Nije uneto':new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(n);
  const day=s=>s?new Date(s).toLocaleDateString('sr-Latn-RS'):'—';
  const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'});
  const e=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='class')n.className=v;else if(v!=null)n.setAttribute(k,v);}children.flat().forEach(c=>c!=null&&n.append(c));return n;};
  const btn=(label,fn,kind='ghost small')=>e('button',{type:'button',class:'btn '+kind,onclick:fn},label);
  let list=[],pending=[],selected=null,filter='',search='',source='',busy=false,view='inquiries';
  const hasAppointment=d=>d.appointmentAt&&d.appointmentTime&&d.appointmentStatus!=='cancelled'&&['Prihvaćeno','Montaža'].includes(d.status);
  const appointmentText=d=>day(d.appointmentAt)+' u '+d.appointmentTime;
  async function api(path='',opts={}){
    const token=sessionStorage.getItem('gttAdminToken');
    const headers={Authorization:'Bearer '+(token||'')};
    let body=opts.body;
    if(opts.json){headers['Content-Type']='application/json';body=JSON.stringify(opts.json);}
    const r=await fetch('/api/admin/records'+path,{method:opts.method||'GET',headers,body});
    if(r.status===401){document.getElementById('logoutBtn').click();throw Error('Sesija je istekla. Prijavi se ponovo.');}
    if(opts.file&&r.ok)return r.blob();
    const d=await r.json();if(!r.ok)throw Error(d.error||'Greška pri čuvanju.');return d;
  }
  function error(err){const box=$('#recordError');if(box){box.textContent=err.message;box.scrollIntoView({block:'nearest'});}else root.prepend(e('p',{class:'record-error'},err.message));}
  async function load(){try{const results=await Promise.all([api(),api('/pending')]);list=results[0].records;pending=results[1].pending;renderList();}catch(err){root.replaceChildren(e('h2',{},'Upiti / Anfragen'),e('p',{class:'record-error'},err.message),btn('Pokušaj ponovo',load));}}
  async function open(id){try{selected=(await api('/'+id)).record;renderRecord();root.scrollIntoView({block:'start'});$('.record-heading').focus({preventScroll:true});}catch(err){error(err);}}
  function renderList(){
    selected=null;root.replaceChildren(e('div',{class:'record-head'},e('div',{},e('h2',{},'Upiti / Anfragen'),e('p',{class:'record-note'},'Svaki upit ima svoj karton. Prihvatanje i odbijanje beleže se posebno.')),e('div',{class:'record-actions'},btn('Dodaj klijenta',manual,''),btn('Osveži',load))));
    if(window.location.hostname==='127.0.0.1'||window.location.hostname==='localhost')root.append(e('div',{class:'record-alert'},'LOKALNI PREGLED · Samo označeni test podaci. Promene se čuvaju lokalno.'));
    const now=new Date().toLocaleString('sv-SE',{timeZone:'Europe/Zurich'}).slice(0,16).replace(' ','T');
    const appointments=list.filter(r=>hasAppointment(r.document)&&(r.document.appointmentAt+'T'+r.document.appointmentTime)>=now).sort((a,b)=>(a.document.appointmentAt+a.document.appointmentTime).localeCompare(b.document.appointmentAt+b.document.appointmentTime));
    root.append(e('div',{class:'record-actions'},btn('Upiti',()=>{view='inquiries';renderList();},view==='inquiries'?'small':'ghost small'),btn('Montaže · '+appointments.length,()=>{view='appointments';renderList();},view==='appointments'?'small':'ghost small')));
    if(view==='appointments'){
      root.append(e('h2',{style:'margin-top:20px'},'Predstojeće montaže'),e('p',{class:'record-note'},'Interni termini u švajcarskom lokalnom vremenu (Europe/Zurich).'));
      if(!appointments.length)root.append(e('p',{class:'record-empty'},'Nema predstojećih zakazanih montaža. Termin zadaješ dugmetom „Zakaži termin montaže“ u dogovorenom poslu.'));
      appointments.forEach(r=>{const d=r.document;root.append(e('div',{class:'record-row'},e('div',{},e('strong',{},d.name||d.company),e('small',{},d.isTest?'TEST · Nije stvarna poseta':'')),e('div',{},e('strong',{},appointmentText(d)),e('small',{},[d.address,d.postalCode].filter(Boolean).join(' · ')||'Adresa nije uneta')),e('div',{},d.phone||d.email,e('small',{},d.appointmentNote||'')),btn('Otvori karton',()=>open(r.id),'small')));});return;
    }
    const counts=e('div',{class:'record-summary'});
    [['','Svi'],...STATUSES.map(s=>[s,s])].forEach(([s,label])=>counts.append(btn(label+' · '+list.filter(r=>!s||r.document.status===s).length,()=>{filter=s;renderList();},s===filter?'active':'')));
    root.append(counts);
    const input=e('input',{placeholder:'Traži ime, firmu, telefon ili ID',value:search,'aria-label':'Pretraga upita',oninput:ev=>{search=ev.target.value;drawRows();}});
    const sources=e('select',{'aria-label':'Izvor upita',onchange:ev=>{source=ev.target.value;drawRows();}},...['Svi izvori','Kalkulator','B2B','Kontakt','Ručni unos'].map(s=>e('option',{value:s==='Svi izvori'?'':s},s)));sources.value=source;
    root.append(e('div',{class:'record-toolbar'},input,sources),e('div',{id:'recordRows',class:'record-list'}));drawRows();
    const imp=e('input',{type:'file',accept:'.json,application/json','aria-label':'Netlify JSON za uvoz',onchange:async ev=>{try{const data=JSON.parse(await ev.target.files[0].text());const r=await api('/import',{method:'POST',json:{submissions:Array.isArray(data)?data:data.submissions}});await load();root.prepend(e('p',{class:'record-note'},`Uvezeno: ${r.created}. Već postoje: ${r.duplicates}.`));}catch(err){error(err);}}});
    const stageInput=e('input',{type:'file',accept:'.json,application/json','aria-label':'Privatni spisak ranijih upita',onchange:async ev=>{try{const data=JSON.parse(await ev.target.files[0].text());const r=await api('/pending',{method:'POST',json:{submissions:Array.isArray(data)?data:data.submissions}});await load();root.prepend(e('p',{class:'record-note'},`Pripremljeno za pregled: ${r.staged}. Već postoje: ${r.duplicates}.`));}catch(err){error(err);}}});
    root.append(e('details',{},e('summary',{},'Uvoz ranijih Netlify upita'),e('p',{class:'record-note'},'Uvoz prepoznaje izvorne ID-eve i čuva postojeće kartone. Ovde uvezi samo izabrane zapise koji treba da dobiju karton.'),imp,e('p',{class:'record-note'},'Ostale ranije upite možeš samo pripremiti na privatni spisak za pregled, bez prenosa u poslove.'),stageInput));
    if(pending.length){
      const box=e('details',{},e('summary',{},`Raniji upiti — čekaju pregled · ${pending.length}`),e('p',{class:'record-note'},'Ovo je privatni pregled originalnih podataka. Ovi upiti još nisu preneti u operativne kartone i nemaju zabeležen dogovor.'));
      pending.forEach(p=>{const f=p.original.fields;box.append(e('details',{},e('summary',{},`${f.name||f.firma||'Bez imena'} · ${p.source} · ${day(p.received_at)}`),e('p',{class:'record-note'},[f.email,f.telefon].filter(Boolean).join(' · ')),e('p',{class:'record-note'},'Čeka pregled pre prenosa · Netlify ID: '+p.original.submissionId),e('pre',{},JSON.stringify(f,null,2))));});
      root.append(box);
    }
  }
  function manual(){
    selected=null;view='inquiries';
    const requestId=crypto.randomUUID();
    root.replaceChildren(btn('← Svi upiti',load),e('h2',{},'Dodaj klijenta'),e('p',{class:'record-note'},'Ručni unos za telefon, preporuku, WhatsApp ili lični kontakt. Dovoljni su ime ili firma i telefon ili email.'),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const f=e('form',{onsubmit:async ev=>{
      ev.preventDefault();const save=f.querySelector('[type=submit]');save.disabled=true;
      try{const d=await api('',{method:'POST',json:{...Object.fromEntries(new FormData(f)),requestId}});selected=d.record;renderRecord();root.scrollIntoView({block:'start'});$('.record-heading').focus({preventScroll:true});root.prepend(e('p',{class:'record-note',role:'status'},'✓ Klijent je sačuvan kao novi upit. Dogovor možeš zabeležiti dugmetom „Dogovoren posao“.'));}catch(err){error(err);save.disabled=false;}
    }});
    const fields=e('div',{class:'record-fields'});
    [['Ime i prezime','name','text'],['Firma','company','text'],['Telefon','phone','tel'],['Email (neobavezno)','email','email'],['Adresa montaže','address','text'],['Poštanski broj / mesto','postalCode','text'],['Kanal dolaska (neobavezno)','channel','text'],['Početna ponuđena cena (CHF, neobavezno)','quotedPrice','number']].forEach(([label,key,type])=>fields.append(e('label',{},label,e('input',{name:key,type,...(type==='number'?{min:0,step:'.01'}:{})}))));
    fields.append(e('label',{class:'wide'},'Beleška / zahtev',e('textarea',{name:'request',maxlength:'6000'})));
    const primary=e('div',{class:'record-fields'});
    const primaryName=fields.querySelector('[name=name]').closest('label');primaryName.firstChild.textContent='Ime ili firma';
    primary.append(primaryName,fields.querySelector('[name=phone]').closest('label'));
    f.append(primary,e('details',{},e('summary',{},'Dodatni podaci (neobavezno)'),fields),e('p',{class:'record-note'},'Početni status: Novi upit. Sam unos čuva evidenciju; email se ne šalje.'),e('button',{type:'submit',class:'btn'},'Sačuvaj klijenta'));root.append(f);root.scrollIntoView({block:'start'});
  }
  function drawRows(){
    const rows=$('#recordRows');rows.replaceChildren();
    const found=list.filter(r=>(!filter||r.document.status===filter)&&(!source||r.source===source)&&(!search||[r.id,...Object.values(r.document).filter(x=>typeof x==='string')].join(' ').toLowerCase().includes(search.toLowerCase())));
    if(!found.length)rows.append(e('div',{class:'record-empty'},list.length?'Nema upita za ovu pretragu.':'Još nema upita. Novi potvrđeni upiti će ovde dobiti karton.'));
    found.forEach(r=>{const d=r.document;rows.append(e('div',{class:'record-row'},e('div',{},e('strong',{},d.name||d.company||'Bez naziva'),d.isTest?e('span',{class:'record-badge test'},'TEST'):null,e('small',{},d.company||d.email||d.phone),e('small',{},r.id)),e('div',{class:'record-source'},r.source,e('small',{},day(r.received_at))),e('div',{class:'record-price'},money(d.agreedPrice??d.quotedPrice),e('small',{},d.status==='Odbijeno'?'Ranija cena':d.agreedPrice!=null?'Dogovoreno':'Ponuda')),e('div',{class:'record-row-actions'},e('span',{class:'record-badge'},d.status),d.decisionDate?e('small',{},'Odluka: '+day(d.decisionDate)):null,btn('Otvori karton',()=>open(r.id),'small'))));});
  }
  function field(label,key,type='text',wide=false){const d=selected.document;const input=type==='textarea'?e('textarea',{name:key},d[key]||''):type==='select'?e('select',{name:key},...STATUSES.map(s=>e('option',{value:s},s))):e('input',{name:key,type,value:d[key]??'',...(type==='number'?{min:'0',step:'.01'}:{})});if(type==='select')input.value=d[key];return e('label',{class:wide?'wide':''},label,input);}
  function group(title,fields){return e('details',{},e('summary',{},title),e('div',{class:'record-fields'},...fields.map(f=>field(...f))));}
  function renderRecord(){
    const r=selected,d=r.document;root.replaceChildren();
    root.append(e('div',{class:'record-head'},btn('← Svi upiti',()=>{if($('#recordForm')?.dataset.dirty==='true'&&!confirm('Napusti nesačuvane izmene?'))return;load();}),e('span',{class:'record-note'},r.id+' · '+r.source+' · '+day(r.received_at))));
    root.append(e('h2',{class:'record-heading',tabindex:'-1'},d.name||d.company||'Karton upita'));
    root.append(e('p',{class:'record-note'},[d.company,d.email,d.phone,d.address,d.postalCode].filter(Boolean).join(' · ')));
    if(d.isTest)root.append(e('div',{class:'record-alert'},'TEST UPIT · Nije stvarna narudžbina.'));
    root.append(e('div',{class:'record-decision-actions'},e('span',{class:'record-badge'},d.status+(d.decisionDate?' · '+day(d.decisionDate):'')),btn('Dogovoren posao',()=>decision('Prihvaćeno'),''),btn('Odbijeno',()=>decision('Odbijeno'),'ghost'),btn('Izmeni cenu / datum',()=>editDecision(),'ghost small'),e('p',{class:'record-note'},'Jedan klik beleži ishod i današnji datum. Dogovor koristi poslednju ponuđenu cenu; ako cena nedostaje, unesi samo iznos.')));
    root.append(e('div',{id:'decisionInline'}));
    const paid=d.payments.reduce((sum,p)=>sum+p.amount,0),agreed=['Prihvaćeno','Montaža','Završeno'].includes(d.status),base=d.invoiceAmount??(agreed?d.agreedPrice:null);
    root.append(e('div',{class:'record-facts'},...[["Izračunata / poslednja ponuda",d.quotedPrice??r.original.price],[d.status==='Odbijeno'&&d.agreedPrice!=null?"Ranije zabeležena cena":"Dogovorena cena",d.agreedPrice],["Uplaćeno",paid],["Preostalo",base==null?null:Math.max(0,base-paid)]].map(([label,n])=>e('div',{},e('small',{},label),e('strong',{},money(n))))));
    const extracted=(d.intake?.measurements||[]).map(m=>(m.type==='window'?'Prozori':'Vrata / plise')+': '+(m.mode==='dimensions'?`${m.quantity} × ${m.width} ${m.widthUnit} × ${m.height} ${m.heightUnit} · `:'')+Number(m.areaM2).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²').join('\n');
    root.append(e('section',{class:'record-request-summary'},e('strong',{},'Zahtev kupca'),e('p',{},extracted||d.products||'Mere / proizvodi još nisu zabeleženi.'),d.request?e('p',{},d.request):null));
    if(d.intake)root.append(intakeSummary(d.intake));
    const appointmentBox=e('section',{class:'record-appointment'});
    if(['Prihvaćeno','Montaža'].includes(d.status))appointmentBox.append(btn('Zakaži termin montaže',schedule,''));
    if(hasAppointment(d))appointmentBox.append(e('p',{},e('strong',{},'Montaža: '+appointmentText(d)),e('span',{class:'record-note'},' · '+([d.address,d.postalCode].filter(Boolean).join(' · ')||'Adresa još nije uneta'))),d.appointmentNote?e('p',{class:'record-note'},d.appointmentNote):null,e('div',{class:'record-actions'},btn('Promeni termin',schedule),btn('Otkaži termin',()=>mutate({action:'cancel-appointment'}))));
    else if(d.appointmentStatus==='cancelled')appointmentBox.append(e('p',{class:'record-note'},'Termin '+appointmentText(d)+' je otkazan. Raniji termin ostaje u istoriji.'));
    if(appointmentBox.childNodes.length)root.append(appointmentBox);
    root.append(e('div',{id:'appointmentInline'}));
    if(base!=null&&paid>base)root.append(e('p',{class:'record-note'},'Višak uplate: '+money(Math.round((paid-base)*100)/100)));
    root.append(e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const form=e('form',{id:'recordForm',oninput:()=>form.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();const patch=Object.fromEntries(new FormData(form));await mutate({action:'update',patch});}});
    form.append(group('Izmeni podatke klijenta / zahtev',[["Ime i prezime","name"],["Firma","company"],["Email","email","email"],["Telefon","phone"],["Adresa montaže","address"],["Poštanski broj / mesto","postalCode"],["Proizvodi i mere","products","textarea",true],["Zahtev kupca","request","textarea",true],["Interne napomene","notes","textarea",true]]));
    form.append(group('Izmeni ponudu / detalje',[["Status","status","select"],["Poslednja ponuđena ukupna cena (CHF)","quotedPrice","number"],["Popust / akcija (opis)","discount"],["Dodatni troškovi (evidencija, CHF)","extraCosts","number"],["Konačna dogovorena cena (CHF)","agreedPrice","number"],["Datum slanja ponude","offerSentAt","date"],["Datum prihvatanja / odbijanja","decisionDate","date"],["Razlog odluke (neobavezno)","decisionReason"],["Dokaz dogovora (npr. naziv priloženog dokumenta)","decisionEvidence","textarea",true],["Poslata ponuda / tekst","offerText","textarea",true]]));
    form.append(group('Izvođenje posla',[["Merenje","measuredAt","date"],["Poručeno","orderedAt","date"],["Montirano","installedAt","date"],["Detalji posla","workNotes","textarea",true]]));
    form.append(group('Račun',[["Broj računa","invoiceNumber"],["Iznos računa (CHF)","invoiceAmount","number"],["Datum računa","invoiceDate","date"],["Rok uplate","invoiceDue","date"]]));
    form.append(e('div',{class:'record-actions record-form-actions'},e('button',{type:'submit',class:'btn',id:'recordSave'},'Sačuvaj karton'),e('span',{class:'record-note'},'Originalni upit ostaje sačuvan. Svako čuvanje dobija verziju u istoriji.')));
    root.append(form);
    root.append(e('div',{class:'record-split'},payments(),complaints()));
    root.append(files());
    const original=e('details',{},e('summary',{},'Originalni upit i kalkulacija'),e('pre',{},JSON.stringify(r.original,null,2)));
    const history=e('details',{},e('summary',{},`Istorija promena · ${r.history.length}`));
    r.history.forEach((h,i)=>{const old=r.history[i+1]?.snapshot||{};const changed=Object.keys(h.snapshot).filter(k=>JSON.stringify(h.snapshot[k])!==JSON.stringify(old[k]));history.append(e('div',{class:'record-log'},e('strong',{},`Verzija ${h.revision} · ${new Date(h.at).toLocaleString('sr-Latn-RS')}`),e('p',{},h.actor),e('p',{},historyTitle(h.kind)),e('details',{},e('summary',{},'Pogledaj zabeležene vrednosti'),e('pre',{},JSON.stringify(Object.fromEntries(changed.map(k=>[k,{pre:old[k]??null,posle:h.snapshot[k]}])),null,2)))));});
    root.append(original,history);
  }
  async function decision(status){
    if(selected.document.status===status){root.prepend(e('p',{class:'record-note',role:'status'},'Ovaj ishod je već zabeležen. Za korekciju koristi „Izmeni cenu / datum“.'));return;}
    if(status==='Prihvaćeno'&&selected.document.quotedPrice==null&&selected.document.agreedPrice==null){
      const f=e('form',{class:'record-alert',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'decision',status,agreedPrice:new FormData(f).get('agreedPrice')});}},e('p',{},'Cena još nije zabeležena. Unesi dogovoreni iznos; današnji datum se beleži automatski.'),e('label',{},'Dogovorena cena (CHF)',e('input',{type:'number',name:'agreedPrice',min:'0',step:'.01',required:true})),e('p',{},e('button',{type:'submit',class:'btn'},'Potvrdi dogovor')));
      $('#decisionInline').replaceChildren(f);f.querySelector('input').focus();return;
    }
    await mutate({action:'decision',status});
  }
  function editDecision(){const target=$('#recordForm [name=agreedPrice]');target.closest('details').open=true;target.focus();target.scrollIntoView({block:'center',behavior:'smooth'});}
  function schedule(){
    const d=selected.document;
    const f=e('form',{class:'record-alert',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'appointment',...Object.fromEntries(new FormData(f))});}},e('strong',{},'Zakaži termin montaže'),e('p',{class:'record-note'},[d.name||d.company,d.address,d.postalCode].filter(Boolean).join(' · ')),e('div',{class:'record-fields'},e('label',{},'Datum montaže',e('input',{type:'date',name:'date',value:d.appointmentAt||today(),required:true})),e('label',{},'Vreme montaže',e('input',{type:'time',name:'time',value:d.appointmentTime||'',required:true})),e('label',{class:'wide'},'Kratka napomena (neobavezno)',e('input',{name:'note',value:d.appointmentNote||'',maxlength:'2000'}))),e('p',{class:'record-note'},'Švajcarsko lokalno vreme. Čuva se interni termin; poruke ili kalendarski pozivi se ne šalju.'),e('button',{type:'submit',class:'btn'},'Sačuvaj termin'));
    $('#appointmentInline').replaceChildren(f);f.querySelector('[name=date]').focus();f.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function intakeSummary(intake){
    const box=e('section',{class:'record-request-summary'},e('h3',{},intake.status==='priced'?'Automatski pripremljena ponuda':'Potrebna je dopuna upita'));
    const quote=intake.quote;
    if(quote){
      const number='GTT-'+selected.id.replace(/^GTT-/,'').slice(0,8).toUpperCase()+'-'+String(intake.version||quote.version||1).padStart(3,'0');
      box.append(e('p',{class:'record-note'},'Ponuda '+number+' · '+day(quote.calculatedAt||intake.processedAt)));
      const rows=e('div',{class:'record-quote-lines'});
      for(const [key,label]of [['fenster','Prozori'],['tueren','Vrata / plise']])if(quote.areas?.[key])rows.append(e('div',{},e('span',{},label+' · '+Number(quote.areas[key]).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²'),e('span',{},money(quote.rates[key])+' / m²')));
      rows.append(e('div',{},e('strong',{},'Ukupna ponuda'),e('strong',{},money(quote.totalCHF))));box.append(rows);
      if(quote.discount)box.append(e('p',{class:'record-note'},quote.discount.name+' · '+quote.discount.percent+'% već uračunato u jedinične cene.'));
    }
    const questions=intake.clarification||[];
    if(questions.length)box.append(e('p',{class:'record-note'},'Podaci koji nedostaju / potrebna provera:'),e('ul',{},...questions.map(q=>e('li',{},typeof q==='string'?q:q.question))));
    const emailStatus={preview_only:'Test pregled: poruka nije poslata.',queued:'Poruka čeka slanje.',sending:'Slanje poruke je u toku.',accepted:'Poruka je predata email servisu. Prijem u sandučetu je zasebna provera.',failed:'Slanje poruke nije uspelo; potreban je pregled.',not_available:'Email kupca nije zabeležen; poruka nije poslata.',blocked:'Slanje čeka proveru podešavanja.',manual_review:'Potrebna je stručna provera.'}[intake.email?.status]||'Status slanja se proverava.';
    box.append(e('p',{class:'record-note'},emailStatus),btn(quote?'Pogledaj ponudu':'Pogledaj poruku za dopunu',async()=>{
      try{const data=await api('/'+selected.id+'/offer');const frame=e('iframe',{title:'Pregled ponude kupcu',sandbox:'',srcdoc:data.html,style:'width:100%;height:70vh;border:0'});const dialog=e('dialog',{class:'record-offer-dialog'},e('div',{class:'record-head'},e('strong',{},data.reference||'Pregled ponude'),btn('Zatvori',()=>{dialog.close();dialog.remove();})),frame);document.body.append(dialog);dialog.showModal();}catch(err){error(err);}
    }));return box;
  }
  async function mutate(body){if(busy)return;if(body.action!=='update'&&$('#recordForm')?.dataset.dirty==='true'){error(Error('Prvo sačuvaj izmene kartona.'));return;}busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);try{selected=(await api('/'+selected.id,{method:'PATCH',json:{...body,revision:selected.revision}})).record;renderRecord();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Sačuvano · verzija '+selected.revision));}catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  function payments(){
    const box=e('section',{class:'card'},e('h2',{},'Uplate'),e('p',{class:'record-note'},'Ručna evidencija primljenih uplata.'));
    selected.document.payments.forEach(p=>box.append(e('div',{class:'record-log'},e('strong',{},money(p.amount)),e('p',{},day(p.date)+' · '+p.note))));
    const f=e('form',{onsubmit:async ev=>{ev.preventDefault();await mutate({action:'payment',...Object.fromEntries(new FormData(f))});}},e('div',{class:'record-fields'},e('label',{},'Iznos (CHF)',e('input',{name:'amount',type:'number',min:'.01',step:'.01',required:true})),e('label',{},'Datum',e('input',{name:'date',type:'date',value:today(),required:true})),e('label',{class:'wide'},'Napomena / referenca',e('input',{name:'note',maxlength:'1000'}))),e('p',{},e('button',{class:'btn ghost small',type:'submit'},'Zabeleži uplatu')));box.append(f);return box;
  }
  function complaints(){
    const box=e('section',{class:'card'},e('h2',{},'Reklamacije'));
    selected.document.complaints.forEach(c=>box.append(e('div',{class:'record-log'},e('strong',{},c.status+' · '+day(c.date)),e('p',{},c.description),e('p',{},[c.owner,c.due?'Rok: '+day(c.due):'',c.resolution].filter(Boolean).join(' · ')),btn('Otvori reklamaciju',()=>edit(c)))));
    const holder=e('div');box.append(btn('Nova reklamacija',()=>edit({date:today(),status:'Otvorena'})),holder);
    function edit(c){const f=e('form',{onsubmit:async ev=>{ev.preventDefault();await mutate({action:'complaint',complaint:{...Object.fromEntries(new FormData(f)),...(c.id?{id:c.id}:{})}});}});const fields=[["Datum","date","date"],["Odgovorna osoba","owner","text"],["Rok","due","date"],["Opis","description","textarea"],["Rešenje","resolution","textarea"],["Datum rešavanja","resolvedAt","date"]];if(c.id)f.append(e('input',{name:'id',type:'hidden',value:c.id}));fields.forEach(([label,key,type])=>f.append(e('label',{},label,type==='textarea'?e('textarea',{name:key,required:key==='description'},c[key]||''):e('input',{type,name:key,value:c[key]||''}))));const status=e('select',{name:'status'},...['Otvorena','U radu','Rešena'].map(s=>e('option',{value:s},s)));status.value=c.status;f.append(e('label',{},'Status',status),e('p',{},e('button',{type:'submit',class:'btn ghost small'},'Sačuvaj reklamaciju')));holder.replaceChildren(f);}
    return box;
  }
  function files(){const r=selected;const box=e('section',{class:'card'},e('h2',{},'Dokumenti i fotografije'),e('p',{class:'record-note'},'Potvrda dogovora, ponuda, merenje, montaža ili reklamacija. Dokumenti su dostupni kroz admin prijavu. PDF, JPG, PNG ili WebP do 2 MB. U opisu reklamacije navedi naziv slike.'));
    const items=e('div',{class:'record-files'});r.files.forEach(f=>items.append(btn(f.name,async()=>{try{const blob=await api('/'+r.id+'/files/'+f.id,{file:true});const url=URL.createObjectURL(blob);const a=e('a',{href:url,download:f.name});a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(err){error(err);}})));box.append(items);
    box.append(e('input',{type:'file',accept:'application/pdf,image/jpeg,image/png,image/webp','aria-label':'Priloži dokument ili sliku',onchange:async ev=>{try{if($('#recordForm')?.dataset.dirty==='true')throw Error('Prvo sačuvaj izmene kartona.');const file=ev.target.files[0];if(file.size>2097152)throw Error('Dokument mora biti manji od 2 MB.');const body=new FormData();body.append('file',file);await api('/'+r.id+'/files',{method:'POST',body});await open(r.id);}catch(err){error(err);}}}));return box;
  }
  document.querySelectorAll('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>{if(selected&&$('#recordForm')?.dataset.dirty==='true'&&!confirm('Napusti nesačuvane izmene?'))return;document.querySelectorAll('[data-admin-panel]').forEach(p=>p.hidden=p.dataset.adminPanel!==b.dataset.adminTab);document.querySelectorAll('[data-admin-tab]').forEach(t=>t.setAttribute('aria-selected',String(t===b)));if(b.dataset.adminTab==='records')load();}));
  window.addEventListener('gtt:admin-login',load);
  window.addEventListener('gtt:admin-logout',()=>{list=[];selected=null;root.replaceChildren();});
  if(!document.getElementById('appView').hidden)load();
})();
