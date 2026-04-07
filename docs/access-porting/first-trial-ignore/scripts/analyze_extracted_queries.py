#!/usr/bin/env python3
"""
Analyze extracted queries from Windows extraction.
Build database of queries with dependencies, complexity, and NAV table references.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Set, Any
from collections import defaultdict

CUSTOM_DIR = Path(__file__).parent.parent / "queries" / "custom" / "q2"
QUERIES_JSONL = CUSTOM_DIR / "queries.jsonl"
QUERIES_SQL = CUSTOM_DIR / "queries.sql"
DOCS_DIR = Path(__file__).parent.parent

# NAV table patterns
NAV_TABLES = [
    r"\[?NEWERA?\$?Sales\s+Header\]?",
    r"\[?NEWERA?\$?Sales\s+Line\]?",
    r"\[?NEWERA?\$?Purchase\s+Header\]?",
    r"\[?NEWERA?\$?Purchase\s+Line\]?",
    r"\[?NEWERA?\$?Item\]?",
    r"\[?NEWERA?\$?Customer\]?",
    r"\[?NEWERA?\$?Vendor\]?",
    r"\[?NEWERA?\$?Ledger\s+Entry\]?",
    r"\[?NEWERA?\$?Invoice\]?",
    r"\[?NEWERA?\$?Order\]?",
    r"\[?NEWERA?\$?Shipment\]?",
    r"\[?NEWERA?\$?Receipt\]?",
]

NAV_KEYWORDS = [
    "Sales", "Purchase", "Item", "Customer", "Vendor",
    "Posting", "Register", "Invoice", "Order", "Shipment", "Receipt",
    "Ledger", "Entry", "Header", "Line", "Dimension"
]


def load_queries_jsonl() -> List[Dict[str, Any]]:
    """Load queries from JSONL file."""
    queries = []
    with open(QUERIES_JSONL) as f:
        for line in f:
            if line.strip():
                queries.append(json.loads(line))
    return queries


def categorize_queries(queries: List[Dict]) -> Dict[str, List[Dict]]:
    """Categorize queries by type and purpose."""
    categories = {
        "system": [],  # Starting with ~
        "hidden": [],  # Hidden in Access UI
        "visible": [],  # Regular user queries
        "nav_reference": [],  # Reference NAV tables
        "temp": [],  # Temporary/working
    }

    for q in queries:
        name = q.get("name", "")
        sql = q.get("sql", "")
        is_hidden = q.get("hidden", False)

        if name.startswith("~"):
            categories["system"].append(q)
        elif is_hidden:
            categories["hidden"].append(q)
        else:
            categories["visible"].append(q)

        # Check if references NAV
        nav_found = False
        for kw in NAV_KEYWORDS:
            if re.search(kw, sql, re.IGNORECASE):
                nav_found = True
                break

        if nav_found:
            categories["nav_reference"].append(q)

        # Check if temp
        if any(t in name.lower() for t in ["tmp", "temp", "working", "appoggio", "tabella"]):
            categories["temp"].append(q)

    return categories


def extract_nav_tables(sql: str) -> Set[str]:
    """Extract NAV table references from SQL."""
    tables = set()

    for pattern in NAV_TABLES:
        matches = re.findall(pattern, sql, re.IGNORECASE)
        tables.update(matches)

    return tables


def analyze_query_dependencies(queries: List[Dict]) -> Dict[str, Set[str]]:
    """Find query dependencies (query A references query B)."""
    dependencies = defaultdict(set)
    query_names = {q["name"] for q in queries}

    for query in queries:
        sql = query.get("sql", "")
        name = query.get("name", "")

        # Find references to other queries
        for other_name in query_names:
            if other_name != name:
                # Check if query references another query
                if re.search(rf"\b{re.escape(other_name)}\b", sql, re.IGNORECASE):
                    dependencies[name].add(other_name)

    return dict(dependencies)


def calculate_complexity(sql: str) -> str:
    """Estimate SQL complexity."""
    lines = len(sql.split("\n"))
    joins = len(re.findall(r"\bJOIN\b", sql, re.IGNORECASE))
    unions = len(re.findall(r"\bUNION\b", sql, re.IGNORECASE))
    subqueries = len(re.findall(r"\(\s*SELECT", sql, re.IGNORECASE))

    score = joins + (unions * 2) + (subqueries * 1.5) + (lines / 10)

    if score < 5:
        return "Bassa"
    elif score < 15:
        return "Media"
    else:
        return "Alta"


def generate_statistics(queries: List[Dict]) -> Dict[str, Any]:
    """Generate overall statistics."""
    categories = categorize_queries(queries)
    nav_queries = categories["nav_reference"]

    stats = {
        "total_queries": len(queries),
        "visible_queries": len(categories["visible"]),
        "hidden_queries": len(categories["hidden"]),
        "system_queries": len(categories["system"]),
        "nav_related": len(nav_queries),
        "temp_tables": len(categories["temp"]),
    }

    # Complexity distribution
    complexity_dist = {"Bassa": 0, "Media": 0, "Alta": 0}
    for q in queries:
        sql = q.get("sql", "")
        if sql:
            comp = calculate_complexity(sql)
            complexity_dist[comp] += 1

    stats["complexity_distribution"] = complexity_dist

    # NAV table frequency
    nav_table_freq = defaultdict(int)
    for q in nav_queries:
        sql = q.get("sql", "")
        tables = extract_nav_tables(sql)
        for table in tables:
            nav_table_freq[table] += 1

    stats["nav_tables_referenced"] = dict(
        sorted(nav_table_freq.items(), key=lambda x: x[1], reverse=True)
    )

    return stats


def generate_report(queries: List[Dict]):
    """Generate comprehensive analysis report."""
    categories = categorize_queries(queries)
    dependencies = analyze_query_dependencies(queries)
    stats = generate_statistics(queries)

    report_lines = [
        "# Analisi Query — NewEraStat.accdb",
        "",
        "## 📊 Statistiche Generali",
        "",
        f"- **Query totali:** {stats['total_queries']}",
        f"- **Query visibili:** {stats['visible_queries']}",
        f"- **Query nascoste:** {stats['hidden_queries']}",
        f"- **Query sistema:** {stats['system_queries']}",
        f"- **NAV-correlate:** {stats['nav_related']}",
        f"- **Tabelle temporanee:** {stats['temp_tables']}",
        "",
        "## 📈 Distribuzione Complessità",
        "",
        f"- **Bassa:** {stats['complexity_distribution']['Bassa']}",
        f"- **Media:** {stats['complexity_distribution']['Media']}",
        f"- **Alta:** {stats['complexity_distribution']['Alta']}",
        "",
        "## 🗄️ Tabelle NAV Referenziate",
        "",
    ]

    for table, count in stats["nav_tables_referenced"].items():
        report_lines.append(f"- **{table}:** {count} query")

    report_lines.extend([
        "",
        "## 📋 Query per Categoria",
        "",
        "### Query NAV-correlate (principale focus porting)",
        "",
    ])

    nav_queries = sorted(
        categories["nav_reference"],
        key=lambda q: len(q.get("sql", "")),
        reverse=True
    )

    for q in nav_queries[:20]:  # Top 20
        name = q.get("name", "")
        sql = q.get("sql", "")
        comp = calculate_complexity(sql)
        report_lines.append(f"- **{name}** — {comp}, {len(sql)} chars")

    report_lines.extend([
        "",
        "### Query di Sistema (interne, ~ prefix)",
        "",
    ])

    for q in categories["system"][:10]:
        name = q.get("name", "")
        report_lines.append(f"- {name}")

    report_lines.extend([
        "",
        "## 🔗 Dipendenze Query",
        "",
        f"Query con dipendenze: {len([d for d in dependencies if dependencies[d]])}/",
        f"{stats['total_queries']}",
        "",
    ])

    # Top dependencies
    top_deps = sorted(
        dependencies.items(),
        key=lambda x: len(x[1]),
        reverse=True
    )[:10]

    for query, deps in top_deps:
        if deps:
            report_lines.append(f"- **{query}** → {', '.join(list(deps)[:3])}")

    report_lines.extend([
        "",
        "---",
        "",
        "## 🎯 Raccomandazioni Porting",
        "",
        "### MVP (Priorità Alta)",
        "",
        "Iniziare dalle 5-10 query NAV-correlate che coprono:",
        "- Sales Shipment Line (vendite)",
        "- Purchase (acquisti)",
        "- Items (articoli)",
        "- Customers (clienti)",
        "- Ledger entries (registri)",
        "",
        "### Fase 2: Query di Sistema",
        "",
        "Query interne (~sq_*) sono ottimizzate per Access.",
        "Potrebbero essere semplificate per SQL Server nativo.",
        "",
        "### Fase 3: Report e Dashboard",
        "",
        "Tabelle temporanee (tabelleappoggio) usate per cache intermedi.",
        "In Luke: migrare a materialized views o cache Redis.",
        "",
    ])

    return "\n".join(report_lines)


def main():
    print("=" * 70)
    print("Query Analysis")
    print("=" * 70)

    if not QUERIES_JSONL.exists():
        print(f"❌ File not found: {QUERIES_JSONL}")
        return

    print("\n📊 Loading queries...")
    queries = load_queries_jsonl()
    print(f"   ✓ Loaded {len(queries)} queries")

    print("\n🔍 Analyzing...")
    categories = categorize_queries(queries)
    stats = generate_statistics(queries)

    print(f"   ✓ {stats['visible_queries']} visible queries")
    print(f"   ✓ {stats['nav_related']} NAV-related queries")
    print(f"   ✓ {len(stats['nav_tables_referenced'])} NAV tables referenced")

    print("\n📝 Generating report...")
    report = generate_report(queries)

    report_file = DOCS_DIR / "QUERIES_ANALYSIS.md"
    with open(report_file, "w") as f:
        f.write(report)

    print(f"   ✓ Report saved → {report_file}")

    # Save statistics as JSON
    stats_file = DOCS_DIR / "raw" / "queries_statistics.json"
    stats_file.parent.mkdir(parents=True, exist_ok=True)

    stats["categories"] = {
        "visible": len(categories["visible"]),
        "hidden": len(categories["hidden"]),
        "system": len(categories["system"]),
        "nav_reference": len(categories["nav_reference"]),
        "temp": len(categories["temp"]),
    }

    with open(stats_file, "w") as f:
        json.dump(stats, f, indent=2)

    print(f"   ✓ Statistics saved → {stats_file}")

    print("\n" + "=" * 70)
    print("✅ Analysis complete!")
    print("=" * 70)


if __name__ == "__main__":
    main()
