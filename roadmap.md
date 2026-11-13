# Roadmap tecnico

## Stato corrente

Il branch operativo è `migration/standalone-stack`. Il database usa Supabase PostgreSQL e la cronologia ufficiale delle modifiche è mantenuta esclusivamente in `supabase/migrations/`.

### Completato

- [x] Autenticazione e spazi personali/condivisi con controlli di membership lato database.
- [x] Conti, categorie e movimenti personali con saldi derivati dai movimenti.
- [x] Trasferimenti atomici tra conti, con due movimenti collegati e validazione differita.
- [x] Spese condivise e regolamenti come entità distinte dai movimenti personali.
- [x] Investimenti e debiti.
- [x] Ricorrenze e scadenze con conferma atomica e controlli sui riferimenti.
- [x] Protezioni di archiviazione per conti e categorie referenziati da piani finanziari attivi.
- [x] Serializzazione delle scritture concorrenti con archiviazione di conti e categorie.
- [x] Integrità dei collegamenti tra movimenti personali, spese condivise e rimborsi.
- [x] Restrizione delle funzioni di membership all'utente autenticato, senza interrogazioni sui ruoli di terzi.
- [x] Inviti modificabili dal client solo per la revoca di inviti pendenti.
- [x] Scrittura delle spese condivise consentita solo tramite RPC validate.
- [x] Verifiche RLS, privilegi anonimi, isolamento e integrità per tutte le aree finanziarie.
- [x] Test di concorrenza con sessioni PostgreSQL indipendenti per conti, categorie, ricorrenze e scadenze.
- [x] Migrazione a uno stack autonomo basato su React, TanStack Start, Supabase e Bun.
- [x] Rimozione dei metadati, delle configurazioni e dei riferimenti operativi della piattaforma precedente.
- [x] Rimozione del sistema di migrazioni Drizzle duplicato: Supabase SQL è l'unica fonte autorevole.
- [x] Rigenerazione del lockfile dopo la rimozione delle dipendenze Drizzle.
- [x] Pipeline frontend resa read-only: formattazione verificata senza commit automatici da CI.

## Lavori in corso

- [x] Pipeline frontend e database completate con esito positivo sul commit applicativo `a832c8c`; tutte le suite SQL, incluse quelle di concorrenza e integrità dei collegamenti, sono verdi.
- [x] Revisione mirata di trigger, policy RLS, grant, RPC e vincoli cross-space completata; le regressioni individuate sono coperte da test.
- [ ] Eseguire un'ulteriore revisione indipendente prima della promozione a `main`.
- [ ] Verificare la configurazione di produzione e definire la gestione dei segreti in base all'hosting scelto.

## Rilascio

- [ ] Scegliere e configurare l'ambiente di hosting e staging.
- [ ] Preparare una procedura riproducibile di deploy e backup/restore, coerente con il piano del servizio scelto.
- [ ] Verificare l'applicazione in staging con account di prova.
- [ ] Concludere la revisione del branch operativo.
- [ ] Promuovere le modifiche a `main` solo dopo validazione completa e approvazione esplicita.

## Regole operative

- I dati finanziari restano a inserimento e aggiornamento manuale.
- Non introdurre sincronizzazioni bancarie senza approvazione esplicita.
- Non applicare migrazioni al database remoto durante sviluppo o CI.
- Ogni modifica al database deve essere accompagnata da test di regressione.
- Non modificare `main` prima della conclusione della revisione e dell'approvazione del rilascio.
