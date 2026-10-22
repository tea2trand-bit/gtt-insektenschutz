(() => {
  const root=document.getElementById('recordsRoot');
  const STATUS={'legacy_review':'Für Goran prüfen','Novi upit':'Neue Anfrage','Ponuda poslata':'Offerte versendet','Čeka odgovor':'Offerte versendet','Prihvaćeno':'Angenommen','Odbijeno':'Abgelehnt','Montaža':'Montage','Završeno':'Abgeschlossen','Reklamationen':'Reklamationen'};
  const STEPS=['Novi upit','Ponuda poslata','Prihvaćeno','Odbijeno','Montaža','Završeno','Reklamationen'];
  const SOURCE={'Kalkulator':'Kalkulator','Kontakt':'Kontaktformular','B2B':'B2B','Ručni unos':'Manuell'};
  const EVENTS={created:'Anfrage angelegt',archive:'Anfrage archiviert',restore:'Anfrage wiederhergestellt','historical-complete':'Frühere Anfrage abgeschlossen','start-installation':'Montage begonnen',complete:'Auftrag abgeschlossen',decision:'Entscheidung erfasst','cancel-order':'Auftrag storniert',payment:'Zahlung erfasst',complaint:'Reklamation aktualisiert',appointment:'Montagetermin geplant','cancel-appointment':'Montagetermin abgesagt',quote_intake:'Masse und Offerte automatisch erstellt',quote_email:'E-Mail-Versand bearbeitet',customer_acceptance:'Bestätigung des Kunden erhalten'};
  const canonical=s=>s==='Čeka odgovor'?'Ponuda poslata':s;
  const money=n=>n==null?'Nicht erfasst':new Intl.NumberFormat('de-CH',{style:'currency',currency:'CHF'}).format(n);
  const date=s=>s?new Date(s).toLocaleDateString('de-CH'):'—';
  const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Zurich'});
  const issueText=i=>i.code==='missing_postal_code'?'PLZ des Montageorts fehlt. Der Richtpreis kann als Entwurf gespeichert werden; Anfahrtskosten sind noch offen.':i.code==='travel_cost_review'?'Anfahrtskosten sind noch offen. Der Richtpreis kann als Entwurf gespeichert werden.':typeof i==='string'?i:i.question;
  const productText=s=>(s||'').replace(/Prozori:/g,'Fenster:').replace(/vrata:/g,'Türen:');
  const $=s=>root.querySelector(s);
  const e=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='class')n.className=v;else if(v!==false&&v!=null)n.setAttribute(k,v===true?'':v);}children.flat().forEach(c=>c!=null&&n.append(c));return n;};
  const btn=(label,fn,kind='ghost small')=>e('button',{type:'button',class:'btn '+kind,onclick:fn},label);
  let records=[],complaintCases=[],offerSummary=null,selected=null,archived=false,filter='Novi upit',montageFilter='',inquiryFilter='',complaintFilter='active',search='',busy=false,deepLinkResolved=false,billingAvailable=false,bankBillingAvailable=false;
  const hasAppointment=d=>!d.archivedAt&&d.appointmentAt&&d.appointmentTime&&d.appointmentStatus!=='cancelled'&&['Prihvaćeno','Montaža'].includes(d.status);
  const hasOpenComplaint=d=>(d.complaints||[]).some(c=>['Otvorena','U radu'].includes(c.status));
  const needsMeasurement=d=>canonical(d.status)==='Novi upit'&&!d.intake?.quote&&!(d.quotedPrice>0)&&!d.intake?.measurements?.length&&!d.intake?.manualReview;
  const listStage=d=>hasOpenComplaint(d)?'Reklamationen':hasAppointment(d)?'Montaža':canonical(d.status);
  const montageState=d=>d.status==='Montaža'?'working':hasAppointment(d)?'planned':'';
  const orderCancelled=d=>d.orderCancellation&&!d.orderCancellation.reopenedAt||d.status==='Odbijeno'&&d.customerAcceptance;
  const stageLabel=d=>orderCancelled(d)?'Storniert':hasOpenComplaint(d)?'Reklamation':d.status==='Montaža'?'Montage in Arbeit':hasAppointment(d)?'Montage geplant':needsMeasurement(d)?'Ausmessen erforderlich':STATUS[d.status]||d.status;
  const hasDirtyForm=()=>!!root.querySelector('form[data-dirty="true"]');
  const appointmentText=d=>date(d.appointmentAt)+' um '+d.appointmentTime;
  const recordName=r=>r.document.name||r.document.company||'Ohne Namen';
  const offerReference=r=>r.document.intake?.version?'GTT-'+String(r.document.intake.version).padStart(3,'0'):'';
  const referenceText=r=>offerReference(r)?(r.document.intake.quote?'Offerte ':'Anfrage ')+offerReference(r):'';
  const isHistorical=r=>r.historical??(!!r.original?.submissionId&&!r.original?.inquiryId);
  const needsHistoricalReview=r=>isHistorical(r)&&!r.document.archivedAt&&listStage(r.document)==='Novi upit';
  const recordStage=r=>needsHistoricalReview(r)?'legacy_review':listStage(r.document);
  function recordLink(r){
    const url=new URL(location.href);url.searchParams.set('anfrage',r.id);
    return e('a',{href:url.pathname+url.search,class:'record-open-link','aria-label':'Anfrage '+recordName(r)+(offerReference(r)?' · '+offerReference(r):'')+' öffnen',onclick:ev=>{
      if(ev.button!==0||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;
      ev.preventDefault();if(!busy)open(r.id);
    }},recordName(r));
  }
  function recordRow(r,...children){
    return e('div',{class:'record-row record-inquiry-row',role:'group','aria-label':'Anfrage '+recordName(r),onclick:ev=>{
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
      const [recordData,complaintData]=await Promise.all([api(archived?'?archived=1':''),api('',{complaint:true})]);records=recordData.records;billingAvailable=recordData.billingAvailable===true;bankBillingAvailable=recordData.bankBillingAvailable===true;offerSummary=recordData.offerSummary;complaintCases=complaintData.complaints;
      if(filter==='legacy_review'&&!records.some(needsHistoricalReview))filter='Novi upit';
      if(!deepLinkResolved&&!archived&&records.some(needsHistoricalReview)&&!records.some(r=>recordStage(r)==='Novi upit'))filter='legacy_review';
      renderList();
      if(!deepLinkResolved){deepLinkResolved=true;const params=new URL(location.href).searchParams,id=params.get('anfrage'),complaint=params.get('reklamation');if(/^[a-f0-9-]{36}$/i.test(complaint||''))await openComplaint(complaint);else if(/^GTT-[a-f0-9]{24}$/.test(id||''))await open(id);else if(params.has('offerte')){const resolved=await api('/resolve?offerte='+encodeURIComponent(params.get('offerte')));await open(resolved.id);}}
    }catch(err){root.replaceChildren(e('h2',{},'Anfragen'),e('p',{class:'record-error'},err.message),btn('Erneut versuchen',load));}
  }
  async function open(id,target=''){try{selected=(await api('/'+id)).record;renderCard();if(target==='measurements'){await measurementCalculator(true);return;}root.scrollIntoView({block:'start'});$('.record-heading').focus({preventScroll:true});}catch(err){error(err);}}
  const stageCount=s=>records.filter(r=>!s||recordStage(r)===s).length+(s==='Reklamationen'&&!archived?complaintCases.filter(c=>c.status!=='Erledigt').length:0);
  function chooseStage(steps){
    const trigger=$('#recordStagePicker');
    const dialog=e('dialog',{class:'records record-stage-dialog','aria-labelledby':'recordStageTitle'});
    const options=e('div',{class:'record-stage-options'});
    const choices=archived?['',...steps]:steps;
    for(const s of choices){
      const active=s===filter;
      options.append(e('button',{type:'button',class:'record-stage-option'+(active?' active':''),'aria-pressed':String(active),onclick:()=>{
        filter=s;montageFilter='';inquiryFilter='';complaintFilter='active';dialog.close();renderList();
      }},e('span',{},STATUS[s]||'Alle archivierten Anfragen'),e('strong',{},String(stageCount(s))),e('span',{'aria-hidden':'true',class:'record-stage-check'},active?'✓':'')));
    }
    dialog.append(e('div',{class:'record-head'},e('h2',{id:'recordStageTitle'},'Status auswählen'),btn('Schliessen',()=>dialog.close())),options);
    dialog.addEventListener('click',ev=>{if(ev.target===dialog){const b=dialog.getBoundingClientRect();if(ev.clientX<b.left||ev.clientX>b.right||ev.clientY<b.top||ev.clientY>b.bottom)dialog.close();}});
    dialog.addEventListener('close',()=>{dialog.remove();const current=$('#recordStagePicker');if(current){current.setAttribute('aria-expanded','false');current.focus({preventScroll:true});}});
    root.append(dialog);trigger.setAttribute('aria-expanded','true');dialog.showModal();
    options.querySelector('.active')?.focus();
  }
  function renderList(){
    selected=null;
    root.replaceChildren(e('div',{class:'record-head'},e('div',{},e('h2',{},archived?'Archiv':'Anfragen'),e('p',{class:'record-note'},archived?'Archivierte Anfragen können jederzeit wiederhergestellt werden.':'Website-Anfragen und Offerten werden automatisch erfasst.')),e('div',{class:'record-actions'},...(archived?[]:[btn('Kunde hinzufügen',manual,'')]),btn('Aktualisieren',load))));
    const steps=records.some(needsHistoricalReview)?['legacy_review',...STEPS]:STEPS;
    root.append(e('div',{class:'record-stage-bar'},e('button',{id:'recordStagePicker',type:'button',class:'btn ghost record-stage-picker','aria-haspopup':'dialog','aria-expanded':'false',onclick:()=>chooseStage(steps)},e('span',{},STATUS[filter]||'Alle archivierten Anfragen'),e('strong',{class:'record-stage-count'},String(stageCount(filter))),e('span',{'aria-hidden':'true',class:'record-stage-chevron'},'⌄'))));
    const filterOptions=e('div',{class:'record-filter-options'});
    root.append(e('div',{class:'record-filter-bar'},filterOptions,btn(archived?'← Aktive Anfragen':'Archiv',()=>{archived=!archived;filter=archived?'':'Novi upit';search='';load();})));
    if(filter==='legacy_review')root.append(e('p',{class:'record-note'},'Frühere Anfragen für Goran: prüfen und bereits erledigte Aufträge mit „Abschliessen“ nach „Abgeschlossen“ verschieben.'));
    if(filter==='Novi upit'){
      const phases=e('div',{class:'record-actions','aria-label':'Anfragebearbeitung'});
      for(const [value,label]of [['measure','Ausmessen erforderlich'],['review','Prüfung erforderlich']]){
        const count=records.filter(r=>recordStage(r)==='Novi upit'&&(value==='measure'?needsMeasurement(r.document):!needsMeasurement(r.document))).length;
        phases.append(btn(label+' '+count,()=>{inquiryFilter=inquiryFilter===value?'':value;renderList();},inquiryFilter===value?'small':'ghost small'));
      }filterOptions.append(phases);
    }
    if(filter==='Montaža'){
      const phases=e('div',{class:'record-actions record-montage-filters','aria-label':'Montagestatus'});
      for(const [value,label]of [['planned','Termin vereinbart'],['working','In Arbeit']]){
        const count=records.filter(r=>recordStage(r)==='Montaža'&&montageState(r.document)===value).length;
        const button=btn(label+' '+count,()=>{montageFilter=montageFilter===value?'':value;drawRows();phases.querySelectorAll('button').forEach(b=>{const active=b.dataset.montageFilter===montageFilter;b.setAttribute('aria-pressed',String(active));b.classList.toggle('ghost',!active);});},montageFilter===value?'small':'ghost small');
        button.dataset.montageFilter=value;button.setAttribute('aria-pressed',String(montageFilter===value));phases.append(button);
      }
      filterOptions.append(phases);
    }
    if(filter==='Reklamationen'&&!archived)filterOptions.append(e('div',{class:'record-actions'},...[['active','Offen / in Bearbeitung'],['Erledigt','Erledigt']].map(([value,label])=>btn(label,()=>{complaintFilter=value;renderList();},complaintFilter===value?'small':'ghost small'))));
    root.append(e('div',{class:'record-toolbar'},e('input',{'aria-label':'Anfragen durchsuchen',placeholder:'Name, Kontakt oder Offertnummer suchen',value:search,oninput:ev=>{search=ev.target.value;drawRows();}}),offerSummary?e('section',{class:'record-offer-summary','aria-label':'Gesamtwert aktiver Offerten'},e('span',{},offerSummary.count+' Offerten'),e('strong',{},money(offerSummary.total))):null),e('div',{id:'recordRows',class:'record-list'}));drawRows();
  }
  function drawRows(){
    const box=$('#recordRows');box.replaceChildren();
    const found=records.filter(r=>(!filter||recordStage(r)===filter)&&(filter!=='Novi upit'||!inquiryFilter||(inquiryFilter==='measure'?needsMeasurement(r.document):!needsMeasurement(r.document)))&&(filter!=='Montaža'||!montageFilter||montageState(r.document)===montageFilter)&&(!search||[r.id,offerReference(r),...(r.offerReferences||[]),...Object.values(r.document).filter(x=>typeof x==='string')].join(' ').toLowerCase().includes(search.trim().toLowerCase())));
    if(filter==='Montaža')found.sort((a,b)=>((a.document.appointmentAt||'9999')+'T'+(a.document.appointmentTime||'')).localeCompare((b.document.appointmentAt||'9999')+'T'+(b.document.appointmentTime||'')));
    found.filter(()=>filter!=='Reklamationen'||complaintFilter!=='Erledigt').forEach(r=>{const d=r.document;box.append(recordRow(r,e('div',{},recordLink(r),d.isTest?e('span',{class:'record-badge test'},'TEST'):null,e('small',{},d.company||d.email||d.phone),referenceText(r)?e('small',{},referenceText(r)):null,hasAppointment(d)?e('small',{},'Montagetermin: '+appointmentText(d)):null),e('div',{class:'record-source'},SOURCE[r.source]||r.source,e('small',{},date(r.received_at))),priceCell(r),listActions(r)));});
    if(filter==='Reklamationen'&&!archived)complaintCases.filter(c=>(complaintFilter==='Erledigt'?c.status==='Erledigt':c.status!=='Erledigt')&&(!search||[c.lookup,c.email,c.description,c.matched_name,'REK-'+String(c.number).padStart(3,'0')].join(' ').toLowerCase().includes(search.trim().toLowerCase()))).forEach(c=>{
      const link=e('a',{class:'record-open-link',href:'/admin?reklamation='+encodeURIComponent(c.id),onclick:ev=>{if(ev.button!==0||ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey)return;ev.preventDefault();openComplaint(c.id);}},c.matched_name||c.lookup);
      box.append(e('div',{class:'record-row',role:'group','aria-label':'Reklamation '+c.lookup,onclick:ev=>{if(!ev.defaultPrevented&&ev.button===0&&!ev.ctrlKey&&!ev.metaKey&&!ev.shiftKey&&!ev.altKey&&!ev.target.closest('a,button,input,select,textarea')&&!window.getSelection()?.toString())openComplaint(c.id);}},e('div',{},link,e('small',{},c.email)),e('div',{},'REK-'+String(c.number).padStart(3,'0'),e('small',{},date(c.created_at))),e('div',{},c.match_status==='matched'?'Auftrag zugeordnet':'Zuordnung prüfen'),e('span',{class:'record-badge'},c.status)));
    });
    if(!box.childNodes.length)box.append(e('p',{class:'record-empty'},archived?'Das Archiv ist leer.':'Keine passenden Anfragen.'));
  }
  function priceCell(r){
    const d=r.document,amount=d.agreedPrice??d.quotedPrice;
    const box=e('div',{class:'record-price'},money(amount),e('small',{},d.customerAcceptance?.pricePreliminary?'Vorläufige Offerte':d.agreedPrice!=null?'Vereinbart':'Offerte'));
    return box;
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
    const d=r.document,actions=e('div',{class:'record-row-actions'},e('span',{class:'record-badge'},needsHistoricalReview(r)?'Für Goran prüfen':stageLabel(d)));
    if(d.intake?.quote&&d.intake.version)actions.append(btn('Offerte ansehen',()=>showOffer(r.id),'small'));
    else if((d.agreedPrice??d.quotedPrice)==null&&!d.archivedAt&&canonical(d.status)==='Novi upit')actions.append(btn('Ausmessen',()=>{if(!busy)open(r.id,'measurements');},'small'));
    if(isHistorical(r)&&!d.archivedAt&&d.status!=='Završeno')actions.append(btn('Abschliessen',()=>changeListedRecord(r,'historical-complete','✓ Auftrag abgeschlossen.'),'small'));
    if(archived||isHistorical(r))actions.append(btn(archived?'Wiederherstellen':'Entfernen',()=>archiveRecord(r,archived),archived?'ghost small':'ghost small record-remove'));
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
    try{selected=(await api('/'+selected.id,{method:'PATCH',json:{...body,revision:selected.revision}})).record;if(body.action==='cancel-order'){const url=new URL(location.href);url.searchParams.delete('anfrage');url.searchParams.delete('offerte');history.replaceState(null,'',url);await load();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Auftrag storniert. Der Eintrag steht unter Abgelehnt.'));}else{renderCard();root.prepend(e('p',{class:'record-note',role:'status'},'✓ Gespeichert.'));}}
    catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function measurementCalculator(fromList=false){
    if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    const r=selected,isCorrection=['Ponuda poslata','Čeka odgovor','Prihvaćeno'].includes(canonical(r.document.status))||r.document.correctionPending===true,requestId=crypto.randomUUID(),rows=e('div'),total=e('div',{class:'record-note record-calculation-total',role:'status'}),proposal=e('div'),save=e('button',{type:'submit',class:'btn'},'Masse speichern');
    const travelIncluded=e('input',{type:'checkbox',name:'travelIncluded'});travelIncluded.checked=r.document.intake?.quote?.travelCosts?.confirmedByAdmin===true&&Number(r.document.intake.quote.travelCosts.amountCHF)===0&&r.document.intake.quote.postalCode===((r.document.postalCode||'').match(/\b\d{4}\b/)?.[0]||'');
    const travelField=input('Anfahrtskosten (CHF, inkl. MwSt.)','travelAmountCHF','number',r.document.intake?.quote?.travelCosts?.amountCHF||'');
    const travelAmount=travelField.querySelector('input');travelAmount.disabled=travelIncluded.checked;
    const mode=e('select',{'aria-label':'Masse eingeben als'},e('option',{value:'dimensions'},'Breite × Höhe (cm)'),e('option',{value:'area'},'Gesamtflächen (m²)'));
    const areaFields=e('div',{class:'record-fields'},input('Fenster gesamt (m²)','windowArea','number',''),input('Türen / Plissee gesamt (m²)','doorArea','number',''));
    areaFields.querySelectorAll('input').forEach(n=>n.step='any');
    let calculationRun=0,timer,areaManual=false;
    const measureRows=e('div',{},rows,btn('+ Fenster / Tür hinzufügen',()=>{addRow();form.dataset.dirty='true';queueCalculation();}));
    const detailPanel=e('details',{},e('summary',{},'Kundenanfrage'));
    const travelPanel=e('details',{},e('summary',{},'Anfahrtskosten (optional)'),e('label',{class:'record-travel-confirmation'},travelIncluded,'Anfahrt inklusive'),travelField);
    const form=e('form',{id:'measurementForm',class:'record-appointment',novalidate:true,oninput:changed,onchange:changed,onsubmit:async ev=>{
      ev.preventDefault();if(busy||!validCalculation(true))return;busy=true;save.disabled=true;
      try{const data=await api('/'+r.id+'/measurements',{method:'POST',json:{revision:r.revision,requestId,measurementSource:isCorrection?'onsite':'admin_confirmed',...travelData(),measurements:measurements(),...(mode.value==='area'&&validRows()?{productionMeasurements:dimensionMeasurements()}:{})}});selected=data.record;renderCard();const mail=data.record.document.intake?.email?.status;root.prepend(e('p',{class:'record-note',role:'status'},data.correction?(data.correction.priceChanged?(mail==='accepted'?'✓ Masse gespeichert. Korrigierte Offerte vom Maildienst angenommen.':mail==='preview_only'?'✓ Masse gespeichert. Korrigierte Offerte als lokale Vorschau vorbereitet.':mail==='draft'?'✓ Masse gespeichert. Korrigierte Offerte bleibt als Entwurf; offene Angaben bitte ergänzen.':'✓ Masse gespeichert. Versandstatus der korrigierten Offerte bitte prüfen.'):'✓ Masse gespeichert. Der Preis bleibt gleich; keine neue Offerte versendet.'):'✓ Masse und Offertentwurf gespeichert. Keine E-Mail versendet.'));root.scrollIntoView({block:'start'});}
      catch(err){total.textContent=err.message;}finally{busy=false;save.disabled=false;}
    }});
    function dimensionMeasurements(){return Array.from(rows.children).map(row=>({type:row.querySelector('[name=type]').value,quantity:Number(row.querySelector('[name=quantity]').value),width:Number(row.querySelector('[name=width]').value),height:Number(row.querySelector('[name=height]').value)}));}
    function travelData(){return travelIncluded.checked?{travelIncluded:true}:travelAmount.value===''?{}:{travelAmountCHF:Number(travelAmount.value)};}
    function measurements(){return mode.value==='dimensions'?dimensionMeasurements():[['window','windowArea'],['door','doorArea']].map(([type,name])=>({type,mode:'area',areaM2:Number(areaFields.querySelector('[name='+name+']').value)})).filter(m=>m.areaM2>0);}
    function validRows(){return rows.children.length>0&&Array.from(rows.querySelectorAll('input,select')).every(n=>n.checkValidity())&&dimensionMeasurements().every(m=>m.width>0&&m.height>0);}
    function syncAreas(){
      if(areaManual)return;if(!validRows()){areaFields.querySelectorAll('input').forEach(n=>n.value='');return;}
      const sums={window:0,door:0};dimensionMeasurements().forEach(m=>sums[m.type]+=m.quantity*m.width*m.height/10000);
      areaFields.querySelector('[name=windowArea]').value=Math.round(sums.window*1e8)/1e8;areaFields.querySelector('[name=doorArea]').value=Math.round(sums.door*1e8)/1e8;
    }
    function changed(ev){
      form.dataset.dirty='true';
      if(areaFields.contains(ev.target))areaManual=true;
      if(rows.contains(ev.target)){areaManual=false;syncAreas();}
      travelAmount.disabled=travelIncluded.checked;
      areaFields.hidden=mode.value!=='area';measureRows.hidden=mode.value!=='dimensions';
      queueCalculation();
    }
    function validCalculation(report=false){
      const controls=mode.value==='area'?areaFields.querySelectorAll('input'):rows.querySelectorAll('input,select');
      const invalid=Array.from(controls).find(n=>!n.checkValidity());if(invalid){if(report)invalid.reportValidity();return false;}
      if(!measurements().length){if(report)total.textContent='Bitte mindestens eine Fläche eingeben.';return false;}
      if(!travelAmount.checkValidity()){if(report){travelPanel.open=true;travelAmount.reportValidity();}return false;}
      if(!areaManual){const confirmation=proposal.querySelector('input[required]');if(confirmation&&!confirmation.checked){if(report)confirmation.reportValidity();return false;}}
      return true;
    }
    function queueCalculation(){clearTimeout(timer);calculationRun++;total.replaceChildren();timer=setTimeout(calculate,250);}
    async function calculate(){
      const run=++calculationRun;
      if(!validCalculation()){total.replaceChildren();return;}
      total.textContent='Preis wird berechnet …';
      try{const data=await api('/'+r.id+'/measurements',{method:'POST',json:{revision:r.revision,preview:true,...travelData(),measurements:measurements()}});if(run!==calculationRun||!form.isConnected)return;
        total.replaceChildren(e('p',{},'Fenster: '+data.quote.areas.fenster.toLocaleString('de-CH',{maximumFractionDigits:4})+' m² · Türen / Plissee: '+data.quote.areas.tueren.toLocaleString('de-CH',{maximumFractionDigits:4})+' m²'),e('strong',{},'Richtpreis inkl. MwSt.: '+money(data.quote.totalCHF)));
        if(data.correction)total.append(e('p',{},data.correction.priceChanged?'Bisher: '+money(data.correction.previousTotalCHF)+' · Neue Offerte zur Bestätigung erforderlich.':'Preis unverändert · Keine neue Offerte erforderlich.'));
        const issues=(data.issues||[]).filter(i=>i.code!=='travel_cost_review'||!data.issues.some(q=>q.code==='missing_postal_code'));
        if(issues.length)total.append(e('ul',{},...issues.map(i=>e('li',{},issueText(i)))));
        if(data.quote.travelCosts.confirmedByAdmin&&data.quote.travelCosts.amountCHF)total.append(e('p',{},'Anfahrt enthalten: '+money(data.quote.travelCosts.amountCHF)));
      }catch(err){if(run===calculationRun)total.textContent=err.message;}
    }
    function addRow(value={},suggestion=null){
      const type=e('select',{name:'type',required:true,'aria-label':'Elementart'},e('option',{value:'window'},'Fenster'),e('option',{value:'door'},'Tür / Plissee'));type.value=value.type||'window';
      const row=e('div',{class:'record-measurement-row'},e('label',{},(suggestion?.label||'Element')+(suggestion&&!suggestion.type?' · vorläufig als Fenster':''),type),input('Anzahl','quantity','number',value.quantity??(suggestion?'':1),true),input('Breite (cm)','width','number',value.width||'',true),input('Höhe (cm)','height','number',value.height||'',true),btn('Entfernen',()=>{row.remove();form.dataset.dirty='true';if(!areaManual)syncAreas();queueCalculation();}));
      if(suggestion?.variants.length>1){
        row.prepend(e('p',{class:'record-note record-measurement-basis'},'Vorläufige Kundenmasse übernommen. Vor der Fertigung vor Ort prüfen.'));
      }
      row.querySelector('[name=quantity]').setAttribute('step','1');row.querySelector('[name=quantity]').setAttribute('min','1');rows.append(row);
    }
    const existing=(r.document.onsite?.productionMeasurements?.length?r.document.onsite.productionMeasurements:r.document.onsite?.measurements||r.document.intake?.productionMeasurements||r.document.intake?.measurements||[]).filter(m=>m.mode==='dimensions');
    if(existing.length)existing.forEach(m=>addRow({...m,width:m.width*(m.widthUnit==='m'?100:m.widthUnit==='mm'?0.1:1),height:m.height*(m.heightUnit==='m'?100:m.heightUnit==='mm'?0.1:1)}));else addRow();
    for(const [type,key]of [['window','windowArea'],['door','doorArea']]){
      const measured=(r.document.onsite?.measurements||r.document.intake?.measurements||[]).filter(m=>m.type===type).reduce((sum,m)=>sum+m.areaM2,0);
      const old=productText(r.document.products).match(type==='window'?/Fenster:\s*([\d.,]+)\s*m²/:/Türen:\s*([\d.,]+)\s*m²/);
      if(measured||old)areaFields.querySelector('[name='+key+']').value=measured||Number(old[1].replace(',','.'));
    }
    if(existing.length)syncAreas();
    const hasStoredArea=Array.from(areaFields.querySelectorAll('input')).some(n=>Number(n.value)>0);
    if(!existing.length&&hasStoredArea){mode.value='area';areaManual=true;}
    areaFields.hidden=mode.value!=='area';measureRows.hidden=mode.value!=='dimensions';
    function close(){if(form.dataset.dirty==='true'&&!confirm('Ungespeicherte Masse verwerfen?'))return;clearTimeout(timer);calculationRun++;if(fromList)load();else renderCard();}
    form.classList.add('record-measurement-form');
    form.append(mode,measureRows,areaFields,proposal,detailPanel,travelPanel,total,e('div',{class:'record-actions'},save,btn('Abbrechen',close)),e('p',{class:'record-note'},isCorrection?'Bei geändertem Preis wird automatisch eine korrigierte Offerte zur Bestätigung versendet. Unveränderte Preise lösen keine neue E-Mail aus.':'Speichert die Masse und einen Offertentwurf. Keine E-Mail wird versendet.'));
    root.replaceChildren(e('div',{class:'record-head'},btn('← Zurück',close),e('span',{class:'record-note'},recordName(r))),e('h2',{class:'record-heading',tabindex:'-1'},'Ausmessen'),e('p',{class:'record-note'},'Masse vor Ort eintragen. Flächen und Richtpreis werden automatisch berechnet.'),form);
    if(r.document.request)detailPanel.append(e('p',{class:'record-note'},r.document.request));
    (mode.value==='area'?areaFields:rows).querySelector('input').focus();root.scrollIntoView({block:'start'});
    if(!existing.length&&!hasStoredArea&&r.document.request){
      proposal.textContent='Masse aus Anfrage werden gelesen …';
      try{const data=await api('/'+r.id+'/measurement-proposal');if(!form.isConnected||form.dataset.dirty==='true')return;
        if(data.rows.length){rows.replaceChildren();data.rows.forEach(s=>addRow({type:s.type,quantity:s.quantity,...(s.variants.find(v=>v.basis==='with_frame')||s.variants[0]||{})},s));}
        proposal.replaceChildren(...(data.rows.length?[e('p',{class:'record-note'},'Kundenmasse übernommen · vor Ort prüfen.')]:[]));if(data.rows.length)detailPanel.append(...(data.warnings||[]).map(w=>e('p',{class:'record-note'},w)));
        if(data.rows.some(s=>s.confirmationRequired))proposal.append(e('label',{class:'record-travel-confirmation'},e('input',{type:'checkbox',required:true}),'Die erfassten Masse und Stückzahlen entsprechen der gewünschten Ausführung.'));
        syncAreas();calculate();
      }catch(err){proposal.textContent=err.message;}
    }else calculate();
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
    if(orderCancelled(d))root.append(e('p',{class:'record-note'},'Storniert. Der Eintrag steht unter Abgelehnt; ein geplanter Montagetermin ist aufgehoben.'));
    else if(d.customerDecline)root.append(e('p',{class:'record-note'},'Der Kunde hat die Offerte online abgelehnt.'));
    else if(d.customerAcceptance)root.append(e('p',{class:'record-note'},d.customerAcceptance.intent==='confirm_corrected_offer'?'Der Kunde hat die korrigierte Offerte nach dem Ausmessen bestätigt.':'Der Kunde möchte fortfahren. Masse und endgültige Vereinbarung müssen noch geprüft werden.'));
    const measurements=(d.intake?.measurements||[]).map(m=>(m.type==='window'?'Fenster':'Türen / Plissee')+': '+(m.mode==='dimensions'?m.quantity+' × '+m.width+' '+m.widthUnit+' × '+m.height+' '+m.heightUnit+' · ':'')+Number(m.areaM2).toLocaleString('de-CH',{maximumFractionDigits:4})+' m²').join('\n');
    root.append(e('section',{class:'record-request-summary'},e('strong',{},'Kundenanfrage'),e('p',{},measurements||productText(d.products)||'Masse noch nicht erfasst.'),d.request?e('p',{},d.request):null));
    if(d.intake)root.append(quoteSummary(d.intake));
    if(d.billing)showInvoiceSummary(r);
    if(!d.archivedAt){
      const next=e('section',{class:'record-next-step'});
      if(hasOpenComplaint(d))next.append(btn('Reklamation bearbeiten',()=>{const box=$('#recordComplaints');box.closest('details').open=true;box.scrollIntoView({block:'start',behavior:'smooth'});},''));
      if(legacy&&status!=='Završeno')next.append(btn('Abschliessen',()=>mutate({action:'historical-complete'}),'record-complete'));
      if(status==='Ponuda poslata')next.append(e('p',{class:'record-note'},'Die Offerte wurde versendet. Der Kunde kann sie über den Link in der E-Mail bestätigen.'));
      if(['Novi upit','Ponuda poslata','Prihvaćeno'].includes(status))next.append(btn('Ausmessen',()=>measurementCalculator(),''));
      if(status==='Prihvaćeno')next.append(btn(hasAppointment(d)?'Montagetermin ändern':'Montagetermin planen',schedule,''),btn('Montage beginnen',()=>mutate({action:'start-installation'}),'ghost'));
      if(status==='Montaža')next.append(btn('Montage abschliessen',billingAvailable&&d.intake?.quote?finishInstallation:()=>mutate({action:'complete'}),''));
      next.append(btn('Stornieren',cancelOrder,'ghost record-cancel'));
      if(next.childNodes.length)root.append(next);
      if(hasAppointment(d))root.append(e('p',{class:'record-appointment'},e('strong',{},'Montage: '+appointmentText(d)),d.appointmentNote?e('span',{},' · '+d.appointmentNote):null));
    }
    root.append(e('div',{id:'inlineAction'}),e('p',{id:'recordError',class:'record-error',role:'alert'}));
    if(!d.archivedAt){
      const notes=e('details',{class:'record-extra'},e('summary',{},'Interne Notiz'));
      const form=e('form',{id:'recordForm',oninput:()=>form.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'update',patch:Object.fromEntries(new FormData(form))});}});
      form.append(input('Notiz zum Auftrag','notes','textarea',d.notes),e('p',{},e('button',{type:'submit',class:'btn small'},'Notiz speichern')));notes.append(form);root.append(notes);
      const decisions=e('div',{class:'record-actions'},btn(orderCancelled(d)?'Auftrag wieder aufnehmen':'Zusage manuell erfassen',()=>decision('Prihvaćeno')),...(['Prihvaćeno','Montaža'].includes(status)?[]:[btn('Absage erfassen',()=>decision('Odbijeno'))]));
      if(hasAppointment(d))decisions.append(btn('Montagetermin absagen',()=>mutate({action:'cancel-appointment'})));
      if(!['Montaža','Završeno'].includes(status))root.append(e('details',{class:'record-extra'},e('summary',{},'Telefonische Zu- / Absage'),decisions));
      root.append(e('details',{class:'record-extra'},e('summary',{},'Dokumente und Fotos'),files()),e('details',{class:'record-extra'},e('summary',{},'Reklamation zum Auftrag'),complaints()));
      const contact=e('details',{class:'record-extra',id:'recordContact'},e('summary',{},'Kontakt korrigieren'));
      const correction=e('form',{id:'contactForm',oninput:()=>correction.dataset.dirty='true',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'update',patch:Object.fromEntries(new FormData(correction))});}}),fields=e('div',{class:'record-fields'});
      for(const [label,key,type]of [['Name','name'],['Firma','company'],['E-Mail','email','email'],['Telefon','phone','tel'],['Montageadresse','address'],['PLZ / Ort','postalCode']])fields.append(input(label,key,type||'text',d[key]));
      correction.append(fields,e('p',{},e('button',{type:'submit',class:'btn small'},'Kontakt speichern')));contact.append(correction);root.append(contact,...(legacy||status==='Odbijeno'?[e('div',{class:'record-actions record-extra'},btn('Anfrage entfernen',()=>archiveRecord(r),'ghost small record-remove'))]:[]));
    }
  }
  function cancelOrder(){
    if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    const d=selected.document,archiveOnly=!d.billing&&['Odbijeno','Završeno'].includes(d.status),form=e('form',{class:'record-appointment',role:'region','aria-label':'Stornierung bestätigen'});
    const consequence=d.billing?'Die Rechnung '+d.billing.number+' wird automatisch vollständig storniert. Ein Stornobeleg wird erstellt und die Karte ins Archiv verschoben.':archiveOnly?'Diese Karte wird ins Archiv verschoben. Bisherige Angaben bleiben gespeichert.':'Die Karte wechselt nach Abgelehnt. Ein geplanter Montagetermin wird aufgehoben. Bisherige Angaben bleiben gespeichert.';
    form.append(e('h3',{},'Möchten Sie wirklich stornieren?'),e('p',{},recordName(selected)),e('p',{},consequence),...(archiveOnly?[]:[input('Grund (optional)','reason','text','')]),e('button',{type:'submit',class:'btn'},'Ja, stornieren'),btn('Abbrechen',()=>form.remove()));
    if((d.payments||[]).length)form.append(e('p',{class:'record-note'},'Bereits erfasste Zahlungen bleiben erhalten. Bei einer stornierten Rechnung wird der Rückzahlungsbetrag angezeigt. Eine Rückzahlung wird nicht ausgelöst.'));
    form.addEventListener('submit',async ev=>{ev.preventDefault();await mutate({action:'cancel-order',confirmCancellation:true,reason:new FormData(form).get('reason')});});$('#inlineAction').replaceChildren(form);form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function decision(status){
    const d=selected.document;
    if(d.status===status)return;
    if(status==='Odbijeno'&&['Prihvaćeno','Montaža'].includes(d.status)){cancelOrder();return;}
    if(status==='Prihvaćeno'&&d.quotedPrice==null&&d.agreedPrice==null){
      const form=e('form',{class:'record-alert',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'decision',status,agreedPrice:new FormData(form).get('agreedPrice')});}},input('Vereinbarter Betrag (CHF)','agreedPrice','number','',true),e('button',{type:'submit',class:'btn'},'Zusage speichern'));$('#inlineAction').replaceChildren(form);form.querySelector('input').focus();return;
    }
    await mutate({action:'decision',status});
  }
  function schedule(){
    const d=selected.document;
    const form=e('form',{class:'record-appointment',onsubmit:async ev=>{ev.preventDefault();await mutate({action:'appointment',...Object.fromEntries(new FormData(form))});}},e('h3',{},'Montagetermin'),e('div',{class:'record-fields'},input('Datum','date','date',d.appointmentAt||today(),true),input('Uhrzeit','time','time',d.appointmentTime||'',true),input('Notiz (optional)','note','text',d.appointmentNote||'')),e('p',{class:'record-note'},'Schweizer Ortszeit. Der Termin wird intern gespeichert.'),e('button',{type:'submit',class:'btn'},'Termin speichern'));$('#inlineAction').replaceChildren(form);form.querySelector('input').focus();
  }
  async function invoiceAction(path,body,message){
    if(busy||hasDirtyForm()){if(hasDirtyForm())error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const result=await api('/'+selected.id+path,{method:'POST',json:{...body,revision:selected.revision}});selected=result.record;renderCard();const delivery=result.invoice?.delivery_status;root.prepend(e('p',{class:'record-note',role:'status'},message+(delivery==='preview_only'?' Lokale Vorschau · keine E-Mail versendet.':delivery==='accepted'?' E-Mail vom Versanddienst angenommen.':' Versand noch nicht bestätigt; Status in der Rechnung prüfen.')));}catch(err){error(err);}finally{busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function finishInstallation(){
    if(hasDirtyForm()){error(Error('Bitte zuerst Ihre Änderungen speichern.'));return;}
    const d=selected.document,total=d.agreedPrice,paid=(d.payments||[]).reduce((n,p)=>n+Number(p.amount),0),remaining=Math.round((total-paid)*100)/100,requestId=crypto.randomUUID();
    let method='';const bankReady=bankBillingAvailable||d.isTest===true;
    const form=e('form',{class:'record-appointment record-payment-card'}),choices=e('fieldset',{class:'record-payment-options'},e('legend',{},'Wie bezahlt der Kunde?')),received=e('input',{type:'checkbox'}),confirmation=e('label',{class:'record-payment-received',hidden:true},received,' Ich bestätige: '+money(remaining)+' wurde erhalten.'),accountNote=e('p',{class:'record-note',hidden:true},'Das Bankkonto für Rechnungen wird noch bestätigt. Bar und TWINT sind bereits verfügbar.'),submit=e('button',{type:'submit',class:'btn',disabled:true},'Montage abschliessen');
    for(const [value,label]of [['bank','Rechnung'],['twint','TWINT'],['cash','Barzahlung']]){
      const radio=e('input',{type:'radio',name:'paymentMethod',value,required:true});
      radio.addEventListener('change',()=>{method=value;received.checked=false;confirmation.hidden=method==='bank';received.required=method!=='bank';accountNote.hidden=method!=='bank'||bankReady;submit.disabled=method==='bank'&&!bankReady;submit.textContent=d.isTest?'TEST · Montage abschliessen':method==='bank'?'Abschliessen und Rechnung senden':'Zahlung bestätigen und abschliessen';});
      choices.append(e('label',{},radio,e('span',{},label)));
    }
    form.append(e('h3',{},'Montage fertig – Zahlung wählen'),e('p',{},'Bestätigte Offerte: '+money(total)+(paid?' · Bereits bezahlt: '+money(paid):'')),e('p',{},'Offen: '+money(remaining)),choices,confirmation,accountNote,e('p',{class:'record-note'},d.isTest?'TEST · Keine E-Mail wird versendet.':'Der Kunde erhält die Rechnung als PDF. Bei Bar oder TWINT ist sie als bezahlt markiert.'),submit,btn('Abbrechen',()=>form.remove()));
    form.addEventListener('submit',ev=>{ev.preventDefault();if(!method||method==='bank'&&!bankReady)return;invoiceAction('/complete-invoice',{requestId,method,paymentReceived:received.checked},'✓ Montage abgeschlossen und Rechnung erstellt.');});$('#inlineAction').replaceChildren(form);form.scrollIntoView({block:'center',behavior:'smooth'});
  }
  async function showInvoiceSummary(r){
    const box=e('section',{class:'record-quote-summary'},e('h3',{},'Rechnung '+r.document.billing.number));root.append(box);
    try{const {invoice}=await api('/'+r.id+'/invoice');if(!box.isConnected)return;const paid=(r.document.payments||[]).reduce((n,p)=>n+Number(p.amount),0),remaining=Math.max(0,Math.round((invoice.snapshot.totalCHF-paid)*100)/100),status={preview_only:'Lokale Vorschau · nicht versendet',queued:'Versand ausstehend',processing:'Versand wird bearbeitet',accepted:'E-Mail vom Versanddienst angenommen',failed:'Versand fehlgeschlagen',unknown:'Versandausgang unklar · bitte vor erneutem Versand prüfen'};
      if(invoice.cancellation){box.append(e('p',{},'STORNIERT · Kein offener Rechnungsbetrag.'),...(invoice.cancellation.refundDueCHF>0?[e('p',{},'Zurückzuerstatten: '+money(invoice.cancellation.refundDueCHF)+' · Rückzahlung noch nicht bestätigt.')]:[]),btn('Stornobeleg als PDF',()=>downloadPDF(r.id,'invoice-cancellation',invoice.cancellation.number)),btn('Originalrechnung ansehen',()=>downloadPDF(r.id,'invoice',invoice.number)));return;}
      box.append(e('p',{},remaining?'Offen: '+money(remaining):'Bezahlt · '+({cash:'Bar',twint:'TWINT',bank:'Banküberweisung'}[invoice.method])),e('p',{class:'record-note'},status[invoice.delivery_status]||'Versandstatus prüfen'),btn('Rechnung als PDF',()=>downloadPDF(r.id,'invoice',invoice.number)));
      if(remaining&&!r.document.archivedAt)box.append(btn('Bankzahlung erhalten',()=>{if(confirm('Den Eingang von '+money(remaining)+' auf dem Bankkonto geprüft?'))invoiceAction('/invoice',{action:'confirm-payment',paymentReceived:true},'✓ Zahlungseingang gespeichert.');}));
      if(['queued','failed','unknown'].includes(invoice.delivery_status))box.append(btn('Versand erneut prüfen',()=>invoiceAction('/invoice',{action:'retry'},'Versand geprüft.')));
    }catch(err){box.append(e('p',{class:'record-error'},err.message));}
  }
  async function downloadPDF(recordId,kind,name){
    try{const blob=await api('/'+recordId+'/'+kind+'?format=pdf',{file:true}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(err){error(err);}
  }
  async function showOffer(recordId){
    try{
      const data=await api('/'+recordId+'/offer');
      const dialog=e('dialog',{class:'record-offer-dialog'});
      const frame=e('iframe',{title:'Kundenofferte',sandbox:'',style:'width:100%;height:70vh;border:0'});frame.srcdoc=data.html;
      dialog.append(e('div',{class:'record-head'},e('strong',{},data.reference||'Offerte'),...(data.pdfAvailable?[btn('PDF herunterladen',()=>downloadPDF(recordId,'offer',data.reference||'Offerte'),'small')]:[]),btn('Schliessen',()=>dialog.close())),frame);
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
    }catch(err){error(err);}
  }
  function quoteSummary(intake){
    const box=e('section',{class:'record-quote-summary'});
    const recordId=selected.id;
    if(referenceText(selected))box.append(e('p',{class:'record-note'},referenceText(selected)));
    const messages={draft:'Offertentwurf · Noch nicht versendet.',preview_only:'Testvorschau: Keine E-Mail versendet.',queued:'Offerte wird zum Versand vorbereitet.',processing:'E-Mail wird versendet.',accepted:'Offerte vom E-Mail-Dienst angenommen.',failed:'Versand fehlgeschlagen. Bitte prüfen.',unknown:'Versandausgang unklar. Bitte prüfen.',not_available:'Keine Kunden-E-Mail vorhanden.'};
    if(intake.email?.status==='draft'&&intake.clarification?.length)box.append(e('div',{class:'record-alert',role:'status'},...intake.clarification.map(i=>e('p',{},issueText(i)))));
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
