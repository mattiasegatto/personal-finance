# Fase 3A — Passo 0: rapporto sulla verifica della protezione delle gambe

## 1. Modifiche effettuate
Nessuna. Repository, database e dati invariati. Eseguite solo letture del catalogo del database.

## 2. Test eseguiti (sola lettura)

**Test 5 — Ruoli e privilegi** (eseguito, letture del catalogo):
- `postgres` (proprietario di tutte le funzioni pubbliche): non superuser, BYPASSRLS = sì.
- `authenticated`, `anon`: non superuser, nessun BYPASSRLS, **non sono membri di alcun ruolo**. Il rapporto è inverso: `postgres` e `authenticator` sono membri di `authenticated`/`anon`/`service_role`. Quindi un client autenticato non può assumere i privilegi di `postgres`.
- `service_role`: BYPASSRLS = sì (solo lato server, mai nel browser).
- `transactions` e `accounts`: RLS attiva, FORCE RLS disattivata (il proprietario la aggira, come previsto per le RPC).
- Trigger su `transactions`: `transactions_guard` e `transactions_log`, entrambi SECURITY DEFINER. Eseguibili solo da `postgres` e `service_role`.
- I privilegi di tabella per ruolo non sono visibili al ruolo di sola lettura usato per l'ispezione: restano quelli dichiarati nelle migrazioni 0002/0005 (non riconfermati ora sul database).

## 3. Test non eseguiti e motivo
- **Test 1** (identità vista da un trigger INVOKER in modifica diretta), **Test 2** (identità vista tramite RPC DEFINER), **Test 3** (RPC con utente non autorizzato), **Test 4** (policy RLS su righe di trasferimento): non eseguibili senza creare almeno una funzione e un trigger. Lo strumento di sola lettura non può creare oggetti né eseguire funzioni. Non sostituisco queste prove con deduzioni.

## 4. Evidenze
Solo quelle del Test 5 sopra. Nessun valore reale di `current_user` dentro un trigger è stato ancora osservato.

## 5. Valutazione (provvisoria)
- RLS: la struttura dei ruoli permette la policy proposta; efficacia sulle righe di trasferimento non provata.
- Trigger INVOKER + `current_user`: compatibile con i ruoli osservati; comportamento effettivo non provato.
- RPC DEFINER: girerebbero come `postgres` con BYPASSRLS → devono verificare tutto esplicitamente.
- Punto debole noto: `service_role` aggira la RLS; il trigger deve bloccarlo esplicitamente.

## 6. Conclusione
**Sicurezza non verificata** (solo i prerequisiti sui ruoli sono confermati).

## 7. Prossimo passo proposto — richiede la tua autorizzazione
Test isolato con oggetti temporanei, in uno schema separato `phase0_probe`, senza toccare tabelle finanziarie:
1. Creazione (una modifica al database): tabella fittizia `probe_rows(id, kind)` con RLS e grant a `authenticated`; trigger INVOKER che registra `current_user` in una tabella `probe_log` e rifiuta `kind='transfer'` se il ruolo è `authenticated`/`anon`/`service_role`; funzione DEFINER che modifica una riga `transfer`; policy RLS che consente a `authenticated` solo righe `ordinary`.
2. Esecuzione, in transazioni annullate con dati fittizi: modifica diretta come `authenticated` (riga ordinary e transfer), chiamata alla funzione, chiamata senza autorizzazione, come `service_role`. Si leggono i valori registrati di `current_user`.
3. Rimozione completa dello schema `phase0_probe` con una seconda modifica, e verifica che non resti nulla.
- Reversibile: sì (schema separato, rimosso al termine; restano solo le due voci nello storico delle migrazioni).
- Privilegi richiesti: quelli del proprietario delle migrazioni (`postgres`).
- Limite: l'esecuzione come `authenticated` potrà richiedere la sessione di prova dal browser/API, se lo strumento non consente di impersonare il ruolo.

Approvando questo piano autorizzi solo il test temporaneo sopra; nessuno schema, RPC o interfaccia della Fase 3A.
