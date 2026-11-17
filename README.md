# Personal Finance

Applicazione web per la gestione delle finanze personali e delle spese condivise.

## Architettura

- **Frontend e server:** React, TanStack Start, TanStack Router e Vite.
- **Database e autenticazione:** Supabase (PostgreSQL e Auth).
- **Sicurezza:** Row Level Security (RLS), controlli server-side, trigger e funzioni RPC.
- **Migrazioni database:** file SQL versionati in `supabase/migrations/`.
- **Test database:** verifiche automatizzate in `supabase/tests/`, eseguite in CI su uno stack Supabase locale.

L'applicazione è autonoma rispetto a qualsiasi specifico ambiente di sviluppo o hosting.

## Principi del progetto

- Inserimento e aggiornamento manuale dei dati finanziari.
- Separazione tra spazi personali e condivisi.
- Nessuna sincronizzazione bancaria automatica.
- Importi monetari memorizzati in centesimi interi.
- I saldi dei conti sono derivati dai movimenti.
- Le chiavi amministrative Supabase sono riservate esclusivamente al server e non devono mai essere inserite nel codice client o nel repository.

## Configurazione locale

Prerequisiti: Git, Docker, Bun **e Node.js LTS**. La Supabase CLI si usa con `bunx`, alla stessa versione fissata nella CI (3.1.0).

Node.js è necessario anche se si usa Bun: il plugin Cloudflare per Vite avvia Miniflare, che sotto il runtime Bun fallisce con `ECONNREFUSED`. Con Node.js installato, `bun run dev` esegue Vite con Node.

1. Clona il branch di sviluppo e installa le dipendenze:

   ```sh
   git clone -b migration/standalone-stack https://github.com/mattiasegatto/personal-finance.git
   cd personal-finance
   bun install --frozen-lockfile
   ```

2. Avvia lo stack Supabase locale (con Docker in esecuzione) e ricrea il database dalle migrazioni:

   ```sh
   bunx supabase@3.1.0 start
   bunx supabase@3.1.0 db reset
   ```

3. Crea `.env.local` con l'URL e la chiave _publishable_ stampati da `supabase start` (chiavi locali di sviluppo, mai quelle di produzione). Il file è escluso da git.

   ```sh
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Se il browser non può raggiungere un'altra porta locale (ad esempio un browser integrato che blocca le richieste verso origini diverse), attiva il proxy di sviluppo di Vite: il browser parla solo con la porta 5173 e Vite inoltra a Supabase.

   ```sh
   SUPABASE_DEV_PROXY_TARGET=http://127.0.0.1:54321
   VITE_SUPABASE_URL=http://localhost:5173/__supabase
   ```

4. Avvia l'applicazione su http://localhost:5173 (dopo ogni modifica a `.env.local` riavviala):

   ```sh
   bun run dev
   ```

### Windows

Installazione dei prerequisiti da PowerShell:

```powershell
winget install Git.Git
winget install Docker.DockerDesktop
winget install OpenJS.NodeJS.LTS
powershell -c "irm bun.sh/install.ps1 | iex"
```

Docker Desktop richiede WSL2. Dopo l'installazione riapri PowerShell e verifica `git --version`, `docker --version`, `node --version` e `bun --version`. Gli avvisi di `supabase start` su Analytics e sulla disponibilità di una CLI più recente si possono ignorare.

## Hosting

L'applicazione è predisposta per Cloudflare Workers tramite il plugin Vite ufficiale per TanStack Start. La configurazione si trova in `wrangler.jsonc`.

Per verificare localmente il bundle Cloudflare senza pubblicarlo:

```sh
bun run build
bunx wrangler deploy --dry-run
```

Per pubblicare manualmente, dopo aver configurato account, token e segreti:

```sh
bun run deploy
```

Il deploy non viene eseguito automaticamente. Il workflow manuale `.github/workflows/cloudflare-deploy.yml` è predisposto ma richiede le variabili GitHub e i segreti del Worker.

Le istruzioni per hosting, costi, Access, backup cifrati e ripristino sono in [Hosting e backup](docs/operations/hosting-and-backups.md).

## Comandi utili

```sh
bun run lint
bun run test
bun run build
```

## Database

Le migrazioni SQL ufficiali si trovano esclusivamente in `supabase/migrations/`. Per ricreare il database locale da zero si utilizza `supabase db reset`.

**Non applicare migrazioni direttamente al progetto Supabase remoto durante lo sviluppo o la validazione.** Le modifiche al database remoto devono essere eseguite solo dopo revisione, test locali e approvazione esplicita.

## Branch e rilascio

Il branch operativo corrente è `migration/standalone-stack`. Il branch `main` resta invariato fino al completamento della revisione, della validazione e all'approvazione esplicita del rilascio.
