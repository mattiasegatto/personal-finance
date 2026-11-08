# Fase 3A — Revisione finale SQL: integrità e protezioni

Nessuna migrazione applicata, nessun oggetto creato, nessun file del repository modificato. Solo analisi, SQL aggiornato, garanzie, test e decisioni aperte.

## 1. Validatore di integrità — cosa controlla davvero

`validate_transfer()` è stato rafforzato e ora verifica, per ogni trasferimento toccato, **tutti** gli invarianti dichiarati:

- esattamente una gamba `source` e una `destination` nei collegamenti;
- `source_transaction_id` / `destination_transaction_id` della testata valorizzati, distinti e allineati ai collegamenti;
- gambe esistenti, `operation_type = 'transfer'`, direzioni `outflow`/`inflow`, categoria NULL;
- stesso spazio, importo, data **e descrizione** tra testata e gambe;
- conti sorgente e destinazione distinti, appartenenti allo spazio del trasferimento, con **valuta identica**;
- spazio di tipo **personale**;
- coerenza di annullamento: testata attiva ⇒ entrambe le gambe attive; testata annullata ⇒ entrambe annullate.

**Copertura delle scritture sulle gambe.** Un terzo constraint trigger differito scatta su `transactions` per **INSERT, UPDATE e DELETE** delle righe `transfer`. Due garanzie distinte:
- una gamba `transfer` **senza collegamento** (inserita direttamente, anche con la variabile impostata) viene rifiutata al commit: il trigger non trova il collegamento e solleva un errore;
- una gamba collegata ma **incoerente** (importo, data, conto, direzione, descrizione, stato di annullamento diversi dalla testata) viene rifiutata al commit dal validatore completo.

In `create_transfer` le gambe sono inserite prima dei collegamenti, ma il trigger è differito al commit: a quel punto i collegamenti esistono e la validazione passa. Le tre superfici (testata, collegamenti, gambe) sono coperte su tutte e tre le operazioni.

## 2. Variabile `app.transfer_rpc` — analisi concreta

- **Chi può impostarla:** solo codice eseguito dentro il database (`set_config`). La connessione dell'app espone solo tabelle, viste e RPC: non esiste alcuna chiamata API che esegua `set_config`. Ho verificato le funzioni esposte esistenti (`create_shared_space`, `invite_to_space`, `accept_invitation`, `create_starter_categories`): nessuna imposta questa variabile. Le uniche funzioni che la imposteranno sono le tre nuove RPC.
- **Imitazione:** un accesso diretto (INSERT/UPDATE via API) non può impostarla; una funzione esposta potrebbe solo se contenesse esplicitamente `set_config('app.transfer_rpc', …)` — nessuna lo fa né lo farà fuori dalle tre RPC.
- **Identità e appartenenza prima del percorso protetto:** in tutte e tre le RPC i controlli `auth.uid()` non nullo e `has_space_role(spazio, uid, [owner, member])` avvengono **prima** di `set_config`. La variabile non è mai letta come prova di autorizzazione: non concede nulla, marca solo il percorso.
- **Blocco di `service_role`:** salta la RLS ma non i trigger. Senza la variabile, `guard_transaction`, `guard_transfers` e `guard_transfer_links` rifiutano ogni scrittura diretta. Anche ipotizzando la variabile impostata (possibile solo con accesso SQL diretto, che l'app non offre), il validatore differito annulla al commit qualunque incoerenza.
- **Conclusione:** la garanzia non poggia sulla variabile da sola, ma su tre strati indipendenti: RLS (ruoli normali), trigger di guardia (ogni ruolo, incluso `service_role`), validatore differito (qualunque scrittura, anche con variabile impostata).

## 3. Guardia della testata — rafforzata

`guard_transfers()` ora rifiuta **ogni** UPDATE diretto (importo, conti, data, descrizione, annullamento, collegamenti) quando la variabile non è impostata — non più solo i cambi dei riferimenti alle gambe. Dentro la RPC restano immutabili spazio e `created_by`, e una testata annullata non è più modificabile. La cancellazione fisica resta vietata. Il validatore differito copre comunque qualunque incoerenza residua.

## 4. Archiviazione dei conti — verifica effettiva (decisione D1 sospesa)

Ho letto la definizione **attualmente presente nel database** di `guard_account()`: non contiene alcun riferimento ai trasferimenti. L'archiviazione è oggi regolata solo dal vincolo del saldo zero.

La migrazione proposta **non modifica `guard_account()`**. Comportamento risultante, esatto:
- archiviare un conto con trasferimenti attivi è **consentito**, purché il saldo sia zero (regola esistente);
- su quel conto: nuovi trasferimenti rifiutati; modifica di descrizione/data dei trasferimenti esistenti consentita; modifica di importo/conti rifiutata; annullamento consentito.

Se invece decidi di bloccare l'archiviazione con trasferimenti attivi, aggiungerò a `guard_account()` un controllo esplicito — solo dopo la tua decisione.

## 5. Privilegi delle funzioni

PostgreSQL concede EXECUTE a PUBLIC per default. La migrazione revoca l'esecuzione pubblica di **tutte** le funzioni interne (guardie, validatori, trigger function — incluse `guard_transaction` e `guard_account` già esistenti, che sono solo trigger function) e concede EXECUTE solo sulle tre RPC, solo ad `authenticated` (revocato a PUBLIC e `anon`). Le trigger function non richiedono privilegi EXECUTE per scattare: la revoca è sicura.

## 6. SQL completo aggiornato

```sql
-- 1. Nuovo tipo di operazione
ALTER TYPE public.tx_operation ADD VALUE 'transfer';

-- 2. Categoria facoltativa (obbligatoria per gli ordinari via trigger)
ALTER TABLE public.transactions ALTER COLUMN category_id DROP NOT NULL;

-- 3. Testata del trasferimento
CREATE TABLE public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE RESTRICT,
  source_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  destination_account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  source_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  destination_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  occurred_on date NOT NULL,
  description text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.transfers TO authenticated;
GRANT ALL ON public.transfers TO service_role;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfers: membri leggono" ON public.transfers
  FOR SELECT TO authenticated
  USING (public.is_space_member(space_id, auth.uid()));

-- 4. Collegamenti gamba <-> trasferimento
CREATE TABLE public.transfer_transaction_links (
  transaction_id uuid PRIMARY KEY REFERENCES public.transactions(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL REFERENCES public.transfers(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('source','destination')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, role)
);
GRANT SELECT ON public.transfer_transaction_links TO authenticated;
GRANT ALL ON public.transfer_transaction_links TO service_role;
ALTER TABLE public.transfer_transaction_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "links: membri leggono" ON public.transfer_transaction_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.transfers t
    WHERE t.id = transfer_id AND public.is_space_member(t.space_id, auth.uid())
  ));

-- 5. Guardia della testata: nessuna modifica diretta, nessuna cancellazione fisica
CREATE OR REPLACE FUNCTION public.guard_transfers()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'I trasferimenti non si cancellano fisicamente: usa l''annullamento.';
  end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null then raise exception 'Un trasferimento annullato non può essere modificato.'; end if;
    if new.space_id <> old.space_id then raise exception 'Un trasferimento non può cambiare spazio.'; end if;
    if new.created_by is distinct from old.created_by then raise exception 'Campo non modificabile.'; end if;
    if current_setting('app.transfer_rpc', true) is distinct from 'on' then
      raise exception 'I trasferimenti si modificano solo tramite la funzione dedicata.';
    end if;
  end if;
  return new;
end $function$;
CREATE TRIGGER transfers_guard BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfers();
CREATE TRIGGER transfers_guard_delete BEFORE DELETE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfers();
CREATE TRIGGER transfers_touch BEFORE UPDATE ON public.transfers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 6. Guardia dei collegamenti: scrittura solo dentro la RPC
CREATE OR REPLACE FUNCTION public.guard_transfer_links()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if current_setting('app.transfer_rpc', true) is distinct from 'on' then
    raise exception 'I collegamenti dei trasferimenti sono gestiti solo dalla funzione dedicata.';
  end if;
  if tg_op = 'UPDATE' then
    if new.transfer_id <> old.transfer_id or new.role <> old.role then
      raise exception 'I collegamenti dei trasferimenti non sono modificabili.';
    end if;
  end if;
  return coalesce(new, old);
end $function$;
CREATE TRIGGER links_guard BEFORE INSERT OR UPDATE OR DELETE ON public.transfer_transaction_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_links();

-- 7. Validatore di coerenza (tutti gli invarianti)
CREATE OR REPLACE FUNCTION public.validate_transfer(_transfer uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare t public.transfers; s public.transactions; d public.transactions;
  sa public.accounts; da public.accounts;
  ns int; nd int; lsrc uuid; ldst uuid;
begin
  select * into t from public.transfers where id = _transfer;
  if t.id is null then return; end if;
  select count(*) filter (where role = 'source'), count(*) filter (where role = 'destination')
    into ns, nd from public.transfer_transaction_links where transfer_id = t.id;
  if ns <> 1 or nd <> 1 then
    raise exception 'Trasferimento incoerente: serve esattamente una gamba sorgente e una destinazione.'; end if;
  select transaction_id into lsrc from public.transfer_transaction_links where transfer_id = t.id and role = 'source';
  select transaction_id into ldst from public.transfer_transaction_links where transfer_id = t.id and role = 'destination';
  if t.source_transaction_id is null or t.destination_transaction_id is null
     or t.source_transaction_id = t.destination_transaction_id
     or t.source_transaction_id is distinct from lsrc
     or t.destination_transaction_id is distinct from ldst then
    raise exception 'Testata e collegamenti del trasferimento non allineati.'; end if;
  select * into s from public.transactions where id = lsrc;
  select * into d from public.transactions where id = ldst;
  if s.id is null or d.id is null then raise exception 'Gamba del trasferimento mancante.'; end if;
  if t.deleted_at is null then
    if s.deleted_at is not null or d.deleted_at is not null then
      raise exception 'Trasferimento attivo con una gamba eliminata.'; end if;
    select * into sa from public.accounts where id = t.source_account_id;
    select * into da from public.accounts where id = t.destination_account_id;
    if sa.id is null or da.id is null
       or sa.space_id <> t.space_id or da.space_id <> t.space_id
       or sa.currency <> da.currency then
      raise exception 'Conti del trasferimento incoerenti o di valuta diversa.'; end if;
    if not public.is_personal_space(t.space_id) then
      raise exception 'I trasferimenti sono ammessi solo nello spazio personale.'; end if;
    if s.operation_type <> 'transfer' or d.operation_type <> 'transfer'
       or s.direction <> 'outflow' or d.direction <> 'inflow'
       or s.category_id is not null or d.category_id is not null
       or s.account_id <> t.source_account_id or d.account_id <> t.destination_account_id
       or s.account_id = d.account_id
       or s.amount_cents <> t.amount_cents or d.amount_cents <> t.amount_cents
       or s.occurred_on <> t.occurred_on or d.occurred_on <> t.occurred_on
       or s.space_id <> t.space_id or d.space_id <> t.space_id
       or s.description is distinct from t.description
       or d.description is distinct from t.description then
      raise exception 'Gambe del trasferimento incoerenti con la testata.'; end if;
  else
    if s.deleted_at is null or d.deleted_at is null then
      raise exception 'Trasferimento annullato con una gamba ancora attiva.'; end if;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.validate_transfer_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform public.validate_transfer(coalesce(new.id, old.id));
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.validate_transfer_link_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  perform public.validate_transfer(coalesce(new.transfer_id, old.transfer_id));
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.validate_transfer_leg_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare tid uuid;
begin
  if coalesce(new.operation_type, old.operation_type) <> 'transfer' then return null; end if;
  select transfer_id into tid from public.transfer_transaction_links
  where transaction_id = coalesce(new.id, old.id);
  if tid is not null then perform public.validate_transfer(tid); end if;
  return null;
end $function$;

CREATE CONSTRAINT TRIGGER transfers_validate
  AFTER INSERT OR UPDATE ON public.transfers
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_transfer_trigger();
CREATE CONSTRAINT TRIGGER links_validate
  AFTER INSERT OR UPDATE OR DELETE ON public.transfer_transaction_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_transfer_link_trigger();
CREATE CONSTRAINT TRIGGER legs_validate
  AFTER UPDATE OR DELETE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_transfer_leg_trigger();

-- 8. Guardia dei movimenti (corpo sostituito, trigger esistente invariato)
CREATE OR REPLACE FUNCTION public.guard_transaction()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare a record; c record; want public.category_kind;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Un movimento non può cambiare spazio.'; end if;
    if old.deleted_at is not null then raise exception 'Un movimento eliminato non può essere modificato.'; end if;
    if new.created_by is distinct from old.created_by then raise exception 'Campo non modificabile.'; end if;
    if new.operation_type is distinct from old.operation_type then
      raise exception 'Il tipo di operazione non è modificabile.'; end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then
    raise exception 'I movimenti personali vanno registrati in uno spazio personale.'; end if;
  select * into a from accounts where id = new.account_id;
  if not found or a.space_id is distinct from new.space_id then
    raise exception 'Il conto appartiene a un altro spazio.'; end if;
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id <> old.account_id) then
    raise exception 'Il conto è archiviato.'; end if;
  if new.operation_type = 'transfer' then
    if current_setting('app.transfer_rpc', true) is distinct from 'on' then
      raise exception 'I movimenti di trasferimento possono essere creati o modificati solo tramite la funzione dedicata.';
    end if;
    if new.category_id is not null then raise exception 'Un trasferimento non ha categoria.'; end if;
  else
    if new.category_id is null then
      raise exception 'La categoria è obbligatoria per un movimento ordinario.'; end if;
    select * into c from categories where id = new.category_id;
    if not found or c.space_id is distinct from new.space_id then
      raise exception 'La categoria appartiene a un altro spazio.'; end if;
    if (tg_op = 'INSERT' or new.category_id <> old.category_id) and c.archived_at is not null then
      raise exception 'La categoria è archiviata.'; end if;
    want := (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind;
    if public.category_root_kind(new.category_id) is distinct from want then
      raise exception 'La categoria non corrisponde alla direzione del movimento.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $function$;

-- 9. guard_account: NESSUNA modifica (verificata la definizione attuale; decisione D1 sospesa)

-- 10. RPC: creazione atomica
CREATE OR REPLACE FUNCTION public.create_transfer(
  _source_account uuid, _destination_account uuid, _amount_cents bigint,
  _occurred_on date, _description text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
  sa public.accounts; da public.accounts;
  tid uuid; stx uuid; dtx uuid; descr text;
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  if _amount_cents is null or _amount_cents <= 0 then raise exception 'Importo non valido'; end if;
  if _occurred_on is null then raise exception 'Data obbligatoria'; end if;
  if _source_account = _destination_account then raise exception 'I conti devono essere distinti'; end if;
  select * into sa from public.accounts where id = _source_account;
  select * into da from public.accounts where id = _destination_account;
  if sa.id is null or da.id is null then raise exception 'Conto non trovato'; end if;
  if sa.space_id <> da.space_id then raise exception 'I conti appartengono a spazi diversi'; end if;
  if not public.is_personal_space(sa.space_id) then
    raise exception 'I trasferimenti sono ammessi solo nello spazio personale'; end if;
  if not public.has_space_role(sa.space_id, uid, array['owner','member']::public.space_role[]) then
    raise exception 'Non sei autorizzato su questo spazio'; end if;
  if sa.currency <> da.currency then raise exception 'I conti devono avere la stessa valuta'; end if;
  if sa.archived_at is not null or da.archived_at is not null then
    raise exception 'Uno dei conti è archiviato'; end if;
  descr := nullif(btrim(coalesce(_description,'')),'');

  perform set_config('app.transfer_rpc', 'on', true);

  insert into public.transfers(space_id, source_account_id, destination_account_id,
    amount_cents, occurred_on, description, created_by)
  values (sa.space_id, sa.id, da.id, _amount_cents, _occurred_on, descr, uid)
  returning id into tid;

  insert into public.transactions(space_id, account_id, category_id, operation_type,
    direction, amount_cents, occurred_on, description)
  values (sa.space_id, sa.id, null, 'transfer', 'outflow', _amount_cents, _occurred_on, descr)
  returning id into stx;

  insert into public.transactions(space_id, account_id, category_id, operation_type,
    direction, amount_cents, occurred_on, description)
  values (sa.space_id, da.id, null, 'transfer', 'inflow', _amount_cents, _occurred_on, descr)
  returning id into dtx;

  insert into public.transfer_transaction_links(transaction_id, transfer_id, role)
  values (stx, tid, 'source'), (dtx, tid, 'destination');

  update public.transfers set source_transaction_id = stx, destination_transaction_id = dtx
  where id = tid;
  return tid;
end $function$;

-- 11. RPC: modifica atomica (descrizione/data sempre; importo/conti solo con conti attivi)
CREATE OR REPLACE FUNCTION public.update_transfer(
  _transfer uuid, _source_account uuid, _destination_account uuid,
  _amount_cents bigint, _occurred_on date, _description text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid();
  t public.transfers; sa public.accounts; da public.accounts;
  descr text; financial_change boolean;
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  select * into t from public.transfers where id = _transfer for update;
  if t.id is null then raise exception 'Trasferimento non trovato'; end if;
  if t.deleted_at is not null then raise exception 'Il trasferimento è annullato'; end if;
  if not public.has_space_role(t.space_id, uid, array['owner','member']::public.space_role[]) then
    raise exception 'Non sei autorizzato su questo spazio'; end if;
  if _amount_cents is null or _amount_cents <= 0 then raise exception 'Importo non valido'; end if;
  if _occurred_on is null then raise exception 'Data obbligatoria'; end if;
  if _source_account = _destination_account then raise exception 'I conti devono essere distinti'; end if;
  select * into sa from public.accounts where id = _source_account;
  select * into da from public.accounts where id = _destination_account;
  if sa.id is null or da.id is null then raise exception 'Conto non trovato'; end if;
  if sa.space_id <> t.space_id or da.space_id <> t.space_id then
    raise exception 'I conti appartengono a un altro spazio'; end if;
  if sa.currency <> da.currency then raise exception 'I conti devono avere la stessa valuta'; end if;

  financial_change := _amount_cents <> t.amount_cents
    or _source_account <> t.source_account_id
    or _destination_account <> t.destination_account_id;
  if financial_change and exists (
    select 1 from public.accounts
    where id in (t.source_account_id, t.destination_account_id, _source_account, _destination_account)
      and archived_at is not null) then
    raise exception 'Importo e conti non sono modificabili: uno dei conti coinvolti è archiviato.';
  end if;
  descr := nullif(btrim(coalesce(_description,'')),'');

  perform set_config('app.transfer_rpc', 'on', true);

  update public.transfers
  set source_account_id = sa.id, destination_account_id = da.id,
      amount_cents = _amount_cents, occurred_on = _occurred_on, description = descr
  where id = t.id;

  update public.transactions
  set account_id = sa.id, amount_cents = _amount_cents, occurred_on = _occurred_on, description = descr
  where id = t.source_transaction_id;

  update public.transactions
  set account_id = da.id, amount_cents = _amount_cents, occurred_on = _occurred_on, description = descr
  where id = t.destination_transaction_id;
end $function$;

-- 12. RPC: annullamento logico (consentito anche con conti archiviati)
CREATE OR REPLACE FUNCTION public.delete_transfer(_transfer uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare uid uuid := auth.uid(); t public.transfers;
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  select * into t from public.transfers where id = _transfer for update;
  if t.id is null then raise exception 'Trasferimento non trovato'; end if;
  if t.deleted_at is not null then raise exception 'Il trasferimento è già annullato'; end if;
  if not public.has_space_role(t.space_id, uid, array['owner','member']::public.space_role[]) then
    raise exception 'Non sei autorizzato su questo spazio'; end if;

  perform set_config('app.transfer_rpc', 'on', true);

  update public.transfers set deleted_at = now() where id = t.id;
  update public.transactions set deleted_at = now()
  where id in (t.source_transaction_id, t.destination_transaction_id);
end $function$;

-- 13. Privilegi: RPC solo agli autenticati; funzioni interne non richiamabili
REVOKE EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, bigint, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, bigint, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_transfer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, bigint, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, bigint, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_transfer(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_transfers() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_transfer_links() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_transfer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_transfer_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_transfer_link_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_transfer_leg_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_transaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_account() FROM PUBLIC, anon, authenticated;
```

## 7. Criticità risolte rispetto alla versione precedente

1. Il validatore ora controlla davvero tutti gli invarianti: riferimenti valorizzati e distinti, descrizione, appartenenza dei conti allo spazio, valuta identica, spazio personale, coerenza di annullamento.
2. Le modifiche alle gambe sono coperte da un terzo constraint trigger differito su `transactions`: nessuna superficie scoperta.
3. `guard_transfers` blocca ogni UPDATE diretto, non solo i riferimenti alle gambe.
4. Privilegi: revocata l'esecuzione pubblica di tutte le funzioni interne; EXECUTE solo sulle tre RPC e solo per `authenticated`.
5. `guard_account` verificata nel database e lasciata invariata: comportamento documentato, decisione D1 sospesa.

## 8. Garanzie effettivamente implementate (e come)

- **Due gambe coerenti, sempre:** vincoli (PK globale, UNIQUE ruolo, FK RESTRICT) + guardie (scrittura solo via RPC) + validatore differito al commit su testata, collegamenti e gambe.
- **Nessuna scrittura diretta:** RLS per i ruoli normali; trigger per ogni ruolo incluso `service_role`; validatore come rete finale anche con variabile impostata.
- **Autorizzazione esplicita:** ogni RPC verifica `auth.uid()` e `has_space_role` prima di aprire il percorso protetto.
- **Ordinari intatti:** tutte le validazioni esistenti preservate; `operation_type` immutabile; categoria obbligatoria per gli ordinari.
- **Storicità:** nessuna cancellazione fisica; annullamento logico di testata e gambe; collegamenti conservati.

## 9. Test necessari dopo l'applicazione

**Connessione reale dell'app (account di prova):** creazione (due movimenti, saldi, coerenza); totali entrate/uscite invariati; modifica importo atomica; annullamento con saldi ricalcolati e collegamenti storici; modifica diretta di una gamba rifiutata; scrittura diretta su testata/collegamenti negata; errori (stesso conto, valute diverse, conto archiviato, importo ≤ 0, non membro, anonimo); persistenza dopo logout/login.

**Livello database (test annullato stile Passo 0):** `service_role` in scrittura diretta su gamba/testata/collegamenti; trasferimento con una gamba sola o disallineata rifiutato al commit; conto archiviato: descrizione/data consentite, importo rifiutato, annullamento consentito; revoche EXECUTE verificate.

**Automatici:** helper totali che esclude i trasferimenti; i 18 test esistenti devono restare verdi.

## 10. Decisioni ancora aperte

- **D1 — Archiviazione con trasferimenti attivi:** la migrazione lascia `guard_account` invariata → archiviazione consentita con saldo zero, trasferimenti attivi gestibili solo in descrizione/data/annullamento. Se preferisci il blocco, lo aggiungo solo dopo tua decisione.
- **D2 — Meccanismo `current_user` → variabile di transazione + validatore:** confermi la sostituzione rispetto al meccanismo del Passo 0.

Nessuna modifica eseguita. Attendo la tua autorizzazione prima di applicare la migrazione.
