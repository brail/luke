# Genoma della Collezione — Recepimento in LUKE

**Rif.** "Genoma della Collezione: Algoritmo di Alert e Sistema di Monitoraggio Avanzamento" (Rev.1, A. Zordan, 1/7/26)
**Stato**: analisi di fattibilità e mappatura sull'architettura esistente. Il piano implementativo (task, migration, stime) è documento separato, a valle di questo.

## Premessa

Il documento originale descrive un sistema concettuale nuovo (PHASE, CALENDAR TEMPLATE, CALENDAR INSTANCE, COLLECTION LAYOUT, Motore di Alert). In LUKE gran parte di queste entità esiste già, sotto altri nomi, a seguito del lavoro di calendario svolto nei mesi scorsi. Questo documento riconcilia i due vocabolari e segnala dove serve estendere il modello dati, dove basta riusare, e dove abbiamo scelto un approccio diverso da quanto ipotizzato nel PDF — con la motivazione.

## 1. Il Core Statico

| Concetto PDF | Corrispondente LUKE | Note |
|---|---|---|
| PHASE | Nuova entità `Phase` (catalogo ordinato) | Oggi esistono due cataloghi separati e non collegati: lo stato di produzione della riga di collezione (`CollectionLayoutRow.progress`) e il tipo di evento calendario (`CalendarEvent.type`). Li unifichiamo in un unico catalogo `Phase`, condiviso da entrambi i domini. È la base che rende possibile confrontare "a che fase è la riga" con "a che fase è il calendario" nello stesso linguaggio. |
| CALENDAR TEMPLATE | `MilestoneTemplate` + `MilestoneTemplateItem` (già esistenti) | Ogni voce del template avrà un riferimento opzionale alla `Phase` corrispondente (opzionale perché un template può contenere anche eventi che non rappresentano una fase produttiva, es. una riunione di revisione). |
| LEAD TIME tra fasi | Implicito nell'offset del template | Il meccanismo attuale calcola la data di ogni voce del template come "data di ancoraggio + un numero di giorni di scostamento" (`offsetDays`). Questo produce esattamente lo stesso risultato del calcolo a ritroso descritto nel PDF, senza bisogno di un algoritmo nuovo: se l'ancoraggio coincide con l'ultima fase, gli scostamenti negativi delle fasi precedenti *sono* il backward scheduling. Non introduciamo una nuova formula, riusiamo quella esistente con questa lettura. |

## 2. L'Istanziazione Stagionale

### Anima A — Linea Temporale

Corrisponde a `SeasonCalendar` (esistente): un calendario per combinazione Marchio+Stagione, contenente gli eventi (`CalendarEvent`) generati dall'applicazione del template.

**Precisazione rispetto al PDF**: la segmentazione per Marchio+Categoria di Prodotto, descritta nel documento come driver per istanziare *più* calendari, non genera in LUKE calendari multipli. Un calendario resta unico per Marchio+Stagione (è la definizione stessa di "calendario": l'insieme di tutti gli eventi di quel contesto). La segmentazione per categoria/sottoinsieme di prodotto avviene invece **a livello di singolo evento**, tramite il meccanismo di "aggancio" descritto al punto 4.

**Sintonizzazione e Congelamento**: introduciamo un passaggio guidato (wizard), obbligatorio prima del congelamento, in cui l'utente scorre gli eventi generati dal template uno per uno e:
- verifica/aggiusta la data tenendo conto di festività e chiusure fornitore già censite in LUKE;
- decide se l'evento si applica a tutte le righe di collezione del layout o solo a un sottoinsieme (vedi punto 4).

Solo al termine del wizard il calendario può essere congelato. Il congelamento salva una copia immutabile delle date raggiunte (data ufficiale), distinta dalla data "di lavoro" che resta modificabile sul template — così un successivo intervento sul template padre non altera retroattivamente calendari già congelati.

### Anima B — Oggetto Fisico

Corrisponde a `CollectionLayout` / `CollectionLayoutRow` (esistenti), nessuna modifica strutturale al contenitore. Il collegamento riga→calendario è già implicito: la riga appartiene a un layout, il layout a Marchio+Stagione, che identifica univocamente il calendario.

Lo "Stato di Avanzamento" descritto nel PDF corrisponde al campo `progress` della riga, che verrà migrato a riferimento verso il nuovo catalogo `Phase` (vedi punto 1).

## 3. Il Sistema di Registrazione e Misurazione

Riprendiamo il concetto proposto (tupla riga/fase/data effettiva) con una tabella storica dedicata, distinta dal log di audit generale già presente in LUKE. Motivazione: il log di audit esistente è pensato per tracciabilità/compliance (chi ha fatto cosa), non per interrogazioni statistiche ad alto volume; una tabella dedicata a "quando la riga X ha raggiunto la fase Y" permette query dirette per i KPI di scostamento descritti nel documento, senza dover interpretare contenuti liberi.

## 4. Gestione dei sottoinsiemi ("fork")

Questo è il punto di maggiore scostamento — e maggiore semplificazione — rispetto all'impostazione iniziale del PDF.

Il PDF non tratta esplicitamente il caso in cui uno stesso evento di calendario debba avere date diverse per sottoinsiemi diversi di prodotti (es. "Rendering" a luglio per una parte della collezione, a settembre per un'altra, con "Consegna Finale" comune a tutti). Discutendo il caso con il team, la soluzione individuata non richiede un motore di regole nuovo: **si ottiene componendo dati già esistenti nel modello LUKE**.

Meccanismo:
- Un evento di calendario può essere "agganciato" (associato) all'intero layout, oppure a un sottoinsieme specifico di righe.
- Se un evento non ha nessun aggancio esplicito, si considera valido per tutte le righe (comportamento di default, nessuna configurazione necessaria per il caso semplice/lineare).
- Una fase può comparire più volte nello stesso calendario con date diverse (es. due eventi "Rendering", uno a luglio uno a settembre), ciascuno agganciato a un sottoinsieme differente e mutuamente esclusivo di righe.
- Un evento successivo senza aggancio (es. "Collezione Lanciata") torna automaticamente a valere per tutte le righe, indipendentemente dal ramo seguito in precedenza — è così che i due sottoinsiemi "si ricongiungono", senza bisogno di un'operazione esplicita di merge.

Il motore di alert, per ogni riga, considera solo gli eventi a cui la riga è effettivamente agganciata (o non ristretti): questo fa emergere il comportamento "a rami" senza dover implementare una logica di attraversamento di grafo. Segnaliamo esplicitamente che questa scelta è coerente con la recente semplificazione del modulo calendario (rimozione del motore a vincoli/solver), di cui manteniamo lo spirito: nessuna nuova componente di calcolo strutturale, solo composizione di dati.

## 5. Il Motore di Alert

Confermiamo l'impostazione del PDF (Fase I: identificazione evento attivo; Fase II: matrice di criticità), con due adattamenti:

1. **Il calcolo della "Data Limite"** si semplifica: coincide con la data-obiettivo già calcolata per la fase in cui si trova attualmente la riga, all'interno dello stesso calendario. Matematicamente equivale alla sottrazione dei lead time intermedi proposta nel PDF, ma non richiede di ripetere quel calcolo: il dato è già disponibile.
2. **Le soglie di criticità (10 giorni, 5-9 giorni, ecc.) e i colori associati non sono fissati nel codice**, ma gestiti in un catalogo configurabile da chi amministra il sistema (stessa filosofia già in uso in LUKE per altri parametri di processo). Questo permette di tarare le soglie nel tempo senza intervento tecnico, e di far evolvere in futuro anche il numero di livelli di criticità, se necessario.

Il calcolo dell'alert non viene salvato in database: si ricalcola ogni volta che serve, rispetto alla data corrente. Scelta motivata dal voler evitare uno stato duplicato che può disallinearsi dal dato sorgente.

## 6. Sistema di Monitoraggio ad Alto Livello

Confermiamo le tre proposte del documento originale, da realizzare come viste all'interno dell'area Prodotto di LUKE, visibili a chi ha accesso sia alla pianificazione calendario sia al layout di collezione:

1. **Dashboard Termografica di Saturazione** — vista per Marchio × Categoria, come da proposta.
2. **Indice di Strozzatura** — vista per evento attivo, come da proposta.
3. **Monitoraggio Predittivo di Stagnazione** — basato sui dati storici della tabella di cui al punto 3, come da proposta.

Nessuna modifica sostanziale rispetto a quanto descritto nel PDF su questo punto.

## Sintesi degli scostamenti rispetto al documento originale

| Punto PDF | Scelta LUKE | Motivo |
|---|---|---|
| Calendario multiplo per segmento | Calendario unico per Marchio+Stagione, segmentazione a livello di singolo evento | Coerenza con la definizione di "calendario" già in uso; evita proliferazione di istanze da gestire separatamente |
| Calcolo esplicito della Data Limite via somma lead time | Riuso diretto della data-obiettivo già calcolata per la fase corrente | Stesso risultato, nessun calcolo duplicato |
| Soglie di alert implicite nel testo | Soglie e colori in catalogo configurabile | Evita hardcoding, consente tuning senza rilascio |
| Nessuna trattazione esplicita dei sottoinsiemi/fork | Meccanismo di aggancio evento↔sottoinsieme, senza motore a grafo | Copre il caso reale (vedi schema condiviso) senza reintrodurre la complessità del motore a vincoli appena rimosso |

---

*Documento di allineamento concettuale. Il piano implementativo (modifiche a schema dati, servizi, interfaccia) segue come documento a parte.*
