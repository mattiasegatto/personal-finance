# Fase 3A — Specifica tecnica definitiva: trasferimenti tra conti personali

Documento progettuale. Nessun file, schema, dato o test è stato modificato o eseguito.

## A. Stato attuale verificato (lettura repository, 7 nov 2026)

- Migrazioni presenti: 0000–0005, invariate rispetto al report precedente.
- `transactions` (0002): `category_id uuid NOT NULL` con FK a `categories`; `amount_cents > 0`; `operation_type tx_operation` con solo `ordinary`; nessun DELETE concesso.
- Privilegi (0002/0005): `authenticated` ha SELECT/INSERT/UPDATE su `transactions`, solo SELECT su `transaction_revisions`; tutto revocato ad `anon` e `public`.
- `guard_transaction()` (0004, SECURITY DEFINER): impone stesso spazio, conto non archiviato, categoria coerente con la direzione; blocca modifiche a movimenti eliminati. Richiede sempre una categoria.
- `log_transaction()` (AFTER INSERT/UPDATE): una revisione per riga (insert/update/delete).
- `account_balances` (security_invoker): saldo iniziale + entrate − uscite non eliminate. Somma tutte le direzioni, quindi i trasferimenti sarebbero già corretti nei saldi.
- Pagina Movimenti: i totali Entrate/Uscite sommano ogni riga → andranno esclusi i trasferimenti.
- Dashboard: usa ancora dati dimostrativi, nessun calcolo dal database da adattare.
- Non verificabile in sola lettura: esecuzione dei test SQL multiutente (richiedono la creazione di utenti di prova).

## B. Architettura proposta (confermata con una semplificazione)

- `transfers` (testata): id, space_id, source_account_id, destination_account_id, amount_cents (>0), occurred_on, description, created_by, deleted_at, timestamp. CHECK `source <> destination`.
- `transfer_transaction_links`: `transaction_id` PK (unicità globale), `transfer_id` FK `ON DELETE RESTRICT`, `role` enum `transfer_leg_role ('source','destination')`, UNIQUE `(transfer_id, role)`.
- Le gambe restano righe di `transactions` con `operation_type = 'transfer'` e `category_id NULL`.
- **Semplificazione raccomandata:** la testata NON memorizza `source_transaction_id`/`destination_transaction_id`. La tabella dei collegamenti è l'unica fonte del legame: elimina alla radice la possibilità di divergenza testata↔link. Il ruolo `fee` non viene creato (commissioni escluse).

## C. Integrità

**Vincoli dichiarativi:** PK globale su `transaction_id`; UNIQUE `(transfer_id, role)` → al massimo una source e una destination; CHECK conti distinti; FK RESTRICT.
**Non garantibile in modo dichiarativo:** "esattamente due gambe" e coerenza tra righe di tabelle diverse.

**Constraint trigger `DEFERRABLE INITIALLY DEFERRED`** (funzione unica `check_transfer_integrity`), su:
- `transfers` AFTER INSERT/UPDATE;
- `transfer_transaction_links` AFTER INSERT/UPDATE/DELETE;
- `transactions` AFTER INSERT/UPDATE quando `operation_type = 'transfer'`.

Al commit, per ogni trasferimento toccato verifica: esattamente 2 link (source+destination); gamba source = `outflow` sul conto sorgente, destination = `inflow` sul conto destinazione; stesso spazio, importo, data, descrizione della testata; valute dei conti uguali; spazio personale; `deleted_at` delle gambe uguale a quello della testata. Inoltre: ogni movimento `transfer` deve avere un link (niente gambe orfane). Errore → rollback dell'intera transazione. Il differimento consente alla RPC di inserire testata, gambe e link in qualsiasi ordine.
Limite noto: un client potrebbe impostare `SET CONSTRAINTS ... IMMEDIATE`, che anticipa il controllo ma non lo disattiva — sicuro.

**RPC (logica, non SQL):**
- `create_transfer(source, destination, amount, date, description)`: valida, inserisce testata, due gambe, due link; ritorna id.
- `update_transfer(id, source, destination, amount, date, description)`: blocca la testata (`FOR UPDATE`), aggiorna testata e entrambe le gambe nella stessa transazione.
- `delete_transfer(id)`: soft-delete di testata e due gambe con lo stesso istante; link conservati.

## D. Sicurezza

**Privilegi:**
- `transactions`: invariati per `authenticated` (SELECT/INSERT/UPDATE) per non rompere i movimenti ordinari.
- `transfers`, `transfer_transaction_links`: solo SELECT ad `authenticated`; nessun privilegio ad `anon`/`public`; `service_role` completo. Nessuna policy INSERT/UPDATE/DELETE.
- RPC: `REVOKE EXECUTE FROM public, anon`; `GRANT EXECUTE TO authenticated`.

**RLS:** SELECT su testata e link se `is_space_member(space_id, auth.uid())` (il link legge lo spazio tramite la testata o una colonna `space_id` ridondante verificata dal trigger differito).

**Protezione delle gambe senza GUC — meccanismo proposto:**
Nuovo trigger **SECURITY INVOKER** `guard_transfer_leg` (BEFORE INSERT/UPDATE su `transactions`). Rifiuta l'operazione se riguarda una riga `transfer` (vecchia o nuova, o presente nei link) e `current_user` è `authenticated` o `anon`.
Perché non è falsificabile: le RPC sono SECURITY DEFINER, quindi le istruzioni eseguite al loro interno girano con il ruolo proprietario; un client via API gira sempre come `authenticated` e non può cambiare ruolo (non ha privilegi `SET ROLE`). Il trigger deve essere INVOKER: dentro un trigger DEFINER `current_user` sarebbe sempre il proprietario e il controllo sarebbe inutile.
Blocca: cambio importo, conto, direzione, data, categoria, soft-delete diretto, conversione ordinary↔transfer, inserimento diretto di gambe.

**Controlli nelle RPC:** `SET search_path = public, pg_temp`; nomi qualificati; `auth.uid()` non nullo; ruolo owner/member tramite `has_space_role`; entrambi i conti nello spazio, personale, non archiviati, stessa valuta; importo > 0; proprietario della funzione senza esposizione di parametri dinamici (nessun SQL dinamico).

**`guard_transaction()` adattato:** se `operation_type = 'transfer'` richiede `category_id IS NULL` e salta i controlli di categoria; se `ordinary` richiede categoria come oggi.

## E. Compatibilità

- `category_id` diventa nullable + CHECK `(operation_type = 'transfer') = (category_id IS NULL)`: nessun movimento ordinario senza categoria, nessun trasferimento con categoria.
- Enum: `ALTER TYPE tx_operation ADD VALUE 'transfer'` in migrazione separata (il nuovo valore non è usabile nella stessa transazione).
- Audit: invariato; ogni gamba produce le sue revisioni. Le revisioni si collegano alla testata tramite il link (nessun nuovo sistema). Rollback della transazione → nessuna revisione parziale.
- Saldi: `account_balances` invariata, già corretta.
- Pagina Movimenti: totali escludono `transfer`; righe con badge "Trasferimento" e conto controparte; pulsanti Modifica/Elimina aprono il dialog trasferimento; filtro tipo (ordinari/trasferimenti); filtro categoria esclude i trasferimenti.
- Categorie: l'eliminazione/archiviazione non è influenzata (i trasferimenti non usano categorie).

## F. Rollback

- **Disattivazione funzionale** (preferita): revoca EXECUTE sulle RPC e nasconde il pulsante; dati e storico intatti.
- **Rollback dati:** nessuna cancellazione fisica. Opzione: soft-delete di tutti i trasferimenti attivi via `delete_transfer` (saldi ripristinati, storico conservato).
- **Rollback schema** (solo se zero trasferimenti mai creati): rimuovere RPC, trigger, policy, tabelle, ripristinare `guard_transaction` e `NOT NULL`. Se esistono gambe storiche il `NOT NULL` non può tornare: si mantiene il CHECK.
- **Enum:** il valore `transfer` resta (PostgreSQL non rimuove valori senza ricreare il tipo); innocuo.
- Controlli preliminari: conteggio trasferimenti/gambe, backup, verifica saldi prima/dopo.

## G. Piano di test (da eseguire in implementazione)

| Area | Scenario | Atteso | Controllo | Livello |
|---|---|---|---|---|
| Integrità | Trasferimento valido | 2 gambe, saldi corretti | RPC + trigger differito | DB/RPC |
| Integrità | Una gamba / nessuna gamba | Rifiuto al commit | Trigger differito | DB |
| Integrità | Doppia source/destination | Rifiuto | UNIQUE | DB |
| Integrità | Importi, valute, direzioni diversi | Rifiuto | Trigger differito / RPC | DB |
| Integrità | Stesso conto / spazi diversi | Rifiuto | CHECK / RPC | DB |
| Sicurezza | Utente non membro o viewer | Rifiuto | RPC `has_space_role` | RPC |
| Sicurezza | Insert/update diretto su testata o link | Permesso negato | Grant + RLS | RLS |
| Sicurezza | Update diretto importo/conto/data di una gamba | Rifiuto | `guard_transfer_leg` | DB |
| Sicurezza | Soft-delete diretto di una gamba | Rifiuto | `guard_transfer_leg` | DB |
| Sicurezza | Inserire riga `transfer` via API / convertire ordinary | Rifiuto | `guard_transfer_leg` + CHECK | DB |
| Sicurezza | Anonimo legge/chiama RPC | Negato | Revoke | RLS |
| Sicurezza | Altro utente legge trasferimenti | 0 righe | RLS | RLS |
| Audit | Create/update/delete | 2 revisioni per operazione | `log_transaction` | DB |
| Audit | Errore a metà RPC | Nessuna riga, nessuna revisione | Transazione | DB |
| Compat. | Movimento ordinario senza categoria | Rifiuto | CHECK | DB |
| Compat. | Entrate/uscite ordinarie | Invariate | Test esistenti | DB |
| Compat. | Totali e filtri Movimenti | Trasferimenti esclusi | Codice pagina | Frontend |
| Compat. | Archiviazione conto con trasferimenti | Solo a saldo zero | `guard_account` | DB |

Test SQL in transazione annullata (`supabase/tests/transfer_isolation.sql`), Vitest per esclusione dai totali, Playwright con dati fittizi poi annullati.

## H. Piano di implementazione

1. **Enum** — migrazione con solo `ADD VALUE 'transfer'`. Fatto: valore presente. Rollback: nessuno necessario.
2. **Schema** — tabelle, CHECK, nullable categoria, indici, grant, RLS. Test: privilegi e RLS.
3. **Protezione** — `guard_transaction` adattato, `guard_transfer_leg`, trigger differito. Test: modifiche dirette rifiutate.
4. **RPC** — tre funzioni con grant puntuali. Test: matrice integrità/audit.
5. **Frontend** — dialog trasferimento, badge, filtri, esclusione dai totali in `movimenti.tsx`; query estesa in `finance.ts`. Test: Vitest + browser.
6. **Verifica finale** — 18 test esistenti + nuovi, linter, aggiornamento `AGENTS.md` e roadmap.
Ogni passo richiede il precedente; rischi principali: regressioni nei movimenti ordinari (mitigato dai test esistenti).

## I. Decisioni richieste

1. Approvare la rimozione degli ID gambe dalla testata (link come unica fonte), oppure mantenerli con controllo differito di coerenza.
2. Approvare il meccanismo `current_user` + trigger INVOKER come protezione delle gambe.
3. Le gambe di un conto archiviato: ammettere la modifica/annullamento di trasferimenti storici che coinvolgono un conto archiviato? (Proposta: no, come per i movimenti ordinari.)

## J. Conclusione

1. Sì, la specifica è pronta per l'approvazione.
2. Incerto finché non testato: comportamento effettivo di `current_user` nei trigger con il ruolo proprietario in Lovable Cloud; esecuzione dei test multiutente.
3. Indispensabili: categoria nullable con CHECK, enum, trigger differito, protezione delle gambe, esclusione dai totali.
4. Rischi residui: chi ha privilegi di servizio aggira i controlli applicativi (ma non il trigger differito); il valore enum resta permanentemente.
