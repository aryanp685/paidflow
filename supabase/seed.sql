-- DEVELOPMENT ONLY. Supabase config disables automatic seeding.
-- To opt in, on a disposable local database only:
--   BEGIN; SET LOCAL paidflow.allow_demo_seed = 'local-only'; \i supabase/seed.sql; COMMIT;
-- The explicit flag is an accidental-execution guard, NOT proof that the database is local.
DO $$
DECLARE uid uuid := 'de000000-0000-4000-8000-000000000001'; bid uuid := 'de000000-0000-4000-8000-000000000002'; cid uuid := 'de000000-0000-4000-8000-000000000003'; iid uuid := 'de000000-0000-4000-8000-000000000004';
BEGIN
  IF current_setting('paidflow.allow_demo_seed',true) IS DISTINCT FROM 'local-only' THEN RAISE EXCEPTION 'Demo seed disabled; explicitly opt in on a disposable local database only'; END IF;
  INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES (uid,'fictional-owner@example.invalid','authenticated','authenticated',now(),now()) ON CONFLICT (id) DO NOTHING;
  PERFORM set_config('request.jwt.claim.sub',uid::text,true);
  INSERT INTO public.businesses(id,name,state_code,created_by) VALUES (bid,'Fictional Sample Workshop','27',uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.business_members(business_id,user_id,role) VALUES (bid,uid,'owner') ON CONFLICT (business_id,user_id) DO NOTHING;
  INSERT INTO public.subscriptions(business_id) VALUES (bid) ON CONFLICT DO NOTHING;
  INSERT INTO public.notification_preferences(business_id) VALUES (bid) ON CONFLICT DO NOTHING;
  INSERT INTO public.customers(id,business_id,name,created_by) VALUES (cid,bid,'Fictional Sample Buyer',uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by)
    VALUES (iid,bid,cid,'DEMO-2026-27-000001','2026-04-01','2026-04-16',2026,'27','27',100000,100000,100000,100000,uid) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.invoice_items(id,business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise)
    VALUES ('de000000-0000-4000-8000-000000000005',bid,iid,'Fictional service',1,100000,100000,100000) ON CONFLICT (id) DO NOTHING;
END $$;
