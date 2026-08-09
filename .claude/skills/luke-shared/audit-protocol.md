# Luke Audit Protocol — shared rules

Protocollo comune a tutte le skill `luke-*`: `/luke-audit`, `/luke-bugs`,
`/luke-security`, `/luke-full`, `/luke-test`, `/luke-fix`, `/luke-docs`.
Ogni skill lo legge prima di iniziare; i controlli specifici restano nel file
della singola skill.

## Applicabilità

Non tutte le sezioni valgono per tutte le skill: §2, §3 e §5 presuppongono che la
skill produca _finding_, e `/luke-test`, `/luke-fix`, `/luke-docs` non ne producono.

Questa tabella è l'unico posto dove l'applicabilità è scritta. Prima viveva nella
riga con cui ogni skill puntava qui, e ogni skill ne aveva inventata una versione
diversa: quattro dicevano «applicalo» senza qualificare, `/luke-test` citava la
sola §1, `/luke-fix` e `/luke-docs` non puntavano affatto — pur scrivendo file.

| §   | Regola                             | Si applica a                                            |
| --- | ---------------------------------- | ------------------------------------------------------- |
| 1   | Scoping sul diff                   | tutte                                                   |
| 2   | Baseline                           | audit, bugs, security, full                             |
| 3   | Escalation a regola deterministica | audit, bugs, security, full                             |
| 4   | `lessons.md` come input di check   | audit, bugs, security, full                             |
| 5   | Onestà dello score                 | audit, bugs, security, full                             |
| 6   | Niente fan-out                     | chi dichiara `agent: Explore`                           |
| 7   | Sessioni concorrenti               | tutte — §7.2 solo per chi scrive file (test, fix, docs) |

---

## 1. Scoping — default sul diff, non sul monorepo

Uno scan dell'intero monorepo produce le stesse finding ad ogni run, costa molto e
si lancia raramente. L'obiettivo è l'opposto: costo basso, uso ad ogni sessione.

Interpreta `$ARGUMENTS` così:

| Forma                  | Comportamento                                                            |
| ---------------------- | ------------------------------------------------------------------------ |
| _(vuoto)_              | **Default**: file cambiati rispetto al merge-base col branch di sviluppo |
| `--since <ref>`        | File cambiati rispetto a `<ref>`                                         |
| `--full`               | Intero monorepo (esplicito)                                              |
| `<path>`               | Solo quel path, ricorsivo                                                |
| `<path> --since <ref>` | Intersezione dei due                                                     |

Per ricavare il set di default:

```bash
# branch di sviluppo corrente (develop-*), fallback su main
BASE=$(git branch -r --list 'origin/develop-*' | sort -V | tail -1 | sed 's|origin/||' | xargs)
BASE=${BASE:-main}
git diff --name-only "$(git merge-base HEAD "$BASE")"...HEAD
git diff --name-only HEAD          # modifiche non committate
git ls-files --others --exclude-standard  # file nuovi non tracciati
```

Unisci i tre elenchi. Se il risultato è vuoto, dillo e fermati — non ripiegare
sullo scan completo senza chiederlo.

**Contesto oltre il diff**: leggi comunque i file di verità (`CLAUDE.md`,
`lessons.md`, schemi in `packages/core/src/schemas/`) e i file direttamente
importati da quelli cambiati. Il diff limita _cosa segnali_, non _cosa leggi_.

---

## 2. Baseline — segnala solo il nuovo

File: `.luke-audit-baseline.json` nella root del progetto. Se non esiste, trattalo
come vuoto (nessuna soppressione).

```json
{
  "version": 1,
  "entries": [
    {
      "key": "luke-audit:apps/api/src/lib/foo.ts:raw-sql-outside-nav",
      "reason": "query DISTINCT ON non esprimibile in Prisma, eccezione documentata in CLAUDE.md",
      "addedAt": "2026-07-29"
    }
  ]
}
```

`key` = `<skill>:<path relativo>:<slug della regola>`. **Mai includere il numero di
riga**: driftano ad ogni edit e renderebbero la soppressione inutile.

Regole:

1. Calcola la `key` di ogni finding prima di riportarla.
2. Se la `key` è in baseline, **non riportarla** nel corpo del report.
3. A fine report indica solo il conteggio: `N finding soppresse da baseline`.
4. **Non scrivere mai** tu il file di baseline. Proponi le righe da aggiungere in
   un blocco separato; è l'utente a decidere cosa accettare.

Il senso: una finding che riemerge ad ogni run e viene ignorata ogni volta educa
a ignorare il report. O si ripara, o si accetta esplicitamente.

---

## 3. Escalation a regola deterministica — obbligatoria

**La regola più importante di questo protocollo.**

Una finding trovata da un LLM è un controllo debole: non deterministico, costoso,
e ritrovabile solo se qualcuno lancia la skill. Una regola semgrep o eslint è
gratuita, ripetibile e gira in CI su ogni push.

Ad ogni run, prima del report finale:

1. Raggruppa le finding per classe (stessa regola, file diversi).
2. Per ogni classe con **≥2 occorrenze**, oppure già presente in un report
   precedente, valuta se è esprimibile come pattern sintattico.
3. Se sì, **proponi la regola** invece di limitarti a elencare le occorrenze:
   - pattern puramente sintattico → `.semgrep/rules/<nome>.yml`
   - richiede il type checker o l'AST TypeScript → `packages/eslint-plugin-luke/rules/<nome>.js`
4. Includi la regola scritta, pronta da incollare, e il comando per verificarla.

Report in coda, sempre presente:

```
### Promozione a regola

| Classe di finding | Occorrenze | Livello proposto | File |
|---|---|---|---|
| ... | N | semgrep / eslint | .semgrep/rules/....yml |

<regola completa, pronta da incollare>
```

Se nessuna classe è promuovibile: `Nessuna classe promuovibile in questo run.`

**Gerarchia dei controlli** — ogni finding va spinta più in alto possibile:

1. Impossibile da sbagliare (tipi, schema Prisma, vincoli DB)
2. Bloccato automaticamente (eslint, semgrep, test in CI)
3. Segnalato deterministicamente (drift check, osv-scanner)
4. Trovato da un LLM ← **stato di partenza, non di arrivo**

---

## 4. lessons.md come input di check

`lessons.md` nella root registra le regressioni già pagate — inclusa quella che ha
causato l'hotfix v1.9.1 (drift fra `RATE_LIMIT_CONFIG`, `DEFAULTS` e
`RateLimitConfigSchema`). Va **letto ad ogni run** e usato come lista di controlli:

1. Leggi `lessons.md`.
2. Per ogni lesson con una forma meccanica verificabile, controlla che il codice
   nello scope non la violi.
3. Se una lesson è esprimibile come regola semgrep/eslint e non lo è ancora,
   includila nella sezione "Promozione a regola" (§3).

Una lesson che nessuno verifica è documentazione, non un controllo.

---

## 5. Onestà dello score

Se la skill produce un punteggio, deve essere calcolato **solo sulle finding nuove**
(post-baseline). Un punteggio che include finding accettate non è comparabile fra
run e scende per ragioni che non riguardano il codice appena scritto.

Indica sempre, accanto allo score, il numero di finding soppresse.

---

## 6. Capacità dell'agente — niente fan-out nelle skill Explore

`/luke-audit`, `/luke-bugs` e `/luke-security` dichiarano `agent: Explore` nel
frontmatter. **Un agente Explore non ha il tool Agent**: non può invocare
subagenti.

Le tre skill contenevano "Run 3 agents in parallel" con tre brief dettagliati.
Non è mai stato eseguito: ogni report `luke-*` mai letto è stato prodotto da un
passaggio singolo e sequenziale sulle tre checklist. Un fan-out dichiarato e mai
avvenuto è la stessa classe di difetto che questo protocollo esiste per trovare —
solo, dentro il protocollo stesso.

**Regola: una skill con `agent: Explore` non deve contenere istruzioni per
invocare subagenti.** Verificata da `tools/scripts/check-skill-integrity.ts`, che
gira in CI.

Il fan-out non va ripristinato passando a `agent: general-purpose`. Le tre skill
aprono con "Read-only. Do NOT modify any file", e oggi quel vincolo è garantito
**dal tipo di agente**, che non ha tool di scrittura. Passare a
`general-purpose` per sbloccare i subagenti consegnerebbe Write ed Edit a delle
skill di sola lettura: un invariante strutturale degradato a istruzione in prosa,
in cambio di un parallelismo che non è mai esistito.

Il fan-out esiste già alla granularità giusta: `/luke-full` (`agent:
general-purpose`) orchestra le tre skill via `Skill()`, ciascuna nel proprio
contesto forkato — tre lavori diversi, non tre fette della stessa checklist.

**Contropartita**: le tre aree girano davvero in un contesto solo, quindi su
scope `--full` il contesto può esaurirsi. Lo scope di default è il diff, perciò
morde solo su `--full` esplicito. Se succede, la risposta è `/luke-full`, non
resuscitare il fan-out.

---

## 7. Sessioni concorrenti

Due sessioni Claude Code sullo stesso repo condividono working tree, database di
test e cache: sono processi diversi sulle stesse risorse, senza alcun arbitro.

Il sintomo osservato è una skill che **si ferma** trovando file che non ha scritto
lei, li tratta come anomalia e interrompe il lavoro. Sono file di un'altra sessione
viva. La risposta giusta non è fermarsi: è riconoscerli, non toccarli, e proseguire.

### 7.1 Identità e censimento

`$CLAUDE_CODE_SESSION_ID` è l'identità della sessione. Resta la stessa nei
subagenti (`/luke-full` che invoca le tre skill di audit condivide la propria), e
quindi anche fra skill successive dello stesso turno di lavoro.

Ogni sessione ha già una scratchpad dir che porta quel nome; le sessioni sorelle
sono directory adiacenti. Nessun registro nuovo da inventare:

```bash
SESSIONS_ROOT=$(dirname "$(find /private/tmp/claude-* -maxdepth 2 -type d \
  -name "$CLAUDE_CODE_SESSION_ID" 2>/dev/null | head -1)")
LEDGER="$SESSIONS_ROOT/$CLAUDE_CODE_SESSION_ID/scratchpad/luke-written.txt"

# File scritti da sessioni ancora vive (ledger toccato negli ultimi 30 minuti)
find "$SESSIONS_ROOT" -maxdepth 3 -name luke-written.txt -mmin -30 \
  -not -path "*/$CLAUDE_CODE_SESSION_ID/*" -exec cat {} +
```

La liveness è l'mtime del ledger, non un heartbeat né un PID: la skill può girare
in un subagente con PID proprio, e un protocollo di heartbeat sarebbe infrastruttura
nuova per un fatto che il filesystem già registra.

**Un ledger vecchio non vincola nessuno.** È deliberato: i file scritti da una
sessione di ieri devono restare modificabili oggi, altrimenti la seconda run di
`/luke-test` sugli stessi test si rifiuterebbe di aggiornarli.

### 7.2 Ledger e proprietà dei file — solo per le skill che scrivono

1. Appendi a `$LEDGER` il path di **ogni** file che scrivi, uno per riga, subito
   dopo averlo scritto.
2. All'avvio calcola il set dei file di sessioni vive diverse dalla tua.
3. Un file in quel set **non si riscrive**: leggilo pure come contesto, evita di
   duplicarne il contenuto, ed elencalo in output come `di altra sessione, non
toccato`. **Non è un errore e non interrompe il lavoro.**
4. Un file nel ledger della **tua** sessione è tuo, anche se scritto da una skill
   precedente: modificalo normalmente.

Il set è vuoto quando giri da solo, e ogni percorso resta identico a oggi.

### 7.3 Risorse condivise non partizionabili

Il database di test è uno solo: porta fissa `5434`, nome fisso, e l'isolamento fra
test è un `TRUNCATE` di tutte le tabelle. Due run di integrazione in parallelo si
cancellano le fixture a vicenda, e il fallimento sembra un bug del prodotto.
`fileParallelism: false` serializza dentro un processo vitest, non fra processi.

- Prima di lanciare i test di integrazione: se `pgrep -f vitest` trova una run
  altrui, aspetta o salta il passo — e dillo nell'output.
- Mai `pnpm test:db:down`: cancella il volume sotto la run di un'altra sessione.

### 7.4 Revert — mai con git

Ripristinare un file dopo una modifica fallita si fa **annullando la propria
Edit**, mai con `git checkout` o `git restore` sul file.

Il comando git non distingue la tua modifica dal resto: butta via anche il lavoro
non committato dell'altra sessione e quello dell'utente. È distruttivo già in
sessione singola; la concorrenza lo rende solo più probabile.
