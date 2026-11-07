# Fase 3A — Passo 0: chiarimenti prima del test

Conferma: nessuna modifica eseguita. Repository, database, migrazioni e dati invariati.

## 1. Reversibilità — procedura rivista (nessun effetto permanente)

La proposta precedente (crea schema → testa → rimuovi) avrebbe lasciato due voci nello storico delle migrazioni: "creazione probe" e "rimozione probe". **Non sono necessarie.** Sostituisco la procedura con una migliore:

- Un'unica esecuzione tramite lo strumento migrazioni, il cui SQL è un solo blocco che crea gli oggetti di prova, esegue tutti i casi, raccoglie i valori osservati e **termina sempre con un errore intenzionale** contenente i risultati (stesso schema già usato nei test SQL: "ALL_PASSED"/"RESULT: …").
- PostgreSQL esegue la migrazione in una transazione: l'errore finale annulla tutto (schema, tabelle, funzioni, trigger, policy, grant, righe fittizie). Lo strumento dichiara che, in caso di errore, file e voce di storico vengono rimossi e nulla viene applicato.
- Effetti permanenti attesi: nessuno. Verifica dopo il test, in sola lettura: assenza dello schema `phase0_probe` e di funzioni con quel nome; storico delle migrazioni ancora a 6 voci (0000–0005); nessun nuovo file in `drizzle/migrations`.
- Lo schema finanziario esistente (`transactions`, `accounts`, ecc.) non viene toccato né letto in scrittura.
- Rischio residuo: se lo strumento non riportasse il testo dell'errore, i valori osservati andrebbero persi (ma senza effetti sul database); in tal caso lo dichiarerei e non dedurrei nulla.

## 2. Oggetti creati (solo dentro la transazione annullata)

- Schema `phase0_probe`.
- Tabella `probe_rows(id, kind text check in ('ordinary','transfer'), note)` con RLS attiva; grant SELECT/INSERT/UPDATE a `authenticated`; policy: `authenticated` vede/modifica solo righe `ordinary`.
- Tabella `probe_log(caso, current_user, session_user, esito)`.
- Tabella `probe_members(user_id)` che simula l'appartenenza allo spazio.
- Funzione trigger **SECURITY INVOKER** `probe_guard()`: registra `current_user`; rifiuta righe `transfer` se `current_user` ∈ {authenticated, anon, service_role}.
- Funzione **SECURITY DEFINER** `probe_rpc_update(id)` (proprietario `postgres`, `search_path` fisso): verifica che `auth.uid()` sia in `probe_members`, poi modifica una riga `transfer`. EXECUTE revocato a public/anon, concesso a `authenticated`.
- Due righe fittizie: una `ordinary`, una `transfer`. Nessun dato finanziario.

## 3. I quattro casi

Il ruolo si imposta con `SET LOCAL ROLE` (consentito: `postgres` è membro di `authenticated` e `service_role`, verificato) e l'identità utente con `request.jwt.claims` fittizi, come fa l'API dopo l'autenticazione. Ogni caso gira in un sotto-blocco che cattura l'errore.

| Caso | Ruolo usato | `current_user` atteso nel trigger | Esito atteso | Come si verifica |
|---|---|---|---|---|
| A. UPDATE diretto riga `transfer` | authenticated | authenticated | Rifiutato (prima dalla RLS: 0 righe; poi, con policy disattivata nel sottocaso A2, dal trigger) | Conteggio righe modificate + errore catturato + riga in `probe_log` |
| A1. UPDATE diretto riga `ordinary` | authenticated | authenticated | Consentito | Valore modificato riletto |
| B. RPC autorizzata | authenticated (utente in `probe_members`) | postgres | Consentito | Riga `transfer` modificata riletta; `probe_log` registra `postgres` |
| C. UPDATE diretto riga `transfer` | service_role | service_role | Rifiutato dal trigger (la RLS è aggirata) | Errore catturato + log |
| D. RPC da utente non membro | authenticated (sub non presente) | — (il trigger non deve scattare) | Rifiutato dalla RPC | Errore catturato, riga invariata |
| D2. RPC da anonimo | anon | — | Permesso negato (nessun EXECUTE) | Errore catturato |

I valori in colonna "atteso" sono teorici; il rapporto riporterà solo i valori effettivamente letti da `probe_log`. La prova che la protezione non blocca la RPC è il caso B: stessa riga, stesso trigger attivo, modifica riuscita.

Limite dichiarato: il test simula la sessione con `SET ROLE` + claims, non passa dall'API reale. Il percorso API produce lo stesso ruolo finale, ma questa equivalenza va confermata dopo l'implementazione con un test dal browser con account di prova.

## 4. Requisiti del test

- Creazione schema, funzioni, trigger, policy, grant: sì, ma solo dentro la transazione annullata.
- Modifica dei privilegi esistenti: no.
- Sessione autenticata dal browser/API: no per il Passo 0.
- Modifiche allo storico migrazioni: no (salvo malfunzionamento dello strumento, verificato dopo).

## 5. Conferma
Nessuna modifica è stata eseguita. Approvando autorizzi solo l'esecuzione del test annullato descritto sopra e le successive verifiche in sola lettura; poi mi fermo con il rapporto.
