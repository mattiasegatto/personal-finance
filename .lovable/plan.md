# Fase 3A — Passo 0: procedura aggiornata del test isolato

Conferma: nessuna modifica eseguita. Repository, database, migrazioni e dati invariati.

## 1. Procedura aggiornata

Invariata nella forma: un unico blocco eseguito tramite lo strumento migrazioni, che crea gli oggetti di prova nello schema `phase0_probe`, esegue i casi e termina **sempre** con un errore intenzionale che contiene il rapporto. Tutto viene annullato; tabelle finanziarie, policy e privilegi esistenti non vengono toccati. Dopo, verifica in sola lettura che lo schema non esista e che lo storico migrazioni sia invariato (6 voci).

Modifica rispetto alla versione precedente: **non si usa più `probe_log` come prova dei rifiuti** e la policy non viene mai disattivata (vedi sotto).

## 2. Raccolta delle evidenze

Hai ragione: ogni caso gira in un sotto-blocco `BEGIN … EXCEPTION`, che PostgreSQL implementa come savepoint. Se il trigger rifiuta, tutto ciò che è stato scritto in quel sotto-blocco — compresa un'eventuale riga di log — viene annullato. Il log non sopravvive.

Le evidenze vengono quindi raccolte così:
- **Operazione rifiutata dal trigger:** il trigger solleva un errore con codice dedicato `P0901` e messaggio `PROBE_GUARD current_user=<valore> session_user=<valore>`. Il gestore del sotto-blocco legge `SQLSTATE` e `SQLERRM` e li accoda a una variabile di testo del blocco esterno. Le variabili PL/pgSQL non sono soggette al rollback del savepoint, quindi l'evidenza sopravvive.
- **Operazione consentita:** il trigger scrive `current_user` nella colonna `seen_by` della riga stessa; il blocco rilegge la riga e il numero di righe modificate (`ROW_COUNT`) e li accoda al rapporto.
- **Rifiuto della RPC (utente non autorizzato):** codice dedicato `P0902`, messaggio `PROBE_RPC_DENIED uid=<valore>`.
- **Permesso negato (anonimo senza EXECUTE):** codice standard `42501`.
- **Errore imprevisto:** qualunque altro `SQLSTATE`, o un codice atteso in un caso sbagliato, viene marcato `UNEXPECTED` con il testo completo; il caso risulta fallito.
- **Risultato finale:** errore intenzionale `PROBE_RESULT: <riga per caso: caso | ruolo | esito | sqlstate | current_user osservato | righe>`. Questo testo è l'unica evidenza; se lo strumento non lo riportasse, lo dichiarerò e il test risulterà non eseguito.

## 3. Distinzione tra RLS e trigger, senza modificare policy

Due tabelle di prova separate, entrambe solo nello schema `phase0_probe`:
- `probe_rls`: RLS attiva con policy "solo righe `ordinary`" per `authenticated`, **nessun trigger**. Verifica solo la policy.
- `probe_trg`: RLS attiva con policy permissiva (tutte le righe) per `authenticated`, **con trigger INVOKER**. Verifica solo il trigger, perché la RLS qui non blocca nulla.

Nessuna policy viene disattivata o modificata dopo la creazione; nessuna policy finanziaria è coinvolta.

Come si distingue l'origine del rifiuto:
- RLS su UPDATE: non genera errore, la riga non è visibile → `ROW_COUNT = 0`. Su INSERT/cambio verso `transfer` → errore `42501` "row-level security".
- Trigger: errore `P0901` con il `current_user` osservato.
- Un esito su `probe_trg` può provenire solo dal trigger; uno su `probe_rls` solo dalla policy.

Casi:

| Caso | Tabella | Ruolo | Esito atteso (teorico) |
|---|---|---|---|
| R1 UPDATE riga ordinary | probe_rls | authenticated | 1 riga modificata |
| R2 UPDATE riga transfer | probe_rls | authenticated | 0 righe |
| R3 INSERT riga transfer | probe_rls | authenticated | 42501 |
| T1 UPDATE riga ordinary | probe_trg | authenticated | 1 riga, `seen_by` = authenticated |
| T2 UPDATE riga transfer | probe_trg | authenticated | P0901, current_user = authenticated |
| T3 INSERT riga transfer | probe_trg | authenticated | P0901 |
| T4 UPDATE riga transfer | probe_trg | service_role | P0901, current_user = service_role |
| T5 RPC autorizzata su riga transfer | probe_trg | authenticated (membro) | 1 riga, `seen_by` = postgres |
| T6 RPC utente non membro | probe_trg | authenticated (non membro) | P0902, riga invariata |
| T7 RPC da anonimo | — | anon | 42501 |

T5 dimostra che il trigger non blocca la RPC autorizzata: stessa tabella, stesso trigger, riga modificata e `current_user` osservato.

## 4. Limiti tecnici

- Sessioni simulate con `SET LOCAL ROLE` e claims fittizi, non tramite l'API reale; l'equivalenza va confermata dopo l'implementazione con un test dal browser.
- Il test dipende dalla capacità dello strumento migrazioni di restituire il messaggio d'errore e di annullare file e storico; entrambe le cose saranno verificate subito dopo.
- Il trigger reale sarà applicato a `transactions`, non a una tabella di prova: il risultato prova il meccanismo, non l'implementazione finale.

## 5. Conferma

Nessuna modifica eseguita. Approvando autorizzi solo l'esecuzione di questo test annullato e le verifiche in sola lettura successive; poi mi fermo con il rapporto.
