# Direkte Rechnungen nach der Montage

Stand: 22.10.2026. Smallinvoice wird fuer diesen Ablauf nicht verwendet.

- Auftrag in Montage oeffnen und Auftrag abschliessen waehlen.
- Rechnung / Bankueberweisung: unveraenderliche Rechnung mit QR-Zahlteil; Restbetrag bleibt offen.
- Bar / TWINT: den tatsaechlich erhaltenen Restbetrag bestaetigen; bezahlte Rechnung als Beleg.
- Betrag stammt ausschliesslich aus der aktuellen, vom Kunden bestaetigten Offertversion. Aufmass muss vorliegen, eine offene Korrektur blockiert die Rechnung.
- Bereits erfasste Zahlungen werden vom offenen Betrag abgezogen. 8.1 Prozent MwSt. sind im bestaetigten Bruttopreis enthalten und werden nicht nochmals aufgeschlagen.
- Eigener Nummernkreis GTT-R-JAHR-00001; vorhandene Fremdrechnungsnummern werden nicht weitergezaehlt.
- Montageabschluss, Rechnung, Zahlung und Historie werden in einer Datenbankoperation gespeichert. Wiederholungen erzeugen keine zweite Rechnung oder Zahlung.
- PDF wird unveraenderlich gespeichert. Versand hat ein eigenes Protokoll mit stabiler Provider-Idempotenz; hoechstens drei Versuche innerhalb von 23 Stunden. Danach muss ein unklarer Ausgang beim Versanddienst geprueft werden.
- Produktion sendet nach dem bewussten Abschluss automatisch an die Kundenadresse. Lokale/Deploy-Preview- und TEST-Rechnungen werden nicht versendet.
- Bankzahlung erhalten erfasst nur einen tatsaechlich geprueften Bankeingang. Es gibt keine Bank- oder TWINT-Schnittstelle und keinen automatischen Abgleich.
- Alte abgeschlossene Auftraege werden nicht nachtraeglich abgerechnet. Fuer Goran pruefen / Abschliessen bleibt ohne Rechnung.
- PDF-Abruf und Aktionen verlangen die bestehende Admin-Anmeldung. Ausgestellte Rechnungen koennen nicht durch normale Kartenbearbeitung ueberschrieben oder mit TEST-Aufraeumen geloescht werden.

## Empfaengerkonto noch zu bestaetigen

Die gelieferte PDF-Rechnung nennt GT Trading GmbH / Raiffeisen; die gelieferte QR-Grafik nennt einen anderen Kontoinhaber. invoice-settings.mts enthaelt die Firmendaten aus der PDF-Vorlage. INVOICE_ACCOUNT_CONFIRMED=false blockiert nur echte Bankrechnungen, bis der Auftraggeber das Zielkonto bestaetigt. Bar und TWINT sind bereits nutzbar: nach bestaetigtem Zahlungseingang entsteht eine bezahlte Rechnung ohne QR-Zahlteil oder Bankverbindung. Alle drei Zahlungsarten werden beim Montageabschluss als direkte Auswahl angezeigt. Es wird kein statischer fremder QR-Code wiederverwendet.

Die Zahlungsfrist von 10 Tagen und die MwSt.-Nummer stammen ebenfalls aus der gelieferten Firmenvorlage. Einfache Rechnungen werden auf einer A4-Seite mit normgerechtem QR-Zahlteil erstellt. Unvollstaendig strukturierte Kundenadressen werden nicht fuer den QR erfunden; dessen Zahlbar-durch-Feld bleibt dann leer.
