# effect-open-protocol

Un client per Open Protocol, il protocollo con cui si parla con gli avvitatori
industriali (i controller), scritto con [Effect](https://effect.website) v4.
La libreria non gestisce i controller: si occupa solo della connessione con
loro. Deve restare collegata anche quando la rete cade, e consegnare ogni
risultato di serraggio all'applicazione una volta sola, oppure dire che non ci
riesce.

Ogni serraggio produce un risultato: coppia, angolo, esito. È un dato di
tracciabilità. Se un'auto esce dalla linea e la coppia di un bullone non è
stata registrata, nessuno può più dire se era stretto bene. Ma le reti di
fabbrica non aiutano, e il protocollo nemmeno. Non ha un identificativo di
correlazione, ammette un solo messaggio in attesa di risposta, chiude dopo
quindici secondi di silenzio, e abbandona un risultato di cui non arriva la
conferma. La parte difficile non è leggere i byte. È quando riprovare, quando
arrendersi, e come dimostrare che funziona.

Documentazione completa, in inglese, in [docs/REFERENCE.md](docs/REFERENCE.md).

## Come provarlo

Serve [Bun](https://bun.sh) 1.3. `bun install`, poi `bun run test`: 158 test,
con il tempo simulato, quindi keep-alive, timeout e backoff si verificano senza
aspettare davvero.

### Sul controller vero

La prova che conta l'ho fatta su un avvitatore Rexroth Nexo che ho in casa, e
quella sessione è dentro il repository. Quattro minuti di controller vero su
WLAN vera, 142 eventi registrati, ogni byte che è passato sul socket:

```sh
EFFECT_OPEN_PROTOCOL_TRACE_DB=../../docs/traces/nexo.sqlite bun run ui
```

Nella lista c'è un run solo. Aprendolo si vedono i suoi frame in ordine, con
tempo, direzione e MID. La storia da seguire è questa:

- **16:01:33.** Handshake (MID 0001/0002), poi MID 0064 per chiedere l'ultimo
  risultato del controller. È 2636, e diventa la base da cui contare. Poi la
  sottoscrizione, MID 0060, accettata con 0005.
- **16:01:52.** Arriva un serraggio, MID 0061 con id 2637. Il client lo
  consegna all'applicazione e **solo dopo** risponde con 0062.
- **16:02:13.** Qui ho spento la WLAN del controller e ho fatto sette serraggi.
  Il keep-alive di quel minuto non riceve risposta, e il client dichiara persa
  la sessione. Poi la traccia tace. Con la rete giù non c'è niente da
  registrare.
- **16:02:34.** Riaccendo la WLAN. Nuovo handshake, e il MID 0064 risponde
  2644, sette avanti rispetto all'ultimo consegnato. Il client chiede 2638,
  2639, fino a 2644, uno alla volta, e in trecento millisecondi li ha tutti.
  **Solo a quel punto** si risottoscrive. Il controller quei sette non li ha
  mai spinti sulla nuova sottoscrizione. Senza questo passaggio erano persi.
- **16:02:59.** Arriva un serraggio nuovo, 2645, e il client lo conferma come
  il primo. Nove risultati consegnati in tutto il run, nessuno due volte.

Chi ha un controller Open Protocol può rifare la stessa prova puntandoci il
client. Sul controller non serve configurare niente, perché il client legge e
basta. Non manda comandi che ne cambiano lo stato.

```sh
bun run client -- --host <ip-del-controller> --port 4545
```

I passi, e cosa deve comparire a ognuno, sono in
[Repeating it with your own controller](docs/REFERENCE.md#repeating-it-with-your-own-controller).

### Senza un controller

C'è un controller simulato, nel repository solo per questo motivo. Tre
terminali dalla radice:

```sh
bun run controller -- --port 4545 --result-interval 2000 --fault-rate 0.15
bun run client     -- --port 4545 --latency 40 --jitter 15
bun run ui                                    # http://localhost:3000
```

Il client è sempre la libreria vera. Aspetta che `--fault-rate` rompa il link.
Premi Invio nel controller mentre è giù, e produce un risultato che il client
non può ricevere. Poi guarda succedere quello che si è visto sul Nexo. Ctrl-C
stampa i conti da entrambi i lati.

E c'è una demo non interattiva: tre controller simulati, guasti a seed fisso.

```sh
bun run demo -- --seed 7 --duration 20 --devices 3 --fault-rate 0.2
```

```text
Results generated:        274
Results delivered:        274
Duplicates discarded:     41
Results lost:             0   OK
Delivered twice:          0   OK
```

**Generati uguali a consegnati, e nessuno consegnato due volte.** Ogni
decisione casuale viene dal seed, quindi un run che fallisce si riproduce
identico. Lo stesso scenario gira su cinquanta seed con `bun run soak`.

Per leggere il codice partirei da `DeviceConnection.ts` e `ResultDelivery.ts`,
poi dal test `Chaos.test.ts`, tutti in `packages/open-protocol`. Il resto del
workspace è di contorno: `packages/store` e `apps/ui` sono il registratore di
traffico e il suo visualizzatore, `packages/cli` i comandi qui sopra.

## Perché l'ho fatto

Questo servizio l'ho già scritto una volta, con NestJS, ed è in produzione. Lì
ho avuto tre problemi seri: un risultato salvato due volte; un messaggio
inatteso da un controller, che ha fatto cadere il servizio e con lui la
connessione verso tutti gli altri controller; dei risultati persi mentre la
rete era giù. Volevo riscriverlo da zero con Effect per vedere quanto mi
avrebbe aiutato a gestire, o a evitare del tutto, quei problemi. Nessuna riga
riportata dalla versione precedente. Il confronto fra le due, con quello che
Effect ha reso più facile e quello che è costato, è in
[NestJS vs Effect](docs/REFERENCE.md#nestjs-vs-effect).

## Le scelte principali

- **Solo Effect, senza NestJS.** Chi non conosce Effect fa più fatica a
  leggerlo, ma errori, risorse e retry funzionano tutti allo stesso modo.
- **La rete è un servizio sostituibile.** Nei test uso una versione in memoria,
  così controllo tempo e guasti. Il rovescio è che è più gentile della rete
  vera: un bug l'ho visto solo con la connessione TCP.
- **Una richiesta alla volta per controller.** Le risposte non dicono a quale
  richiesta si riferiscono, e la specifica ammette un solo messaggio in attesa.
  Le richieste vanno in fila, ma sono poche e non pesa.
- **L'ack parte solo dopo che l'applicazione ha gestito il risultato.**
  L'alternativa era confermare subito, ma se l'applicazione poi fallisce il
  risultato è perso. Il prezzo è che l'applicazione deve saper ignorare un
  doppione: dedup e watermark stanno in memoria, e un riavvio li dimentica.
- **Una callback, non uno stream.** Con uno stream la libreria non sa quando il
  consumer ha davvero gestito un elemento, e l'ack diventa una scommessa.

Più nel dettaglio in
[Technical decisions](docs/REFERENCE.md#technical-decisions), insieme ai
[limiti noti](docs/REFERENCE.md#known-limits).

## Uso dell'AI

Il design l'ho scritto io, partendo da quello che avevo già sviluppato con
NestJS: modello di concorrenza, gestione delle connessioni, delivery dei
risultati e comportamento in caso di errore. Il codice e i test li ha poi
scritti Claude, seguendo quel design e i miei suggerimenti durante lo sviluppo.
L'ho usato anche per esplorare alternative e per fare review del codice.

Non ho mai considerato l'output dell'AI come fonte di verità: il comportamento
l'ho verificato contro la specifica del protocollo e, per Effect, contro la
documentazione e il codice sorgente. Nelle cartelle `.claude/`, `explorations/`
e `goals/` ho lasciato parte del processo.

## Cosa ho imparato

Che certi bug non si trovano rileggendo il codice. Otto risultati persi in
silenzio: tre trovati dal test di caos, altri cinque dal soak quando sono
passato da due seed a decine. Nessuno alzava un errore o faceva fallire un
test. Il codice sembrava giusto, ed era giusto per il percorso che avevo in
mente. Due dei cinque erano dentro codice scritto per correggere i primi tre.
La prova sul Nexo ha aggiunto quello che il simulatore non poteva mostrare: il
tentativo di connessione non aveva timeout, e la libreria confermava con 0062
anche i risultati recuperati, che non lo richiedono. Entrambi corretti.

Su questo problema Effect ha aiutato soprattutto in due punti: gli errori
stanno nel tipo, e il tempo si testa senza aspettare davvero.

Con più tempo approfondirei Cluster di Effect. Oggi serve un'istanza del
servizio per ogni gruppo di controller, e se quell'istanza cade si perde la
connessione con tutti; con Cluster ogni controller sarebbe un'entità che
qualsiasi istanza può possedere, e passerebbe a un'altra se la prima cade. Poi
proverei altri modelli di controller e interruzioni più lunghe.
