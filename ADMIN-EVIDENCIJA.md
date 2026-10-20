# Admin evidencija

Repozitorijum: `tea2trand-bit/gtt-insektenschutz`. Polazni produkcioni commit: `e1272f9e7876a1573f908521d1b88bdd1d5d5571`. Radna grana: `codex/admin-records`.

Admin zadržava postojeću prijavu. Navigacija razdvaja Projekte, Sezonsku ponudu i Upite. Originalni podaci upita ostaju nepromenljivi; izmene kartona dobijaju verziju i istoriju. Zajednička admin lozinka ne identifikuje pojedinačnog kolegu, pa autor glasi „Admin (zajednička prijava)“.

## Skladištenje

Netlify Database / Postgres čuva kartone, istoriju i privatne dokumente do 2 MB. SQL CTE atomskom izmenom čuva novu verziju i istoriju. Optimistička provera revizije vraća 409 ako je drugi prozor već promenio karton. Originalni podaci nisu dozvoljeno polje za izmenu. Uplate se dodaju u evidenciju; ovo ne pokreće plaćanje i nije računovodstveni sistem.

Migracije su u `netlify/database/migrations/`. Hosted migracije primenjuje Netlify deploy; nemoj ih ručno izvršavati nad produkcijom. Preview dobija svoju DB granu. Stvarni podaci iz produkcije se ne koriste za demonstraciju.

`records-event.mts` sluša Netlify `formSubmitted` događaj sa verifikovanim potpisom. Ne menja `submission-created.mts`, niti slanje emaila. Kalkulator, B2B i kontakt imaju `record_source` i `inquiry_id`. `inquiry-id.js` čuva isti ID tokom ponovljenog slanja; uspešan reset forme kreira novi ID. Novi karton uvek počinje kao „Novi upit“. Prihvatanje zahteva dogovorenu cenu i datum, a odbijanje datum i razlog. Slanje emaila nije dokazano statusom kartona; admin ručno upisuje potvrđeno slanje i tekst/dokument ponude.

Raniji Netlify zapisi mogu se uvesti u adminu kao JSON niz sa `id`, `form_name`, `created_at`, `data`. Uvoz koristi sačuvani inquiry_id, kada postoji, ili originalni Netlify submission ID. Ponovljen uvoz ne prepisuje postojeći karton. Ranije forme bez novog ID-a ostaju u Netlify; njihov originalni ID koristi se u uvozu.

## Lokalni pregled

Node >=22.12 (preporučeno24), `npm ci`, `npm run preview:admin`. Adresa: `http://127.0.0.1:4400/admin`, lokalna lozinka `gtt-demo-local`. PGlite izvršava pravi Postgres SQL i čuva isključivo označene test podatke u `.local-records/db`. Ovaj folder je ignorisan u Gitu i ne ulazi u build. Postojeća galerija/akcija u ovom lokalnom pregledu su izolovani primeri; osnovna evidencija koristi stvarnu lokalnu bazu.

`npm test`, `npm run typecheck`, `npm run build`. Test obuhvata sva tri izvora, duplikate, originalnu cenu, istoriju, konkurentne izmene, obavezna polja odluka, uplate, rešavanje reklamacija, privatnost dokumenata i admin autentifikaciju.

Build kopira samo javne HTML/CSS/JS fajlove, assets, robots i sitemap u `dist/`. Izvor funkcija, migracije, testovi, lokalna baza i alati ostaju van javnog publish direktorijuma. Nemoj vraćati publish na koren repozitorijuma.

## Cloud provera i objava

Pripremiti odvojeni Deploy Preview i proveriti migraciju, 401 bez tokena, čuvanje/ponovno otvaranje kartona, 409 pri staroj reviziji i preuzimanje dokumenta uz prijavu. `records-preview-probe.html` se generiše samo za deploy-preview: zasebna Netlify test forma izbegava produkcioni email handler i postojeća notification pravila. Cloud event dokaz zahteva da stvarno verifikovan Netlify upit pokrene handler i da se karton pojavi; direktan lokalni poziv nije takav dokaz.

Pre produkcione objave ponovo proveriti trenutno objavljen deploy i promene email kolege. Šira objava admina je odvojena od odobrene email popravke. Ne menjati postojeću sezonsku akciju, podatke galerije, billing ili produkcione upite radi testa.
