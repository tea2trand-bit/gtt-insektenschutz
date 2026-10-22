# Interne E-Mails und Zustellung

Stand: 22.10.2026.

Neue interne Nachrichten zeigen Ereignis, naechsten Schritt, Website-Quelle, Kontakt und Offertbetrag. Die Ursprungsanfrage und technische Details bleiben in der Karte. HTML und Plaintext tragen dieselbe kurze Information. Der Admin-Link verwendet die globale Offertnummer, zum Beispiel /admin?offerte=GTT-003; die Aufloesung erfolgt erst nach Anmeldung, auch fuer archivierte Karten. Alte versandte E-Mails werden nicht nachtraeglich geaendert.

## Oeffentlich gepruefte DNS-Eintraege

- resend._domainkey.gtt-insektenschutz.ch: DKIM-Schluessel vorhanden.
- send.gtt-insektenschutz.ch: CNAME auf send.forge.rmta.net, mit SPF und MX am Ziel.
- _dmarc.gtt-insektenschutz.ch: kein TXT-Eintrag gefunden.
- Root-TXT enthaelt keinen SPF-Eintrag. Das beweist keinen SPF-Fehler: fuer SPF gilt der Envelope-Sender, nicht zwingend die sichtbare From-Adresse.

Aus Screenshots der GMX-Spamansicht laesst sich kein Authentication-Results-Header und kein konkreter Ablehnungsgrund ablesen. Fuer eine abschliessende Diagnose wird eine Originalnachricht als .eml mit vollstaendigen Kopfzeilen benoetigt. Pruefen: SPF/DKIM/DMARC, Alignment, Return-Path und Provider-Ereignis. Keine Zugangsdaten sind dafuer erforderlich.

DNS wurde nicht veraendert. DMARC erst nach Pruefung aller legitimen Absender einfuehren, anfangs mit Monitoring; keine blinde reject-Policy. Eine Kennzeichnung als Kein Spam im GMX-Postfach kann den persoenlichen Filter trainieren. Inbox-Zustellung ist nicht garantiert.

Quellen:
- https://resend.com/docs/dashboard/domains/introduction
- https://hilfe.gmx.net/email/spam-und-viren/spamschutz-einstellungen.html
