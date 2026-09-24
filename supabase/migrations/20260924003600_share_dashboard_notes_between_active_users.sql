-- Dashboard notes (client_id IS NULL) are a shared team workspace.
-- Client-specific notes remain scoped by client access.
DROP POLICY IF EXISTS mig_notes_scope ON public.client_notes;

CREATE POLICY mig_notes_scope ON public.client_notes
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  (SELECT private.is_crm_admin())
  OR CASE
    WHEN client_id IS NULL THEN private.is_active_crm_user()
    ELSE private.mig_can_access_client(client_id)
  END
)
WITH CHECK (
  (SELECT private.is_crm_admin())
  OR (
    author_id = (SELECT auth.uid())
    AND (client_id IS NULL OR private.mig_can_access_client(client_id))
  )
);
