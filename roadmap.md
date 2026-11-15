# Roadmap tecnico

## Stato corrente

Il branch operativo è `migration/standalone-stack`. Il database usa Supabase PostgreSQL e la cronologia ufficiale delle modifiche è mantenuta esclusivamente in `supabase/migrations/`.

### Completato

- [x] Autenticazione e spazi personali/condivisi con controlli di membership lato database.
- [x] Conti, categorie e movimenti personali con saldi derivati dai movimenti.
- [x] Trasferimenti atomici tra conti, con due movimenti collegati e validazione differita.
- [x] Spese condivise e regolamenti come entità distinte dai movimenti personali.
- [x] Investimenti, debiti, ricorrenze e scadenze.
- [x] Protezioni di archiviazione e serializzazione delle scritture concorrenti.
- [x] Integrità dei collegamenti tra movimenti personali, spese condivise e rimborsi.
- [x] Protezione delle funzioni di membership e degli inviti.
- [x] Predicato degli spazi personali limitato al proprietario autenticato, con regressione contro l'enumerazione degli spazi altrui.
- [x] Scrittura delle spese condivise consentita solo tramite RPC validate.
- [x] Verifiche RLS, privilegi anonimi, isolamento e integrità per le aree finanziarie.
- [x] Test di concorrenza con sessioni PostgreSQL indipendenti.
- [x] Stack applicativo autonomo basato su React, TanStack Start, Supabase e Bun.
- [x] Rimozione dei metadati e dei riferimenti operativi della piattaforma precedente.
- [x] Rimozione di Drizzle: Supabase SQL è l'unica fonte autorevole per lo schema.
- [x] Lockfile Bun aggiornato e dipendenze Cloudflare Workers aggiunte.
- [x] Cloudflare Vite plugin integrato e Worker configurato con entrypoint personalizzato `src/server.ts`.
- [x] Bundle Cloudflare validato con `wrangler deploy --dry-run`, senza pubblicare l'applicazione.
- [x] Workflow manuale di deploy Cloudflare predisposto.
- [x] Script di backup cifrato con age e script di ripristino dati predisposti.
- [x] Workflow manuale per backup cifrati su Cloudflare R2 predisposto, con verifica del download byte-per-byte.
- [x] Separazione dei token Cloudflare tra deploy Worker e backup R2.
- [x] Documentata l'architettura a basso costo: Workers Paid, Supabase Free, R2 EU, Cloudflare Access e SMTP transazionale gratuito.
- [x] CLI Supabase fissata a una versione stabile nei workflow CI.
- [x] Pipeline frontend resa read-only e ampliata con controlli di compatibilità Worker e sintassi degli script operativi.

## Validazione tecnica

- [x] Frontend CI verde con Supabase CLI 3.1.0, Bun frozen install, formattazione, sintassi script backup/restore, ESLint, Vitest, build produzione e dry-run Cloudflare Worker.
- [x] Database CI verde con Supabase CLI 3.1.0: ricostruzione completa, isolamento spazi/membership, finanza personale, trasferimenti, spese condivise, scadenze, ricorrenze, investimenti/debiti e test di concorrenza.
- [x] Regressione aggiunta e verificata: un utente autenticato non può interrogare l'esistenza dello spazio personale di un altro utente.
- [x] La verifica è stata eseguita senza collegarsi a un database remoto e senza effettuare deploy.

## Lavori in corso

- [ ] Eseguire una revisione indipendente finale di trigger, policy RLS, grant, RPC e vincoli cross-space.
- [ ] Verificare il ripristino end-to-end su un progetto Supabase separato.

## Provisioning e rilascio

- [ ] Creare il progetto Supabase di produzione in una regione UE.
- [ ] Creare il Worker Cloudflare e attivare Cloudflare Access prima di inserire dati reali.
- [ ] Creare il bucket R2 con giurisdizione EU e lifecycle di 35 giorni.
- [ ] Configurare il mittente SMTP e testare registrazione, conferma email e recupero password.
- [ ] Generare la chiave age, conservarne la parte privata offline e configurare i segreti GitHub.
- [ ] Eseguire il primo backup remoto e verificare decifratura e integrità.
- [ ] Eseguire un ripristino completo su un progetto di prova.
- [ ] Attivare la schedulazione quotidiana dei backup dopo il primo test riuscito.
- [ ] Eseguire il deploy di staging e testare accessi, autorizzazioni e flussi finanziari.
- [ ] Completare revisione e approvazione del rilascio.
- [ ] Promuovere le modifiche a `main` solo dopo validazione completa e approvazione esplicita.

## Regole operative

- I dati finanziari restano a inserimento e aggiornamento manuale.
- Non introdurre sincronizzazioni bancarie senza approvazione esplicita.
- Non applicare migrazioni al database remoto durante sviluppo o CI.
- Ogni modifica al database deve essere accompagnata da test di regressione.
- Non eseguire deploy reali o backup su account remoti prima del provisioning e dell'approvazione.
- Non modificare `main` prima della conclusione della revisione e dell'approvazione del rilascio.
