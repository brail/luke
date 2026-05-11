# Extraction Summary

**Source:** /Users/brail/code/cursor/luke/docs/access-porting/NewEraStat.accdb
**Extracted:** /Users/brail/code/cursor/luke

## Files Generated

- `tables.txt` — List of all tables
- `queries_sql.txt` — Saved query definitions (partially extracted)
- `queries_list.json` — Query metadata as JSON
- `vba_modules.txt` — VBA module placeholder
- `forms_list.txt` — Forms placeholder
- `reports_list.txt` — Reports placeholder

## Limitations

mdbtools on Unix does not fully support:
- VBA module source code extraction
- Query definitions (stored as binary objects in Access)
- Form/Report structure

**Next step:** Manual extraction via Access UI, pyodbc, or Windows COM API.
