-- Run ONLY against a reset local Supabase DB as the local postgres role; rolls back.
-- This checks real auth.uid()/roles and RLS, but NOT Auth HTTP, Storage or PostgREST.
BEGIN;
INSERT INTO auth.users(id,email,aud,role,created_at,updated_at) VALUES
('11000000-0000-4000-8000-000000000001','a@example.invalid','authenticated','authenticated',now(),now()),
('11000000-0000-4000-8000-000000000002','b@example.invalid','authenticated','authenticated',now(),now()),
('11000000-0000-4000-8000-000000000003','manager@example.invalid','authenticated','authenticated',now(),now()),
('11000000-0000-4000-8000-000000000004','viewer@example.invalid','authenticated','authenticated',now(),now()),
('11000000-0000-4000-8000-000000000005','suspended@example.invalid','authenticated','authenticated',now(),now());
INSERT INTO public.businesses(id,name,state_code,created_by) VALUES
('22000000-0000-4000-8000-000000000001','Fictional A','27','11000000-0000-4000-8000-000000000001'),
('22000000-0000-4000-8000-000000000002','Fictional B','27','11000000-0000-4000-8000-000000000002');
INSERT INTO public.business_members(business_id,user_id,role,status) VALUES
('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','owner','active'),
('22000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','owner','active'),
('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','manager','active'),
('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000004','viewer','active'),
('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000005','manager','suspended');
INSERT INTO public.customers(id,business_id,name,created_by) VALUES
('33000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','A Buyer','11000000-0000-4000-8000-000000000001'),
('33000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','B Buyer','11000000-0000-4000-8000-000000000002');
INSERT INTO public.invoices(id,business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code,subtotal_paise,taxable_paise,total_paise,balance_paise,created_by) VALUES
('44000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','TEST-B','2026-04-01','2026-04-02',2026,'27','27',1000,1000,1000,1000,'11000000-0000-4000-8000-000000000002');
INSERT INTO public.invoice_items(business_id,invoice_id,description,quantity,unit_price_paise,taxable_paise,line_total_paise) VALUES ('22000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','Fictional work',1,1000,1000,1000);
INSERT INTO public.documents(id,business_id,invoice_id,category,file_name,storage_path,mime_type,file_size_bytes,uploaded_by) VALUES ('55000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','other','x','22000000-0000-4000-8000-000000000002/x','text/plain',1,'11000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
SELECT public.issue_invoice('22000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002');
SELECT public.record_payment('22000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000001',100,'2026-04-01','upi');
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.customers WHERE business_id='22000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'A positive read failed'; END IF;
 IF EXISTS (SELECT 1 FROM public.customers WHERE business_id='22000000-0000-4000-8000-000000000002') OR EXISTS (SELECT 1 FROM public.invoices WHERE business_id='22000000-0000-4000-8000-000000000002') OR EXISTS (SELECT 1 FROM public.payments WHERE business_id='22000000-0000-4000-8000-000000000002') OR EXISTS (SELECT 1 FROM public.documents WHERE business_id='22000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'A-D cross-tenant read succeeded'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.set_member_access('22000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000003','owner','active'); RAISE EXCEPTION 'E role escalation succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.invoices(business_id,customer_id,invoice_number,invoice_date,due_date,fy_start_year,origin_state_code,place_of_supply_state_code) VALUES ('22000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000002','CROSS','2026-04-01','2026-04-02',2026,'27','27'); RAISE EXCEPTION 'G cross-tenant FK succeeded'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN PERFORM public.record_payment('22000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000002',1,'2026-04-01','upi'); RAISE EXCEPTION 'H cross-tenant payment succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000004',true);
DO $$ BEGIN
 BEGIN INSERT INTO public.customers(business_id,name) VALUES ('22000000-0000-4000-8000-000000000001','Viewer attempt'); RAISE EXCEPTION 'F viewer write succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000005',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.customers WHERE business_id='22000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'J suspended access succeeded'; END IF;
 BEGIN PERFORM public.allocate_invoice_number('22000000-0000-4000-8000-000000000001','2026-04-01'); RAISE EXCEPTION 'J suspended RPC succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.create_business('Bad','27'); RAISE EXCEPTION 'I anonymous RPC succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
