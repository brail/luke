#!/usr/bin/env python3
"""
Split queries from QUERIES_TEMPLATE.md into individual .sql files.
Reads markdown, extracts SQL blocks, and saves them as separate files.
"""

import re
from pathlib import Path

TEMPLATE_FILE = Path(__file__).parent.parent / "QUERIES_TEMPLATE.md"
QUERIES_DIR = Path(__file__).parent.parent / "queries"

QUERIES_DIR.mkdir(exist_ok=True)


def parse_queries_from_markdown() -> dict:
    """Parse QUERIES_TEMPLATE.md and extract SQL blocks."""
    with open(TEMPLATE_FILE) as f:
        content = f.read()

    queries = {}

    # Match patterns like: ## QRY_001 — [name]
    # Followed by ```sql block
    pattern = r'## (QRY_\d{3}) — ([^\n]+)\n+```sql\n(.*?)\n```'

    matches = re.finditer(pattern, content, re.DOTALL)

    for match in matches:
        qry_id = match.group(1)
        qry_name = match.group(2).strip()
        qry_sql = match.group(3).strip()

        queries[qry_id] = {
            'name': qry_name,
            'sql': qry_sql,
        }

    return queries


def save_query_file(qry_id: str, qry_name: str, qry_sql: str) -> Path:
    """Save a single query to a .sql file."""
    # Create safe filename from name
    safe_name = (
        qry_name
        .replace(' — ', '_')
        .replace('- ', '_')
        .replace(' - ', '_')
        .replace(' ', '_')
        .replace('/', '_')
        .replace('(', '')
        .replace(')', '')
        .replace('[', '')
        .replace(']', '')
        .lower()
    )[:50]

    filename = f"{qry_id}_{safe_name}.sql"
    filepath = QUERIES_DIR / filename

    # Write file with header comment
    with open(filepath, 'w') as f:
        f.write(f"-- ============================================================\n")
        f.write(f"-- {qry_id} — {qry_name}\n")
        f.write(f"-- Fonte originale: Access query '{qry_name}'\n")
        f.write(f"-- Status: [To be verified]\n")
        f.write(f"-- ============================================================\n\n")
        f.write(qry_sql)
        f.write("\n")

    return filepath


def main():
    print("=" * 70)
    print("Splitting Queries from Template")
    print("=" * 70)

    if not TEMPLATE_FILE.exists():
        print(f"❌ Template file not found: {TEMPLATE_FILE}")
        return False

    queries = parse_queries_from_markdown()

    if not queries:
        print("⚠️  No queries found in template")
        print("   Make sure you've filled in the SQL blocks in QUERIES_TEMPLATE.md")
        return False

    print(f"\n📝 Found {len(queries)} queries\n")

    placeholder_count = 0

    for qry_id, data in sorted(queries.items()):
        filepath = save_query_file(qry_id, data['name'], data['sql'])

        if '[PASTE SQL HERE]' in data['sql']:
            print(f"⚠️  {filepath.name} — [PLACEHOLDER, not filled in]")
            placeholder_count += 1
        else:
            lines = data['sql'].split('\n')
            line_count = len([l for l in lines if l.strip()])
            print(f"✓  {filepath.name} — {line_count} lines")

    print("\n" + "=" * 70)

    if placeholder_count > 0:
        print(f"⚠️  {placeholder_count} queries still have [PASTE SQL HERE]")
        print("   Please fill in the SQL blocks in QUERIES_TEMPLATE.md")
    else:
        print("✅ All queries extracted to individual .sql files!")

    print(f"   Location: {QUERIES_DIR}/")
    print("=" * 70)

    return placeholder_count == 0


if __name__ == "__main__":
    main()
