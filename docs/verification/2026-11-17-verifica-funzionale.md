# Verifica funzionale interfaccia ↔ database — 17 novembre 2026

Step 2 della roadmap: ogni pagina è stata provata dall'interfaccia contro uno stack Supabase **locale** ricostruito dalle migrazioni (`supabase db reset`, CLI 3.1.0), con l'app in `bun run dev` su Windows. Nessun database remoto è stato toccato.

Per ogni area sono stati verificati: funzionamento dell'interfaccia, salvataggio effettivo nel database, autorizzazioni (con tre utenti: A owner, B member, C viewer) e aggiornamento dei dati dipendenti (saldi, totali, dashboard, report).

## Esito per area

| Area                                     | Interfaccia          | Database | Permessi | Dati dipendenti | Note                                                                                                                               |
| ---------------------------------------- | -------------------- | -------- | -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Registrazione, accesso, spazio personale | ✅                   | ✅       | ✅       | ✅              | Spazio personale creato automaticamente con ruolo owner.                                                                           |
| Conti                                    | ✅                   | ✅       | ✅       | ✅              | Eliminazione bloccata con movimenti; archiviazione solo a saldo zero; conto archiviato non selezionabile e rifiutato dal database. |
| Categorie                                | ✅ (dopo correzione) | ✅       | ✅       | ✅              | Massimo due livelli imposto dal database; categorie archiviate e figlie di padri archiviati non più proposte.                      |
| Movimenti                                | ✅ (dopo correzione) | ✅       | ✅       | ✅              | Modifica, eliminazione logica e storico revisioni funzionanti.                                                                     |
| Trasferimenti                            | ✅ (dopo correzione) | ✅       | ✅       | ✅              | Due gambe atomiche; gambe non modificabili né eliminabili fuori dalla RPC; inserimento diretto vietato.                            |
| Investimenti e debiti                    | ✅                   | ✅       | ✅       | ✅              | Residuo superiore al capitale ammesso per scelta (interessi capitalizzati).                                                        |
| Ricorrenze                               | ✅                   | ✅       | ✅       | ✅              | Conferma crea il movimento; doppia conferma rifiutata.                                                                             |
| Scadenze                                 | ✅ (dopo correzione) | ✅       | ✅       | ✅              | Completamento crea il movimento; stati "in ritardo/aperta" corretti.                                                               |
| Spazi condivisi e inviti                 | ⚠️                   | ✅       | ✅       | ✅              | Manca la revoca degli inviti dall'interfaccia (vedi sotto).                                                                        |
| Spese condivise, quote, rimborsi         | ❌ bloccante         | ✅       | ✅       | ✅              | Impossibile creare categorie dello spazio condiviso dall'interfaccia (vedi sotto).                                                 |
| Dashboard, Patrimonio, Report            | ✅ (dopo correzione) | —        | ✅       | ✅              | Patrimonio netto e flussi mensili coincidono con il calcolo diretto sul database.                                                  |

Isolamento verificato: B e C non vedono conti, movimenti, investimenti o debiti personali di A; non possono scrivere nel suo spazio, promuoversi o invitare; il viewer non può creare spese né categorie; solo il pagatore può collegare un proprio movimento personale; scritture dirette su spese condivise e trasferimenti negate.

## Difetti corretti (con test di regressione)

1. **Lista movimenti sempre vuota.** Il filtro "Tutte le categorie" passava il valore interno `__all` invece di `all`, escludendo ogni movimento e trasferimento. Il database era corretto; era solo la visualizzazione.
2. **Trasferimenti contati come entrate e uscite.** Le due gambe comparivano in lista accanto al trasferimento e gonfiavano i totali della pagina Movimenti e i flussi mensili della dashboard. Il report era già corretto.
3. **Importo "2.000" rifiutato.** Il parser accettava "1.500,50" ma non i punti delle migliaia senza virgola.
4. **Categorie non utilizzabili proposte nei moduli.** Le sottocategorie di un padre archiviato erano selezionabili in movimenti, ricorrenze e scadenze, poi rifiutate dal database.
5. **"Annulla" sulle scadenze senza conferma.** L'azione è irreversibile; ora chiede conferma e l'etichetta è "Annulla scadenza".

## Da decidere (richiedono una scelta di prodotto)

1. **Categorie dello spazio condiviso — bloccante.** Il database richiede che una spesa condivisa usi una categoria di spesa _dello stesso spazio condiviso_, ma la pagina Categorie gestisce solo lo spazio personale e la funzione `create_starter_categories` fallisce sugli spazi condivisi (crea anche categorie di entrata). Il documento di progetto parla invece di "sistema unico di categorie, non duplicato tra personale e condiviso". Opzioni: (a) categorie per spazio, con gestione nella pagina Categorie e set iniziale di sole spese alla creazione dello spazio; (b) categorie condivise uniche, che richiede di cambiare il modello dati.
2. **"Rinvia" nelle ricorrenze salta l'occorrenza.** Avanza alla data successiva senza registrare nulla (es. lo stipendio di dicembre sparisce dal piano). Rinominare in "Salta" con conferma, oppure implementare un vero rinvio a una data scelta.
3. **Revoca degli inviti in attesa.** Il database la consente all'owner, l'interfaccia non la offre. Un invito con ruolo sbagliato oggi non si può correggere dall'app.

## Osservazioni minori

- Intestazione "Prototipo · dati dimostrativi" e titoli di pagina "Fondo" non più coerenti con un'app che usa dati reali.
- Formati non uniformi: alcune pagine mostrano "2650,81 €" e altre "2.398,40 €"; quantità e percentuali con il punto decimale ("10.5", "55.0%"); debito nullo mostrato come "-0,00 €"; "1 elementi".
- Le card dei saldi delle spese condivise includono anche i membri in sola lettura, che non possono avere quote.
- "Annulla" è usato anche per l'annullamento di un trasferimento in lista: è protetto da conferma, ma l'etichetta coincide con quella dei pulsanti di chiusura dei moduli.
- `tsc --noEmit` riporta 28 errori di tipo preesistenti (accessi indicizzati con `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`, soprattutto in Spese condivise, Ricorrenze, Scadenze). Il controllo dei tipi non è nella CI.
- Avvisi ESLint preesistenti (8, nessun errore).

## Ambiente di sviluppo

- Su Windows serve Node.js: sotto il runtime Bun Miniflare fallisce con `ECONNREFUSED` (difetto noto di Miniflare/Bun).
- Aggiunto un proxy di sviluppo opzionale in `vite.config.ts` (`SUPABASE_DEV_PROXY_TARGET`), attivo solo se configurato in `.env.local`, per i browser che bloccano richieste verso altre porte locali. Istruzioni nel README.
