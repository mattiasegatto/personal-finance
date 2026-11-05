# Verifica spese condivise

- [x] Esaminare saldi, quote, rimborsi e collegamenti ai movimenti.
- [x] Correggere soltanto problemi accertati, senza modificare il design.
- [x] Eseguire test dei calcoli e della modifica delle quote attraverso la schermata: 9 test superati e percorso browser verificato.
- [x] Riassumere risultati e limiti: movimenti personali ancora non aggregati nell’app; inserimento rimborsi, dati reali e più partecipanti non verificati.
# Rimborsi
- [x] Modulo "Registra pareggio" con validazione, storico, eliminazione con conferma; 7 test + verifica in browser.
# Specifica database (solo progettazione)
- [x] Specifica consolidata: spazi, categorie uniche, flusso unico di inserimento, trasferimenti, commissioni, rettifiche.
- [x] Tre decisioni aperte confermate da Mattia: commissione autonoma alla cancellazione, cambio pagatore rifiutato finché collegato, modifica atomica delle gambe.
- [x] Fase 1: autenticazione (email+password, Google), spazi personali/condivisi, inviti, RLS, test di isolamento.
- [ ] Fase 2 (movimenti, conti, trasferimenti, spese, regolamenti): in attesa di approvazione esplicita di Mattia.
