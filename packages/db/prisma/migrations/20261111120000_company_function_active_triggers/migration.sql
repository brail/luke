-- Backstop for company-function visibility writes (#242).
-- Existing rows are neither scanned nor rewritten.
-- Apply once through Prisma Migrate; this migration is not idempotent.
--
-- Lock order:
--   T1: destination event, then function.
--   T2: function.
--   T3: event (held by UPDATE), then all functions ordered by id.
--   T4: function (held by UPDATE); association checks take no row locks.
--
-- Application batch writers already lock all functions in id order.
-- External batch writers must use the same ordering or handle deadlocks.
--
-- Isolation: the guarantee holds under READ COMMITTED, the PostgreSQL default and the only level
-- Luke uses. Each check reads a fresh snapshot after its lock wait. Under REPEATABLE READ, T4 reads
-- its transaction's snapshot and can miss a concurrent T1/T3 commit.

CREATE FUNCTION public.check_event_visibility_function_active()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  event_active boolean;
  function_active boolean;
BEGIN
  -- An unchanged legacy association remains editable.
  IF TG_OP = 'UPDATE' THEN
    IF NEW."eventId" IS NOT DISTINCT FROM OLD."eventId"
       AND NEW."functionId" IS NOT DISTINCT FROM OLD."functionId" THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Serialize the association with cancellation/restoration of its destination.
  SELECT e."cancelledAt" IS NULL
    INTO event_active
    FROM public.calendar_events AS e
    WHERE e.id = NEW."eventId"
    FOR NO KEY UPDATE;

  -- A missing parent is the existing foreign key's responsibility.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT f."isActive"
    INTO function_active
    FROM public.company_functions AS f
    WHERE f.id = NEW."functionId"
    FOR SHARE;

  IF event_active AND function_active IS FALSE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'LK001',
      CONSTRAINT = 'company_function_active',
      MESSAGE = 'An active event cannot receive an inactive function.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.check_template_visibility_function_active()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  function_active boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."templateItemId" IS NOT DISTINCT FROM OLD."templateItemId"
       AND NEW."functionId" IS NOT DISTINCT FROM OLD."functionId" THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT f."isActive"
    INTO function_active
    FROM public.company_functions AS f
    WHERE f.id = NEW."functionId"
    FOR SHARE;

  IF function_active IS FALSE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'LK001',
      CONSTRAINT = 'company_function_active',
      MESSAGE = 'A template item cannot receive an inactive function.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.check_restored_event_functions_active()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  -- Lock every referenced function, including currently active ones.
  -- The event row is already locked by the triggering UPDATE.
  PERFORM f.id
    FROM public.company_functions AS f
    WHERE EXISTS (
      SELECT 1
      FROM public.calendar_event_visibilities AS v
      WHERE v."eventId" = NEW.id
        AND v."functionId" = f.id
    )
    ORDER BY f.id
    FOR SHARE OF f;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_event_visibilities AS v
    JOIN public.company_functions AS f ON f.id = v."functionId"
    WHERE v."eventId" = NEW.id
      AND NOT f."isActive"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'LK001',
      CONSTRAINT = 'company_function_active',
      MESSAGE = 'An event with an inactive function cannot be restored.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.check_function_deactivation_visibility()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  -- UPDATE already holds the function row.
  -- Do not lock events or visibility rows here: that would invert T1/T3.
  IF EXISTS (
    SELECT 1
    FROM public.calendar_event_visibilities AS v
    JOIN public.calendar_events AS e ON e.id = v."eventId"
    WHERE v."functionId" = NEW.id
      AND e."cancelledAt" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.milestone_template_item_visibilities AS v
    WHERE v."functionId" = NEW.id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'LK001',
      CONSTRAINT = 'company_function_active',
      MESSAGE = 'A function used by active events or template items cannot be deactivated.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_event_visibility_function_active
BEFORE INSERT OR UPDATE OF "eventId", "functionId"
ON public.calendar_event_visibilities
FOR EACH ROW
EXECUTE FUNCTION public.check_event_visibility_function_active();

CREATE TRIGGER template_item_visibility_function_active
BEFORE INSERT OR UPDATE OF "templateItemId", "functionId"
ON public.milestone_template_item_visibilities
FOR EACH ROW
EXECUTE FUNCTION public.check_template_visibility_function_active();

CREATE TRIGGER calendar_event_restore_functions_active
BEFORE UPDATE OF "cancelledAt"
ON public.calendar_events
FOR EACH ROW
WHEN (
  OLD."cancelledAt" IS NOT NULL
  AND NEW."cancelledAt" IS NULL
)
EXECUTE FUNCTION public.check_restored_event_functions_active();

CREATE TRIGGER company_function_deactivation_visibility
BEFORE UPDATE OF "isActive"
ON public.company_functions
FOR EACH ROW
WHEN (
  OLD."isActive" IS TRUE
  AND NEW."isActive" IS FALSE
)
EXECUTE FUNCTION public.check_function_deactivation_visibility();
