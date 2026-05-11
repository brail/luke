#!/usr/bin/env python3
"""
Advanced Access database extraction using pyodbc or direct file parsing.
Tries multiple approaches to extract queries, VBA, and forms.
"""

import sys
import json
from pathlib import Path
import subprocess
import re
from typing import List, Dict, Any

ACCDB_FILE = Path(__file__).parent.parent / "NewEraStat.accdb"
RAW_DIR = Path(__file__).parent.parent / "raw"


def try_pyodbc_extraction():
    """Try to use pyodbc with ODBC driver."""
    print("🔍 Trying pyodbc extraction...")
    try:
        import pyodbc
        print("   ✓ pyodbc available")

        # Try to find Access ODBC driver
        drivers = pyodbc.drivers()
        access_drivers = [d for d in drivers if 'Access' in d or 'ACCDB' in d]

        if not access_drivers:
            print("   ⚠️  No Access ODBC driver found")
            print(f"      Available drivers: {drivers}")
            return False

        print(f"   Found Access driver: {access_drivers[0]}")

        # Connect to the .accdb file
        conn_str = f"Driver={{{access_drivers[0]}}};DBQ={ACCDB_FILE};"
        try:
            conn = pyodbc.connect(conn_str)
            cursor = conn.cursor()

            # Query system tables for saved queries
            # MSysObjects contains definitions of queries
            try:
                cursor.execute(
                    "SELECT Name, Type FROM MSysObjects WHERE Type=5"
                )  # Type 5 = Query
                queries = cursor.fetchall()
                print(f"   ✓ Found {len(queries)} queries")

                # Save query names
                query_list = [{"name": q[0], "type": "Query"} for q in queries]
                with open(RAW_DIR / "queries_list.json", "w") as f:
                    json.dump(query_list, f, indent=2)

            except Exception as e:
                print(f"   ⚠️  Could not query MSysObjects: {e}")

            cursor.close()
            conn.close()
            return True

        except Exception as e:
            print(f"   ⚠️  Could not connect: {e}")
            return False

    except ImportError:
        print("   ⚠️  pyodbc not installed")
        print("      Install with: pip install pyodbc")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def try_pandas_extraction():
    """Try to use pandas to read Access tables."""
    print("🔍 Trying pandas extraction...")
    try:
        import pandas as pd

        print("   ✓ pandas available")

        # List of key tables to try to read
        key_tables = [
            "Navision",
            "TabelleInQuery",
            "TabellaStagioni",
            "Indici",
        ]

        for table in key_tables:
            try:
                df = pd.read_table(str(ACCDB_FILE), table)
                print(f"   ✓ Read table: {table} ({len(df)} rows)")
            except Exception as e:
                pass

        return True

    except ImportError:
        print("   ⚠️  pandas not installed")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False


def extract_with_access_vbs():
    """Generate a VBScript to run on Windows via osascript (if on Mac with Office)."""
    print("🔍 Checking for Access COM API...")

    # On Mac with Office, try AppleScript
    vbs_code = '''
tell application "Microsoft Access"
    open file POSIX path of the file "{accdb_file}"
    -- Try to export queries
    -- This is a placeholder for actual VBS/AppleScript
end tell
'''

    print("   ⚠️  Access COM API not directly available on macOS")
    print("      Requires Windows + Microsoft Access or Office 365 with Access")


def extract_with_jackcesspy():
    """Try using jackcesspy (pure Python, no ODBC needed)."""
    print("🔍 Trying jackcesspy...")
    try:
        # Needs special installation: pip install jackcess
        subprocess.run(
            ["python3", "-c", "import jackcess"],
            capture_output=True,
            check=True,
        )
        print("   ✓ jackcess available")
        return True
    except:
        print("   ⚠️  jackcess not installed")
        print("      Install with: pip install jackcess")
        return False


def extract_manual_inspection():
    """Provide instructions for manual extraction."""
    print("\n📋 Manual Extraction Instructions\n")
    print("Since .accdb files require Access API for full extraction,")
    print("here are the options:\n")

    print("Option 1: Windows + Python + pyodbc")
    print("  - Install: pip install pyodbc")
    print("  - Install ODBC driver: 'Microsoft Access Driver (*.mdb, *.accdb)'")
    print("  - Run this script again\n")

    print("Option 2: macOS + Excel/Numbers + Manual Export")
    print("  - Open NewEraStat.accdb in Access (if available)")
    print("  - File → Export → each query to CSV")
    print("  - Manually list queries in docs/access-porting/MANUAL_QUERIES.txt\n")

    print("Option 3: Online Tools")
    print("  - Convert .accdb to SQLite: mdb-export to CSV, then import to SQLite")
    print("  - Then query the SQLite database\n")

    print("Option 4: Docker + Python")
    print("  - Use Docker image with Python + pypyodbc")
    print("  - Volume mount the .accdb file\n")

    instruction_file = RAW_DIR / "MANUAL_EXTRACTION_NEEDED.md"
    with open(instruction_file, "w") as f:
        f.write("# Manual Extraction Required\n\n")
        f.write(
            "The .accdb file contains queries and VBA modules that require Access API.\n"
        )
        f.write("\n## Recommended Approach\n\n")
        f.write(
            "1. **On Windows machine with Access installed:**\n"
        )
        f.write("   - Use `extract_with_access.vbs` (to be created)\n")
        f.write("   - Or: Open in Access → Tools → Analyze → Document\n\n")
        f.write("2. **Export from Access UI:**\n")
        f.write("   - Right-click each query → Export → CSV\n")
        f.write("   - Right-click each module → Export → text\n\n")
        f.write("3. **Place extracted files in `raw/` directory:**\n")
        f.write("   - `queries_manual/QRY_001.sql`\n")
        f.write("   - `vba_manual/ModuleName.bas`\n")

    print(f"\n✓ Instructions saved to {instruction_file}")


def main():
    print("=" * 70)
    print("Advanced Access Database Extraction")
    print("=" * 70)
    print(f"File: {ACCDB_FILE}\n")

    if not ACCDB_FILE.exists():
        print(f"❌ File not found: {ACCDB_FILE}")
        sys.exit(1)

    success = False

    # Try different extraction methods
    success = try_pyodbc_extraction() or success
    success = try_pandas_extraction() or success

    extract_manual_inspection()

    print("\n" + "=" * 70)
    print("✅ Analysis complete. Check instructions above.")
    print("=" * 70)


if __name__ == "__main__":
    main()
