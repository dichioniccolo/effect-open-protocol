# effect-open-protocol

È un client per Open Protocol, il protocollo con cui si parla con gli
avvitatori industriali (i controller). L'ho scritto con
[Effect](https://effect.website) v4. La libreria non gestisce i controller, si
occupa solo della connessione con loro. Deve restare collegata anche quando la
rete cade, e passare ogni risultato di serraggio all'applicazione una volta
sola.

La documentazione completa, in inglese, è in [docs/REFERENCE.md](docs/REFERENCE.md).

## Come provarlo

Serve [Bun](https://bun.sh) 1.3.

```sh
bun install
bun run test
bun run demo -- --seed 7 --duration 10 --devices 3 --fault-rate 0.2
```

I test automatici e la demo usano un controller simulato, che fa parte del
repository solo per questo motivo. La demo ne avvia tre e per dieci secondi rompe un po' di tutto: connessioni che
cadono, messaggi spezzati, controller che si riavviano. Alla fine stampa un
riepilogo. Se riporta `Results lost: 0` e `Delivered twice: 0`, è andato tutto
bene.

Oltre al simulatore, ho provato la libreria con il controller reale che ho in
casa, un avvitatore Rexroth Nexo. Dopo la sottoscrizione è arrivato il primo
risultato. Poi ho staccato la WLAN del controller e ho fatto un nuovo
serraggio. Quando la rete è tornata, la libreria si è riconnessa e ha
recuperato con il MID 0064 il risultato perso. Alla fine l'applicazione aveva
ricevuto entrambi i risultati, una volta sola ciascuno. La prova ha anche fatto
emergere un problema che il simulatore non poteva mostrare: il tentativo di
connessione non ha un timeout, e con la rete giù resta appeso finché la rete
torna o il sistema operativo rinuncia. Lo correggerò a parte.

Se si volesse guardare il codice, consiglierei di partire da
`DeviceConnection.ts` e `ResultDelivery.ts`, e poi dal test `Chaos.test.ts`.
Sono tutti in `packages/open-protocol`.

## Perché l'ho fatto

Questo servizio l'ho già scritto una volta, con NestJS, ed è in produzione. Lì
ho avuto tre problemi seri. Un risultato salvato due volte. Un messaggio
inatteso arrivato da un controller, che ha fatto cadere il servizio e quindi la
connessione con tutti gli altri controller. E dei risultati persi mentre la rete
era giù.

Volevo provare a riscriverlo da zero con Effect, per vedere quanto mi avrebbe
aiutato a gestire, o a evitare del tutto, alcuni dei problemi citati sopra.

## Le scelte principali

- **Solo Effect, senza NestJS.** Chi non conosce Effect fa più fatica a
  leggerlo, ma errori, risorse e retry funzionano tutti allo stesso modo.
- **La rete è un servizio sostituibile.** Nei test uso una versione in memoria,
  così posso controllare il tempo e i guasti. Il rovescio è che è più gentile
  della rete vera, e infatti un bug l'ho visto solo quando ho attivato la connessione TCP.
- **Una richiesta alla volta per controller.** Le risposte del protocollo non
  dicono a quale richiesta si riferiscono, e la specifica ammette un solo
  messaggio in attesa di risposta. Per questo la libreria manda una richiesta e
  aspetta la risposta prima di mandare la successiva. Le richieste vanno in
  fila, ma sono poche e non pesa.
- **L'ack parte solo dopo che l'applicazione ha gestito il risultato.**
  L'alternativa era confermare subito, ma se l'applicazione poi fallisce il
  risultato è perso. Il prezzo è che l'applicazione deve saper ignorare un
  doppione.

Sono spiegate più nel dettaglio in
[Technical decisions](docs/REFERENCE.md#technical-decisions).

## Uso dell'AI

Il design l'ho scritto io, partendo da quello che avevo già sviluppato con
NestJS: modello di concorrenza, gestione delle connessioni, delivery dei
risultati e comportamento in caso di errore. Il codice e i test li ha poi
scritti Claude, seguendo quel design e i miei suggerimenti durante lo
sviluppo. L'ho usato anche per esplorare alternative e per fare review del
codice.

Non ho mai considerato l'output dell'AI come fonte di verità. Il comportamento
l'ho verificato contro la specifica del protocollo e, per Effect, contro la
documentazione e il codice sorgente. Il test di caos ha poi trovato bug che né
io né il modello avevamo visto leggendo il codice.

Nelle cartelle `.claude/`, `explorations/` e `goals/` ho lasciato parte del
processo usato durante lo sviluppo.

## Cosa ho imparato

Più di tutto, che certi bug non si trovano rileggendo il codice. Il test che
simula i guasti ne ha trovati otto, tutti di risultati persi senza nessun
errore. Il codice sembrava giusto. Li ho trovati solo facendolo girare tante
volte e controllando che i conti tornassero.

Su questo problema Effect ha aiutato soprattutto in due punti. Gli errori
stanno nel tipo, e il tempo si testa senza aspettare davvero.


Con più tempo approfondirei Cluster di Effect. Oggi serve un'istanza del
servizio per ogni gruppo di controller, e se quell'istanza cade si perde la
connessione con tutti. Con Cluster ogni controller potrebbe essere gestito da
un'istanza qualsiasi e spostarsi su un'altra se la prima cade. Poi proverei la
libreria su altri modelli di controller e con interruzioni più lunghe.
