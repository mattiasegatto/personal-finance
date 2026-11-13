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
- [x] Test SQL di isolamento e integrità per spazi, finanze, trasferimenti, spese condivise, scadenze, ricorrenze, investimenti e debiti.
- [x] Pipeline CI per installazione, lint, test, build e ricostruzione del database locale.
- [x] Migrazione a uno stack autonomo basato su React, TanStack Start, Supabase e Bun.
- [x] Rimozione dei metadati e dei documenti specifici di strumenti precedenti.
- [x] Rimozione del sistema di migrazioni Drizzle duplicato: Supabase SQL è l'unica fonte autorevole.
- [x] Rigenerazione del lockfile dopo la rimozione delle dipendenze Drizzle.

## Lavori in corso

- [ ] Completare la verifica CI sul commit che include la pulizia e il lockfile aggiornato.
- [ ] Aggiungere test di concorrenza con transazioni PostgreSQL indipendenti per archiviazione di conti/categorie e creazione di ricorrenze/scadenze.
- [ ] Verificare l'ordine di acquisizione dei lock e l'assenza di deadlock nei percorsi concorrenti.
- [ ] Eseguire una revisione completa di trigger, policy RLS, grant, RPC e vincoli cross-space.
- [ ] Verificare che tutte le configurazioni e le istruzioni operative siano coerenti con lo stack corrente.
- [ ] Eseguire un controllo finale delle dipendenze, delle variabili d'ambiente e della gestione dei segreti.

## Rilascio

- [ ] Preparare una procedura riproducibile di deploy e backup/restore.
- [ ] Verificare il comportamento dell'applicazione in un ambiente di staging con account di prova.
- [ ] Concludere la revisione del branch operativo.
- [ ] Promuovere le modifiche a `main` solo dopo validazione completa e approvazione esplicita.

## Regole operative

- I dati finanziari restano a inserimento e aggiornamento manuale.
- Non introdurre sincronizzazioni bancarie senza approvazione esplicita.
- Non applicare migrazioni al database remoto durante sviluppo o CI.
- Ogni modifica al database deve essere accompagnata da test di regressione.
- Non modificare `main` prima della conclusione della revisione e dell'approvazione del rilascio.
