(() => {
  const root=document.getElementById('recordsRoot');
  const STATUS={'Novi upit':'Neue Anfrage','Ponuda poslata':'Offerte versendet','Čeka odgovor':'Offerte versendet','Prihvaćeno':'Angenommen','Odbijeno':'Abgelehnt','Montaža':'Montage','Završeno':'Abgeschlossen'};
  const STEPS=['Novi upit','Ponuda poslata','Prihvaćeno','Odbijeno','Montaža','Završeno'];
  const SOURCE={'Kalkulator':'Rechner','Kontakt':'Kontaktformular','B2B':'B2B','Ručni unos':'Manuell'};
  const EVENTS={created:'Anfrage angelegt',archive:'Anfrage archiviert',restore:'Anfrage wiederhergestellt','historical-complete':'Frühere Anfrage abgeschlossen','start-installation':'Montage begonnen',complete:'Auftrag abgeschlossen',decision:'Entscheidung erfasst',payment:'Zahlung erfasst',complaint:'Reklamation aktualisiert',appointment:'Montagetermin geplant','cancel-appointment':'Montagetermin abgesagt',quote_intake:'Masse und Offerte automatisch erstellt',quote_email:'E-Mail-Versand bearbeitet',customer_acceptance:'Bestätigung des Kunden erhalten'};
  const canonical=s=>s==='Čeka odgovor'?'Ponuda poslata':s;
  const money=n=>n==null?'Nicht erfasst':new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(n);
  const date=s=>s?new Date(s).toLocaleDateString('de-CH'):'—';
  const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'});
  const productText=s=>(s||'').replace(/Prozori:/g,'Fenster:').replace(/vrata:/g,'Türen:');
  const $=s=>root.querySelector(s);
  const e=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='class')n.className=v;else if(v!==false&&v!=null)n.setAttribute(k,v===true?'':v);}children.flat().forEach(c=>c!=null&&n.append(c));return n;};
  const btn=(label,fn,kind='ghost small')=>e('button',{type:'button',class:'btn '+kind,onclick:fn},label);
  let records=[],selected=null,archived=false,filter='',search='',view='inquiries',busy=false,deepLinkResolved=false;
  const hasAppointment=d=>!d.archivedAt&&d.appointmentAt&&d.appointmentTime&&d.appointmentStatus!=='cancelled'&&['Prihvaćeno','Montaža'].includes(d.status);
  const appointmentText=d=>date(d.appointmentAt)+' um '+d.appointmentTime;
  async function api(path='',opts={}){
    const headers={Authorization:'Bearer '+(sessionStorage.getItem('gttAdminToken')||'')};
    let body=opts.body;if(opts.json){headers['Content-Type']='application/json';body=JSON.stringify(opts.json);}
    const response=await fetch('/api/admin/records'+path,{method:opts.method||'GET',headers,body});
    if(response.status===401){document.getElementById('logoutBtn').click();throw Error('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.');}
    if(opts.file&&response.ok)return response.blob();
    const data=await response.json();if(!response.ok)throw Error(data.error||'Die Anfrage konnte nicht gespeichert werden.');return data;
  }
  function error(err){const box=$('#recordError');if(box)box.textContent=err.message;else root.prepend(e('p',{class:'record-error',role:'alert'},err.message));}
  async function load(){
    try{
      records=(await api(archived?'?archived=1':'')).records;renderList();
      if(!deepLinkResolved){deepLinkResolved=true;const id=new URL(location.href).searchParams.get('anfrage');if(/^GTT-[a-f0-9]{24}$/.test(id||''))await open(id);}
    }catch(err){root.replaceChildren(e('h2',{},'Anfragen'),e('p',{class:'record-error'},err.message),btn('Erneut versuchen',load));}
  }
  async function open(id){try{selected=(await api('/'+id)).record;renderCard();root.scrollIntoView({block:'start'});$('.record-heading').focus({preventScroll:true});}catch(err){error(err);}}
  function renderList(){
    selected=null;
    root.replaceChildren(e('div',{class:'record-head'},e('div',{},e('h2',{},archived?'Archiv':'Anfragen'),e('p',{class:'record-note'},archived?'Archivierte Anfragen können jederzeit wiederhergestellt werden.':'Website-Anfragen und Offerten werden automatisch erfasst.')),e('div',{class:'record-actions'},...(archived?[]:[btn('Kunde hinzufügen',manual,'')]),btn(archived?'← Aktive Anfragen':'Archiv',()=>{archived=!archived;view='inquiries';filter='';search='';load();}),btn('Aktualisieren',load))));
    if(['127.0.0.1','localhost'].includes(location.hostname))root.append(e('p',{class:'record-alert'},'LOKALE VORSCHAU · Gekennzeichnete Testdaten. Änderungen werden lokal gespeichert.'));
    const now=new Date().toLocaleString('sv-SE',{timeZone:'Europe/Zurich'}).slice(0,16).replace(' ','T');
    const appointments=records.filter(r=>hasAppointment(r.document)&&r.document.appointmentAt+'T'+r.document.appointmentTime>=now).sort((a,b)=>(a.document.appointmentAt+a.document.appointmentTime).localeCompare(b.document.appointmentAt+b.document.appointmentTime));
    if(!archived)root.append(e('div',{class:'record-actions'},btn('Anfragen',()=>{view='inquiries';renderList();},view==='inquiries'?'small':'ghost small'),btn('Montagetermine '+appointments.length,()=>{view='appointments';renderList();},view==='appointments'?'small':'ghost small')));
    if(view==='appointments'){
      if(!appointments.length)root.append(e('p',{class:'record-empty'},'Keine anstehenden Montagetermine.'));
      appointments.forEach(r=>{const d=r.document;root.append(e('div',{class:'record-row'},e('strong',{},d.name||d.company),e('div',{},appointmentText(d),e('small',{},[d.address,d.postalCode].filter(Boolean).join(' · ')||'Adresse nicht erfasst')),e('span',{},d.phone||d.email),btn('Öffnen',()=>open(r.id),'small')));});return;
    }
    const counters=e('div',{class:'record-summary'});
    STEPS.map(s=>[s,STATUS[s]]).forEach(([s,label])=>counters.append(e('button',{type:'button',class:s===filter?'active':'','aria-pressed':String(s===filter),onclick:()=>{filter=filter===s?'':s;drawRows();renderCounters();}},e('span',{},label),e('strong',{class:'record-kpi-value'},String(records.filter(r=>canonical(r.document.status)===s).length)))));
    root.append(counters,e('div',{class:'record-toolbar'},e('input',{'aria-label':'Anfragen durchsuchen',placeholder:'Name, Firma oder Kontakt suchen',value:search,oninput:ev=>{search=ev.target.value;drawRows();}})),e('div',{id:'recordRows',class:'record-list'}));drawRows();
  }
  function renderCounters(){root.querySelectorAll('.record-summary button').forEach((b,i)=>{const status=STEPS[i];b.classList.toggle('active',filter===status);b.setAttribute('aria-pressed',String(filter===status));});}
  function drawRows(){
    const box=$('#recordRows');box.replaceChildren();
    const found=records.filter(r=>(!filter||canonical(r.document.status)===filter)&&(!search||[r.id,...Object.values(r.document).filter(x=>typeof x==='string')].join(' ').toLowerCase().includes(search.toLowerCase())));
    if(!found.length)box.append(e('p',{class:'record-empty'},archived?'Das Archiv ist leer.':'Keine passenden Anfragen.'));
    found.forEach(r=>{const d=r.document;box.append(e('div',{class:'record-row'},e('div',{},e('strong',{},d.name||d.company||'Ohne Namen'),d.isTest?e('span',{class:'record-badge test'},'TEST'):null,e('small',{},d.company||d.email||d.phone)),e('div',{class:'record-source'},SOURCE[r.source]||r.source,e('small',{},date(r.received_at))),e('div',{class:'record-price'},money(d.agreedPrice??d.quotedPrice),e('small',{},d.agreedPrice!=null?'Vereinbart':'Offerte')),e('div',{class:'record-row-actions'},e('span',{class:'record-badge'},STATUS[d.status]||d.status),btn('Öffnen',()=>open(r.id),'small'),btn(archived?'Wiederherstellen':'Entfernen',()=>archiveRecord(r,archived),archived?'ghost small':'ghost small record-remove'))));});
  }
  async function archiveRecord(r,restore=false){
    if(busy)return;if($('#recordForm')?.dataset.dirty==='true'){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    if(!restore&&!confirm('Anfrage «'+(r.document.name||r.document.company||'ohne Namen')+'» entfernen? Sie bleibt im Archiv und kann wiederhergestellt werden.'))return;
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api('/'+r.id,{method:'PATCH',json:{action:restore?'restore':'archive',revision:r.revision}});await load();root.prepend(e('p',{class:'record-note',role:'status'},restore?'✓ Anfrage wiederhergestellt.':'✓ Anfrage archiviert.'));}
    catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function mutate(body){
    if(busy)return;if(body.action!=='update'&&$('#recordForm')?.dataset.dirty==='true'){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{selected=(await api('/'+selected.id,{method:'PATCH',json:{...body,revision:selected.revision}})).record;renderCard();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Gespeichert.'));}
    catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function input(label,name,type='text',value='',required=false){return e('label',{},label,type==='textarea'?e('textarea',{name,required},value??''):e('input',{type,name,value:value??'',required,...(type==='number'?{min:0,step:'.01'}:{})}));}
  function manual(){
    selected=null;view='inquiries';archived=false;const requestId=crypto.randomUUID();
    root.replaceChildren(btn('← Alle Anfragen',load),e('h2',{},'Kunde hinzufügen'),e('p',{class:'record-note'},'Für Anfragen per Telefon, Empfehlung oder persönlichen Kontakt.'),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const form=e('form',{onsubmit:async ev=>{ev.preventDefault();const save=form.querySelector('[type=submit]');save.disabled=true;try{selected=(await api('',{method:'POST',json:{...Object.fromEntries(new FormData(form)),requestId}})).record;renderCard();}catch(err){error(err);save.disabled=false;}}});
    form.append(e('div',{class:'record-fields'},input('Name oder Firma','name'),input('Telefon','phone','tel')),e('details',{},e('summary',{},'Weitere Angaben (optional)'),e('div',{class:'record-fields'},input('Firma','company'),input('E-Mail','email','email'),input('Montageadresse','address'),input('PLZ / Ort','postalCode'),input('Kontaktweg','channel'),input('Offertpreis (CHF)','quotedPrice','number'),input('Anfrage / Notiz','request','textarea'))),e('p',{class:'record-note'},'Das Erfassen erstellt eine Anfrage. Es wird keine E-Mail versendet.'),e('button',{type:'submit',class:'btn'},'Kunde speichern'));root.append(form);
  }
  function renderCard(){
    const r=selected,d=r.document,status=canonical(d.status),legacy=!!r.original.submissionId&&!r.original.inquiryId;
    root.replaceChildren(e('div',{class:'record-head'},btn('← Alle Anfragen',()=>{if($('#recordForm')?.dataset.dirty==='true'&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;load();}),e('span',{class:'record-note'},(SOURCE[r.source]||r.source)+' · '+date(r.received_at))),e('h2',{class:'record-heading',tabindex:'-1'},d.name||d.company||'Anfrage'),e('p',{class:'record-note'},[d.company,d.email,d.phone,d.address,d.postalCode].filter(Boolean).join(' · ')),e('p',{},e('span',{class:'record-badge'},STATUS[d.status]||d.status)));
    if(d.isTest)root.append(e('p',{class:'record-alert'},'TESTANFRAGE · Keine tatsächliche Bestellung.'));
    if(d.archivedAt)root.append(e('div',{class:'record-alert'},'Archiviert am '+date(d.archivedAt),btn('Wiederherstellen',()=>archiveRecord(r,true))));
    const amount=d.agreedPrice??d.quotedPrice??r.original.price;
    if(amount!=null)root.append(e('div',{class:'record-main-price'},e('span',{},d.customerAcceptance?.pricePreliminary?'Vorläufiger Offertbetrag':d.agreedPrice!=null?'Vereinbarter Betrag':'Offertbetrag'),e('strong',{},money(amount))));
    if(d.customerAcceptance)root.append(e('p',{class:'record-note'},'Der Kunde möchte fortfahren. Masse und endgültige Vereinbarung müssen noch geprüft werden.'));
    const measurements=(d.intake?.measurements||[]).map(m=>(m.type==='window'?'Fenster':'Türen / Plissee')+': '+(m.mode==='dimensions'?m.quantity+' × '+m.width+' '+m.widthUnit+' × '+m.height+' '+m.heightUnit+' · ':'')+Number(m.areaM2).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²').join('\n');
    root.append(e('section',{class:'record-request-summary'},e('strong',{},'Kundenanfrage'),e('p',{},measurements||productText(d.products)||'Masse noch nicht erfasst.'),d.request?e('p',{},d.request):null));
    if(d.intake)root.append(quoteSummary(d.intake));
    if(!d.archivedAt){
      const next=e('section',{class:'record-next-step'});
      if(legacy&&status!=='Završeno')next.append(btn('Als abgeschlossen markieren',()=>mutate({action:'historical-complete'}),''));
      else if(status==='Ponuda poslata')next.append(e('p',{class:'record-note'},'Die Offerte wurde versendet. Der Kunde kann sie über den Link in der E-Mail bestätigen.'));
      else if(status==='Novi upit'&&!d.intake)next.append(btn('Offertpreis / Angaben erfassen',()=>editDetails('quotedPrice'),''));
      if(status==='Prihvaćeno')next.append(btn(hasAppointment(d)?'Montagetermin ändern':'Montagetermin planen',schedule,''),btn('Montage beginnen',()=>mutate({action:'start-installation'}),'ghost'));
      if(status==='Montaža')next.append(btn('Auftrag abschliessen',()=>mutate({action:'complete'}),''));
      if(next.childNodes.length)root.append(next);
      if(hasAppointment(d))root.append(e('p',{class:'record-appointment'},e('strong',{},'Montage: '+appointmentText(d)),d.appointmentNote?e('span',{},' · '+d.appointmentNote):null));
    }
    root.append(e('div',{id:'inlineAction'}),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const more=e('details',{id:'recordDetails'},e('summary',{},d.archivedAt?'Original und Verlauf':'Weitere Angaben / manuelle Korrektur'));
    if(!d.archivedAt){
      const form=e('form',{id:'recordForm',oninput:()=>form.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'update',patch:Object.fromEntries(new FormData(form))});}});
      const fields=e('div',{class:'record-fields'});
      for(const [label,key,type]of [['Name','name'],['Firma','company'],['E-Mail','email','email'],['Telefon','phone','tel'],['Montageadresse','address'],['PLZ / Ort','postalCode'],['Offertbetrag (CHF)','quotedPrice','number'],['Vereinbarter Betrag (CHF)','agreedPrice','number'],['Versanddatum der Offerte','offerSentAt','date'],['Datum der Zusage / Absage','decisionDate','date'],['Interne Notizen','notes','textarea'],['Kundenanfrage','request','textarea']])fields.append(input(label,key,type||'text',d[key]));
      form.append(fields,e('p',{},e('button',{type:'submit',class:'btn'},'Angaben speichern')));more.append(form);
      const decisions=e('div',{class:'record-actions'},btn('Zusage manuell erfassen',()=>decision('Prihvaćeno')),btn('Absage erfassen',()=>decision('Odbijeno')));
      if(hasAppointment(d))decisions.append(btn('Montagetermin absagen',()=>mutate({action:'cancel-appointment'})));
      more.append(e('h3',{},'Manuelle Entscheidung'),decisions,e('p',{class:'record-note'},'Für telefonisch oder persönlich bestätigte Zu- und Absagen.'),payments(),complaints(),files(),e('div',{class:'record-actions'},btn('Anfrage entfernen',()=>archiveRecord(r),'ghost small record-remove')));
    }
    more.append(e('h3',{},'Originalanfrage'),e('pre',{},JSON.stringify(r.original,null,2)),e('h3',{},'Verlauf'));
    r.history.forEach(h=>more.append(e('p',{class:'record-note'},new Date(h.at).toLocaleString('de-CH')+' · '+(EVENTS[h.kind]||'Angaben aktualisiert'))));root.append(more);
  }
  function editDetails(name){const more=$('#recordDetails');more.open=true;const field=more.querySelector('[name='+name+']');field?.focus();more.scrollIntoView({block:'center',behavior:'smooth'});}
  async function decision(status){
    const d=selected.document;
    if(d.status===status)return;
    if(status==='Prihvaćeno'&&d.quotedPrice==null&&d.agreedPrice==null){
      const form=e('form',{class:'record-alert',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'decision',status,agreedPrice:new FormData(form).get('agreedPrice')});}},input('Vereinbarter Betrag (CHF)','agreedPrice','number','',true),e('button',{type:'submit',class:'btn'},'Zusage speichern'));$('#inlineAction').replaceChildren(form);form.querySelector('input').focus();return;
    }
    await mutate({action:'decision',status});
  }
  function schedule(){
    const d=selected.document;
    const form=e('form',{class:'record-appointment',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'appointment',...Object.fromEntries(new FormData(form))});}},e('h3',{},'Montagetermin'),e('div',{class:'record-fields'},input('Datum','date','date',d.appointmentAt||today(),true),input('Uhrzeit','time','time',d.appointmentTime||'',true),input('Notiz (optional)','note','text',d.appointmentNote||'')),e('p',{class:'record-note'},'Schweizer Ortszeit. Der Termin wird intern gespeichert.'),e('button',{type:'submit',class:'btn'},'Termin speichern'));$('#inlineAction').replaceChildren(form);form.querySelector('input').focus();
  }
  function quoteSummary(intake){
    const box=e('section',{class:'record-quote-summary'});
    const messages={preview_only:'Testvorschau: Keine E-Mail versendet.',queued:'Offerte wird zum Versand vorbereitet.',processing:'E-Mail wird versendet.',accepted:'Offerte vom E-Mail-Dienst angenommen.',failed:'Versand fehlgeschlagen. Bitte prüfen.',unknown:'Versandausgang unklar. Bitte prüfen.',not_available:'Keine Kunden-E-Mail vorhanden.'};
    if(intake.status!=='priced')box.append(e('h3',{},'Weitere Angaben erforderlich'),e('ul',{},...(intake.clarification||[]).map(q=>e('li',{},typeof q==='string'?q:q.question))));
    box.append(e('p',{class:'record-note'},messages[intake.email?.status]||'Versandstatus wird geprüft.'),btn(intake.quote?'Offerte ansehen':'Rückfrage ansehen',async()=>{try{const data=await api('/'+selected.id+'/offer');const dialog=e('dialog',{class:'record-offer-dialog'});const frame=e('iframe',{title:'Kundenofferte',sandbox:'',style:'width:100%;height:70vh;border:0'});frame.srcdoc=data.html;dialog.append(e('div',{class:'record-head'},e('strong',{},data.reference||'Offerte'),btn('Schliessen',()=>dialog.close())),frame);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();}catch(err){error(err);}}));return box;
  }
  function payments(){
    const d=selected.document,paid=d.payments.reduce((sum,p)=>sum+p.amount,0),base=d.invoiceAmount??(['Prihvaćeno','Montaža','Završeno'].includes(d.status)?d.agreedPrice:null);
    const box=e('section',{class:'record-extra'},e('h3',{},'Rechnung und Zahlungen'),e('p',{class:'record-note'},'Smallinvoice ist noch nicht verbunden. Die Anbindung wird vorbereitet.'),e('p',{},'Bezahlt: '+money(paid)+(base!=null?' · Offen: '+money(Math.max(0,base-paid)):'')));
    d.payments.forEach(p=>box.append(e('p',{class:'record-note'},date(p.date)+' · '+money(p.amount)+' · '+p.note)));
    const form=e('form',{onsubmit:async ev=>{ev.preventDefault();await mutate({action:'payment',...Object.fromEntries(new FormData(form))});}},e('div',{class:'record-fields'},input('Erhaltene Zahlung (CHF)','amount','number','',true),input('Zahlungsdatum','date','date',today(),true),input('Notiz / Referenz','note')),e('button',{type:'submit',class:'btn ghost small'},'Zahlung erfassen'));box.append(form);return box;
  }
  function complaints(){
    const labels={'Otvorena':'Offen','U radu':'In Bearbeitung','Rešena':'Erledigt'},box=e('section',{class:'record-extra'},e('h3',{},'Reklamationen')),holder=e('div');
    selected.document.complaints.forEach(c=>box.append(e('p',{},e('strong',{},labels[c.status]||c.status),e('span',{},' · '+c.description+' '),btn('Bearbeiten',()=>edit(c)))));
    box.append(btn('Reklamation erfassen',()=>edit({date:today(),status:'Otvorena'})),holder);
    function edit(c){
      const form=e('form',{onsubmit:async ev=>{ev.preventDefault();await mutate({action:'complaint',complaint:{...Object.fromEntries(new FormData(form)),...(c.id?{id:c.id}:{})}});}});
      const fields=e('div',{class:'record-fields'});for(const [label,key,type]of [['Datum','date','date'],['Verantwortlich','owner','text'],['Frist','due','date'],['Beschreibung','description','textarea'],['Lösung','resolution','textarea'],['Erledigt am','resolvedAt','date']])fields.append(input(label,key,type,c[key]||'',key==='description'));
      const states=e('div',{class:'record-actions'});for(const [value,label]of Object.entries(labels)){const radio=e('input',{type:'radio',name:'status',value});radio.checked=c.status===value;states.append(e('label',{},radio,label));}
      form.append(fields,states,e('button',{type:'submit',class:'btn ghost small'},'Reklamation speichern'));holder.replaceChildren(form);
    }return box;
  }
  function files(){
    const r=selected,box=e('section',{class:'record-extra'},e('h3',{},'Dokumente und Fotos'),e('p',{class:'record-note'},'PDF, JPG, PNG oder WebP bis 2 MB. Nur nach Anmeldung verfügbar.'));
    r.files.forEach(f=>box.append(btn(f.name,async()=>{try{const blob=await api('/'+r.id+'/files/'+f.id,{file:true});const url=URL.createObjectURL(blob);e('a',{href:url,download:f.name}).click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(err){error(err);}})));
    box.append(e('input',{type:'file',accept:'application/pdf,image/jpeg,image/png,image/webp','aria-label':'Dokument oder Bild anhängen',onchange:async ev=>{try{if($('#recordForm')?.dataset.dirty==='true')throw Error('Bitte zuerst Ihre Änderungen speichern.');const file=ev.target.files[0];if(!file)return;if(file.size>2097152)throw Error('Die Datei darf höchstens 2 MB gross sein.');const body=new FormData();body.append('file',file);await api('/'+r.id+'/files',{method:'POST',body});await open(r.id);}catch(err){error(err);}}}));return box;
  }
  document.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{if(selected&&$('#recordForm')?.dataset.dirty==='true'&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;document.querySelectorAll('[data-admin-panel]').forEach(panel=>panel.hidden=panel.dataset.adminPanel!==button.dataset.adminTab);document.querySelectorAll('[data-admin-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));if(button.dataset.adminTab==='records')load();}));
  window.addEventListener('gtt:admin-login',load);
  window.addEventListener('gtt:admin-logout',()=>{records=[];selected=null;root.replaceChildren();});
  if(!document.getElementById('appView').hidden)load();
})();
