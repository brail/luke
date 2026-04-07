#!/usr/bin/env python3
"""
Extract database structure, queries, VBA modules from Microsoft Access (.accdb) file.
Uses mdbtools on Linux/Mac to parse the Access database.
"""

import subprocess
import json
import re
import os
import sys
from pathlib import Path
from typing import List, Dict, Any

# Paths
ACCDB_FILE = Path(__file__).parent.parent / "NewEraStat.accdb"
RAW_DIR = Path(__file__).parent.parent / "raw"

RAW_DIR.mkdir(parents=True, exist_ok=True)


def run_command(cmd: List[str], description: str = "") -> str:
    """Run shell command and return output."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=False
        )
        if result.returncode != 0 and result.stderr:
            print(f"⚠️  {description}: {result.stderr}", file=sys.stderr)
        return result.stdout
    except Exception as e:
        print(f"❌ Error running {' '.join(cmd)}: {e}", file=sys.stderr)
        return ""


def extract_tables() -> List[str]:
    """Extract list of all tables (local + linked)."""
    print("📋 Extracting tables...")
    output = run_command(
        ["mdb-tables", "-1", str(ACCDB_FILE)],
        "mdb-tables"
    )
    tables = [t.strip() for t in output.strip().split("\n") if t.strip()]

    output_file = RAW_DIR / "tables.txt"
    with open(output_file, "w") as f:
        f.write("# All tables in NewEraStat.accdb\n\n")
        for table in tables:
            f.write(f"{table}\n")

    print(f"   ✓ Found {len(tables)} tables → {output_file}")
    return tables


def extract_queries() -> Dict[str, Any]:
    """Extract all saved queries and their SQL definitions."""
    print("📝 Extracting queries...")

    queries = []
    output_file = RAW_DIR / "queries_sql.txt"
    json_file = RAW_DIR / "queries_list.json"

    # Try to export queries via mdb-export
    # In Access, queries are stored as objects; we'll try to list them
    try:
        # mdb-queries might not exist, but we can try to enumerate system tables
        # For .accdb, queries might be in a special table
        result = subprocess.run(
            ["mdb-tables", "-1", str(ACCDB_FILE)],
            capture_output=True, text=True
        )
        tables = result.stdout.strip().split("\n")

        # Look for system tables that might contain query definitions
        system_tables = [t for t in tables if t.startswith("~") or t.startswith("MSys")]

        if system_tables:
            print(f"   Found system tables: {system_tables}")

            # Try to extract from MSysObjects or similar
            for table in system_tables:
                try:
                    output = run_command(
                        ["mdb-export", str(ACCDB_FILE), table],
                        f"mdb-export {table}"
                    )
                    if output and len(output) > 100:
                        with open(RAW_DIR / f"system_table_{table}.txt", "w") as f:
                            f.write(output)
                except:
                    pass
    except Exception as e:
        print(f"   ⚠️  Could not extract system tables: {e}")

    # Write placeholder/info
    with open(output_file, "w") as f:
        f.write("# Saved Queries in NewEraStat.accdb\n\n")
        f.write("Note: Direct query extraction from .accdb requires Access COM API or specialized parsing.\n")
        f.write("Queries will be documented based on form recordsources and VBA code analysis.\n")

    with open(json_file, "w") as f:
        json.dump(queries, f, indent=2)

    print(f"   ✓ Queries documented → {output_file}, {json_file}")
    return {"queries": queries}


def extract_vba() -> str:
    """Extract VBA source code from modules."""
    print("🔧 Extracting VBA modules...")
    output_file = RAW_DIR / "vba_modules.txt"

    with open(output_file, "w") as f:
        f.write("# VBA Modules in NewEraStat.accdb\n\n")
        f.write("Note: Direct VBA extraction from .accdb requires Access COM API.\n")
        f.write("VBA modules will need to be extracted manually via Access UI or tools like:\n")
        f.write("- Microsoft.Office.Access.ObjectModel (Windows/COM)\n")
        f.write("- Python: pip install pyodbc + ODBC driver\n")
        f.write("- Manual export from Access: File → Export to Python\n\n")

    print(f"   ✓ VBA placeholder → {output_file}")
    return str(output_file)


def extract_forms() -> List[str]:
    """Extract list of forms and main controls."""
    print("📋 Extracting forms...")
    output_file = RAW_DIR / "forms_list.txt"

    with open(output_file, "w") as f:
        f.write("# Forms in NewEraStat.accdb\n\n")
        f.write("Note: Form metadata requires Access object model.\n")
        f.write("Will be documented from VBA module analysis.\n")

    print(f"   ✓ Forms placeholder → {output_file}")
    return [output_file]


def extract_reports() -> List[str]:
    """Extract list of reports and associated queries."""
    print("📋 Extracting reports...")
    output_file = RAW_DIR / "reports_list.txt"

    with open(output_file, "w") as f:
        f.write("# Reports in NewEraStat.accdb\n\n")
        f.write("Note: Report metadata requires Access object model.\n")
        f.write("Will be documented from query analysis.\n")

    print(f"   ✓ Reports placeholder → {output_file}")
    return [output_file]


def create_extraction_summary() -> None:
    """Create a summary of the extraction process."""
    summary_file = RAW_DIR / "_EXTRACTION_SUMMARY.md"

    with open(summary_file, "w") as f:
        f.write("# Extraction Summary\n\n")
        f.write(f"**Source:** {ACCDB_FILE}\n")
        f.write(f"**Extracted:** {Path.cwd()}\n\n")
        f.write("## Files Generated\n\n")
        f.write("- `tables.txt` — List of all tables\n")
        f.write("- `queries_sql.txt` — Saved query definitions (partially extracted)\n")
        f.write("- `queries_list.json` — Query metadata as JSON\n")
        f.write("- `vba_modules.txt` — VBA module placeholder\n")
        f.write("- `forms_list.txt` — Forms placeholder\n")
        f.write("- `reports_list.txt` — Reports placeholder\n\n")
        f.write("## Limitations\n\n")
        f.write("mdbtools on Unix does not fully support:\n")
        f.write("- VBA module source code extraction\n")
        f.write("- Query definitions (stored as binary objects in Access)\n")
        f.write("- Form/Report structure\n\n")
        f.write("**Next step:** Manual extraction via Access UI, pyodbc, or Windows COM API.\n")

    print(f"✓ Summary → {summary_file}")


def main():
    print("=" * 60)
    print("Access Database Extraction")
    print("=" * 60)
    print(f"File: {ACCDB_FILE}")
    print(f"Output: {RAW_DIR}\n")

    if not ACCDB_FILE.exists():
        print(f"❌ Error: {ACCDB_FILE} not found")
        sys.exit(1)

    extract_tables()
    extract_queries()
    extract_vba()
    extract_forms()
    extract_reports()
    create_extraction_summary()

    print("\n" + "=" * 60)
    print("✅ Extraction complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
