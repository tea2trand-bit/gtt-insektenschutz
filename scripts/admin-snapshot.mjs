// Local preview tooling only. The production side of this copy is read-only.
export async function exportAdminSnapshot(password){
  const origin='https://gtt-insektenschutz.ch';
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  password='';
  if(!login.ok)throw Error('Die Produktionsanmeldung wurde abgelehnt (HTTP '+login.status+').');
  const session=await login.json();
  const read=async(route,binary=false)=>{
    if(!/^\/api\/admin\/(?:records(?:\?archived=1|\/GTT-[a-f0-9]{24}(?:\/files\/[a-f0-9-]{36})?)?|items|offer)$/.test(route))throw Error('Ungültiger Exportpfad.');
    const response=await fetch(origin+route,{method:'GET',headers:{Authorization:'Bearer '+session.token}});
    if(!response.ok)throw Error('Die Daten konnten nicht gelesen werden (HTTP '+response.status+').');
    return binary?Buffer.from(await response.arrayBuffer()).toString('base64'):response.json();
  };
  const [active,archived,items,offer]=await Promise.all([read('/api/admin/records'),read('/api/admin/records?archived=1'),read('/api/admin/items'),read('/api/admin/offer')]);
  const ids=[...new Set([...active.records,...archived.records].map(r=>r.id))];
  const records=await Promise.all(ids.map(async id=>{
    const {record}=await read('/api/admin/records/'+id);
    record.files=await Promise.all((record.files||[]).map(async f=>({...f,contentBase64:await read('/api/admin/records/'+id+'/files/'+f.id,true)})));
    return record;
  }));
  session.token='';
  return {schemaVersion:1,sourceOrigin:origin,exportedAt:new Date().toISOString(),records,items:items.items||[],offer:offer.offer};
}

export async function importAdminSnapshot(db,snapshot){
  if(snapshot.schemaVersion!==1||snapshot.sourceOrigin!=='https://gtt-insektenschutz.ch'||!Array.isArray(snapshot.records))throw Error('Ungültige lokale Kopie.');
  await db.exec('CREATE TABLE IF NOT EXISTS gtt_local_snapshot_receipt(id boolean PRIMARY KEY DEFAULT true CHECK(id),source_exported_at text NOT NULL)');
  if((await db.query('SELECT id FROM gtt_local_snapshot_receipt')).rows.length)throw Error('Die lokale Kopie wurde bereits übernommen. Lokale Änderungen werden nicht überschrieben.');
  const count=(await db.query('SELECT count(*)::int AS n FROM gtt_records')).rows[0].n;
  if(count)throw Error('Die lokale Kopie enthält bereits Daten. Lokale Änderungen werden nicht überschrieben.');
  await db.transaction(async tx=>{
    for(const r of snapshot.records){
      if(!/^GTT-[a-f0-9]{24}$/.test(r.id)||!r.original||!r.document||!Number.isInteger(r.revision))throw Error('Unvollständiger Datensatz in der lokalen Kopie.');
      await tx.query('INSERT INTO gtt_records(id,source,received_at,updated_at,revision,original,document) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[r.id,r.source,r.received_at,r.updated_at||r.received_at,r.revision,JSON.stringify(r.original),JSON.stringify(r.document)]);
      for(const h of r.history||[])await tx.query('INSERT INTO gtt_record_history(record_id,revision,at,actor,kind,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[r.id,h.revision,h.at,h.actor,h.kind,JSON.stringify(h.snapshot)]);
      for(const f of r.files||[])await tx.query('INSERT INTO gtt_record_files(id,record_id,name,content_type,content,created_at) VALUES($1,$2,$3,$4,$5,$6)',[f.id,r.id,f.name,f.content_type,Buffer.from(f.contentBase64,'base64'),f.created_at]);
      const versions=new Map();
      for(const intake of [...(r.history||[]).map(h=>h.snapshot?.intake),r.document.intake])if(intake?.version)versions.set(Number(intake.version),intake);
      for(const [version,intake]of versions)await tx.query('INSERT INTO gtt_quote_versions(version,record_id,source_fingerprint,snapshot) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4::jsonb)',[version,r.id,intake.sourceFingerprint||'local-copy-'+version,JSON.stringify(intake)]);
    }
    // Preserve copied global numbers and never move the local sequence backwards.
    await tx.query("SELECT setval(pg_get_serial_sequence('gtt_quote_versions','version'),GREATEST((SELECT last_value FROM gtt_quote_versions_version_seq),(SELECT COALESCE(max(version),1) FROM gtt_quote_versions)),true)");
    await tx.query('INSERT INTO gtt_local_snapshot_receipt(source_exported_at) VALUES($1)',[snapshot.exportedAt]);
  });
  return {records:snapshot.records.length,active:snapshot.records.filter(r=>!r.document.archivedAt).length,archived:snapshot.records.filter(r=>r.document.archivedAt).length,exportedAt:snapshot.exportedAt};
}
