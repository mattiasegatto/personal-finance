# Hosting, costi e protezione dei dati

## Decisione architetturale proposta

Per mantenere la spesa ricorrente bassa senza gestire un server PostgreSQL autonomamente:

- **Applicazione:** Cloudflare Workers, con TanStack Start tramite il plugin Vite ufficiale di Cloudflare.
- **Database e autenticazione:** Supabase, progetto collocato in una regione UE.
- **Backup fuori dal database:** Cloudflare R2, bucket con giurisdizione UE.
- **Cifratura backup:** age, prima del caricamento su R2.
- **CI e backup pianificati:** GitHub Actions.
- **Email transazionali:** Brevo Free via SMTP per conferme account e recupero password.
- **Accesso:** Supabase Auth per gli account applicativi; Cloudflare Access può aggiungere una lista di email autorizzate davanti all'app.

Questa configurazione evita un VPS da amministrare e non introduce sincronizzazioni bancarie o servizi non necessari.

## Stima dei costi

Valori in USD, prima di IVA, cambio e dominio. Verificare i prezzi prima di attivare i servizi.

| Servizio | Piano previsto | Costo base |
|---|---|---:|
| Cloudflare Workers | Paid, consigliato per SSR | $5/mese |
| Supabase | Free | $0/mese |
| Cloudflare R2 | Free, entro le quote | $0/mese |
| Cloudflare Access | Free, fino a 50 utenti | $0/mese |
| Email Auth | Brevo Free, fino a 300 email/giorno | $0/mese |
| GitHub Actions | Quote incluse nel piano GitHub | $0 aggiuntivi previsti |
| Dominio personalizzato | Da acquistare solo se necessario | Variabile |

Il piano Workers Paid include 10 milioni di richieste e 30 milioni di millisecondi CPU al mese; il consumo oltre le quote è tariffato a parte. Il piano Free ha un limite di 10 ms CPU per invocazione: per un'applicazione SSR è prudente non basare il rilascio su quel limite.

Supabase Free include 500 MB di database e 5 GB di egress, ma può mettere in pausa un progetto dopo una settimana di attività insufficiente e non offre backup automatici. Per questo il backup esterno è una condizione necessaria, non un optional.

R2 include 10 GB-mese di storage Standard, 1 milione di operazioni Class A e 10 milioni Class B. Per un database personale i backup dovrebbero restare ampiamente sotto queste soglie, ma il consumo va controllato.

Supabase Pro costa $25/mese e include backup giornalieri con retention di 7 giorni. È l'alternativa più semplice, ma supera il budget economico che abbiamo fissato. Non è il piano iniziale proposto.

Fonti ufficiali:
- https://developers.cloudflare.com/workers/platform/pricing/
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://developers.cloudflare.com/r2/pricing/
- https://www.cloudflare.com/sase/products/access/

## Dati e collocazione geografica

1. Creare il progetto Supabase in una regione UE, preferibilmente vicina agli utenti.
2. Creare il bucket R2 selezionando esplicitamente la giurisdizione **EU**. La giurisdizione non può essere cambiata dopo la creazione del bucket.
3. I backup vengono cifrati lato client prima del caricamento. R2 applica inoltre la propria cifratura a riposo.
4. Cloudflare Workers è una piattaforma edge: l'elaborazione delle richieste può avvenire in diverse località. La collocazione UE di database e backup non equivale a una garanzia che ogni trattamento applicativo avvenga esclusivamente nell'UE.

Per i riferimenti:
- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/

## Email di autenticazione

L'app usa registrazione email/password, conferma dell'indirizzo e recupero password. In produzione è quindi necessario configurare SMTP personalizzato in Supabase Auth.

Il server SMTP predefinito di Supabase è soltanto per test: invia solo agli indirizzi del team dell'organizzazione e attualmente è limitato a 2 email/ora. Non è adatto agli inviti e agli utenti reali.

Per mantenere i costi a zero propongo **Brevo Free**:
- include email transazionali;
- consente fino a 300 invii al giorno nel piano gratuito;
- supporta SMTP e viene indicato da Supabase tra i provider compatibili.

Configurazione prevista:
1. Creare un account Brevo.
2. Verificare il dominio mittente e pubblicare i record DNS SPF/DKIM richiesti.
3. Generare le credenziali SMTP.
4. Inserire host, porta, utente, password e indirizzo mittente in Supabase Dashboard → Authentication → SMTP Settings.
5. Testare registrazione, conferma email, recupero password e inviti con gli indirizzi effettivi.

Il costo previsto è $0/mese entro il limite gratuito. Se il dominio non è già disponibile, resta da aggiungere il suo costo annuale.

Fonti:
- https://supabase.com/docs/guides/auth/auth-smtp
- https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan
- https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans

## Protezione dell'accesso

L'applicazione mantiene Supabase Auth e le autorizzazioni RLS già implementate. Per limitare ulteriormente l'accesso all'interfaccia a persone scelte:

1. Collegare un dominio al Worker.
2. Attivare Cloudflare Access per l'hostname dell'applicazione.
3. Abilitare One-time PIN come metodo di autenticazione.
4. Creare una policy Allow con le sole email autorizzate; non usare una regola che consenta genericamente qualsiasi indirizzo.
5. Mantenere anche l'autenticazione Supabase dell'applicazione: Access è un ulteriore cancello, non sostituisce utenti, spazi e permessi applicativi.

Cloudflare Access Free è indicato per meno di 50 utenti. La protezione con Access richiede un hostname/dominio configurato; il costo del dominio, se non già disponibile, è separato.

## Variabili e segreti

Per ridurre i privilegi, usare token Cloudflare distinti per deploy del Worker e scrittura dei backup R2. Non riutilizzare lo stesso token per entrambe le operazioni.

### Variabili pubbliche di build

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Servono al bundle browser. La publishable key è pubblica per definizione e la sicurezza dipende da RLS e dalle policy del database.

### Segreti del Worker

Configurare questi valori come Worker secrets/variables nella dashboard Cloudflare, non nel repository:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`, solo se necessaria alle operazioni amministrative server-side
- `CRON_SECRET`, se vengono attivate route pianificate protette

La service role key non deve mai essere inserita nel bundle browser, in `wrangler.jsonc`, in Git o in una variabile pubblica.

### GitHub Actions: deploy

Secret:
- `CLOUDFLARE_DEPLOY_API_TOKEN`: permessi Workers Scripts Edit e Account Settings Read; aggiungere Zone Read solo se necessario per la configurazione del dominio.

Variables:
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

### GitHub Actions: backup

Secrets:
- `SUPABASE_DB_URL`: connection string del Session Pooler, con password URL-encoded e SSL.
- `CLOUDFLARE_R2_API_TOKEN`: permesso R2 Object Read & Write limitato al bucket dei backup.

Variables:
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `AGE_RECIPIENT`

## Backup automatico

Il repository contiene un workflow manuale predisposto per produrre un backup cifrato e caricarlo su R2. Non è ancora schedulato: prima devono esistere il progetto Supabase, il bucket R2 e i relativi segreti GitHub.

Il backup comprende:

- dati applicativi dello schema `public`;
- utenti e identità di autenticazione (`auth.users` e `auth.identities`), inclusi gli hash password;
- file SQL delle migrazioni e configurazione database;
- manifest con data e commit Git di riferimento.

Le sessioni di autenticazione non vengono esportate: dopo un ripristino gli utenti dovranno effettuare nuovamente l'accesso. Non vengono inclusi file caricati via Storage API; al momento l'applicazione non dipende da file utente per i dati finanziari.

La CLI Supabase esclude intenzionalmente gli schemi gestiti `auth` e `storage` dal proprio dump. Per questo il workflow esporta separatamente utenti e identità con `pg_dump`. Il client PostgreSQL usato per questo passaggio deve essere compatibile con la versione major del database Supabase; il workflow è attualmente impostato su PostgreSQL 17 e andrà adeguato se il progetto viene creato con una major differente.

Generazione della coppia di chiavi su un computer affidabile:

```sh
age-keygen -o personal-finance-backup-key.txt
age-keygen -y personal-finance-backup-key.txt
```

Il secondo comando stampa il destinatario pubblico da inserire nella variabile GitHub `AGE_RECIPIENT`. La chiave privata nel file `personal-finance-backup-key.txt` deve essere conservata offline o in un password manager. Non va caricata su GitHub, Cloudflare o nel repository. Senza la chiave privata il backup cifrato non è recuperabile.

Dopo aver creato il bucket, configurare una regola di lifecycle per eliminare gli oggetti sotto `backups/daily/` dopo 35 giorni. Prima di abilitare una schedulazione quotidiana, eseguire almeno un backup manuale e verificarne il download e la decifratura.

## Ripristino

Il ripristino non è considerato verificato finché non viene provato su un progetto Supabase separato.

Procedura prevista:

1. Creare un nuovo progetto Supabase nella stessa regione UE e con una versione PostgreSQL compatibile.
2. Recuperare il backup da R2 e decifrarlo con la chiave privata age conservata offline, quindi estrarre l'archivio. Il file cifrato non va mai allegato a ticket o condiviso pubblicamente.
3. Se `roles.sql` contiene ruoli personalizzati, importarli nel nuovo progetto prima delle migrazioni. Al momento il progetto non definisce ruoli PostgreSQL personalizzati.
4. Applicare le migrazioni versionate nel backup al nuovo progetto con `supabase link` e `supabase db push`.
5. Impostare `NEW_DB_URL` con la connection string del nuovo progetto e importare prima `auth-users.sql` e poi `data.sql` con `bash scripts/restore-database-backup.sh <directory-backup>`. Lo script usa una transazione e disabilita temporaneamente i trigger durante l'importazione, così da non duplicare profili e spazi personali.
6. Verificare accesso degli utenti, profili, spazi, conti, movimenti, saldi, trasferimenti e spese condivise.
7. Ruotare i segreti e aggiornare le variabili del Worker prima di riaprire l'applicazione.


Non eseguire un ripristino sul database attivo senza una copia preventiva e una verifica della destinazione.

Riferimenti:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Stato operativo

- [x] Configurazione di build Cloudflare Workers aggiunta al branch.
- [x] Dipendenze e comandi di deploy predisposti.
- [x] Workflow di backup cifrato predisposto per esecuzione manuale.
- [ ] Creare gli account e il progetto Supabase di produzione.
- [ ] Creare il bucket R2 in giurisdizione UE e configurare lifecycle.
- [ ] Generare e conservare offline la chiave privata age.
- [ ] Configurare SMTP Brevo e testare tutti i flussi email.
- [ ] Configurare i segreti e le variabili GitHub/Cloudflare.
- [ ] Eseguire il primo backup reale e verificarne la decifratura.
- [ ] Eseguire un ripristino completo su un progetto di prova.
- [ ] Attivare il backup quotidiano e il deploy solo dopo le verifiche.
- [ ] Configurare dominio e Cloudflare Access con la lista delle email autorizzate.
