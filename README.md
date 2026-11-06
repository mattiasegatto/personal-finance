# Personal Finance

INTEGRAZIONE AL PROGETTO — SPESE CONDIVISE

L'app dovrà anche sostituire Splitwise per la gestione delle spese condivise tra due persone.

Per questa fase realizza soltanto le schermate e la navigazione con dati fittizi. Non collegare ancora database o servizi esterni.

Prevedi una sezione "Spese condivise" con:

Riepilogo delle spese comuni per mese.

Elenco delle spese con data, descrizione, categoria, importo e pagatore.

Divisione predefinita al 50% tra due partecipanti.

Possibilità di personalizzare le quote per una singola spesa.

Saldo progressivo che mostra chi deve denaro a chi.

Storico dei rimborsi e dei pareggi periodici.

Filtri per periodo, categoria e partecipante.

ARCHITETTURA E REGOLE CONTABILI

Le finanze personali e quelle condivise devono essere separate logicamente, pur potendo utilizzare gli stessi movimenti quando una spesa viene collegata a un pagamento personale.

Non duplicare le uscite bancarie. Un rimborso tra partecipanti non deve essere trattato come nuovo reddito o nuova spesa condivisa.

Prevedi fin dall'architettura spazi personali e spazi condivisi, con autorizzazioni individuali. Un partecipante allo spazio condiviso non deve poter visualizzare automaticamente i conti, gli investimenti o gli altri dati privati dell'altro.

Mantieni il modello estensibile per supportare in futuro più partecipanti, quote variabili e spese ricorrenti.

Per ora usa esclusivamente dati dimostrativi. Non implementare ancora autenticazione, database o calcoli definitivi: questi saranno progettati e verificati in una fase successiva.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/00b8ef70-f4e5-4ce6-9a58-03da6a3af429).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
