// A transport retry keeps its ID; a successful form reset starts a new inquiry.
document.querySelectorAll('form[name="angebot"],form[name="kontakt"],form[name="b2b-anfrage"]').forEach(form => {
  const field = form.elements.namedItem('inquiry_id');
  if (!field) return;
  const renew = () => { field.value = crypto.randomUUID(); };
  renew();
  form.addEventListener('reset', () => queueMicrotask(renew));
});
