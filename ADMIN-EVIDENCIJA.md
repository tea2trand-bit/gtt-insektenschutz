# Admin evidencija

Repozitorijum: `tea2trand-bit/gtt-insektenschutz`. Polazni produkcioni commit: `e1272f9e7876a1573f908521d1b88bdd1d5d5571`. Radna grana: `codex/admin-records`.

Admin zadržava postojeću prijavu. Navigacija razdvaja Projekte, Sezonsku ponudu i Upite. Originalni podaci upita ostaju nepromenljivi; izmene kartona dobijaju verziju i istoriju. Zajednička admin lozinka ne identifikuje pojedinačnog kolegu, pa autor glasi „Admin (zajednička prijava)“.

## Skladištenje

Netlify Database / Postgres čuva kartone, istoriju i privatne dokumente do 2 MB. SQL CTE atomskom izmenom čuva novu verziju i istoriju. Optimistička provera revizije vraća 409 ako je drugi prozor već promenio karton. Originalni podaci nisu dozvoljeno polje za izmenu. Uplate se dodaju u evidenciju; ovo ne pokreće plaćanje i nije računovodstveni sistem.

Migracije su u `netlify/database/migrations/`. Hosted migracije primenjuje Netlify deploy; nemoj ih ručno izvršavati nad produkcijom. Preview dobija svoju DB granu. Stvarni podaci iz produkcije se ne koriste za demonstraciju.

`records-event.mts` sluša Netlify `formSubmitted` događaj sa verifikovanim potpisom. Kalkulator, B2B i kontakt imaju `record_source` i `inquiry_id`. `inquiry-id.js` čuva isti ID tokom ponovljenog slanja; uspešan reset forme kreira novi ID. Novi karton počinje kao „Novi upit“. Automatska obrada prelazi na „Ponuda poslata“ tek kada email provajder prihvati poruku; taj status sam ne dokazuje prijem u inbox. U produkciji je potreban `GTT_QUOTE_AUTOMATION=enabled`; isti prekidač isključuje staro customer slanje u `submission-created.mts`, tako da kupac dobija jednu ponudu. Postojeća Netlify obaveštenja administratorima ostaju odvojena.

„Dogovoren posao“ jednim klikom preuzima poslednju ponuđenu cenu i beleži današnji datum u Europe/Zurich vremenu; ako cena nedostaje, traži samo iznos. „Odbijeno“ beleži datum i ishod, a razlog je neobavezan. Ovo je interna evidencija administratorove odluke. Originalna ponuda ostaje sačuvana. Samo slanje ponude nikada ne prihvata posao.

Raniji Netlify zapisi mogu se uvesti u adminu kao JSON niz sa `id`, `form_name`, `created_at`, `data`. Uvoz koristi sačuvani inquiry_id, kada postoji, ili originalni Netlify submission ID. Ponovljen uvoz ne prepisuje postojeći karton. Ranije forme bez novog ID-a ostaju u Netlify; njihov originalni ID koristi se u uvozu.

„Dodaj klijenta“ unosi klijenta bez javne platforme, sa imenom ili firmom i telefonom ili emailom; ostala polja su neobavezna. Novi zapis koristi izvor Ručni unos, dobija stabilan ID i istoriju, i ne šalje email. Raniji upiti koji čekaju korisnikov pregled čuvaju se odvojeno u `gtt_pending_inquiries` i vide samo kroz admin API, bez pretvaranja u operativne poslove.

„Zakaži termin montaže“ je dostupan uz dogovoren posao. Administrator bira lokalni datum/vreme (Europe/Zurich) i neobaveznu napomenu; kupac i adresa dolaze iz kartona. Pregled Montaže prikazuje predstojeće aktivne termine sa vezom do kartona. Promena i otkazivanje su nove verzije istorije; ovo ne šalje kalendarske pozive ili poruke.

Automatska obrada iz istog potpisanog Netlify događaja poziva `processQuoteIntake` posle idempotentnog otvaranja kartona, uključujući ponovljenu dostavu događaja. Mere i ponuda dobijaju nepromenljivu verziju; izlazni email ima jedinstvenu rezervaciju i idempotency key. Originalni tekst ostaje sačuvan. AI služi samo za izdvajanje tehničkih mera; cenovnik, popust i zaokruživanje ostaju u istom determinističkom obračunu kao postojeći kalkulator. Nejasni slučajevi traže dopunu umesto izmišljene cene.

Odobreni istorijski uvoz koristi privatni manifest u Netlify Blobs, čiji je SHA256 unapred pinovan u production runtime konfiguraciji. Korisnik je naknadno izričito odobrio svih 14 Netlify upita u glavnoj evidenciji. Manifest v2 sadrži originalne submission ID-eve, podatke i tačne izvorne datume. Novi istorijski kartoni počinju kao „Novi upit“; postojeće odluke i istorija se ne prepisuju. Potpisani production događaj ili autentifikovano otvaranje liste završava idempotentni uvoz. Potvrda sa ukupnim brojem i ID-evima je u `gtt_admin_import_jobs`; lični podaci ne ulaze u repozitorijum ili statički build. Uvoz ne pokreće obračun ili slanje starih ponuda. Raniji redovi za privatni pregled koji već imaju karton automatski su isključeni iz liste čekanja.

## Lokalni pregled

Node >=22.12 (preporučeno24), `npm ci`, `npm run preview:admin`. Adresa: `http://127.0.0.1:4400/admin`, lokalna lozinka `gtt-demo-local`. PGlite izvršava pravi Postgres SQL i čuva podatke u `.local-records/db`. Ovaj folder je ignorisan u Gitu i ne ulazi u build. Operativni demo kartoni su označeni TEST. Poseban privatni istorijski spisak sadrži podatke korisnika koji čekaju pregled; ne koristiti ih za demonstracije. Postojeća galerija/akcija u ovom lokalnom pregledu su izolovani primeri; evidencija koristi stvarnu lokalnu bazu.

`npm test`, `npm run typecheck`, `npm run build`. Test obuhvata sva tri izvora, duplikate, originalnu cenu, istoriju, konkurentne izmene, obavezna polja odluka, uplate, rešavanje reklamacija, privatnost dokumenata i admin autentifikaciju.

Build kopira samo javne HTML/CSS/JS fajlove, assets, robots i sitemap u `dist/`. Izvor funkcija, migracije, testovi, lokalna baza i alati ostaju van javnog publish direktorijuma. Nemoj vraćati publish na koren repozitorijuma.

## Cloud provera i objava

Pripremiti odvojeni Deploy Preview i proveriti migraciju, 401 bez tokena, čuvanje/ponovno otvaranje kartona, 409 pri staroj reviziji i preuzimanje dokumenta uz prijavu. `records-preview-probe.html` se generiše samo za deploy-preview: zasebna Netlify test forma izbegava produkcioni email handler i postojeća notification pravila. Cloud event dokaz zahteva da stvarno verifikovan Netlify upit pokrene handler i da se karton pojavi; direktan lokalni poziv nije takav dokaz.

Pre produkcione objave proveriti trenutno objavljen deploy i zajedničku verziju email obrade. Koristiti novi uspešan deploy sa primenjenim migracijama i zadržati postojeće zaključavanje automatske objave. Završni live kontakt test mora biti jasno označen TEST; prijem emaila i sačuvani karton proveravaju se odvojeno. Ne menjati postojeću sezonsku akciju, podatke galerije ili billing radi testa.
