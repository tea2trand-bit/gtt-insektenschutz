# Smallinvoice: vorbereitete Anbindung

Stand: 21.10.2026. Der vorhandene Smallinvoice-Account ist noch nicht eingerichtet und derzeit nicht zugänglich. Es wurden keine Rechnungen angelegt oder versendet.

netlify/lib/smallinvoice-preparation.mts erstellt aus einem abgeschlossenen Auftrag einen prüfbaren Entwurf mit Kundendaten, bestätigtem Gesamtbetrag, CHF, Sprache Deutsch und Position. Anfragen ohne bestätigten Betrag werden nicht fakturiert. Die Schnittstelle führt keine Netzwerkzugriffe aus.

Für die Aktivierung im bestehenden Account:

- Firmendaten des Rechnungsausstellers, Rechnungsnummern, Zahlungsfrist und Bankdaten prüfen.
- Steuerkonfiguration und Einheit aus dem tatsächlichen Account übernehmen; keine Steuersätze aus Dokumentationsbeispielen übernehmen.
- Einen eigenen API-V2-Client für dieses Projekt mit den erforderlichen Kontakt- und Rechnungsrechten einrichten. Zugangsdaten nur als geschützte Functions-Variablen speichern.
- Kunden und Adressen über Smallinvoice zuordnen, anschliessend POST /v2/receivables/invoices verwenden.
- Die zurückgegebene Smallinvoice-ID und Rechnungsnummer mit dem GTT-Karton verknüpfen und doppelte Erstellung durch eine eindeutige Referenz verhindern.
- Zunächst Entwurf und PDF prüfen. Der Versand bleibt ein eigener, ausdrücklich ausgelöster Schritt.

Ein OAuth-Client-Credentials-Token gilt laut Dokumentation für den eigenen Account. Eine Rechnung benötigt unter anderem contact_id, contact_address_id, Positionen, Datum, Fälligkeit, CHF und Sprache de. Die konkreten Konto-, Steuer- und Einheits-IDs müssen erst aus dem eingerichteten Account gelesen werden.

Offizielle Quellen:

- https://api.smallinvoice.com/v2/doc/?action=auth-workflow
- https://api.smallinvoice.com/v2/doc/?action=calls
- https://api.smallinvoice.com/v2/doc/
