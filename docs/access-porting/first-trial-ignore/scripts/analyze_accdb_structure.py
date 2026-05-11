#!/usr/bin/env python3
"""
Analyze Access database structure using mdb-export.
Extract table schemas and content to understand query logic.
"""

import subprocess
import json
from pathlib import Path
from typing import List, Dict, Any

ACCDB_FILE = Path(__file__).parent.parent / "NewEraStat.accdb"
RAW_DIR = Path(__file__).parent.parent / "raw"
TABLES_FILE = RAW_DIR / "tables.txt"


def read_tables_list() -> List[str]:
    """Read the table names from tables.txt."""
    with open(TABLES_FILE) as f:
        lines = f.readlines()

    tables = []
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#"):
            tables.append(line)

    return tables


def export_table_schema(table: str) -> Dict[str, Any]:
    """Export table schema and first few rows using mdb-export."""
    try:
        # Get header (first row)
        result = subprocess.run(
            ["mdb-export", str(ACCDB_FILE), table],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if result.returncode != 0:
            return {"error": result.stderr}

        lines = result.stdout.strip().split("\n")
        if not lines:
            return {"error": "No data"}

        # Parse CSV-like header
        header = lines[0].split(",") if lines else []
        row_count = len(lines) - 1

        return {
            "table": table,
            "columns": header,
            "rows": row_count,
            "sample": lines[1:3] if len(lines) > 1 else [],
        }

    except subprocess.TimeoutExpired:
        return {"error": "Timeout"}
    except Exception as e:
        return {"error": str(e)}


def analyze_nav_related_tables():
    """Analyze tables that seem related to NAV integration."""
    tables = read_tables_list()

    # Look for NAV-related tables
    nav_keywords = ["navision", "nav", "navi", "edi", "resi", "ordini"]
    nav_related = [
        t for t in tables if any(kw.lower() in t.lower() for kw in nav_keywords)
    ]

    print(f"📊 Found {len(nav_related)} NAV-related tables:")
    for t in nav_related:
        print(f"   - {t}")

    # Export schemas for these tables
    nav_schemas = {}
    for table in nav_related[:10]:  # Limit to first 10
        print(f"\n📋 Exporting {table}...")
        schema = export_table_schema(table)
        if "error" not in schema:
            print(f"   ✓ Columns: {len(schema['columns'])}, Rows: {schema['rows']}")
            nav_schemas[table] = schema
        else:
            print(f"   ⚠️  {schema['error']}")

    return nav_schemas


def export_named_queries_metadata():
    """Try to find query definitions in special tables."""
    print("\n🔍 Searching for query metadata...")

    tables = read_tables_list()

    # Look for tables that might contain query definitions or metadata
    meta_keywords = ["query", "sql", "definizione", "tabelle", "indici"]
    meta_tables = [
        t for t in tables if any(kw.lower() in t.lower() for kw in meta_keywords)
    ]

    print(f"   Found {len(meta_tables)} potential metadata tables:")
    for t in meta_tables:
        print(f"     - {t}")

    # Export these
    for table in meta_tables:
        output_file = RAW_DIR / f"metadata_{table}.csv"
        try:
            result = subprocess.run(
                ["mdb-export", str(ACCDB_FILE), table],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode == 0 and result.stdout:
                with open(output_file, "w") as f:
                    f.write(result.stdout)
                print(f"   ✓ Exported {table} → {output_file.name}")
        except Exception as e:
            print(f"   ⚠️  {table}: {e}")


def create_analysis_summary(nav_schemas: Dict):
    """Create a summary of the analysis."""
    summary_file = RAW_DIR / "STRUCTURE_ANALYSIS.md"

    with open(summary_file, "w") as f:
        f.write("# NewEraStat.accdb — Structure Analysis\n\n")
        f.write(f"**Total tables:** {len(read_tables_list())}\n\n")

        f.write("## NAV-Related Tables Found\n\n")
        for table, schema in nav_schemas.items():
            if "error" not in schema:
                f.write(f"### {table}\n")
                f.write(f"- **Columns:** {len(schema['columns'])}\n")
                f.write(f"- **Rows:** {schema['rows']}\n")
                f.write(f"- **Fields:** {', '.join(schema['columns'][:5])}")
                if len(schema["columns"]) > 5:
                    f.write(f" + {len(schema['columns']) - 5} more")
                f.write("\n\n")

        f.write("## Next Steps\n\n")
        f.write(
            "- [ ] Manual inspection of queries via Access UI\n"
        )
        f.write(
            "- [ ] Export VBA modules from Access\n"
        )
        f.write(
            "- [ ] Document query logic from form/report recordsources\n"
        )

    print(f"\n✓ Summary → {summary_file}")


def main():
    print("=" * 70)
    print("Access Database Structure Analysis")
    print("=" * 70)

    nav_schemas = analyze_nav_related_tables()
    export_named_queries_metadata()
    create_analysis_summary(nav_schemas)

    print("\n" + "=" * 70)
    print("✅ Analysis complete!")
    print("=" * 70)


if __name__ == "__main__":
    main()
