-- Candidate local migration: prevent the new team UI overwriting a newer change.
-- The original set_member_access RPC remains callable; this is not a universal CAS guarantee.
CREATE FUNCTION public.set_member_access_if_current(
  p_business_id uuid, p_user_id uuid, p_expected_role public.business_role,
  p_expected_status public.member_status, p_role public.business_role, p_status public.member_status
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE actor_role public.business_role; target public.business_members;
BEGIN
  IF auth.uid() IS NULL OR p_business_id IS NULL OR p_user_id IS NULL OR p_expected_role IS NULL OR p_expected_status IS NULL OR p_role IS NULL OR p_status IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  IF NOT paidflow_private.has_business_role(p_business_id, ARRAY['owner','admin']::public.business_role[]) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.businesses WHERE id=p_business_id FOR NO KEY UPDATE;
  SELECT role INTO actor_role FROM public.business_members WHERE business_id=p_business_id AND user_id=auth.uid() AND status='active' FOR SHARE;
  IF actor_role IS NULL OR actor_role NOT IN ('owner','admin') OR p_user_id=auth.uid() THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO target FROM public.business_members WHERE business_id=p_business_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE='P0002'; END IF;
  IF target.role='owner' OR p_role='owner' OR (actor_role='admin' AND (target.role='admin' OR p_role='admin')) THEN RAISE EXCEPTION 'Cannot modify privileged membership' USING ERRCODE='42501'; END IF;
  IF (target.role,target.status) IS DISTINCT FROM (p_expected_role,p_expected_status) THEN RAISE EXCEPTION 'Membership changed; reload' USING ERRCODE='40001'; END IF;
  IF (target.role,target.status) IS NOT DISTINCT FROM (p_role,p_status) THEN RETURN jsonb_build_object('business_id',target.business_id,'user_id',target.user_id,'role',target.role,'status',target.status); END IF;
  UPDATE public.business_members SET role=p_role, status=p_status WHERE id=target.id RETURNING * INTO target;
  RETURN jsonb_build_object('business_id',target.business_id,'user_id',target.user_id,'role',target.role,'status',target.status);
END $$;
REVOKE ALL ON FUNCTION public.set_member_access_if_current(uuid,uuid,public.business_role,public.member_status,public.business_role,public.member_status) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_member_access_if_current(uuid,uuid,public.business_role,public.member_status,public.business_role,public.member_status) TO authenticated;
