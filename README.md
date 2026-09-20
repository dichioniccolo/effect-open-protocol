# effect-open-protocol

Gli avvitatori industriali si comandano via rete, con un protocollo che si
chiama Open Protocol. Questa libreria ci parla, ed è scritta con
[Effect](https://effect.website) v4. Tiene la connessione con i controller e
passa ogni risultato di serraggio all'applicazione una volta sola.

Ogni serraggio produce un risultato: coppia, angolo, esito, identificativo. È
il dato che certifica quel bullone, e se non arriva all'applicazione è perso.
Il protocollo non aiuta: un messaggio alla volta, risposte che non dicono a
quale domanda rispondono, e dopo quindici secondi di silenzio il controller
chiude.

Documentazione completa, in inglese, in [docs/REFERENCE.md](docs/REFERENCE.md).

## Perché l'ho fatto

Questo servizio l'ho già scritto una volta con NestJS, ed è in produzione. Lì
ho avuto tre problemi seri: un risultato salvato due volte, un messaggio
inatteso che ha fatto cadere il servizio e con lui le connessioni verso tutti
gli altri controller, e dei risultati persi mentre la rete era giù.

Volevo rifarlo da zero con Effect e vedere quanto mi aiutava su quei tre
problemi. Non ho riportato niente dalla versione vecchia.

## Le scelte principali

- **Solo Effect, senza NestJS.** Ogni errore è dichiarato nella firma, ogni
  risorsa muore con il suo `Scope`, ogni retry è uno `Schedule`. Nella versione
  NestJS erano eccezioni, lifecycle hook e cicli scritti a mano.
- **La connessione non conosce i socket.** Parla con l'interfaccia `Transport`,
  e chi la costruisce decide se dietro c'è il TCP o una rete in memoria. Nei
  test uso quella in memoria, così i tempi e i guasti li decido io.
- **Una richiesta alla volta per controller.** Le risposte non dicono a quale
  domanda rispondono, quindi il client ne manda una, aspetta risposta, e solo dopo manda
  la prossima.
- **Il client conferma solo dopo che l'applicazione ha gestito il risultato.**
  Se confermasse subito e poi l'applicazione si rompesse, quel risultato
  sarebbe perso. Il costo è che ogni tanto ne arriva uno doppio, e
  l'applicazione deve saperlo buttare.
- **Una callback, non uno stream.** Con uno stream non sai quando chi consuma
  ha finito davvero, quindi non sai nemmeno quando confermare.

## Come provarlo

Serve [Bun](https://bun.sh) 1.3. I 158 test girano su tempo finto, quindi
keep-alive, timeout e backoff si controllano senza aspettare davvero.

```sh
bun install
bun run test
```

### La sessione reale

La prova vera l'ho fatta su un avvitatore Rexroth Nexo che ho in casa, e quella
sessione è dentro il repository. Quattro minuti su WLAN vera, ogni byte passato
sul socket.

```sh
EFFECT_OPEN_PROTOCOL_TRACE_DB=../../docs/traces/nexo.sqlite bun run ui
```

C'è un run solo. Aprilo, e vedi i frame in ordine con ora, direzione e MID.

- **16:01:33.** Handshake. Il client chiede al controller l'ultimo risultato,
  è il 2636, e da lì in poi conta. Poi si iscrive ai risultati.
- **16:01:52.** Arriva il serraggio 2637. Il client lo passa all'applicazione,
  e **solo dopo** risponde 0062.
- **16:02:13.** Qui ho spento la WLAN e ho fatto sette serraggi. Il keep-alive
  non riceve risposta, il client considera persa la sessione, e la traccia si
  ferma.
- **16:02:34.** Riaccendo la WLAN. Il client si riconnette, chiede l'ultimo
  risultato, è il 2644: sette avanti rispetto all'ultimo che ha passato.
  Allora chiede uno per uno dal 2638 al 2644, e in trecento millisecondi li ha
  tutti. **Solo a quel punto** si iscrive di nuovo.
- **16:02:59.** Arriva un serraggio nuovo, il 2645, e il client lo conferma
  come il primo. In tutto il run l'applicazione ha ricevuto nove risultati,
  nessuno due volte.

### Il simulatore

La stessa cosa si può far succedere a comando, con un controller finto. Tre
comandi, ognuno nel suo terminale.

```sh
bun run controller -- --port 4545
bun run client     -- --port 4545 --latency 40 --jitter 15
bun run ui                                    # http://localhost:3000
```

Il client è lo stesso codice del run sul Nexo. L'outage lo si comanda dal
terminale del controller. I comandi sono righe, quindi ognuno finisce con
Invio.

1. **Invio** da solo, e il controller fa un risultato. Il client lo consegna e
   risponde 0062.
2. **`d` e Invio**, e il collegamento va giù. Il client perde la sessione e
   ricomincia a riprovare.
3. **Invio** altre due volte, e il controller fa due risultati che il client
   non può ricevere.
4. **`u` e Invio**, e il collegamento torna. Il client si riconnette, si
   accorge che gliene mancano due e li chiede.

Ctrl-C stampa i conti dei due lati, che devono essere uguali.

Nel codice parti da `DeviceConnection.ts` e `ResultDelivery.ts`, in
`packages/open-protocol`. `packages/store` e `apps/ui`
registrano e mostrano il traffico, `packages/cli` sono i comandi qui sopra.

## Uso dell'AI

Il design l'ho scritto io, partendo da quello che avevo già fatto con NestJS:
concorrenza, connessioni, consegna dei risultati, errori. Il codice e i test li
ha scritti Claude, seguendo quel design e i miei suggerimenti. Non ho mai preso
quello che usciva come verità: il comportamento l'ho controllato sulla
specifica del protocollo, e per Effect sulla documentazione e sul codice
sorgente. Nelle cartelle `.claude/`, `explorations/` e `goals/` ho lasciato
parte del lavoro.

## Cosa ho imparato

I bug che contavano non li ho trovati rileggendo il codice, ma rompendo la
rete e contando i risultati alla fine del run. Otto risultati persi, e nessuno
dava segnali: niente errore, nessun test rosso, solo un numero più basso. Il
codice era giusto per il caso che stavo immaginando.

Il Nexo ha aggiunto quello che il simulatore non poteva far vedere. La
connessione non aveva un timeout, e il client rispondeva 0062 anche ai
risultati recuperati, che la conferma non la vogliono. Corretti tutti e due.

Effect mi ha aiutato su tre cose. Le dipendenze stanno nel tipo, quindi se al
programma manca un pezzo, per esempio il `Transport`, TypeScript non me lo fa
compilare; con NestJS lo stesso errore lo vedi a runtime, a servizio già
avviato. Anche gli errori stanno nel tipo: quelli che non gestisco restano
nella firma, e se ne resta uno dove ho dichiarato che non ce ne sono più, non
compila. E il tempo si prova senza aspettarlo.

In produzione non lo terrei come libreria. Metterei tutto dentro il servizio,
con i MID definiti lì, senza un livello in mezzo da tenere generico. Poi
guarderei Cluster di Effect: oggi serve un'istanza per ogni gruppo di
controller, e se quella cade porta giù le connessioni con tutti.
