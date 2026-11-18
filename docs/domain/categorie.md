# Categorie

Elenco definitivo **v1** (deciso il 18/11/2026, migrazione `20261118100000_category_taxonomy_v1.sql`).

Le categorie sono fisse e uguali per tutti gli spazi: ogni spazio personale riceve l'intero elenco, ogni spazio condiviso solo i gruppi di spesa. Gli utenti non possono aggiungere, rinominare, spostare o archiviare categorie; l'elenco cambia solo con una migrazione che aggiorna `seed_space_categories()`.

## Criteri

- Si classifica per **scopo** della spesa o dell'entrata, non per mezzo di pagamento.
- Due livelli: categoria principale e sottocategoria. Un movimento può usare anche la sola categoria principale.
- Restano fuori dalle categorie le operazioni che non sono entrate o spese: trasferimenti tra conti propri e rimborsi tra partecipanti alle spese condivise.
- La **rata di mutuo o finanziamento** si registra interamente come spesa (Casa › Mutuo); il debito residuo si aggiorna a mano.

## Entrate

| Categoria          | Sottocategorie                                                               |
| ------------------ | ---------------------------------------------------------------------------- |
| Lavoro             | Stipendio · Tredicesima e premi · Lavoro autonomo · Rimborsi spese di lavoro |
| Rendite            | Interessi · Dividendi e cedole · Affitti percepiti                           |
| Rimborsi e sussidi | Rimborsi fiscali · Rimborsi assicurativi · Bonus e sussidi pubblici          |
| Altre entrate      | Regali ricevuti · Vendita di beni usati · Varie                              |

## Spese

| Categoria                      | Sottocategorie                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Casa                           | Affitto · Mutuo · Condominio · Manutenzione e riparazioni · Arredamento ed elettrodomestici · Assicurazione casa  |
| Utenze                         | Luce · Gas · Acqua · Internet e telefono · Rifiuti                                                                |
| Alimentazione                  | Spesa alimentare · Ristoranti e bar · Asporto e consegne                                                          |
| Trasporti                      | Carburante · Mezzi pubblici · Manutenzione veicolo · Assicurazione e bollo · Parcheggi e pedaggi · Taxi e sharing |
| Salute                         | Visite ed esami · Farmaci · Dentista · Ottica · Assicurazione sanitaria                                           |
| Cura personale e abbigliamento | Abbigliamento e calzature · Parrucchiere ed estetica · Prodotti per la persona                                    |
| Tempo libero                   | Sport e palestra · Hobby · Spettacoli ed eventi · Libri, musica e giochi · Abbonamenti digitali                   |
| Viaggi e vacanze               | Trasporti di viaggio · Alloggi · Attività e visite                                                                |
| Istruzione e formazione        | Corsi · Libri e materiali · Rette scolastiche                                                                     |
| Famiglia e animali             | Figli · Animali domestici · Aiuti ai familiari                                                                    |
| Regali e donazioni             | Regali · Beneficenza                                                                                              |
| Tasse e oneri finanziari       | Imposte · Commissioni bancarie · Interessi passivi · Bolli e altre tasse                                          |
| Altre spese                    | Varie · Imprevisti                                                                                                |

## Passaggio dall'elenco provvisorio

Le categorie provvisorie sono state trasformate al loro posto; i dati collegati non sono stati modificati.

| Prima                              | Dopo                             |
| ---------------------------------- | -------------------------------- |
| Entrate                            | Lavoro                           |
| Entrate › Stipendio                | Lavoro › Stipendio               |
| Entrate › Altre entrate            | Altre entrate › Varie            |
| Casa › Affitto e mutuo             | Casa › Affitto                   |
| Casa › Utenze                      | Utenze                           |
| Vita quotidiana                    | Altre spese                      |
| Vita quotidiana › Spesa alimentare | Alimentazione › Spesa alimentare |
| Vita quotidiana › Trasporti        | Trasporti                        |
| Vita quotidiana › Svago            | Tempo libero                     |

Le categorie create in precedenza fuori dall'elenco provvisorio restano invariate e in sola lettura; se hanno lo stesso nome di una categoria principale nuova, vengono riutilizzate.

## Da decidere

- **Versamenti e prelievi da investimenti**: escono o entrano nella liquidità ma non sono spese o entrate. Proposta: un'operazione dedicata, simile a un trasferimento, collegata all'investimento.
