#!/usr/bin/env python3
"""
Extract query names and relationships from Access metadata.
Generate preliminary REVERSE_ENGINEERING.md structure.
"""

import csv
import json
from pathlib import Path
from typing import Dict, List, Set

RAW_DIR = Path(__file__).parent.parent / "raw"
QUERIES_JSON = RAW_DIR / "queries_list.json"
TABLES_QUERIES_CSV = RAW_DIR / "metadata_TabelleInQuery.csv"
DOCS_DIR = Path(__file__).parent.parent


def parse_tabelle_in_query() -> Dict[str, List[str]]:
    """Parse TabelleInQuery.csv to get table-to-query mapping."""
    mapping = {}

    with open(TABLES_QUERIES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            table = row.get("Tabella", "").strip('"')
            query = row.get("Query", "").strip('"')

            if table and query:
                if table not in mapping:
                    mapping[table] = []
                if query not in mapping[table]:
                    mapping[table].append(query)

    return mapping


def extract_unique_queries() -> List[Dict[str, str]]:
    """Extract unique query names and create preliminary entries."""
    mapping = parse_tabelle_in_query()

    all_queries = set()
    for queries in mapping.values():
        all_queries.update(queries)

    # Create entries
    queries_list = []
    for idx, query_name in enumerate(sorted(all_queries), 1):
        # Create mnemonic from query name
        # Simplify Italian query names
        mnemonic = query_name[:30].replace(" ", "_").replace("-", "_")

        queries_list.append({
            "id": f"QRY_{idx:03d}",
            "name": query_name,
            "mnemonic": mnemonic,
            "type": "Unknown",
            "complexity": "Unknown",
            "status": "pending_analysis"
        })

    return queries_list


def create_reverse_engineering_skeleton(queries_list: List[Dict]):
    """Create the REVERSE_ENGINEERING.md skeleton."""
    doc_path = DOCS_DIR / "REVERSE_ENGINEERING.md"

    lines = [
        "# Reverse Engineering — Access Statistics Module",
        "",
        "## Panoramica",
        "",
        f"- **N. query totali:** {len(queries_list)}",
        "- **N. moduli VBA:** [Da determinare]",
        "- **Query collegate a form:** [Da determinare]",
        "- **Query collegate a report:** [Da determinare]",
        "- **Tabelle NAV referenziate:** [Da determinare]",
        "",
        "---",
        "",
        "## Catalogo Query",
        "",
    ]

    # Group queries by table mentions
    nav_tables = set()
    for query in queries_list:
        # Try to detect NAV tables from query name
        nav_keywords = [
            "Sales", "Purchase", "Ledger", "Item", "Customer", "Vendor",
            "Posting", "Register", "Invoice", "Order", "Shipment", "Receipt"
        ]
        for kw in nav_keywords:
            if kw.lower() in query["name"].lower():
                nav_tables.add(kw)

    if nav_tables:
        lines[8] = f"- **Tabelle NAV referenziate:** {', '.join(sorted(nav_tables))}"

    # Add query entries
    for query in queries_list:
        lines.extend([
            f"### {query['id']} — {query['mnemonic']}",
            "",
            f"**Nome Access:** `{query['name']}`",
            f"**Tipo:** [Select / Crosstab / Action / Pass-Through]",
            "**Usata in:** [Form: ? / Report: ? / VBA: ? / Standalone]",
            "**Complessità:** [Bassa / Media / Alta]",
            "",
            "**Scopo business:**",
            "[Descrizione da completare]",
            "",
            "**Tabelle NAV coinvolte:**",
            "| Tabella | Alias | Join type | Campi usati |",
            "|---|---|---|---|",
            "| ? | ? | ? | ? |",
            "",
            "**Logica chiave:**",
            "",
            "- [Bullet point sui filtri, aggregazioni, calcoli derivati rilevanti]",
            "",
            "**Dipendenze da altre query Access:**",
            "",
            "- [NomeQueryDipendente] — [motivo]",
            "",
            "**Note per il porting:**",
            "",
            "- [Problemi attesi]",
            "",
            "---",
            "",
        ])

    # Add VBA section
    lines.extend([
        "## Moduli VBA",
        "",
        "### [Da estrarre manualmente]",
        "",
        "Moduli VBA non ancora estratti. Richiedono accesso via COM API.",
        "",
        "---",
        "",
        "## Mappa di porting verso Luke",
        "",
        "[Da completare dopo analisi approfondita]",
        "",
    ])

    with open(doc_path, "w") as f:
        f.write("\n".join(lines))

    print(f"✓ REVERSE_ENGINEERING.md skeleton → {doc_path}")


def save_queries_json(queries_list: List[Dict]):
    """Save the queries list as JSON."""
    with open(QUERIES_JSON, "w") as f:
        json.dump(queries_list, f, indent=2)

    print(f"✓ queries_list.json → {QUERIES_JSON}")


def create_queries_summary():
    """Create a summary document."""
    mapping = parse_tabelle_in_query()
    queries_list = extract_unique_queries()

    summary_lines = [
        "# Queries Summary",
        "",
        f"**Total unique queries:** {len(queries_list)}",
        "",
        "## Queries by NAV Table",
        "",
    ]

    for table in sorted(mapping.keys()):
        summary_lines.append(f"### {table}")
        summary_lines.append("")
        for query in mapping[table]:
            summary_lines.append(f"- {query}")
        summary_lines.append("")

    summary_file = RAW_DIR / "QUERIES_SUMMARY.md"
    with open(summary_file, "w") as f:
        f.write("\n".join(summary_lines))

    print(f"✓ QUERIES_SUMMARY.md → {summary_file}")
    return len(queries_list)


def main():
    print("=" * 70)
    print("Query Extraction and Analysis")
    print("=" * 70)

    print("\n📊 Parsing TabelleInQuery...")
    mapping = parse_tabelle_in_query()
    print(f"   ✓ Found {len(mapping)} NAV tables")

    print("\n📋 Extracting unique queries...")
    queries_list = extract_unique_queries()
    print(f"   ✓ Found {len(queries_list)} unique queries")

    print("\n💾 Saving data...")
    save_queries_json(queries_list)
    count = create_queries_summary()
    create_reverse_engineering_skeleton(queries_list)

    print("\n" + "=" * 70)
    print(f"✅ Analysis complete! {count} queries documented.")
    print("=" * 70)


if __name__ == "__main__":
    main()
