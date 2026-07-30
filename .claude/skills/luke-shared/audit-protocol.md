# Luke Audit Protocol — shared rules

Protocollo comune a `/luke-audit`, `/luke-bugs`, `/luke-security`, `/luke-full`.
Ogni skill lo legge prima di iniziare. Qui vivono le regole di **scoping**,
**baseline**, **escalation a regola** e **uso di lessons.md**; i controlli specifici
restano nel file della singola skill.

---

## 1. Scoping — default sul diff, non sul monorepo

Uno scan dell'intero monorepo produce le stesse finding ad ogni run, costa molto e
si lancia raramente. L'obiettivo è l'opposto: costo basso, uso ad ogni sessione.

Interpreta `$ARGUMENTS` così:

| Forma | Comportamento |
|---|---|
| *(vuoto)* | **Default**: file cambiati rispetto al merge-base col branch di sviluppo |
| `--since <ref>` | File cambiati rispetto a `<ref>` |
| `--full` | Intero monorepo (esplicito) |
| `<path>` | Solo quel path, ricorsivo |
| `<path> --since <ref>` | Intersezione dei due |

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
importati da quelli cambiati. Il diff limita *cosa segnali*, non *cosa leggi*.

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
