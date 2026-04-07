# extract_access_queries.py (rev3 - verbose & resilient)
import argparse
import json
import os
import sys
from pathlib import Path

import win32com.client as win32

DAO_PROGIDS = [
    "DAO.DBEngine.120",  # ACE 12+ (Access 2007+)
    "DAO.DBEngine.36",   # Jet 4.0 (Access 97–2003)
    "DAO.DBEngine"       # fallback
]

DB_OPEN_DYNASET = 2
DB_OPEN_SNAPSHOT = 4

def log(msg, *, step=None, verbose=True):
    if not verbose:
        return
    if step:
        print(f"[STEP {step}] {msg}")
    else:
        print(f"[INFO] {msg}")

def warn(msg):
    print(f"[WARN] {msg}")

def err(msg):
    print(f"[ERROR] {msg}", file=sys.stderr)

def get_dao_engine(verbose=True):
    last_err = None
    for progid in DAO_PROGIDS:
        try:
            log(f"Tento inizializzazione {progid}…", verbose=verbose)
            eng = win32.gencache.EnsureDispatch(progid)
            # extra: leggi versione se disponibile
            try:
                ver = getattr(eng, "Version", None)
                if ver:
                    log(f"OK: {progid} Version={ver}", verbose=verbose)
                else:
                    log(f"OK: {progid} (versione non disponibile)", verbose=verbose)
            except Exception:
                log(f"OK: {progid} (impossibile leggere Version)", verbose=verbose)
            return eng
        except Exception as e:
            last_err = e
            warn(f"Fallito {progid}: {e}")
    raise RuntimeError(f"Impossibile inizializzare DAO. Ultimo errore: {last_err}")

def open_database(dao, path, password=None, read_only=True, verbose=True):
    connect = ""
    if password:
        connect = f";PWD={password}"
    log(f"Apro database: {path}", step=2, verbose=verbose)
    try:
        db = dao.OpenDatabase(str(path), False, read_only, connect)
    except Exception as e:
        raise RuntimeError(
            "OpenDatabase fallita.\n"
            "Cause comuni:\n"
            "- Mancanza di Access/Access Database Engine (ACE/Jet).\n"
            "- Mismatch 32/64 bit (Python 64-bit richiede ACE 64-bit).\n"
            "- Password errata o file bloccato/aperto).\n"
            f"Dettaglio: {e}"
        )
    try:
        name = getattr(db, "Name", None)
        log(f"Database aperto: {name}", verbose=verbose)
    except Exception:
        pass
    return db

def sanitize_filename(name: str) -> str:
    bad = '<>:"/\\|?*'
    out = "".join("_" if c in bad else c for c in name)
    return (out.strip() or "query")[:128]

def ensure_outdir(outdir: Path, verbose=True):
    (outdir / "queries").mkdir(parents=True, exist_ok=True)
    # crea anche un README per indicare che la cartella è stata generata
    readme = outdir / "queries" / "_README.txt"
    if not readme.exists():
        readme.write_text(
            "Cartella generata da extract_access_queries.py (rev3). "
            "Contiene un .sql per ogni query salvata trovata.\n", encoding="utf-8"
        )
    log(f"Cartella output: {outdir}", step=1, verbose=verbose)

def collect_querydefs(db, include_hidden=True, verbose=True):
    res = []
    qdefs = db.QueryDefs
    cnt = 0
    for q in qdefs:
        name = str(q.Name)
        is_hidden = name.startswith("~sq") or name.lower().startswith("msys")
        if not include_hidden and is_hidden:
            continue
        try:
            sql = str(q.SQL)
        except Exception:
            sql = ""
        qtype = getattr(q, "Type", None)
        res.append({
            "name": name,
            "sql": sql,
            "type": int(qtype) if qtype is not None else None,
            "hidden": bool(is_hidden)
        })
        cnt += 1
    log(f"QueryDefs enumerate: {cnt} (post-filtro: {len(res)})", step=3, verbose=verbose)
    if res:
        preview = ", ".join([r['name'] for r in res[:10]])
        log(f"Prime query: {preview}{' …' if len(res)>10 else ''}", verbose=verbose)
    return res

def collect_from_msysobjects(db, include_hidden=True, verbose=True):
    out = []
    log("Fallback MSysObjects: provo SELECT Name, Flags FROM MSysObjects WHERE Type=5…", step=4, verbose=verbose)
    try:
        rs = db.OpenRecordset(
            "SELECT Name, Flags FROM MSysObjects WHERE Type=5 ORDER BY Name",
            DB_OPEN_SNAPSHOT
        )
    except Exception as e:
        warn(f"Impossibile leggere MSysObjects (permessi?) -> {e}")
        return out
    try:
        while not rs.EOF:
            name = str(rs.Fields("Name").Value)
            flags = rs.Fields("Flags").Value
            flags = int(flags) if flags is not None else 0
            is_hidden = name.startswith("~sq") or name.lower().startswith("msys") or (flags & 1) != 0
            if not include_hidden and is_hidden:
                rs.MoveNext(); continue
            sql = ""
            try:
                qd = db.QueryDefs(name)
                try:
                    sql = str(qd.SQL)
                except Exception:
                    sql = ""
            except Exception:
                sql = ""
            out.append({"name": name, "sql": sql, "type": 5, "hidden": bool(is_hidden)})
            rs.MoveNext()
    finally:
        try: rs.Close()
        except Exception: pass
    log(f"MSysObjects (Type=5) trovate: {len(out)}", verbose=verbose)
    if out:
        preview = ", ".join([r['name'] for r in out[:10]])
        log(f"Prime query (MSys): {preview}{' …' if len(out)>10 else ''}", verbose=verbose)
    return out

def write_outputs(outdir: Path, queries, verbose=True):
    ensure_outdir(outdir, verbose=verbose)

    jsonl_path = outdir / "queries.jsonl"
    sql_path   = outdir / "queries.sql"

    with jsonl_path.open("w", encoding="utf-8", newline="\n") as f:
        for item in queries:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    with sql_path.open("w", encoding="utf-8", newline="\n") as f:
        if not queries:
            f.write("-- Nessuna query salvata trovata.\n")
        for i, q in enumerate(queries, 1):
            f.write(f"-- [{i}] {q['name']}{'  (hidden)' if q.get('hidden') else ''}\n")
            if q["sql"]:
                f.write(q["sql"].rstrip() + "\n")
            else:
                f.write("-- (nessun testo SQL disponibile o query non testuale)\n")
            f.write("\nGO\n\n")

    # file per query
    for q in queries:
        fname = sanitize_filename(q["name"]) + ".sql"
        with (outdir / "queries" / fname).open("w", encoding="utf-8", newline="\n") as f:
            f.write((q["sql"] or "-- (nessun testo SQL disponibile o query non testuale)") + "\n")

    log(f"Scritti file:\n- {jsonl_path}\n- {sql_path}\n- {outdir/'queries'}", step=7, verbose=verbose)
    return jsonl_path, sql_path, (outdir / "queries")

def diagnostic_listing(db, verbose=True):
    log("DIAGNOSTICA: elenco prime 20 tabelle…", step="DIAG-1", verbose=verbose)
    try:
        tdefs = db.TableDefs
        count = 0
        for t in tdefs:
            nm = str(t.Name)
            if nm.lower().startswith("msys"):  # mostra anche MSys, ma etichettale
                tag = "(MSys)"
            else:
                tag = ""
            log(f"  - {nm} {tag}", verbose=verbose)
            count += 1
            if count >= 20:
                break
        log(f"Totale TableDefs (approx): {len([t for t in tdefs])}", verbose=verbose)
    except Exception as e:
        warn(f"Impossibile enumerare TableDefs: {e}")

def main():
    ap = argparse.ArgumentParser(description="Estrai query da Access .mdb/.accdb con debug verboso")
    ap.add_argument("db_path", help="Percorso al file .mdb/.accdb")
    ap.add_argument("-o", "--outdir", default=None, help="Cartella di output (default accanto al file)")
    ap.add_argument("--password", default=None, help="Password del database (se impostata)")
    ap.add_argument("--no-hidden", action="store_true", help="Escludi query nascoste (~sq_*, MSys*)")
    ap.add_argument("--verbose", action="store_true", help="Log dettagliato")
    ap.add_argument("--diag", action="store_true", help="Stampa diagnostica (TableDefs ecc.)")
    args = ap.parse_args()

    verbose = args.verbose or True  # verbose sempre attivo per aiutarti
    dbp = Path(args.db_path).expanduser().resolve()
    if not dbp.exists():
        err(f"File non trovato: {dbp}")
        sys.exit(2)

    outdir = Path(args.outdir) if args.outdir else dbp.parent / f"{dbp.stem}_query_dump"
    ensure_outdir(outdir, verbose=verbose)

    # STEP 0: info processo/Python
    log(f"Python: {sys.version}", step=0, verbose=verbose)
    log(f"Processo a 64-bit: {sys.maxsize > 2**32}", verbose=verbose)

    # STEP 1: DAO init
    try:
        dao = get_dao_engine(verbose=verbose)
    except Exception as e:
        err(str(e))
        warn("Se usi Python 64-bit, installa Access Database Engine 64-bit. Viceversa per 32-bit.")
        sys.exit(3)

    # STEP 2: open DB
    try:
        db = open_database(dao, dbp, password=args.password, read_only=True, verbose=verbose)
    except Exception as e:
        err(str(e))
        sys.exit(4)

    if args.diag:
        diagnostic_listing(db, verbose=verbose)

    include_hidden = not args.no_hidden

    # STEP 3: QueryDefs
    queries = collect_querydefs(db, include_hidden=include_hidden, verbose=verbose)

    # STEP 4: fallback se vuoto
    if not queries:
        log("Nessuna QueryDef trovata (o tutte filtrate). Avvio fallback MSysObjects…", step=5, verbose=verbose)
        queries = collect_from_msysobjects(db, include_hidden=include_hidden, verbose=verbose)

    # STEP 5: riprova includendo hidden se ancora vuoto e l'utente aveva escluso
    if not queries and not include_hidden:
        log("Ancora vuoto con hidden escluse. Riprovo includendo hidden…", step=6, verbose=verbose)
        queries = collect_querydefs(db, include_hidden=True, verbose=verbose)
        if not queries:
            queries = collect_from_msysobjects(db, include_hidden=True, verbose=verbose)

    try:
        db.Close()
    except Exception:
        pass

    # STEP 6/7: output
    jsonl_path, sql_path, qdir = write_outputs(outdir, queries, verbose=verbose)

    # EPILOGO
    print("\n================= RISULTATO =================")
    print(f"Query trovate: {len(queries)}")
    print(f"- {jsonl_path}")
    print(f"- {sql_path}")
    print(f"- {qdir}")
    if not queries:
        print("\nNessuna query salvata trovata.")
        print("Possibili cause:")
        print("• Le SQL sono solo in Form/Report (RecordSource/RowSource) o Macro/VBA.")
        print("• Permessi sulle tabelle di sistema (MSys*) negati.")
        print("• Il file è solo tabelle/relazioni senza QueryDefs.")
        print("Se vuoi, ti fornisco uno script VBA per esportare RecordSource/RowSource da tutti i Form/Report.")
    else:
        hidden_cnt = sum(1 for q in queries if q.get("hidden"))
        if hidden_cnt:
            print(f"Nota: {hidden_cnt} query marcate hidden (~sq_* o MSys).")
    print("============================================")

if __name__ == "__main__":
    main()
