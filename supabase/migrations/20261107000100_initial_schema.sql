-- PAIDFLOW: tenant-owned data model. All monetary values are integer paise.
-- Migrations run as the local Supabase migration owner, never as a browser user.
CREATE TYPE public.business_role AS ENUM ('owner','admin','manager','accountant','viewer');
CREATE TYPE public.member_status AS ENUM ('active','suspended');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '', preferred_language text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en','hi','mr')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  legal_name text, business_type text NOT NULL DEFAULT 'other', is_gst_registered boolean NOT NULL DEFAULT false,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  address_line1 text, address_line2 text, city text, state_code text NOT NULL CHECK (state_code ~ '^[0-9]{2}$'),
  pincode text CHECK (pincode IS NULL OR pincode ~ '^[0-9]{6}$'), currency_code text NOT NULL DEFAULT 'INR' CHECK (currency_code = 'INR'),
  fy_start_month smallint NOT NULL DEFAULT 4 CHECK (fy_start_month = 4),
  invoice_prefix text NOT NULL DEFAULT 'PF' CHECK (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
  upi_id text, upi_payee_name text, default_payment_terms_days integer NOT NULL DEFAULT 15 CHECK (default_payment_terms_days BETWEEN 0 AND 3650),
  created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((NOT is_gst_registered AND gstin IS NULL) OR (is_gst_registered AND gstin IS NOT NULL))
);
CREATE TABLE public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  user_id uuid NOT NULL REFERENCES auth.users(id), role public.business_role NOT NULL, status public.member_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), UNIQUE (business_id,user_id)
);
CREATE TABLE public.business_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254), role public.business_role NOT NULL CHECK (role <> 'owner'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'), invited_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at), UNIQUE(business_id,id)
);
CREATE TABLE public.invoice_sequences (
  business_id uuid NOT NULL REFERENCES public.businesses(id), fy_start_year integer NOT NULL CHECK (fy_start_year BETWEEN 1900 AND 9998),
  last_number bigint NOT NULL CHECK (last_number > 0), PRIMARY KEY (business_id,fy_start_year)
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200), contact_person text, email text, phone text, whatsapp_phone text,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'), billing_address jsonb, shipping_address jsonb,
  state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'), payment_terms_days integer CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 3650),
  credit_limit_paise bigint CHECK (credit_limit_paise IS NULL OR credit_limit_paise BETWEEN 0 AND 9007199254740991), internal_notes text,
  is_archived boolean NOT NULL DEFAULT false, created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (business_id,id)
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id), customer_id uuid NOT NULL,
  invoice_number text NOT NULL CHECK (length(trim(invoice_number)) BETWEEN 1 AND 80),
  invoice_date date NOT NULL, due_date date NOT NULL CHECK (due_date >= invoice_date), fy_start_year integer NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'draft' CHECK (lifecycle_status IN ('draft','issued','cancelled')),
  is_archived boolean NOT NULL DEFAULT false, issued_at timestamptz, sent_at timestamptz, cancelled_at timestamptz, cancelled_reason text,
  is_gst_invoice boolean NOT NULL DEFAULT false, supply_type text NOT NULL DEFAULT 'non_gst' CHECK (supply_type IN ('intra_state','inter_state','non_gst')),
  origin_state_code text NOT NULL CHECK (origin_state_code ~ '^[0-9]{2}$'), place_of_supply_state_code text NOT NULL CHECK (place_of_supply_state_code ~ '^[0-9]{2}$'),
  po_number text, po_date date, delivery_challan_number text, notes text, terms text,
  subtotal_paise bigint NOT NULL DEFAULT 0, discount_paise bigint NOT NULL DEFAULT 0, taxable_paise bigint NOT NULL DEFAULT 0,
  cgst_paise bigint NOT NULL DEFAULT 0, sgst_paise bigint NOT NULL DEFAULT 0, igst_paise bigint NOT NULL DEFAULT 0,
  shipping_paise bigint NOT NULL DEFAULT 0, additional_charges_paise bigint NOT NULL DEFAULT 0, round_off_paise smallint NOT NULL DEFAULT 0,
  total_paise bigint NOT NULL DEFAULT 0, paid_paise bigint NOT NULL DEFAULT 0, balance_paise bigint NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,id,customer_id), UNIQUE (business_id,invoice_number),
  FOREIGN KEY (business_id,customer_id) REFERENCES public.customers(business_id,id)
);
CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, invoice_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0), description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000), hsn_sac_code text, unit text NOT NULL DEFAULT 'Nos',
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0), unit_price_paise bigint NOT NULL, discount_paise bigint NOT NULL DEFAULT 0,
  taxable_paise bigint NOT NULL, gst_rate_bps integer NOT NULL DEFAULT 0, cgst_paise bigint NOT NULL DEFAULT 0, sgst_paise bigint NOT NULL DEFAULT 0, igst_paise bigint NOT NULL DEFAULT 0, line_total_paise bigint NOT NULL,
  UNIQUE (business_id,id), FOREIGN KEY (business_id,invoice_id) REFERENCES public.invoices(business_id,id)
);
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, invoice_id uuid NOT NULL, customer_id uuid NOT NULL,
  payment_date date NOT NULL, amount_paise bigint NOT NULL CHECK (amount_paise BETWEEN 1 AND 9007199254740991),
  payment_mode text NOT NULL CHECK (payment_mode IN ('upi','neft','rtgs','imps','bank_transfer','cash','cheque','other')),
  reference_id text, proof_document_id uuid, verification_status text NOT NULL DEFAULT 'user_recorded' CHECK (verification_status IN ('user_recorded','proof_attached')),
  notes text, status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','voided')), voided_at timestamptz, voided_by uuid REFERENCES auth.users(id), voided_reason text,
  idempotency_key uuid NOT NULL, recorded_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,id,invoice_id), UNIQUE (business_id,idempotency_key),
  FOREIGN KEY (business_id,invoice_id,customer_id) REFERENCES public.invoices(business_id,id,customer_id),
  CHECK ((status = 'recorded' AND voided_at IS NULL AND voided_by IS NULL AND voided_reason IS NULL) OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND voided_reason IS NOT NULL AND length(trim(voided_reason)) > 0)),
  CHECK ((proof_document_id IS NULL AND verification_status = 'user_recorded') OR (proof_document_id IS NOT NULL AND verification_status = 'proof_attached'))
);
CREATE TABLE public.payment_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, invoice_id uuid NOT NULL, customer_id uuid NOT NULL,
  promised_date date NOT NULL, promised_amount_paise bigint NOT NULL CHECK (promised_amount_paise BETWEEN 1 AND 9007199254740991),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','missed','rescheduled')),
  customer_note text, created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE (business_id,id), FOREIGN KEY (business_id,invoice_id,customer_id) REFERENCES public.invoices(business_id,id,customer_id)
);
CREATE TABLE public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, invoice_id uuid NOT NULL, customer_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('due_soon','due_today','overdue_1_7','overdue_8_15','overdue_16_30','overdue_30_plus')),
  tone text NOT NULL CHECK (tone IN ('friendly','professional','firm','final')), language text NOT NULL CHECK (language IN ('en','hi','mr')),
  next_followup_date date, status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','snoozed','cancelled')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id,id), UNIQUE (business_id,id,invoice_id,customer_id), FOREIGN KEY (business_id,invoice_id,customer_id) REFERENCES public.invoices(business_id,id,customer_id)
);
CREATE TABLE public.reminder_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, reminder_id uuid, invoice_id uuid NOT NULL, customer_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp_deeplink','email_draft','copied_text','phone_call_note')),
  language text NOT NULL CHECK (language IN ('en','hi','mr')), tone text NOT NULL CHECK (tone IN ('friendly','professional','firm','final')),
  message_body text NOT NULL, customer_response text, next_followup_date date, acted_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,invoice_id,customer_id) REFERENCES public.invoices(business_id,id,customer_id),
  FOREIGN KEY (business_id,reminder_id,invoice_id,customer_id) REFERENCES public.reminders(business_id,id,invoice_id,customer_id)
);
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id), customer_id uuid, invoice_id uuid, payment_id uuid,
  category text NOT NULL CHECK (category IN ('purchase_order','invoice_copy','delivery_challan','proof_of_delivery','acceptance_acknowledgement','email_acknowledgement','payment_receipt','contract','other')),
  file_name text NOT NULL, storage_path text NOT NULL UNIQUE, mime_type text NOT NULL, file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0), sha256_checksum text, document_date date, notes text,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id,id), UNIQUE(business_id,id,invoice_id),
  FOREIGN KEY (business_id,customer_id) REFERENCES public.customers(business_id,id),
  FOREIGN KEY (business_id,invoice_id) REFERENCES public.invoices(business_id,id),
  FOREIGN KEY (business_id,invoice_id,customer_id) REFERENCES public.invoices(business_id,id,customer_id),
  FOREIGN KEY (business_id,payment_id,invoice_id) REFERENCES public.payments(business_id,id,invoice_id),
  CHECK (payment_id IS NULL OR invoice_id IS NOT NULL), CHECK (storage_path LIKE business_id::text || '/%')
);
ALTER TABLE public.payments ADD CONSTRAINT payment_proof_same_invoice_fk FOREIGN KEY (business_id,proof_document_id,invoice_id) REFERENCES public.documents(business_id,id,invoice_id);
CREATE TABLE public.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id), document_id uuid, confirmed_invoice_id uuid,
  engine_used text NOT NULL CHECK (engine_used IN ('pdf_text','tesseract_ocr','python_pymupdf','ai_provider')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','needs_review','confirmed','rejected','failed')),
  extracted_payload jsonb, field_confidences jsonb, user_corrected_payload jsonb, confirmed_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id,document_id) REFERENCES public.documents(business_id,id), FOREIGN KEY (business_id,confirmed_invoice_id) REFERENCES public.invoices(business_id,id),
  CHECK ((status = 'confirmed' AND confirmed_at IS NOT NULL AND confirmed_invoice_id IS NOT NULL) OR (status <> 'confirmed' AND confirmed_at IS NULL AND confirmed_invoice_id IS NULL))
);
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL REFERENCES public.businesses(id), actor_user_id uuid REFERENCES auth.users(id),
  entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.subscriptions (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id), plan_tier text NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free','starter','growth','business')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), limits_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notification_preferences (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id), default_reminder_language text NOT NULL DEFAULT 'en' CHECK (default_reminder_language IN ('en','hi','mr')),
  default_reminder_tone text NOT NULL DEFAULT 'professional' CHECK (default_reminder_tone IN ('friendly','professional','firm','final')),
  due_soon_days_before integer NOT NULL DEFAULT 3 CHECK (due_soon_days_before BETWEEN 0 AND 365), enable_digest boolean NOT NULL DEFAULT false
);
