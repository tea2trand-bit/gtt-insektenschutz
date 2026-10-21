(() => {
  const form=document.getElementById('complaintForm'),button=document.getElementById('submitComplaint'),error=document.getElementById('formError');
  const requestId=crypto.randomUUID();let busy=false;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!form.reportValidity())return;
    busy=true;button.disabled=true;error.textContent='';
    try{
      const values=Object.fromEntries(new FormData(form));
      const response=await fetch('/api/reklamationen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,requestId})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'Bitte versuchen Sie es erneut.');
      form.hidden=true;const success=document.getElementById('complaintSuccess');success.hidden=false;success.focus();
    }catch(err){error.textContent=err.message||'Bitte die Verbindung prüfen und erneut versuchen.';}
    finally{busy=false;button.disabled=false;}
  });
})();
