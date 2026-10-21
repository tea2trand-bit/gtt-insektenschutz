(() => {
  const root=document.getElementById('recordsRoot');
  const STATUS={'Novi upit':'Neue Anfrage','Ponuda poslata':'Offerte versendet','Čeka odgovor':'Offerte versendet','Prihvaćeno':'Angenommen','Odbijeno':'Abgelehnt','Montaža':'Montage','Završeno':'Abgeschlossen','Reklamationen':'Reklamationen'};
  const STEPS=['Novi upit','Ponuda poslata','Prihvaćeno','Odbijeno','Montaža','Završeno','Reklamationen'];
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
  let records=[],complaintCases=[],selected=null,archived=false,filter='Novi upit',montageFilter='',inquiryFilter='',complaintFilter='active',search='',busy=false,deepLinkResolved=false;
  const hasAppointment=d=>!d.archivedAt&&d.appointmentAt&&d.appointmentTime&&d.appointmentStatus!=='cancelled'&&['Prihvaćeno','Montaža'].includes(d.status);
  const hasOpenComplaint=d=>(d.complaints||[]).some(c=>['Otvorena','U radu'].includes(c.status));
  const needsMeasurement=d=>canonical(d.status)==='Novi upit'&&!d.intake?.quote&&!(d.quotedPrice>0)&&!d.intake?.measurements?.length&&!d.intake?.manualReview;
  const listStage=d=>hasOpenComplaint(d)?'Reklamationen':hasAppointment(d)?'Montaža':canonical(d.status);
  const montageState=d=>d.status==='Montaža'?'working':hasAppointment(d)?'planned':'';
  const stageLabel=d=>hasOpenComplaint(d)?'Reklamation':d.status==='Montaža'?'Montage in Arbeit':hasAppointment(d)?'Montage geplant':needsMeasurement(d)?'Ausmessen erforderlich':STATUS[d.status]||d.status;
  const hasDirtyForm=()=>!!root.querySelector('form[data-dirty="true"]');
  const appointmentText=d=>date(d.appointmentAt)+' um '+d.appointmentTime;
  const recordName=r=>r.document.name||r.document.company||'Ohne Namen';
  const offerReference=r=>r.document.intake?.version?'GTT-'+String(r.document.intake.version).padStart(3,'0'):'';
  const referenceText=r=>offerReference(r)?(r.document.intake.quote?'Offerte ':'Anfrage ')+offerReference(r):'';
  const isHistorical=r=>r.historical??(!!r.original?.submissionId&&!r.original?.inquiryId);
  function recordLink(r){
    const url=new URL(location.href);url.searchParams.set('anfrage',r.id);
    return e('a',{href:url.pathname+url.search,class:'record-open-link','aria-label':'Anfrage '+recordName(r)+(offerReference(r)?' · '+offerReference(r):'')+' öffnen',onclick:ev=>{
      if(ev.button!==0||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;
      ev.preventDefault();if(!busy)open(r.id);
    }},recordName(r));
  }
  function recordRow(r,...children){
    return e('div',{class:'record-row',role:'group','aria-label':'Anfrage '+recordName(r),onclick:ev=>{
      if(busy||ev.defaultPrevented||ev.button!==0||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;
      if(ev.target.closest('a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[contenteditable],[tabindex]'))return;
      if(window.getSelection()?.toString())return;
      open(r.id);
    }},...children);
  }
  async function api(path='',opts={}){
    const headers={Authorization:'Bearer '+(sessionStorage.getItem('gttAdminToken')||'')};
    let body=opts.body;if(opts.json){headers['Content-Type']='application/json';body=JSON.stringify(opts.json);}
    const response=await fetch('/api/admin/'+(opts.complaint?'complaints':'records')+path,{method:opts.method||'GET',headers,body});
    if(response.status===401){document.getElementById('logoutBtn').click();throw Error('Ihre Sitzung ist abgelaufen. Bitte erneut anmelden.');}
    if(opts.file&&response.ok)return response.blob();
    const data=await response.json();if(!response.ok)throw Error(data.error||'Die Anfrage konnte nicht gespeichert werden.');return data;
  }
  function error(err){const box=$('#recordError');if(box)box.textContent=err.message;else root.prepend(e('p',{class:'record-error',role:'alert'},err.message));}
  async function load(){
    try{
      const [recordData,complaintData]=await Promise.all([api(archived?'?archived=1':''),api('',{complaint:true})]);records=recordData.records;complaintCases=complaintData.complaints;renderList();
      if(!deepLinkResolved){deepLinkResolved=true;const params=new URL(location.href).searchParams,id=params.get('anfrage'),complaint=params.get('reklamation');if(/^[a-f0-9-]{36}$/i.test(complaint||''))await openComplaint(complaint);else if(/^GTT-[a-f0-9]{24}$/.test(id||''))await open(id);}
    }catch(err){root.replaceChildren(e('h2',{},'Anfragen'),e('p',{class:'record-error'},err.message),btn('Erneut versuchen',load));}
  }
  async function open(id){try{selected=(await api('/'+id)).record;renderCard();root.scrollIntoView({block:'start'});$('.record-heading').focus({preventScroll:true});}catch(err){error(err);}}
  function renderList(){
    selected=null;
    root.replaceChildren(e('div',{class:'record-head'},e('div',{},e('h2',{},archived?'Archiv':'Anfragen'),e('p',{class:'record-note'},archived?'Archivierte Anfragen können jederzeit wiederhergestellt werden.':'Website-Anfragen und Offerten werden automatisch erfasst.')),e('div',{class:'record-actions'},...(archived?[]:[btn('Kunde hinzufügen',manual,'')]),btn('Aktualisieren',load))));
    const counters=e('div',{class:'record-summary'});
    STEPS.map(s=>[s,STATUS[s]]).forEach(([s,label])=>counters.append(e('button',{type:'button',class:s===filter?'active':'','aria-pressed':String(s===filter),onclick:()=>{filter=s;montageFilter='';inquiryFilter='';complaintFilter='active';renderList();}},e('span',{},label),e('strong',{class:'record-kpi-value'},String(records.filter(r=>listStage(r.document)===s).length+(s==='Reklamationen'&&!archived?complaintCases.filter(c=>c.status!=='Erledigt').length:0))))));
    root.append(e('div',{class:'record-stage-bar'},counters,btn(archived?'← Aktive Anfragen':'Archiv',()=>{archived=!archived;filter=archived?'':'Novi upit';search='';load();})));
    if(filter==='Novi upit'){
      const phases=e('div',{class:'record-actions','aria-label':'Anfragebearbeitung'});
      for(const [value,label]of [['measure','Ausmessen erforderlich'],['review','Prüfung erforderlich']]){
        const count=records.filter(r=>listStage(r.document)==='Novi upit'&&(value==='measure'?needsMeasurement(r.document):!needsMeasurement(r.document))).length;
        phases.append(btn(label+' '+count,()=>{inquiryFilter=inquiryFilter===value?'':value;renderList();},inquiryFilter===value?'small':'ghost small'));
      }root.append(phases);
    }
    if(filter==='Montaža'){
      const phases=e('div',{class:'record-actions record-montage-filters','aria-label':'Montagestatus'});
      for(const [value,label]of [['planned','Termin vereinbart'],['working','In Arbeit']]){
        const count=records.filter(r=>listStage(r.document)==='Montaža'&&montageState(r.document)===value).length;
        const button=btn(label+' '+count,()=>{montageFilter=montageFilter===value?'':value;drawRows();phases.querySelectorAll('button').forEach(b=>{const active=b.dataset.montageFilter===montageFilter;b.setAttribute('aria-pressed',String(active));b.classList.toggle('ghost',!active);});},montageFilter===value?'small':'ghost small');
        button.dataset.montageFilter=value;button.setAttribute('aria-pressed',String(montageFilter===value));phases.append(button);
      }
      root.append(phases);
    }
    if(filter==='Reklamationen'&&!archived)root.append(e('div',{class:'record-actions'},...[['active','Offen / in Bearbeitung'],['Erledigt','Erledigt']].map(([value,label])=>btn(label,()=>{complaintFilter=value;renderList();},complaintFilter===value?'small':'ghost small'))));
    root.append(e('div',{class:'record-toolbar'},e('input',{'aria-label':'Anfragen durchsuchen',placeholder:'Name, Kontakt oder Offertnummer suchen',value:search,oninput:ev=>{search=ev.target.value;drawRows();}})),e('div',{id:'recordRows',class:'record-list'}));drawRows();
  }
  function drawRows(){
    const box=$('#recordRows');box.replaceChildren();
    const found=records.filter(r=>(!filter||listStage(r.document)===filter)&&(filter!=='Novi upit'||!inquiryFilter||(inquiryFilter==='measure'?needsMeasurement(r.document):!needsMeasurement(r.document)))&&(filter!=='Montaža'||!montageFilter||montageState(r.document)===montageFilter)&&(!search||[r.id,offerReference(r),...(r.offerReferences||[]),...Object.values(r.document).filter(x=>typeof x==='string')].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
    if(filter==='Montaža')found.sort((a,b)=>((a.document.appointmentAt||'9999')+'T'+(a.document.appointmentTime||'')).localeCompare((b.document.appointmentAt||'9999')+'T'+(b.document.appointmentTime||'')));
    found.filter(()=>filter!=='Reklamationen'||complaintFilter!=='Erledigt').forEach(r=>{const d=r.document;box.append(recordRow(r,e('div',{},recordLink(r),d.isTest?e('span',{class:'record-badge test'},'TEST'):null,e('small',{},d.company||d.email||d.phone),referenceText(r)?e('small',{},referenceText(r)):null,hasAppointment(d)?e('small',{},'Montagetermin: '+appointmentText(d)):null),e('div',{class:'record-source'},SOURCE[r.source]||r.source,e('small',{},date(r.received_at))),e('div',{class:'record-price'},money(d.agreedPrice??d.quotedPrice),e('small',{},d.customerAcceptance?.pricePreliminary?'Vorläufige Offerte':d.agreedPrice!=null?'Vereinbart':'Offerte')),listActions(r)));});
    if(filter==='Reklamationen'&&!archived)complaintCases.filter(c=>(complaintFilter==='Erledigt'?c.status==='Erledigt':c.status!=='Erledigt')&&(!search||[c.lookup,c.email,c.description,c.matched_name,'REK-'+String(c.number).padStart(3,'0')].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).forEach(c=>{
      const link=e('a',{class:'record-open-link',href:'/admin?reklamation='+encodeURIComponent(c.id),onclick:ev=>{if(ev.button!==0||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;ev.preventDefault();openComplaint(c.id);}},c.matched_name||c.lookup);
      box.append(e('div',{class:'record-row',role:'group','aria-label':'Reklamation '+c.lookup,onclick:ev=>{if(!ev.defaultPrevented&&ev.button===0&&!ev.ctrlKey&&!ev.metaKey&&!ev.shiftKey&&!ev.altKey&&!ev.target.closest('a,button,input,select,textarea')&&!window.getSelection()?.toString())openComplaint(c.id);}},e('div',{},link,e('small',{},c.email)),e('div',{},'REK-'+String(c.number).padStart(3,'0'),e('small',{},date(c.created_at))),e('div',{},c.match_status==='matched'?'Auftrag zugeordnet':'Zuordnung prüfen'),e('span',{class:'record-badge'},c.status)));
    });
    if(!box.childNodes.length)box.append(e('p',{class:'record-empty'},archived?'Das Archiv ist leer.':'Keine passenden Anfragen.'));
  }
  async function openComplaint(id){try{const {complaint}=await api('/'+id,{complaint:true});renderComplaintCard(complaint);}catch(err){error(err);}}
  function renderComplaintCard(c){
    selected=null;
    root.replaceChildren(btn('← Reklamationen',()=>{if($('#complaintForm')?.dataset.dirty==='true'&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;filter='Reklamationen';load();}),e('h2',{class:'record-heading',tabindex:'-1'},'Reklamation REK-'+String(c.number).padStart(3,'0')),e('p',{class:'record-note'},c.lookup+' · '+c.email+' · '+date(c.created_at)),e('p',{},e('span',{class:'record-badge'},c.status)),e('section',{class:'record-request-summary'},e('strong',{},'Kundenmeldung'),e('p',{},c.description)),e('p',{class:'record-note'},c.match_status==='matched'?'Dem bestehenden Auftrag zugeordnet.':'Zuordnung bitte prüfen. Es wurde kein Auftrag automatisch geändert.'),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const actions=e('div',{class:'record-actions'});
    if(c.record_id)actions.append(btn('Zugehörigen Auftrag öffnen',()=>{if($('#complaintForm')?.dataset.dirty==='true'&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;open(c.record_id);}));
    actions.append(btn('E-Mail-Vorschau',async()=>{try{const data=await api('/'+c.id+'/message',{complaint:true}),dialog=e('dialog',{class:'record-offer-dialog'}),frame=e('iframe',{title:'Interne Reklamationsmeldung',sandbox:'',style:'width:100%;height:65vh;border:0'});frame.srcdoc=data.message.html;dialog.append(e('div',{class:'record-head'},e('strong',{},'An '+data.message.to.join(', ')),btn('Schliessen',()=>dialog.close())),e('p',{class:'record-note'},({preview_only:'Vorschau · Keine E-Mail versendet.',accepted:'Interne E-Mail vom Maildienst angenommen.',queued:'Interne E-Mail wird zum Versand vorbereitet.',processing:'Interne E-Mail wird versendet.',failed:'Versand fehlgeschlagen. Bitte prüfen.',unknown:'Versandausgang wird geprüft.'})[data.status]||'Versandstatus nicht verfügbar.'),frame);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();}catch(err){error(err);}}));root.append(actions);
    const form=e('form',{id:'complaintForm',class:'record-extra',oninput:()=>form.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();if(busy)return;busy=true;const save=form.querySelector('button[type=submit]');save.disabled=true;try{const data=await api('/'+c.id,{complaint:true,method:'PATCH',json:{...Object.fromEntries(new FormData(form)),revision:c.revision}});renderComplaintCard({...c,...data.complaint});}catch(err){error(err);}finally{busy=false;save.disabled=false;}}}),status=e('select',{name:'status'});
    for(const value of ['Offen','In Bearbeitung','Erledigt'])status.append(e('option',{value,selected:value===c.status},value));
    form.append(e('label',{},'Bearbeitungsstatus',status),input('Notiz / Lösung','resolution','textarea',c.resolution),e('button',{type:'submit',class:'btn small'},'Bearbeitung speichern'));root.append(form);$('.record-heading').focus();root.scrollIntoView({block:'start'});
  }
  function listActions(r){
    const d=r.document,actions=e('div',{class:'record-row-actions'},e('span',{class:'record-badge'},stageLabel(d)));
    if(d.intake?.quote&&d.intake.version)actions.append(btn('Offerte ansehen',()=>showOffer(r.id),'small'));
    if(isHistorical(r)&&!d.archivedAt&&d.status!=='Završeno')actions.append(btn('Abschliessen',()=>changeListedRecord(r,'historical-complete','✓ Auftrag abgeschlossen.'),'small'));
    actions.append(btn(archived?'Wiederherstellen':'Entfernen',()=>archiveRecord(r,archived),archived?'ghost small':'ghost small record-remove'));
    if(archived&&d.archivedAt&&d.isTest===true)actions.append(btn('Endgültig entfernen',()=>deleteTestRecord(r),'ghost small record-remove'));
    return actions;
  }
  async function archiveRecord(r,restore=false){
    if(busy)return;if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    if(!restore&&!confirm('Anfrage «'+(r.document.name||r.document.company||'ohne Namen')+'» entfernen? Sie bleibt im Archiv und kann wiederhergestellt werden.'))return;
    await changeListedRecord(r,restore?'restore':'archive',restore?'✓ Anfrage wiederhergestellt.':'✓ Anfrage archiviert.');
  }
  async function deleteTestRecord(r){
    if(busy||!r.document.archivedAt||r.document.isTest!==true)return;
    if(!confirm('TEST-Anfrage «'+recordName(r)+'» ('+(offerReference(r)||r.id)+') endgültig aus der Admin-Evidenz entfernen? Zugehörige Offerten, Dokumente und Verlauf werden ebenfalls gelöscht. Dies kann nicht rückgängig gemacht werden. Ursprüngliche Formularübermittlungen und bereits versendete E-Mails bleiben erhalten.'))return;
    await changeListedRecord(r,'delete','✓ TEST-Anfrage endgültig entfernt.','DELETE');
  }
  async function changeListedRecord(r,action,message,method='PATCH'){
    if(busy)return;if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await api('/'+r.id,{method,json:method==='DELETE'?{revision:r.revision,confirmRecordId:r.id}:{action,revision:r.revision}});await load();root.prepend(e('p',{class:'record-note',role:'status'},message));}
    catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function mutate(body){
    if(busy)return;if(body.action!=='update'&&hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{selected=(await api('/'+selected.id,{method:'PATCH',json:{...body,revision:selected.revision}})).record;renderCard();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Gespeichert.'));}
    catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function measurementCalculator(){
    if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    const r=selected,requestId=crypto.randomUUID(),rows=e('div'),total=e('p',{class:'record-note',role:'status'}),save=e('button',{type:'submit',class:'btn'},'Offerte berechnen und speichern');
    const form=e('form',{id:'measurementForm',class:'record-appointment',oninput:()=>{form.dataset.dirty='true';total.textContent='';},onsubmit:async ev=>{
      ev.preventDefault();if(busy)return;busy=true;save.disabled=true;
      try{const data=await api('/'+r.id+'/measurements',{method:'POST',json:{revision:r.revision,requestId,measurements:measurements()}});selected=data.record;renderCard();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Masse und Offertentwurf gespeichert. Keine E-Mail versendet.'));}
      catch(err){total.textContent=err.message;}finally{busy=false;save.disabled=false;}
    }});
    function measurements(){return Array.from(rows.children).map(row=>({type:row.querySelector('[name=type]').value,quantity:Number(row.querySelector('[name=quantity]').value),width:Number(row.querySelector('[name=width]').value),height:Number(row.querySelector('[name=height]').value)}));}
    function addRow(value={}){
      const type=e('select',{name:'type','aria-label':'Elementart'},e('option',{value:'window'},'Fenster'),e('option',{value:'door'},'Tür / Plissee'));type.value=value.type||'window';
      const row=e('div',{class:'record-measurement-row'},e('label',{},'Element',type),input('Anzahl','quantity','number',value.quantity||1,true),input('Breite (cm)','width','number',value.width||'',true),input('Höhe (cm)','height','number',value.height||'',true),btn('Entfernen',()=>{row.remove();form.dataset.dirty='true';total.textContent='';}));
      row.querySelector('[name=quantity]').setAttribute('step','1');row.querySelector('[name=quantity]').setAttribute('min','1');rows.append(row);
    }
    const existing=(r.document.intake?.measurements||[]).filter(m=>m.mode==='dimensions');
    if(existing.length)existing.forEach(m=>addRow({...m,width:m.width*(m.widthUnit==='m'?100:m.widthUnit==='mm'?0.1:1),height:m.height*(m.heightUnit==='m'?100:m.heightUnit==='mm'?0.1:1)}));else addRow();
    form.append(e('h3',{},'Masse nach dem Ausmessen'),e('p',{class:'record-note'},'Breite und Höhe in Zentimetern. Der Preis wird mit den aktuellen Website-Konditionen berechnet.'),rows,btn('+ Fenster / Tür hinzufügen',()=>{addRow();form.dataset.dirty='true';}),e('div',{class:'record-actions'},btn('Preis berechnen',async()=>{if(!form.reportValidity())return;try{const data=await api('/'+r.id+'/measurements',{method:'POST',json:{revision:r.revision,preview:true,measurements:measurements()}});total.textContent='Gesamtbetrag inkl. MwSt.: '+money(data.quote.totalCHF);}catch(err){total.textContent=err.message;}}),save,btn('Abbrechen',()=>{if(form.dataset.dirty==='true'&&!confirm('Ungespeicherte Masse verwerfen?'))return;$('#inlineAction').replaceChildren();})),total,e('p',{class:'record-note'},'Speichert die Masse und einen Offertentwurf. Es wird keine E-Mail versendet.'));
    $('#inlineAction').replaceChildren(form);form.querySelector('[name=width]').focus();form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  function input(label,name,type='text',value='',required=false){return e('label',{},label,type==='textarea'?e('textarea',{name,required},value??''):e('input',{type,name,value:value??'',required,...(type==='number'?{min:0,step:'.01'}:{})}));}
  function manual(){
    selected=null;filter='Novi upit';archived=false;const requestId=crypto.randomUUID();
    root.replaceChildren(btn('← Zur Übersicht',load),e('h2',{},'Kunde hinzufügen'),e('p',{class:'record-note'},'Für Anfragen per Telefon, Empfehlung oder persönlichen Kontakt.'),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    const form=e('form',{onsubmit:async ev=>{ev.preventDefault();const save=form.querySelector('[type=submit]');save.disabled=true;try{selected=(await api('',{method:'POST',json:{...Object.fromEntries(new FormData(form)),requestId}})).record;renderCard();}catch(err){error(err);save.disabled=false;}}});
    form.append(e('div',{class:'record-fields'},input('Name oder Firma','name'),input('Telefon','phone','tel')),e('details',{},e('summary',{},'Weitere Angaben (optional)'),e('div',{class:'record-fields'},input('Firma','company'),input('E-Mail','email','email'),input('Montageadresse','address'),input('PLZ / Ort','postalCode'),input('Kontaktweg','channel'),input('Offertpreis (CHF)','quotedPrice','number'),input('Anfrage / Notiz','request','textarea'))),e('p',{class:'record-note'},'Das Erfassen erstellt eine Anfrage. Es wird keine E-Mail versendet.'),e('button',{type:'submit',class:'btn'},'Kunde speichern'));root.append(form);
  }
  function renderCard(){
    const r=selected,d=r.document,status=canonical(d.status),legacy=isHistorical(r);
    root.replaceChildren(e('div',{class:'record-head'},btn('← Zur Übersicht',()=>{if(hasDirtyForm()&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;load();}),e('span',{class:'record-note'},(SOURCE[r.source]||r.source)+' · '+date(r.received_at))),e('h2',{class:'record-heading',tabindex:'-1'},d.name||d.company||'Anfrage'),e('p',{class:'record-note'},[d.company,d.email,d.phone,d.address,d.postalCode].filter(Boolean).join(' · ')),e('p',{},e('span',{class:'record-badge'},stageLabel(d))));
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
      if(hasOpenComplaint(d))next.append(btn('Reklamation bearbeiten',()=>{const box=$('#recordComplaints');box.closest('details').open=true;box.scrollIntoView({block:'start',behavior:'smooth'});},''));
      if(legacy&&status!=='Završeno')next.append(btn('Abschliessen',()=>mutate({action:'historical-complete'}),''));
      if(status==='Ponuda poslata')next.append(e('p',{class:'record-note'},'Die Offerte wurde versendet. Der Kunde kann sie über den Link in der E-Mail bestätigen.'));
      else if(status==='Novi upit')next.append(btn('Masse erfassen / berechnen',measurementCalculator,''));
      if(status==='Prihvaćeno')next.append(btn(hasAppointment(d)?'Montagetermin ändern':'Montagetermin planen',schedule,''),btn('Montage beginnen',()=>mutate({action:'start-installation'}),'ghost'));
      if(status==='Montaža')next.append(btn('Auftrag abschliessen',()=>mutate({action:'complete'}),''));
      if(next.childNodes.length)root.append(next);
      if(hasAppointment(d))root.append(e('p',{class:'record-appointment'},e('strong',{},'Montage: '+appointmentText(d)),d.appointmentNote?e('span',{},' · '+d.appointmentNote):null));
    }
    root.append(e('div',{id:'inlineAction'}),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    if(!d.archivedAt){
      const notes=e('section',{class:'record-extra'},e('h3',{},'Interne Notiz'));
      const form=e('form',{id:'recordForm',oninput:()=>form.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'update',patch:Object.fromEntries(new FormData(form))});}});
      form.append(input('Notiz zum Auftrag','notes','textarea',d.notes),e('p',{},e('button',{type:'submit',class:'btn small'},'Notiz speichern')));notes.append(form);root.append(notes);
      const decisions=e('div',{class:'record-actions'},btn('Zusage manuell erfassen',()=>decision('Prihvaćeno')),btn('Absage erfassen',()=>decision('Odbijeno')));
      if(hasAppointment(d))decisions.append(btn('Montagetermin absagen',()=>mutate({action:'cancel-appointment'})));
      root.append(e('details',{class:'record-extra'},e('summary',{},'Telefonische Zu- / Absage'),decisions),e('details',{class:'record-extra'},e('summary',{},'Dokumente und Fotos'),files()),e('details',{class:'record-extra'},e('summary',{},'Reklamation zum Auftrag'),complaints()));
      const contact=e('details',{class:'record-extra',id:'recordContact'},e('summary',{},'Kontakt korrigieren'));
      const correction=e('form',{id:'contactForm',oninput:()=>correction.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'update',patch:Object.fromEntries(new FormData(correction))});}}),fields=e('div',{class:'record-fields'});
      for(const [label,key,type]of [['Name','name'],['Firma','company'],['E-Mail','email','email'],['Telefon','phone','tel'],['Montageadresse','address'],['PLZ / Ort','postalCode']])fields.append(input(label,key,type||'text',d[key]));
      correction.append(fields,e('p',{},e('button',{type:'submit',class:'btn small'},'Kontakt speichern')));contact.append(correction);root.append(contact,e('div',{class:'record-actions record-extra'},btn('Anfrage entfernen',()=>archiveRecord(r),'ghost small record-remove')));
    }
  }
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
  async function showOffer(recordId){
    try{
      const data=await api('/'+recordId+'/offer');
      const dialog=e('dialog',{class:'record-offer-dialog'});
      const frame=e('iframe',{title:'Kundenofferte',sandbox:'',style:'width:100%;height:70vh;border:0'});frame.srcdoc=data.html;
      dialog.append(e('div',{class:'record-head'},e('strong',{},data.reference||'Offerte'),btn('Schliessen',()=>dialog.close())),frame);
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
    }catch(err){error(err);}
  }
  function quoteSummary(intake){
    const box=e('section',{class:'record-quote-summary'});
    const recordId=selected.id;
    if(referenceText(selected))box.append(e('p',{class:'record-note'},referenceText(selected)));
    const messages={draft:'Offertentwurf nach Ausmessen · Noch nicht versendet.',preview_only:'Testvorschau: Keine E-Mail versendet.',queued:'Offerte wird zum Versand vorbereitet.',processing:'E-Mail wird versendet.',accepted:'Offerte vom E-Mail-Dienst angenommen.',failed:'Versand fehlgeschlagen. Bitte prüfen.',unknown:'Versandausgang unklar. Bitte prüfen.',not_available:'Keine Kunden-E-Mail vorhanden.'};
    if(intake.measurementRequired)box.append(e('p',{class:'record-note'},'Ausmessen erforderlich · Termin mit dem Kunden abstimmen, danach Masse erfassen.'));
    else if(intake.status!=='priced')box.append(e('h3',{},'Prüfung erforderlich'),e('ul',{},...(intake.clarification||[]).map(q=>e('li',{},typeof q==='string'?q:q.question))));
    box.append(e('p',{class:'record-note'},messages[intake.email?.status]||'Versandstatus wird geprüft.'),btn(intake.quote?'Offerte ansehen':'Rückfrage ansehen',()=>showOffer(recordId)));return box;
  }
  function complaints(){
    const labels={'Otvorena':'Offen','U radu':'In Bearbeitung','Rešena':'Erledigt'},box=e('section',{class:'record-extra',id:'recordComplaints'},e('h3',{},'Reklamationen')),holder=e('div');
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
    box.append(e('input',{type:'file',accept:'application/pdf,image/jpeg,image/png,image/webp','aria-label':'Dokument oder Bild anhängen',onchange:async ev=>{try{if(hasDirtyForm())throw Error('Bitte zuerst Ihre Änderungen speichern.');const file=ev.target.files[0];if(!file)return;if(file.size>2097152)throw Error('Die Datei darf höchstens 2 MB gross sein.');const body=new FormData();body.append('file',file);await api('/'+r.id+'/files',{method:'POST',body});await open(r.id);}catch(err){error(err);}}}));return box;
  }
  document.querySelectorAll('[data-admin-tab]').forEach(button=>button.addEventListener('click',()=>{if(hasDirtyForm()&&!confirm('Ungespeicherte Änderungen verwerfen?'))return;document.querySelectorAll('[data-admin-panel]').forEach(panel=>panel.hidden=panel.dataset.adminPanel!==button.dataset.adminTab);document.querySelectorAll('[data-admin-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));if(button.dataset.adminTab==='records')load();}));
  window.addEventListener('gtt:admin-login',load);
  window.addEventListener('gtt:admin-logout',()=>{records=[];complaintCases=[];selected=null;root.replaceChildren();});
  if(!document.getElementById('appView').hidden)load();
})();
