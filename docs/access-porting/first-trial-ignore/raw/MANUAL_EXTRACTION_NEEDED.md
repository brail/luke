# Manual Extraction Required

The .accdb file contains queries and VBA modules that require Access API.

## Recommended Approach

1. **On Windows machine with Access installed:**
   - Use `extract_with_access.vbs` (to be created)
   - Or: Open in Access → Tools → Analyze → Document

2. **Export from Access UI:**
   - Right-click each query → Export → CSV
   - Right-click each module → Export → text

3. **Place extracted files in `raw/` directory:**
   - `queries_manual/QRY_001.sql`
   - `vba_manual/ModuleName.bas`
