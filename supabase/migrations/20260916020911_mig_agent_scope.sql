-- Add assignment restrictions without weakening existing active-user, hidden-row,
-- retention or compliance policies. Owners/admins retain their current access.
CREATE OR REPLACE FUNCTION private.mig_actor_can_access_client(p_actor_id uuid, p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.profiles p JOIN public.clients c ON c.id = p_client_id
   WHERE p.id = p_actor_id AND p.active
   AND (p.role IN ('owner','admin') OR c.assigned_agent_id = p.id)
 );
$$;
REVOKE ALL ON FUNCTION private.mig_actor_can_access_client(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mig_actor_can_access_client(uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION private.mig_can_access_client(p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT private.mig_actor_can_access_client((SELECT auth.uid()), p_client_id);
$$;
REVOKE ALL ON FUNCTION private.mig_can_access_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mig_can_access_client(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS mig_clients_assignment_scope ON public.clients;
CREATE POLICY mig_clients_assignment_scope ON public.clients AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR assigned_agent_id = (SELECT auth.uid()))
WITH CHECK ((SELECT private.is_crm_admin()) OR assigned_agent_id = (SELECT auth.uid()));

DO $migration$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['client_doctors','client_medications','client_pharmacies','client_sensitive','client_sms_messages','communications','documents','health_plans','hospital_indemnity_plans','life_policies','medicare_details','retirement_accounts','ringcentral_calls','soa_signature_requests'] LOOP
   EXECUTE format('DROP POLICY IF EXISTS mig_client_book_scope ON public.%I',t);
   EXECUTE format('CREATE POLICY mig_client_book_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.mig_can_access_client(client_id)) WITH CHECK (private.mig_can_access_client(client_id))',t);
 END LOOP;
END;
$migration$;

DROP POLICY IF EXISTS mig_notes_scope ON public.client_notes;
CREATE POLICY mig_notes_scope ON public.client_notes AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR CASE WHEN client_id IS NULL THEN author_id=(SELECT auth.uid()) ELSE private.mig_can_access_client(client_id) END)
WITH CHECK ((SELECT private.is_crm_admin()) OR (author_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))));
DROP POLICY IF EXISTS mig_appointments_scope ON public.appointments;
CREATE POLICY mig_appointments_scope ON public.appointments AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))))
WITH CHECK ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))));
DROP POLICY IF EXISTS mig_leads_scope ON public.workspace_leads;
CREATE POLICY mig_leads_scope ON public.workspace_leads AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))))
WITH CHECK ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))));
DROP POLICY IF EXISTS mig_commissions_scope ON public.commissions;
CREATE POLICY mig_commissions_scope ON public.commissions AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR (agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))))
WITH CHECK ((SELECT private.is_crm_admin()) OR (agent_id=(SELECT auth.uid()) AND (client_id IS NULL OR private.mig_can_access_client(client_id))));
DROP POLICY IF EXISTS mig_medicare_commissions_scope ON public.medicare_commission_events;
CREATE POLICY mig_medicare_commissions_scope ON public.medicare_commission_events AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND private.mig_can_access_client(client_id)))
WITH CHECK ((SELECT private.is_crm_admin()) OR (assigned_agent_id=(SELECT auth.uid()) AND private.mig_can_access_client(client_id)));
DROP POLICY IF EXISTS mig_profiles_scope ON public.profiles;
CREATE POLICY mig_profiles_scope ON public.profiles AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR id=(SELECT auth.uid()))
WITH CHECK ((SELECT private.is_crm_admin()));
DROP POLICY IF EXISTS mig_audit_scope ON public.audit_log;
CREATE POLICY mig_audit_scope ON public.audit_log AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR actor_id=(SELECT auth.uid()))
WITH CHECK ((SELECT private.is_crm_admin()) OR actor_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS mig_campaign_assignment_scope ON public.campaigns;
CREATE POLICY mig_campaign_assignment_scope ON public.campaigns AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT private.is_crm_admin()) OR assigned_agent_id=(SELECT auth.uid()))
WITH CHECK ((SELECT private.is_crm_admin()) OR assigned_agent_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS mig_campaign_member_client_scope ON public.campaign_members;
CREATE POLICY mig_campaign_member_client_scope ON public.campaign_members AS RESTRICTIVE FOR ALL TO authenticated
USING (private.mig_can_access_client(client_id)) WITH CHECK (private.mig_can_access_client(client_id));

-- Scope storage by its actual client/lead path, not a user-supplied document reference.
CREATE OR REPLACE FUNCTION private.mig_can_access_storage(p_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE first_part text := split_part(p_path,'/',1); second_part text := split_part(p_path,'/',2);
BEGIN
 IF NOT private.is_active_crm_user() THEN RETURN false; END IF;
 IF private.is_crm_admin() THEN RETURN true; END IF;
 IF first_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RETURN private.mig_can_access_client(first_part::uuid);
 END IF;
 IF first_part = 'leads' AND second_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
   RETURN EXISTS (SELECT 1 FROM public.workspace_leads l WHERE l.id=second_part::uuid
     AND l.assigned_agent_id=(SELECT auth.uid()) AND (l.client_id IS NULL OR private.mig_can_access_client(l.client_id)));
 END IF;
 RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.mig_can_access_storage(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mig_can_access_storage(text) TO authenticated, service_role;
DROP POLICY IF EXISTS mig_storage_book_scope ON storage.objects;
CREATE POLICY mig_storage_book_scope ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (bucket_id='mh-client-documents' AND private.mig_can_access_storage(name))
WITH CHECK (bucket_id='mh-client-documents' AND private.mig_can_access_storage(name));

-- Sensitive-data RPCs are service-only; additionally scope the verified actor.
DO $migration$
DECLARE f record; definition text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('mh_client_sensitive_get','mh_client_sensitive_save','mh_client_banking_get','mh_client_banking_save','mh_medicare_gov_credentials_get','mh_medicare_gov_credentials_save') LOOP
   definition := pg_get_functiondef(f.oid);
   IF position('private.mig_actor_can_access_client' IN definition)=0 THEN
     IF position(E'\nbegin\n' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected function body: %',f.proname; END IF;
     definition := replace(definition,E'\nbegin\n',E'\nbegin\n  if not private.mig_actor_can_access_client(p_actor_id,p_client_id) then raise exception ''Unauthorized client access'' using errcode=''42501''; end if;\n');
     EXECUTE definition;
   END IF;
 END LOOP;
END;
$migration$;
ALTER VIEW public.client_search_results SET (security_invoker=true);
ALTER VIEW public.campaign_member_results SET (security_invoker=true);
ALTER VIEW public.campaign_summaries SET (security_invoker=true);
ALTER VIEW public.life_premium_dashboard_rollup SET (security_invoker=true);

-- A narrowly authorized RPC performs soft deletion without relaxing the SELECT
-- policy that keeps hidden rows inaccessible to browser queries.
CREATE OR REPLACE FUNCTION public.hide_my_communication(p_kind text,p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE client uuid; affected integer;
BEGIN
 IF p_kind='conversation' THEN client:=p_id;
 ELSIF p_kind='text' THEN SELECT client_id INTO client FROM public.client_sms_messages WHERE id=p_id;
 ELSIF p_kind='call' THEN SELECT client_id INTO client FROM public.ringcentral_calls WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Invalid communication kind' USING ERRCODE='22023'; END IF;
 IF NOT private.mig_can_access_client(client) THEN RAISE EXCEPTION 'Communication unavailable' USING ERRCODE='42501'; END IF;
 IF p_kind='conversation' THEN UPDATE public.client_sms_messages SET hidden_at=now(),updated_at=now() WHERE client_id=client AND hidden_at IS NULL;
 ELSIF p_kind='text' THEN UPDATE public.client_sms_messages SET hidden_at=now(),updated_at=now() WHERE id=p_id AND hidden_at IS NULL;
 ELSE UPDATE public.ringcentral_calls SET hidden_at=now(),updated_at=now() WHERE id=p_id AND hidden_at IS NULL; END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected;
END; $$;
REVOKE ALL ON FUNCTION public.hide_my_communication(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hide_my_communication(text,uuid) TO authenticated,service_role;

-- End-to-end RLS assertions with synthetic principals. The inner transaction is
-- deliberately rolled back, so no test users, records, sessions or files remain.
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); n integer;
BEGIN
 BEGIN
   INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
   VALUES (a,'mig-rls-'||a||'@example.invalid','{"mh_admin_provisioned":true,"requested_role":"agent"}','{"full_name":"Synthetic agent A"}'),
          (b,'mig-rls-'||b||'@example.invalid','{"mh_admin_provisioned":true,"requested_role":"agent"}','{"full_name":"Synthetic agent B"}');
   INSERT INTO public.clients(id,assigned_agent_id,first_name,last_name) VALUES(ca,a,'Synthetic','A'),(cb,b,'Synthetic','B');
   INSERT INTO public.documents(client_id,uploaded_by,category,file_name,storage_path) VALUES(ca,a,'other','fixture.txt',ca||'/fixture.txt'),(cb,b,'other','fixture.txt',cb||'/fixture.txt');
   INSERT INTO public.client_sms_messages(client_id,user_id,direction,body,status) VALUES(ca,a,'inbound','Synthetic A','received'),(cb,b,'inbound','Synthetic B','received');
   INSERT INTO public.ringcentral_calls(client_id,source_call_id,direction,started_at) VALUES(ca,'mig-test-'||ca,'Inbound',now()),(cb,'mig-test-'||cb,'Inbound',now());
   PERFORM set_config('request.jwt.claim.sub',a::text,true);
   PERFORM set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
   EXECUTE 'SET LOCAL ROLE authenticated';
   SELECT count(*) INTO n FROM public.clients; IF n<>1 THEN RAISE EXCEPTION 'Agent client isolation failed: %',n; END IF;
   SELECT count(*) INTO n FROM public.client_search_results; IF n<>1 THEN RAISE EXCEPTION 'Client search view isolation failed'; END IF;
   SELECT count(*) INTO n FROM public.documents; IF n<>1 THEN RAISE EXCEPTION 'Document isolation failed'; END IF;
   SELECT count(*) INTO n FROM public.client_sms_messages; IF n<>1 THEN RAISE EXCEPTION 'Text isolation failed'; END IF;
   SELECT count(*) INTO n FROM public.ringcentral_calls; IF n<>1 THEN RAISE EXCEPTION 'Call isolation failed'; END IF;
   UPDATE public.clients SET last_name='Forbidden' WHERE id=cb; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Foreign client update was allowed'; END IF;
   BEGIN
     UPDATE public.clients SET assigned_agent_id=b WHERE id=ca;
     RAISE EXCEPTION 'Agent reassignment was allowed';
   EXCEPTION WHEN insufficient_privilege THEN NULL;
   END;
   BEGIN
     INSERT INTO public.clients(assigned_agent_id,first_name,last_name) VALUES(b,'Forbidden','Insert');
     RAISE EXCEPTION 'Foreign client insert was allowed';
   EXCEPTION WHEN insufficient_privilege THEN NULL;
   END;
   INSERT INTO public.clients(assigned_agent_id,first_name,last_name) VALUES(a,'Allowed','Insert');
   IF NOT private.mig_can_access_storage(ca||'/fixture.txt') OR private.mig_can_access_storage(cb||'/fixture.txt') THEN RAISE EXCEPTION 'Storage isolation failed'; END IF;
   SELECT public.hide_my_communication('conversation',ca) INTO n; IF n<>1 THEN RAISE EXCEPTION 'Own text deletion failed'; END IF;
   SELECT count(*) INTO n FROM public.client_sms_messages; IF n<>0 THEN RAISE EXCEPTION 'Hidden text remained visible'; END IF;
   BEGIN PERFORM public.hide_my_communication('conversation',cb); RAISE EXCEPTION 'Foreign conversation deletion allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   SELECT public.hide_my_communication('call',id) INTO n FROM public.ringcentral_calls WHERE client_id=ca; IF n<>1 THEN RAISE EXCEPTION 'Own call deletion failed'; END IF;
   SELECT count(*) INTO n FROM public.ringcentral_calls; IF n<>0 THEN RAISE EXCEPTION 'Hidden call remained visible'; END IF;
   EXECUTE 'RESET ROLE';
   IF private.mig_actor_can_access_client(a,cb) THEN RAISE EXCEPTION 'Sensitive RPC actor scope failed'; END IF;
   RAISE EXCEPTION USING ERRCODE='MG001',MESSAGE='Rollback successful synthetic RLS assertions';
 EXCEPTION WHEN SQLSTATE 'MG001' THEN NULL;
 END;
END;
$test$;
