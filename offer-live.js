// Seasonal offer (Herbst-/Winteraktion) managed in /admin.
// Applies the discounted m² rates to the calculator and price cards and shows
// a short banner. Without an active offer nothing on the page changes.
(function(){
  if(!window.fetch) return;

  function chf(n){ return "CHF " + Math.round(n).toLocaleString("de-CH") + ".–"; }
  function fmtDate(iso){
    var p = (iso || "").split("-");
    return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : "";
  }
  function el(tag, cls, text){
    var e = document.createElement(tag);
    if(cls) e.className = cls;
    if(text != null) e.textContent = text;
    return e;
  }

  function apply(o){
    var copy = window.gttOfferCopy(o), label = copy.label;
    var message = label + ' · ' + copy.detail;

    // calculator
    if(typeof window.gttSetOffer === "function") window.gttSetOffer(o);
    var calc = document.getElementById("rechner");
    if(calc && !calc.querySelector(".offer-ribbon")){
      var ribbon = el("div", "offer-ribbon");
      ribbon.appendChild(el("strong", null, label));
      ribbon.appendChild(el("span", null, copy.detail));
      calc.insertBefore(ribbon, calc.firstChild);
    }

    // price cards
    ["fenster", "tueren"].forEach(function(key){
      var strong = document.querySelector('[data-rate="' + key + '"]');
      if(!strong || !o[key] || o.rates[key] >= o.baseRates[key]) return;
      strong.textContent = chf(o.rates[key]) + " / m²";
      var old = el("span", "rate-old", "statt ");
      old.appendChild(el("s", null, chf(o.baseRates[key]) + " / m²"));
      strong.parentNode.insertBefore(old, strong.nextSibling);
      var card = strong.closest("article");
      if(card && !card.querySelector(".offer-badge")) card.insertBefore(el("p", "offer-badge", label), card.querySelector("h3"));
    });

    // top bar
    var topbar = document.querySelector(".topbar");
    if(topbar && !topbar.querySelector(".topbar-offer")){
      var a = el("a", "topbar-offer", "🍂 " + message);
      a.href = "#rechner";
      topbar.insertBefore(a, topbar.firstChild);
    }
  }

  fetch("/api/offer", { headers: { "Accept": "application/json" } })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if(!d || !d.offer) return;
      if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", function(){ apply(d.offer); });
      else apply(d.offer);
    })
    .catch(function(){});
})();
