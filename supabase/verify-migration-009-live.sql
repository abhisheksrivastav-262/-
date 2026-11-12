-- READ-ONLY preflight for Migration 009.
-- Run in Supabase SQL Editor only to inspect state. This file contains SELECTs
-- and read-only catalog queries only: no DDL, DML, GRANT, REVOKE, or functions.
-- Secret plaintext is never selected or returned.

-- Result set 1: tables, required columns, member_id unique index, RLS, owner,
-- and FORCE RLS.
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('members','id'), ('members','user_id'), ('members','membership_no'), ('members','status'),
    ('id_cards','id'), ('id_cards','member_id'), ('id_cards','token_hash'), ('id_cards','valid_until'),
    ('id_cards','revoked_at'), ('id_cards','created_at')
), column_checks AS (
  SELECT r.table_name, r.column_name,
         EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
         ) AS present
  FROM required_columns r
), table_state AS (
  SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled,
         c.relforcerowsecurity AS force_rls, pg_get_userbyid(c.relowner) AS table_owner
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname IN ('members','id_cards') AND c.relkind='r'
), unique_member_index AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attname='member_id' AND NOT a.attisdropped
    WHERE n.nspname='public' AND t.relname='id_cards'
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indimmediate IS TRUE
      AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
  ) AS pass
)
SELECT 'table' AS check_group, 'public.'||x.table_name AS item,
       CASE WHEN x.present THEN 'PASS' ELSE 'FAIL' END AS status,
       CASE WHEN x.present THEN 'exists' ELSE 'missing table' END AS detail
FROM (VALUES ('members'),('id_cards')) v(table_name)
CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM table_state s WHERE s.table_name=v.table_name) present) x
UNION ALL
SELECT 'column', 'public.'||table_name||'.'||column_name,
       CASE WHEN present THEN 'PASS' ELSE 'FAIL' END,
       CASE WHEN present THEN 'present' ELSE 'missing' END
FROM column_checks
UNION ALL
SELECT 'unique-index','public.id_cards(member_id)',
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END,
       CASE WHEN pass THEN 'valid non-partial immediate single-key UNIQUE index found'
            ELSE 'required index/constraint not found' END
FROM unique_member_index
UNION ALL
SELECT 'RLS', 'public.'||table_name,
       CASE WHEN rls_enabled THEN 'PASS' ELSE 'FAIL' END,
       'enabled='||rls_enabled||'; force='||force_rls||'; owner='||table_owner
FROM table_state
UNION ALL
SELECT 'RLS policy','public.id_cards policies',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'MANUAL REVIEW' END,
       'policy_count='||count(*)
FROM pg_policies WHERE schemaname='public' AND tablename='id_cards';

-- Result set 2: actual executor RLS bypass and expected new-function owner.
-- Assumption: Migration 009 does not assign function owners, so newly created
-- functions will be owned by current_user. No assumed role is fabricated here.
-- RLS bypass is via rolbypassrls, or table ownership when FORCE RLS is off.
WITH executor AS (
  SELECT r.oid, r.rolname, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user
), card_table AS (
  SELECT c.relowner, c.relforcerowsecurity FROM pg_class c
  WHERE c.oid=to_regclass('public.id_cards')
)
SELECT 'migration_executor / expected owner of new Migration 009 functions' AS role_context,
       e.rolname AS actual_role,
       CASE WHEN e.rolbypassrls OR (e.oid=ct.relowner AND NOT ct.relforcerowsecurity)
            THEN 'PASS' ELSE 'FAIL' END AS rls_bypass_status,
       e.rolbypassrls AS bypassrls,
       (e.oid=ct.relowner) AS owns_id_cards,
       ct.relforcerowsecurity AS force_rls
FROM executor e
CROSS JOIN card_table ct;

-- Result set 3: existing helper ownership, or expected pre-migration status,
-- plus the executor permissions required if Migration 009 creates the functions.
WITH wanted(signature, required_schema, required_extension_signature) AS (
  VALUES
    ('public.derive_id_card_qr_token(uuid)'::text,'vault'::text,'extensions.hmac(bytea,bytea,text)'::text),
    ('public.hash_id_card_token(uuid)'::text,'extensions'::text,'extensions.digest(bytea,text)'::text),
    ('public.issue_approved_member_id_card()'::text,NULL::text,NULL::text),
    ('public.get_id_card_qr_token(uuid)'::text,NULL::text,NULL::text)
), functions AS (
  SELECT w.*, to_regprocedure(w.signature) AS function_oid,
         CASE WHEN w.required_extension_signature IS NOT NULL
              THEN to_regprocedure(w.required_extension_signature) END AS extension_function_oid
  FROM wanted w
)
SELECT f.signature,
       CASE WHEN f.function_oid IS NULL THEN 'NOT CREATED YET' ELSE pg_get_userbyid(p.proowner) END AS owner,
       CASE WHEN f.function_oid IS NULL THEN 'NOT CREATED YET' WHEN p.prosecdef THEN 'PASS' ELSE 'FAIL' END AS security_definer,
       CASE WHEN f.required_schema IS NULL THEN 'N/A'
            WHEN f.function_oid IS NULL AND has_schema_privilege(current_user,f.required_schema,'USAGE') THEN 'PASS (executor; expected new owner)'
            WHEN f.function_oid IS NULL THEN 'FAIL (executor; expected new owner)'
            WHEN has_schema_privilege(p.proowner,f.required_schema,'USAGE') THEN 'PASS' ELSE 'FAIL' END AS schema_usage,
       CASE WHEN f.required_extension_signature IS NULL THEN 'N/A'
            WHEN f.extension_function_oid IS NULL THEN 'FAIL: required extension function missing'
            WHEN f.function_oid IS NULL AND has_function_privilege(current_user,f.extension_function_oid,'EXECUTE') THEN 'PASS (executor; expected new owner)'
            WHEN f.function_oid IS NULL THEN 'FAIL'
            WHEN has_function_privilege(p.proowner,f.extension_function_oid,'EXECUTE') THEN 'PASS' ELSE 'FAIL' END AS extension_execute,
       CASE WHEN f.signature <> 'public.derive_id_card_qr_token(uuid)' THEN 'N/A'
            WHEN f.function_oid IS NULL AND has_table_privilege(current_user,'vault.decrypted_secrets','SELECT') THEN 'PASS (executor; expected new owner)'
            WHEN f.function_oid IS NULL THEN 'FAIL (executor; expected new owner)'
            WHEN has_table_privilege(p.proowner,'vault.decrypted_secrets','SELECT') THEN 'PASS' ELSE 'FAIL' END AS vault_decrypted_secrets_select
FROM functions f LEFT JOIN pg_proc p ON p.oid=f.function_oid;

-- Result set 4: check matching secret metadata only; do not access secret values.
SELECT 'abvds_id_card_token_key' AS secret_name,
       count(*) AS matching_record_count,
       CASE WHEN count(*)=1 THEN 'PASS' ELSE 'FAIL' END AS presence
FROM vault.secrets
WHERE name='abvds_id_card_token_key';

-- Result set 5: complete helper ACL entries plus effective client privileges.
-- Unexpected direct grantees are surfaced for manual comparison with executor
-- and the issuer/RPC owners. PUBLIC uses grantee_oid=0. No ACL is modified.
WITH wanted(signature) AS (
  VALUES ('public.derive_id_card_qr_token(uuid)'::text),
         ('public.hash_id_card_token(uuid)'::text)
), helpers AS (
  SELECT p.oid AS function_oid, p.proowner, p.proacl
  FROM pg_proc p
  WHERE p.oid IN (SELECT to_regprocedure(signature) FROM wanted WHERE to_regprocedure(signature) IS NOT NULL)
), allowed AS (
  SELECT (SELECT oid FROM pg_roles WHERE rolname=current_user) AS role_oid
  UNION SELECT p.proowner FROM pg_proc p WHERE p.oid=to_regprocedure('public.issue_approved_member_id_card()')
  UNION SELECT p.proowner FROM pg_proc p WHERE p.oid=to_regprocedure('public.get_id_card_qr_token(uuid)')
  UNION SELECT p.proowner FROM helpers p
)
SELECT h.function_oid::regprocedure AS helper,
       acl.grantee AS grantee_oid,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE coalesce(r.rolname,'<dropped role>') END AS grantee,
       acl.privilege_type, acl.is_grantable,
       CASE WHEN acl.grantee=0 OR NOT EXISTS (SELECT 1 FROM allowed a WHERE a.role_oid=acl.grantee)
            THEN 'UNEXPECTED DIRECT GRANT' ELSE 'expected/owner grant' END AS review
FROM helpers h
CROSS JOIN LATERAL aclexplode(coalesce(h.proacl,acldefault('f',h.proowner))) acl
LEFT JOIN pg_roles r ON r.oid=acl.grantee
WHERE acl.privilege_type='EXECUTE'
ORDER BY helper::text, grantee;

-- Missing helper functions are expected before Migration 009; no privilege
-- function is called for a missing signature.
WITH wanted(signature) AS (
  VALUES ('public.derive_id_card_qr_token(uuid)'::text),
         ('public.hash_id_card_token(uuid)'::text)
), checks AS (
  SELECT role_name, signature, to_regprocedure(signature) AS function_oid
  FROM (VALUES ('anon'::text),('authenticated'::text)) roles(role_name)
  CROSS JOIN wanted
)
SELECT role_name, signature AS helper_signature,
       CASE WHEN function_oid IS NULL THEN 'NOT CREATED YET'
            WHEN has_function_privilege(role_name,function_oid,'EXECUTE') THEN 'FAIL: effective EXECUTE exists'
            ELSE 'PASS: no effective EXECUTE' END AS status
FROM checks;

-- Result set 6: migration 007 membership-number trigger, approved members,
-- migration 009 trigger-name collision, card count, and token compatibility limitation.
SELECT 'migration_007_trigger' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger t
         WHERE t.tgrelid='public.members'::regclass
           AND t.tgname='members_assign_membership_number'
           AND NOT t.tgisinternal AND t.tgenabled<>'D'
           AND t.tgfoid=to_regprocedure('public.assign_membership_number()')
           AND t.tgtype=23
           AND EXISTS (
             SELECT 1 FROM pg_attribute a
             WHERE a.attrelid=t.tgrelid AND a.attname='status' AND NOT a.attisdropped
               AND a.attnum=ANY(t.tgattr::smallint[])
           )
       ) THEN 'PASS' ELSE 'FAIL' END AS status,
       'enabled BEFORE INSERT OR UPDATE OF status trigger expected' AS detail
UNION ALL
SELECT 'approved_without_membership_no',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
       'count='||count(*)
FROM public.members WHERE status='approved' AND nullif(btrim(membership_no),'') IS NULL
UNION ALL
SELECT 'migration_009_trigger_name',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
       'existing_named_trigger_count='||count(*)
FROM pg_trigger WHERE tgrelid='public.members'::regclass
  AND tgname='members_issue_approved_id_card' AND NOT tgisinternal
UNION ALL
SELECT 'existing_id_cards',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'MANUAL REVIEW' END,
       'card_count='||count(*)||'; existing token/hash compatibility is not calculated here'
FROM public.id_cards;

-- Note: this verification intentionally does not derive or return QR tokens,
-- read the Vault secret value, create helper functions, or invoke token RPCs.
-- If id_cards contains rows, token_hash compatibility with the proposed HMAC
-- derivation requires a separately reviewed, secret-safe check before migration.
