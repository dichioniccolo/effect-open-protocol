# effect-open-protocol

Client Open Protocol per avvitatori industriali, scritto con
[Effect](https://effect.website) v4.

Lo stesso servizio l'ho già scritto con NestJS e ce l'ho in produzione. Questa
è una libreria riscritta da capo, con Effect.

## I tre problemi della versione NestJS

Un risultato salvato due volte. Un messaggio inatteso che ha fatto cadere il
servizio, e con lui le connessioni verso tutti gli altri controller. E dei
risultati persi mentre la rete era giù. In produzione li ho sistemati tutti e
tre, uno alla volta, come si sono presentati. Riscrivendo il codice per questo
test, senza riportare niente dalla versione vecchia, volevo vedere come
affrontarli con Effect dall'inizio.

## Le scelte principali

- **Solo Effect, senza NestJS.** Ogni errore è dichiarato nella firma della
  funzione, ogni risorsa la chiude chi l'ha aperta (`Scope`), e ogni
  ritentativo segue una politica definita con il modulo `Schedule`. Nella
  versione NestJS erano eccezioni, lifecycle hook e cicli scritti a mano.
- **La connessione non conosce i socket.** Parla con un'interfaccia,
  `Transport`, e chi la costruisce decide se dietro c'è il TCP vero o una rete
  finta. Nei test uso la seconda, così i tempi e i guasti li posso decidere io.
- **Una richiesta alla volta per controller.** Le risposte del controller non
  dicono a quale richiesta rispondono, quindi il client ne manda una, aspetta
  risposta, e solo dopo manda la prossima.
- **Il client conferma solo dopo che l'applicazione ha gestito il risultato.**
  Se confermasse subito e poi l'applicazione si rompesse, quel risultato
  sarebbe perso. Il costo è che ogni tanto ne arriva uno doppio, e
  l'applicazione deve saperlo buttare.
- **Una callback, non uno stream.** Con uno stream non si sa quando chi
  consuma ha finito davvero, quindi non si sa nemmeno quando confermare.

## Uso dell'AI

Il design l'ho scritto io, partendo da quello che avevo già fatto con NestJS:
concorrenza, connessioni, consegna dei risultati, errori. Il codice e i test li
ha scritti Claude, seguendo quel design e i miei suggerimenti. Non ho mai preso
quello che usciva come verità: il comportamento l'ho controllato sulla
specifica del protocollo, e per Effect sulla documentazione e sul codice
sorgente. Nelle cartelle `.claude/`, `explorations/` e `goals/` ho lasciato
parte del lavoro.

## Come provarlo

Serve [Bun](https://bun.sh) 1.3. I 158 test girano sul `TestClock` di Effect:
il tempo non passa da solo, lo sposta avanti il test. Così i messaggi che
tengono viva la connessione, i timeout e le attese tra un tentativo e l'altro
si provano senza aspettare davvero.

```sh
bun install
bun run test
```

### Il simulatore

Nel repository c'è un controller finto, così il collegamento lo si butta giù a
mano invece di aspettare che cada da solo. Tre comandi, ognuno nel suo
terminale.

```sh
bun run controller -- --port 4545
bun run client     -- --port 4545 --latency 40 --jitter 15
bun run ui                                    # http://localhost:3000
```

I comandi si danno dal terminale del controller. Sono righe, quindi ognuno
finisce con Invio.

1. **Invio** da solo, e il controller fa un risultato. Il client lo consegna
   all'applicazione e poi conferma.
2. **`d` e Invio**, e il collegamento va giù. Il client perde la sessione e
   ricomincia a riprovare.
3. **Invio** altre due volte, e il controller fa due risultati che il client
   non può ricevere.
4. **`u` e Invio**, e il collegamento torna. Il client si riconnette, si
   accorge che gliene mancano due e li chiede.

Ctrl-C stampa i conti dei due lati, che devono essere uguali.

### La sessione reale

La stessa prova l'ho fatta su un avvitatore Rexroth Nexo che ho in casa, con
lo stesso client, e quella sessione è dentro il repository. Quattro minuti su
WLAN vera, ogni byte passato sul socket.

```sh
EFFECT_OPEN_PROTOCOL_TRACE_DB=../../docs/traces/nexo.sqlite bun run ui
```

C'è una sola sessione. Aprendola si vedono i messaggi in ordine, con ora,
direzione e numero. Ogni messaggio del protocollo ha un numero, il MID: lo
0061 è un risultato in arrivo, lo 0062 la conferma che il client manda dopo che
l'applicazione l'ha gestito, lo 0064 chiede un risultato per numero (con 0,
l'ultimo che il controller ha fatto) e lo 0065 è la risposta.

- **16:01:33.** Handshake. Il client chiede al controller qual è l'ultimo
  risultato che ha fatto, è il 2636, e da lì in poi conta. Poi chiede di
  ricevere quelli nuovi via via che arrivano.
- **16:01:52.** Arriva il serraggio 2637. Il client lo passa all'applicazione,
  e **solo dopo** conferma.
- **16:02:13.** Qui ho spento la WLAN e ho fatto sette serraggi. Il messaggio
  che tiene viva la connessione non riceve risposta, il client considera persa
  la sessione, e la traccia si ferma.
- **16:02:34.** Riaccendo la WLAN. Il client si riconnette, chiede l'ultimo
  risultato, è il 2644: sette avanti rispetto all'ultimo che ha passato.
  Allora chiede uno per uno dal 2638 al 2644, e in trecento millisecondi li ha
  tutti. **Solo a quel punto** si rimette in ascolto di quelli nuovi.
- **16:02:59.** Arriva un serraggio nuovo, il 2645, e il client lo conferma
  come il primo. In tutta la sessione l'applicazione ha ricevuto nove
  risultati, nessuno due volte.

## Dov'è il codice

Il grosso è in `packages/open-protocol`: `DeviceConnection.ts` tiene su la
connessione con un controller, `ResultDelivery.ts` prende il risultato che
arriva, chiama l'handler dell'applicazione e manda l'ack solo se l'handler è
andato a buon fine, riconoscendo i rinvii di quello che ha già passato.
`packages/store` e `apps/ui` registrano e mostrano il traffico, `packages/cli`
sono i comandi qui sopra.

## Cosa ho imparato

I bug che contavano non li ho trovati rileggendo il codice, ma facendo cadere
la rete a ripetizione, con guasti a caso, e confrontando i conti dei due lati
come fa il simulatore qui sopra. Otto risultati persi in tutto, e nessuno dava
segnali: niente errore, nessun test rosso, solo un numero più basso alla fine.
Il codice era giusto per il caso che stavo immaginando.

Il Nexo ha aggiunto quello che il simulatore non poteva far vedere. La
connessione non aveva un timeout, e il client confermava anche i risultati
recuperati con lo 0064, che la conferma non la vogliono. Corretti tutti e due.

I tre problemi qui sopra, in questa versione, hanno una risposta nel codice.
Il doppione: il client riconosce i rinvii, e lo stesso risultato
all'applicazione non ci arriva due volte. Il crash che si portava dietro le
altre connessioni: ogni controller ha la sua fiber supervisionata, e quello
che va in errore su uno resta lì. I risultati persi: quelli prodotti mentre il
collegamento era giù la libreria li richiede con lo 0064 appena la connessione
torna su.

Effect mi ha aiutato su tre cose. Le dipendenze stanno nel tipo, quindi se al
programma manca un pezzo, per esempio il `Transport`, TypeScript non me lo fa
compilare; con NestJS lo stesso errore si vede a runtime, a servizio già
avviato. Anche gli errori stanno nel tipo: quelli che non gestisco restano
nella firma, e se ne resta uno dove ho dichiarato che non ce ne sono più, non
compila. E il tempo si prova senza aspettarlo.

La UI è stata l'occasione per provare gli atom di Effect, che non avevo mai
usato: lo stato della pagina sta tutto lì, dai dati che arrivano dal server ai
filtri e alla riga selezionata, e il valore derivato si dichiara invece di
tenerlo in sincrono a mano. Con più tempo ci guarderei ancora, a partire
dall'idratazione tra server e client.
