-- Section access: from this release a parent section (`settings`, `maintenance`, `product`, `admin`,
-- `sales`) is derived from its children — on if and only if one of them is (ADR-025, ADR-027). The
-- data below was written under the previous rule (ADR-021), where a parent decided on its own and,
-- because the web layouts check only the parent, closed or opened its whole group. Left as it is, a
-- per-user `false` on a parent stops working and the group opens again.
--
-- This migration rewrites that data so every user keeps the parent-and-child visibility they had.
-- For a user U with role r and every child C of a parent P, after this migration C resolves to
--
--   gate(U, P) AND without(U, C)
--
-- gate:    U's override on P if any, else legacy(r, P) — the value of P under ADR-021;
-- without: U's override on C if any, else legacy(r, C) — what C resolved to before this migration;
-- legacy(r, s): if the stored role map M has the key r, M[r][s] when it is 'enabled' or 'disabled',
--   anything else (absent, 'auto', another value, M[r] not an object) the permission fallback;
--   if M has no key r, or there is no M, the static table. This is the reader this migration
--   translates from: the stored map replaced a role's static map wholesale, and a missing entry
--   read as 'auto'. The permission fallback is this release's, which took `config:read` away from
--   editor and viewer; for the five parents it is the same as before.
--
-- Sections without a parent (`dashboard`, `planning`) are not touched; neither is the kill switch
-- (`app.sections.disabled`), which applies the same way before and after.
--
-- The hierarchy, the static table and the permission fallback are frozen below as they stood when
-- this migration was written, so that replaying it on an older backup does not depend on later code.
--
-- It runs once per database. It is NOT safe to replay by hand where it already ran: step 4 would then
-- delete the child grants made since, including the ones step 3 inserted. A single DO block, so the
-- whole rewrite is one statement and commits or rolls back as a unit.

DO $migration$
DECLARE
  hierarchy CONSTANT jsonb := '{
    "settings": [
      "settings.users", "settings.storage", "settings.mail", "settings.ldap", "settings.nav",
      "settings.nav_sync", "settings.google", "settings.collection_control", "settings.company"
    ],
    "maintenance": [
      "maintenance.config", "maintenance.import_export", "maintenance.backup", "maintenance.mode",
      "maintenance.audit_log"
    ],
    "product": [
      "product.pricing", "product.collection_layout", "product.merchandising_plan",
      "product.control"
    ],
    "admin": [
      "admin.brands", "admin.seasons", "admin.vendors", "admin.collection_layout_configuration",
      "admin.calendar_configuration", "admin.phase_catalog"
    ],
    "sales": [
      "sales.statistics"
    ]
  }';
  all_sections CONSTANT text[] := ARRAY[
    'dashboard', 'settings', 'settings.users', 'settings.storage', 'settings.mail',
    'settings.ldap', 'settings.nav', 'settings.nav_sync', 'settings.google',
    'settings.collection_control', 'maintenance', 'maintenance.config',
    'maintenance.import_export', 'maintenance.backup', 'maintenance.mode', 'maintenance.audit_log',
    'product', 'product.pricing', 'product.collection_layout', 'product.merchandising_plan',
    'product.control', 'admin', 'admin.brands', 'admin.seasons', 'admin.vendors',
    'admin.collection_layout_configuration', 'admin.calendar_configuration', 'admin.phase_catalog',
    'sales', 'sales.statistics', 'planning', 'settings.company'
  ];
  -- Sections the static table opens. The admin role is open everywhere, in this table and in the
  -- permission fallback (`*:*`), so it is not listed in either.
  static_open CONSTANT jsonb := '{
    "editor": [
      "dashboard", "product", "product.pricing", "product.collection_layout",
      "product.merchandising_plan", "product.control", "sales", "sales.statistics", "planning"
    ],
    "viewer": [
      "dashboard", "product", "product.pricing", "product.collection_layout",
      "product.merchandising_plan", "product.control", "planning"
    ]
  }';
  -- Sections the permission fallback opens (`SECTION_TO_PERMISSION` and the role's permissions).
  permission_open CONSTANT jsonb := '{
    "editor": [
      "dashboard", "settings.users", "product", "product.pricing", "product.collection_layout",
      "product.merchandising_plan", "product.control", "admin.brands", "admin.seasons",
      "admin.vendors", "admin.collection_layout_configuration", "admin.calendar_configuration",
      "admin.phase_catalog", "sales", "sales.statistics", "planning", "settings.company"
    ],
    "viewer": [
      "dashboard", "settings.users", "product", "product.pricing", "product.collection_layout",
      "product.merchandising_plan", "product.control", "admin.brands", "admin.seasons",
      "admin.vendors", "admin.collection_layout_configuration", "admin.calendar_configuration",
      "admin.phase_catalog", "sales", "sales.statistics", "planning", "settings.company"
    ]
  }';
  stored text;
  role_map jsonb; -- M, or NULL when there is none the old reader would have used
BEGIN
  -- Step 0. The old reader parsed the value whatever `isEncrypted` said: a value that is not JSON
  -- (ciphertext included), or not a JSON object, left every role on the static table. The new reader
  -- with no row does the same, so such a row is deleted.
  SELECT value INTO stored FROM app_configs WHERE key = 'rbac.sectionAccessDefaults';
  IF FOUND THEN
    IF pg_input_is_valid(stored, 'jsonb') AND jsonb_typeof(stored::jsonb) = 'object' THEN
      role_map := stored::jsonb;
    ELSE
      DELETE FROM app_configs WHERE key = 'rbac.sectionAccessDefaults';
    END IF;
  END IF;

  CREATE TEMP TABLE r2_child ON COMMIT DROP AS
  SELECT p.key AS parent, c.child
  FROM jsonb_each(hierarchy) AS p
  CROSS JOIN LATERAL jsonb_array_elements_text(p.value) AS c(child);

  -- Step 1. legacy(r, s), for every known role and section, read before anything is written.
  CREATE TEMP TABLE r2_legacy ON COMMIT DROP AS
  SELECT r.role, s.section,
    CASE
      WHEN r.role = 'admin' AND NOT coalesce(role_map ? 'admin', false) THEN true
      WHEN coalesce(role_map ? r.role, false) THEN
        CASE CASE WHEN jsonb_typeof(role_map -> r.role) = 'object' THEN role_map -> r.role ->> s.section END
          WHEN 'enabled' THEN true
          WHEN 'disabled' THEN false
          ELSE r.role = 'admin' OR coalesce((permission_open -> r.role) ? s.section, false)
        END
      ELSE coalesce((static_open -> r.role) ? s.section, false)
    END AS open
  FROM unnest(ARRAY['admin', 'editor', 'viewer']) AS r(role)
  CROSS JOIN unnest(all_sections) AS s(section);

  -- Step 2. A parent switched off for a user: every child off for that user, explicitly, whatever
  -- the child said — a per-user denial keeps holding if the role defaults change later.
  INSERT INTO user_section_access (id, "userId", section, enabled, "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, p."userId", h.child, false, now(), now()
  FROM user_section_access p
  JOIN r2_child h ON h.parent = p.section
  WHERE NOT p.enabled
  ON CONFLICT ("userId", section) DO UPDATE SET enabled = false, "updatedAt" = now();

  -- Step 3. A parent switched on for a user whose role closes it but opens a child the user has no
  -- override on: the child was reachable through the parent override; step 5 closes it for the
  -- role, so the user gets it explicitly. Possible only with a stored role map.
  INSERT INTO user_section_access (id, "userId", section, enabled, "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, p."userId", h.child, true, now(), now()
  FROM user_section_access p
  JOIN r2_child h ON h.parent = p.section
  JOIN users u ON u.id = p."userId"
  JOIN r2_legacy gate ON gate.role = u.role::text AND gate.section = h.parent
  JOIN r2_legacy child ON child.role = u.role::text AND child.section = h.child
  WHERE p.enabled
    AND NOT gate.open
    AND child.open
    AND NOT EXISTS (
      SELECT 1 FROM user_section_access c WHERE c."userId" = p."userId" AND c.section = h.child
    );

  -- Step 4. A child switched on for a user with no override on its parent, under a role that closes
  -- the parent: the child was unreachable, and would open now. Deleted, so the user follows the
  -- role (owner decision, ADR-027).
  DELETE FROM user_section_access c
  USING r2_child h, users u, r2_legacy gate
  WHERE c.section = h.child
    AND c.enabled
    AND u.id = c."userId"
    AND gate.role = u.role::text
    AND gate.section = h.parent
    AND NOT gate.open
    AND NOT EXISTS (
      SELECT 1 FROM user_section_access p WHERE p."userId" = c."userId" AND p.section = h.parent
    );

  -- Step 5. The role map, rewritten for the new reader: only the known roles it already holds (a
  -- role it does not hold keeps the static table, then as now); every section explicit, 'enabled' and
  -- 'disabled' kept and anything else written as the 'auto' it was read as; every child of a parent
  -- the role closes set to 'disabled'. Unknown roles and sections are dropped.
  IF role_map IS NOT NULL THEN
    UPDATE app_configs
    SET value = (
          SELECT coalesce(jsonb_object_agg(per_role.role, per_role.sections), '{}'::jsonb)::text
          FROM (
            SELECT l.role,
              jsonb_object_agg(l.section,
                CASE
                  WHEN gate.open = false THEN 'disabled'
                  WHEN jsonb_typeof(role_map -> l.role) = 'object'
                    AND (role_map -> l.role ->> l.section) IN ('enabled', 'disabled')
                    THEN role_map -> l.role ->> l.section
                  ELSE 'auto'
                END) AS sections
            FROM r2_legacy l
            LEFT JOIN r2_child h ON h.child = l.section
            LEFT JOIN r2_legacy gate ON gate.role = l.role AND gate.section = h.parent
            WHERE role_map ? l.role
            GROUP BY l.role
          ) AS per_role
        ),
        "isEncrypted" = false,
        "updatedAt" = now()
    WHERE key = 'rbac.sectionAccessDefaults';
  END IF;

  -- Step 6. Overrides on parent sections: nothing reads them any more, and `sectionAccess.set` no
  -- longer writes them.
  DELETE FROM user_section_access WHERE section IN (SELECT DISTINCT parent FROM r2_child);
END
$migration$;
