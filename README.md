# Personal Finance

Applicazione web per la gestione delle finanze personali e delle spese condivise.

## Architettura

- **Frontend e server:** React, TanStack Start e Vite.
- **Database e autenticazione:** Supabase (PostgreSQL e Auth).
- **Sicurezza dei dati:** Row Level Security (RLS) e controlli lato server.
- **Migrazioni database:** file SQL versionati in `supabase/migrations/`.
- **Test database:** verifiche automatizzate in `supabase/tests/`, eseguite in CI su un'istanza Supabase locale.

L'applicazione è progettata per essere indipendente da uno specifico ambiente di sviluppo o hosting.

## Principi del progetto

- Inserimento e aggiornamento manuale dei dati finanziari.
- Separazione tra spazi personali e condivisi.
- Nessuna sincronizzazione bancaria automatica.
- Importi monetari memorizzati in centesimi interi.
- Le chiavi amministrative Supabase sono riservate esclusivamente al server e non devono mai essere inserite nel codice client o nel repository.

## Configurazione locale

Prerequisiti: Bun, Docker e Supabase CLI.

1. Clona il repository e installa le dipendenze:

   ```sh
   bun install --frozen-lockfile
   ```

2. Crea il file `.env` partendo da `.env.example` e configura le variabili richieste. Non condividere né versionare il file `.env`.

3. Avvia lo stack Supabase locale:

   ```sh
   supabase start
   supabase db reset
   ```

4. Avvia l'applicazione:

   ```sh
   bun run dev
   ```

## Comandi utili

```sh
bun run lint
bun run test
bun run build
```

## Database

Le migrazioni SQL ufficiali si trovano in `supabase/migrations/`. Per ricreare il database locale da zero si utilizza `supabase db reset`.

**Non applicare migrazioni direttamente al progetto Supabase remoto durante lo sviluppo o la validazione.** Le modifiche al database remoto devono essere eseguite solo dopo revisione, test locali e approvazione esplicita.

## Stato della migrazione

Il ramo `migration/standalone-stack` contiene il lavoro per rendere il progetto indipendente dall'ambiente Lovable. Il ramo `main` e il vecchio ambiente cloud devono restare intatti fino al completamento della validazione e all'approvazione del passaggio.
