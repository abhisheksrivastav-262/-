-- ABVDS Migration 009 live preflight (read-only; do not treat as migration SQL).
-- Every statement below is a SELECT/catalog inspection. Vault output is limited
-- to record count and byte length; no secret text or decrypted value is returned.
-- Run before Migration 009. Additive columns/functions absent before migration are
-- reported as expected, while incompatible existing definitions fail closed.

-- Result set 1: required tables and columns. ADDITIVE means Migration 009 creates it.
WITH required(table_name, column_name, phase) AS (
  VALUES
    ('members','id','REQUIRED'),('members','user_id','REQUIRED'),
    ('members','full_name','REQUIRED'),('members','membership_no','REQUIRED'),
    ('members','status','REQUIRED'),('members','valid_until','REQUIRED'),
    ('members','unit_id','REQUIRED'),('members','designation_id','REQUIRED'),
    ('members','photo_path','REQUIRED'),('members','public_photo','REQUIRED'),
    ('profiles','id','REQUIRED'),('profiles','is_active','REQUIRED'),
    ('profiles','account_status','REQUIRED'),
    ('id_cards','id','REQUIRED'),('id_cards','member_id','REQUIRED'),
    ('id_cards','token_hash','REQUIRED'),('id_cards','valid_until','REQUIRED'),
    ('id_cards','revoked_at','REQUIRED'),('id_cards','created_at','REQUIRED'),
    ('id_cards','reissued_at','ADDITIVE'),('id_cards','token_generation_id','ADDITIVE'),
    ('id_verifications','id','REQUIRED'),('id_verifications','id_card_id','REQUIRED'),
    ('id_verifications','viewed_at','REQUIRED'),
    ('id_verifications','token_generation_id','ADDITIVE'),
    ('id_verifications','token_hash_snapshot','ADDITIVE'),
    ('id_verifications','verification_status','ADDITIVE'),
    ('organizational_units','id','REQUIRED'),('organizational_units','name','REQUIRED'),
    ('organizational_units','state','REQUIRED'),('organizational_units','district','REQUIRED'),
    ('organizational_units','active','REQUIRED'),('organizational_units','parent_id','REQUIRED'),
    ('designations','id','REQUIRED'),('designations','name','REQUIRED')
)
SELECT CASE
         WHEN to_regclass(format('public.%I', r.table_name)) IS NULL THEN 'FAIL'
         WHEN c.column_name IS NOT NULL THEN 'PASS'
         WHEN r.phase='ADDITIVE' THEN 'PASS'
         ELSE 'FAIL'
       END AS status,
       r.phase,
       'public.'||r.table_name AS table_name,
       r.column_name,
       c.data_type AS actual_data_type,
       CASE WHEN c.column_name IS NULL AND r.phase='ADDITIVE'
            THEN 'Migration 009 adds this column'
            WHEN c.column_name IS NULL THEN 'Required pre-existing column is missing'
            ELSE 'Present'
       END AS finding
FROM required r
LEFT JOIN information_schema.columns c
  ON c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name
ORDER BY r.table_name,r.column_name;

-- Result set 2: identity, hash, status and date assignment types.
WITH cols AS (
  SELECT a.attrelid::regclass AS relation, a.attname, a.atttypid,
         a.atttypmod, a.attnotnull, pg_catalog.format_type(a.atttypid,a.atttypmod) AS actual_type
  FROM pg_attribute a
  WHERE a.attnum>0 AND NOT a.attisdropped
), checks AS (
  SELECT 'members.id UUID' AS check_name,
         CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END AS status,
         c.actual_type AS actual_value,
         'UUID required for member RPC identity' AS expected
  FROM cols c WHERE c.relation='public.members'::regclass AND c.attname='id'
  UNION ALL
  SELECT 'id_verifications.id_card_id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID FK to stable id_cards.id'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='id_card_id'
  UNION ALL
  SELECT 'id_verifications.id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID primary key for verification-history rows'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='id'
  UNION ALL
  SELECT 'id_verifications.viewed_at timestamp',CASE WHEN c.atttypid IN ('pg_catalog.timestamp'::regtype,'pg_catalog.timestamptz'::regtype) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'timestamp used for history ordering'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='viewed_at'
  UNION ALL
  SELECT 'members.user_id and profiles.id UUID',CASE WHEN EXISTS(SELECT 1 FROM cols x WHERE x.relation='public.members'::regclass AND x.attname='user_id' AND x.atttypid='pg_catalog.uuid'::regtype) AND EXISTS(SELECT 1 FROM cols x WHERE x.relation='public.profiles'::regclass AND x.attname='id' AND x.atttypid='pg_catalog.uuid'::regtype) THEN 'PASS' ELSE 'FAIL' END,
         (SELECT actual_type FROM cols WHERE relation='public.members'::regclass AND attname='user_id')||' / '||(SELECT actual_type FROM cols WHERE relation='public.profiles'::regclass AND attname='id'),'UUID profile join'
  UNION ALL
  SELECT 'id_cards.id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID primary key; stable across reissues'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='id'
  UNION ALL
  SELECT 'id_cards.member_id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID compatible with members.id'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='member_id'
  UNION ALL
  SELECT 'id_cards.token_hash SHA-256 text',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype) AND (c.atttypmod<0 OR c.atttypmod-4>=64) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'text/varchar capacity >= 64'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='token_hash'
  UNION ALL
  SELECT 'id_cards.revoked_at timestamptz',CASE WHEN c.atttypid='pg_catalog.timestamptz'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'timestamptz'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='revoked_at'
  UNION ALL
  SELECT 'id_cards.created_at timestamptz',CASE WHEN c.atttypid='pg_catalog.timestamptz'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'timestamptz'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='created_at'
  UNION ALL
  SELECT 'members.valid_until assignment-compatible',
         CASE WHEN m.atttypid=i.atttypid OR EXISTS (SELECT 1 FROM pg_cast x WHERE x.castsource=m.atttypid AND x.casttarget=i.atttypid AND x.castcontext IN ('i','a')) THEN 'PASS' ELSE 'FAIL' END,
         m.actual_type||' -> '||i.actual_type,'Implicit or assignment cast to id_cards.valid_until'
  FROM cols m CROSS JOIN cols i
  WHERE m.relation='public.members'::regclass AND m.attname='valid_until'
    AND i.relation='public.id_cards'::regclass AND i.attname='valid_until'
  UNION ALL
  SELECT 'valid_until comparable with current_date',
         CASE WHEN m.atttypid IN ('pg_catalog.date'::regtype,'pg_catalog.timestamp'::regtype,'pg_catalog.timestamptz'::regtype) AND i.atttypid IN ('pg_catalog.date'::regtype,'pg_catalog.timestamp'::regtype,'pg_catalog.timestamptz'::regtype) THEN 'PASS' ELSE 'FAIL' END,
         m.actual_type||' / '||i.actual_type,'date or timestamp types'
  FROM cols m CROSS JOIN cols i
  WHERE m.relation='public.members'::regclass AND m.attname='valid_until'
    AND i.relation='public.id_cards'::regclass AND i.attname='valid_until'
  UNION ALL
  SELECT 'members.membership_no text-like',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype,'pg_catalog.bpchar'::regtype) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'text/varchar/char'
  FROM cols c WHERE c.relation='public.members'::regclass AND c.attname='membership_no'
  UNION ALL
  SELECT 'members.status approved-compatible',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype,'pg_catalog.bpchar'::regtype) OR t.typtype='e' THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'Text-like or enum containing approved'
  FROM cols c JOIN pg_type t ON t.oid=c.atttypid WHERE c.relation='public.members'::regclass AND c.attname='status'
  UNION ALL
  SELECT 'id_cards.reissued_at timestamptz',CASE WHEN c.atttypid='pg_catalog.timestamptz'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'timestamptz when already present'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='reissued_at'
  UNION ALL
  SELECT 'id_cards.token_generation_id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID; added/backfilled and made NOT NULL by migration'
  FROM cols c WHERE c.relation='public.id_cards'::regclass AND c.attname='token_generation_id'
  UNION ALL
  SELECT 'id_verifications.token_generation_id UUID',CASE WHEN c.atttypid='pg_catalog.uuid'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'UUID nullable history snapshot'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='token_generation_id'
  UNION ALL
  SELECT 'id_verifications.token_hash_snapshot SHA-256 text',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype) AND (c.atttypmod<0 OR c.atttypmod-4>=64) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'text/varchar capacity >= 64'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='token_hash_snapshot'
  UNION ALL
  SELECT 'id_verifications.verification_status text-like',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype) AND (c.atttypmod<0 OR c.atttypmod-4>=9) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'text/varchar capacity >= 9'
  FROM cols c WHERE c.relation='public.id_verifications'::regclass AND c.attname='verification_status'
  UNION ALL
  SELECT 'profiles.is_active boolean',CASE WHEN c.atttypid='pg_catalog.bool'::regtype THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'boolean'
  FROM cols c WHERE c.relation='public.profiles'::regclass AND c.attname='is_active'
  UNION ALL
  SELECT 'profiles.account_status text-like',CASE WHEN c.atttypid IN ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype,'pg_catalog.bpchar'::regtype) THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'text/varchar/char'
  FROM cols c WHERE c.relation='public.profiles'::regclass AND c.attname='account_status'
  UNION ALL
  SELECT 'members.status enum includes approved',CASE WHEN t.typtype<>'e' OR EXISTS(SELECT 1 FROM pg_enum e WHERE e.enumtypid=t.oid AND e.enumlabel='approved') THEN 'PASS' ELSE 'FAIL' END,c.actual_type,'approved status label'
  FROM cols c JOIN pg_type t ON t.oid=c.atttypid WHERE c.relation='public.members'::regclass AND c.attname='status'
)
SELECT status,check_name,actual_value,expected FROM checks
UNION ALL
SELECT CASE WHEN to_regclass('public.id_cards') IS NULL THEN 'FAIL' ELSE 'PASS' END,
       'Stable card identity update guard',
       CASE WHEN p.oid IS NULL THEN 'reissue RPC not yet created' ELSE
         CASE WHEN lower(pg_get_functiondef(p.oid)) ~ 'update[[:space:]]+public\.id_cards[[:space:]]+set[[:space:]]+id[[:space:]]*=' THEN 'existing reissue source updates id' ELSE 'existing reissue source does not set id' END END,
       'Migration 009 never updates id_cards.id'
FROM (SELECT to_regprocedure('public.reissue_member_id_card(uuid)')::oid AS oid) x
LEFT JOIN pg_proc p ON p.oid=x.oid;

-- Result set 3: nullability/defaults, PK and uniqueness indexes.
WITH target_cols AS (
  SELECT * FROM (VALUES
    ('id_cards','id','REQUIRED_NOT_NULL'),('id_cards','member_id','REQUIRED_NOT_NULL'),
    ('id_cards','token_hash','REQUIRED_NOT_NULL'),('id_cards','token_generation_id','ADDED_NOT_NULL_NO_DEFAULT'),
    ('id_cards','reissued_at','ADDED_NULLABLE_NO_DEFAULT'),
    ('id_verifications','id','REQUIRED_NOT_NULL_DEFAULT'),('id_verifications','id_card_id','REQUIRED_NULLABLE'),
    ('id_verifications','viewed_at','REQUIRED_NOT_NULL_DEFAULT'),
    ('id_verifications','token_generation_id','ADDED_NULLABLE_NO_DEFAULT'),
    ('id_verifications','token_hash_snapshot','ADDED_NULLABLE_NO_DEFAULT'),
    ('id_verifications','verification_status','ADDED_NULLABLE_NO_DEFAULT')
  ) v(table_name,column_name,expected_shape)
), attrs AS (
  SELECT tc.*, c.is_nullable, c.column_default, a.attnotnull,
         c.column_name IS NOT NULL AS present
  FROM target_cols tc
  LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=tc.table_name AND c.column_name=tc.column_name
  LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||tc.table_name) AND a.attname=tc.column_name AND NOT a.attisdropped
)
SELECT CASE
         WHEN NOT present AND expected_shape LIKE 'ADDED%' THEN 'PASS'
         WHEN NOT present THEN 'FAIL'
         WHEN expected_shape='REQUIRED_NOT_NULL' AND attnotnull THEN 'PASS'
         WHEN expected_shape='REQUIRED_NULLABLE' AND NOT attnotnull THEN 'PASS'
         WHEN expected_shape='REQUIRED_NOT_NULL_DEFAULT' AND attnotnull AND column_default IS NOT NULL THEN 'PASS'
         WHEN expected_shape='ADDED_NOT_NULL_NO_DEFAULT' AND attnotnull AND column_default IS NULL THEN 'PASS'
         WHEN expected_shape='ADDED_NULLABLE_NO_DEFAULT' AND NOT attnotnull AND column_default IS NULL THEN 'PASS'
         WHEN expected_shape LIKE 'ADDED%' AND NOT attnotnull AND column_default IS NULL THEN 'REVIEW'
         ELSE 'FAIL'
       END AS status,
       'public.'||table_name AS table_name,column_name,expected_shape,
       CASE WHEN NOT present THEN 'absent; expected before migration for additive field'
            ELSE 'nullable='||is_nullable||'; default='||coalesce(column_default,'<none>') END AS actual_shape
FROM attrs
UNION ALL
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='id' AND NOT a.attisdropped
         WHERE i.indrelid='public.id_cards'::regclass AND i.indisprimary AND i.indisvalid AND i.indkey[0]=a.attnum
       ) THEN 'PASS' ELSE 'FAIL' END,
       'public.id_cards','id','PRIMARY KEY','stable card primary key'
UNION ALL
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname=ix.column_name AND NOT a.attisdropped
         WHERE i.indrelid='public.id_cards'::regclass AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indimmediate IS TRUE AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
       ) THEN 'PASS' ELSE 'FAIL' END,
       'public.id_cards',ix.column_name,'UNIQUE single-column non-partial immediate index','required by Migration 009'
FROM (VALUES ('member_id'),('token_hash')) ix(column_name)
UNION ALL
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='token_generation_id' AND NOT a.attisdropped
         WHERE i.indrelid='public.id_cards'::regclass AND i.indisunique AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indimmediate IS TRUE AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum
       ) THEN 'PASS' WHEN to_regclass('public.id_cards_token_generation_id_key') IS NULL THEN 'PASS' ELSE 'FAIL' END,
       'public.id_cards','token_generation_id','UNIQUE after migration','absent before migration is expected; Migration 009 creates it';

-- Result set 4: foreign-key preservation and dependent references to stable card ID.
WITH id_col AS (
  SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.id_cards') AND attname='id' AND NOT attisdropped
), fk AS (
  SELECT c.*, ns.nspname AS referencing_schema, t.relname AS referencing_table
  FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace
  WHERE c.contype='f' AND c.confrelid=to_regclass('public.id_cards')
    AND (SELECT attnum FROM id_col)=ANY(c.confkey)
)
SELECT CASE WHEN EXISTS (
         SELECT 1 FROM fk f
         WHERE f.referencing_schema='public' AND f.referencing_table='id_verifications'
           AND f.conname='id_verifications_id_card_id_fkey'
           AND f.convalidated AND f.confupdtype='a' AND f.confdeltype='a'
           AND cardinality(f.conkey)=1 AND cardinality(f.confkey)=1
           AND f.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=to_regclass('public.id_verifications') AND attname='id_card_id' AND NOT attisdropped)]::smallint[]
       ) THEN 'PASS' ELSE 'FAIL' END AS status,
       'id_verifications_id_card_id_fkey' AS constraint_name,
       'public.id_verifications.id_card_id -> public.id_cards.id' AS relationship,
       'validated; ON UPDATE NO ACTION; ON DELETE NO ACTION; no drop/alter in migration' AS required_definition
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'REVIEW' END,
       coalesce(string_agg(format('%I.%I.%I',f.referencing_schema,f.referencing_table,f.conname),', '),'none'),
       'additional FK(s) to public.id_cards.id','stable id is never updated; review all listed references'
FROM fk f
WHERE NOT (f.referencing_schema='public' AND f.referencing_table='id_verifications' AND f.conname='id_verifications_id_card_id_fkey');

-- Result set 5: RLS, FORCE RLS and policy inventory for affected/read tables.
SELECT CASE
         WHEN rel.oid IS NULL THEN 'FAIL'
         WHEN rel.relrowsecurity AND (c.relname NOT IN ('id_cards','id_verifications') OR pc.policy_count=0) THEN 'PASS'
         WHEN c.relname IN ('id_cards','id_verifications') AND rel.relrowsecurity AND pc.policy_count=0 THEN 'PASS'
         WHEN c.relname IN ('id_cards','id_verifications') AND pc.policy_count>0 THEN 'FAIL'
         ELSE 'REVIEW'
       END AS status,
       'public.'||c.relname AS table_name,
       coalesce(rel.relrowsecurity,false) AS rls_enabled,
       coalesce(rel.relforcerowsecurity,false) AS force_rls,
       coalesce(pc.policy_count,0) AS policy_count,
       pc.policy_names,
       CASE WHEN c.relname IN ('id_cards','id_verifications') THEN 'RLS enabled; zero policies required'
            ELSE 'Existing policy inventory; function owner must bypass RLS or own table without FORCE RLS' END AS expected
FROM (VALUES ('id_cards'),('id_verifications'),('members'),('profiles'),('organizational_units'),('designations')) c(relname)
LEFT JOIN pg_class rel ON rel.oid=to_regclass('public.'||c.relname)
LEFT JOIN LATERAL (
  SELECT count(*) AS policy_count,string_agg(p.policyname,', ' ORDER BY p.policyname) AS policy_names
  FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
) pc ON true;

-- Result set 6: direct table/column ACLs and effective client/service-role access.
SELECT CASE
         WHEN acl.grantee=0 THEN 'FAIL'
         WHEN c.relname='id_cards' AND acl.grantee=c.relowner THEN 'PASS'
         WHEN acl.grantee='service_role'::regrole::oid AND acl.privilege_type IN ('SELECT','INSERT','UPDATE') AND NOT acl.is_grantable THEN 'PASS'
         WHEN c.relname='id_verifications' AND acl.grantee=c.relowner THEN 'PASS'
         WHEN c.relname='id_verifications' AND acl.grantee='service_role'::regrole::oid THEN 'REVIEW'
         ELSE 'FAIL'
       END AS status,
       'public.'||c.relname AS object_name,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,acl.is_grantable,'direct table ACL' AS privilege_source
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
WHERE n.nspname='public' AND c.relname IN ('id_cards','id_verifications')
UNION ALL
SELECT CASE WHEN acl.grantee=0 THEN 'FAIL'
            WHEN acl.grantee=(SELECT relowner FROM pg_class WHERE oid=a.attrelid) THEN 'PASS'
            WHEN acl.grantee='service_role'::regrole::oid AND acl.privilege_type IN ('SELECT','INSERT','UPDATE') AND NOT acl.is_grantable THEN 'PASS'
            ELSE 'FAIL' END,
       format('public.%s.%s',t.relname,a.attname),
       CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
       acl.privilege_type,acl.is_grantable,'direct column ACL'
FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace
CROSS JOIN LATERAL aclexplode(a.attacl) acl
WHERE n.nspname='public' AND t.relname IN ('id_cards','id_verifications') AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
UNION ALL
SELECT CASE WHEN (p.rolname IN ('anon','authenticated') AND has_any_column_privilege(p.rolname, c.oid, 'SELECT')) THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,c.oid,'SELECT') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND (has_table_privilege(p.rolname,c.oid,'INSERT') OR has_table_privilege(p.rolname,c.oid,'UPDATE') OR has_table_privilege(p.rolname,c.oid,'DELETE') OR has_table_privilege(p.rolname,c.oid,'TRUNCATE') OR has_table_privilege(p.rolname,c.oid,'REFERENCES') OR has_table_privilege(p.rolname,c.oid,'TRIGGER') OR has_any_column_privilege(p.rolname,c.oid,'INSERT') OR has_any_column_privilege(p.rolname,c.oid,'UPDATE') OR has_any_column_privilege(p.rolname,c.oid,'REFERENCES')) THEN 'FAIL'
            WHEN p.rolname='service_role' AND c.relname='id_cards'
                 AND (has_table_privilege(p.rolname,c.oid,'DELETE') OR has_table_privilege(p.rolname,c.oid,'TRUNCATE') OR has_table_privilege(p.rolname,c.oid,'REFERENCES') OR has_table_privilege(p.rolname,c.oid,'TRIGGER') OR has_any_column_privilege(p.rolname,c.oid,'REFERENCES')) THEN 'FAIL'
            WHEN p.rolname='service_role' AND c.relname='id_cards'
                 AND has_table_privilege(p.rolname,c.oid,'SELECT') AND has_table_privilege(p.rolname,c.oid,'INSERT') AND has_table_privilege(p.rolname,c.oid,'UPDATE') THEN 'PASS'
            WHEN p.rolname='service_role' AND c.relname='id_cards' THEN 'REVIEW'
            ELSE 'PASS' END,
       'public.'||c.relname,p.rolname,
       concat_ws(',',
         CASE WHEN has_table_privilege(p.rolname,c.oid,'SELECT') THEN 'SELECT' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'INSERT') THEN 'INSERT' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'UPDATE') THEN 'UPDATE' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'DELETE') THEN 'DELETE' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'TRUNCATE') THEN 'TRUNCATE' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'REFERENCES') THEN 'REFERENCES' END,
         CASE WHEN has_table_privilege(p.rolname,c.oid,'TRIGGER') THEN 'TRIGGER' END
       ),false,'effective privilege incl. role memberships'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) p(rolname)
WHERE n.nspname='public' AND c.relname IN ('id_cards','id_verifications')
UNION ALL
SELECT CASE WHEN p.rolname IN ('anon','authenticated') AND (has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'SELECT') OR has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'SELECT')) THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'INSERT') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'UPDATE') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'DELETE') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'TRUNCATE') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'REFERENCES') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'TRIGGER') THEN 'FAIL'
            WHEN p.rolname IN ('anon','authenticated') AND (has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'INSERT') OR has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'UPDATE') OR has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'REFERENCES')) THEN 'FAIL'
            ELSE 'PASS' END,
       'public.id_verifications',p.rolname,
       concat_ws(',',CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'SELECT') THEN 'SELECT' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'INSERT') THEN 'INSERT' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'UPDATE') THEN 'UPDATE' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'DELETE') THEN 'DELETE' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'TRUNCATE') THEN 'TRUNCATE' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'REFERENCES') THEN 'REFERENCES' END,
                       CASE WHEN has_table_privilege(p.rolname,to_regclass('public.id_verifications'),'TRIGGER') THEN 'TRIGGER' END,
                       CASE WHEN has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'INSERT') THEN 'COLUMN INSERT' END,
                       CASE WHEN has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'UPDATE') THEN 'COLUMN UPDATE' END,
                       CASE WHEN has_any_column_privilege(p.rolname,to_regclass('public.id_verifications'),'REFERENCES') THEN 'COLUMN REFERENCES' END),false,
       'effective verification-history privilege incl. membership'
FROM (VALUES ('anon'),('authenticated')) p(rolname)
UNION ALL
SELECT CASE WHEN r.rolname IN ('anon','authenticated','service_role') OR r.oid=c.relowner THEN 'PASS'
            WHEN has_table_privilege(r.rolname,c.oid,'SELECT') OR has_table_privilege(r.rolname,c.oid,'INSERT') OR has_table_privilege(r.rolname,c.oid,'UPDATE') OR has_table_privilege(r.rolname,c.oid,'DELETE') THEN 'FAIL'
            ELSE 'PASS' END,
       'public.'||c.relname,r.rolname,
       concat_ws(',',CASE WHEN has_table_privilege(r.rolname,c.oid,'SELECT') THEN 'SELECT' END,
                       CASE WHEN has_table_privilege(r.rolname,c.oid,'INSERT') THEN 'INSERT' END,
                       CASE WHEN has_table_privilege(r.rolname,c.oid,'UPDATE') THEN 'UPDATE' END,
                       CASE WHEN has_table_privilege(r.rolname,c.oid,'DELETE') THEN 'DELETE' END),false,
       'effective access for custom roles incl. inherited memberships'
FROM pg_roles r CROSS JOIN (VALUES ('id_cards'),('id_verifications')) t(table_name)
JOIN pg_class c ON c.oid=to_regclass('public.'||t.table_name)
WHERE r.rolname NOT IN ('anon','authenticated','service_role') AND NOT r.rolsuper;

-- Result set 7: function owner, SECURITY DEFINER, search_path and effective RPC grants.
WITH expected(name,signature,kind) AS (
  VALUES ('derive_id_card_qr_token','public.derive_id_card_qr_token(uuid)','helper'),
         ('hash_id_card_token','public.hash_id_card_token(uuid)','helper'),
         ('issue_approved_member_id_card','public.issue_approved_member_id_card()','trigger'),
         ('get_id_card_qr_token','public.get_id_card_qr_token(uuid)','rpc'),
         ('reissue_member_id_card','public.reissue_member_id_card(uuid)','rpc'),
         ('verify_id_card_token','public.verify_id_card_token(text)','rpc')
), resolved AS (
  SELECT e.*,to_regprocedure(e.signature)::oid AS fn_oid
  FROM expected e
)
SELECT CASE WHEN r.fn_oid IS NULL THEN 'PASS'
            WHEN p.prosecdef AND coalesce(array_to_string(p.proconfig,','),'') ILIKE '%search_path=pg_catalog%' THEN 'PASS'
            ELSE 'FAIL' END AS status,
       r.name,r.signature,
       CASE WHEN p.oid IS NULL THEN 'NOT CREATED YET; migration executor is expected owner'
            ELSE pg_get_userbyid(p.proowner) END AS actual_or_expected_owner,
       coalesce(p.prosecdef,false) AS security_definer,
       p.proconfig AS function_settings,
       CASE WHEN p.oid IS NULL THEN 'migration creates this function'
            WHEN r.kind='rpc' THEN 'service_role EXECUTE; anon/authenticated denied'
            WHEN r.kind='helper' THEN 'targeted internal owners only; no PUBLIC/client EXECUTE'
            ELSE 'trigger function; PUBLIC/client EXECUTE revoked' END AS required_state,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_effective_execute,
       CASE WHEN p.oid IS NULL THEN NULL ELSE has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_effective_execute,
       CASE WHEN p.oid IS NULL OR r.kind NOT IN ('rpc','helper') THEN NULL ELSE has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_effective_execute
FROM resolved r LEFT JOIN pg_proc p ON p.oid=r.fn_oid
ORDER BY r.name;

-- Result set 8: function ACL rows. PUBLIC/client ACL entries are revoked by 009;
-- inherited effective access after those revokes must still be absent.
WITH funcs AS (
  SELECT p.oid,p.proname,p.proowner,p.proacl
  FROM pg_proc p
  WHERE p.oid=ANY(ARRAY[
    to_regprocedure('public.derive_id_card_qr_token(uuid)')::oid,
    to_regprocedure('public.hash_id_card_token(uuid)')::oid,
    to_regprocedure('public.issue_approved_member_id_card()')::oid,
    to_regprocedure('public.get_id_card_qr_token(uuid)')::oid,
    to_regprocedure('public.reissue_member_id_card(uuid)')::oid,
    to_regprocedure('public.verify_id_card_token(text)')::oid
  ])
)
SELECT CASE WHEN acl.grantee=0 THEN 'REVIEW'
            WHEN pg_get_userbyid(acl.grantee) IN ('anon','authenticated') THEN 'REVIEW'
            WHEN acl.grantee IN (f.proowner,'service_role'::regrole::oid) THEN 'PASS'
            ELSE 'FAIL' END AS status,
       f.proname AS function_name,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       acl.privilege_type,acl.is_grantable,pg_get_userbyid(f.proowner) AS function_owner,
       'REVIEW means migration must revoke direct client/PUBLIC grant; unexpected custom role is FAIL' AS interpretation
FROM funcs f
CROSS JOIN LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl
WHERE acl.privilege_type='EXECUTE'
UNION ALL
SELECT CASE WHEN to_regprocedure(x.signature) IS NULL THEN 'PASS'
            WHEN has_function_privilege('anon',to_regprocedure(x.signature)::oid,'EXECUTE') OR has_function_privilege('authenticated',to_regprocedure(x.signature)::oid,'EXECUTE') THEN 'FAIL'
            ELSE 'PASS' END,
       x.name,'anon/authenticated effective', 'EXECUTE',false,NULL,
       'Migration must leave no direct or inherited client EXECUTE access'
FROM (VALUES ('derive_id_card_qr_token','public.derive_id_card_qr_token(uuid)'),
             ('hash_id_card_token','public.hash_id_card_token(uuid)'),
             ('get_id_card_qr_token','public.get_id_card_qr_token(uuid)'),
             ('reissue_member_id_card','public.reissue_member_id_card(uuid)'),
             ('verify_id_card_token','public.verify_id_card_token(text)')) x(name,signature);

-- Result set 9: Vault metadata and secret byte length only, plus pgcrypto checks.
-- No plaintext column is selected or returned. decrypted_secret is consumed only
-- inside octet_length(convert_to(...)); do not change this to SELECT decrypted_secret.
WITH metadata AS (
  SELECT count(*) AS matching_secret_count
  FROM vault.secrets WHERE name='abvds_id_card_token_key'
), secret_length AS (
  SELECT count(*) AS decrypted_match_count,
         min(octet_length(convert_to(decrypted_secret,'UTF8'))) AS min_secret_length_bytes,
         max(octet_length(convert_to(decrypted_secret,'UTF8'))) AS max_secret_length_bytes
  FROM vault.decrypted_secrets WHERE name='abvds_id_card_token_key'
), crypto(signature,fn_oid) AS (
  VALUES ('extensions.digest(bytea,text)',to_regprocedure('extensions.digest(bytea,text)')::oid),
         ('extensions.hmac(bytea,bytea,text)',to_regprocedure('extensions.hmac(bytea,bytea,text)')::oid)
)
SELECT CASE WHEN m.matching_secret_count=1 AND s.decrypted_match_count=1 AND s.min_secret_length_bytes>=32 THEN 'PASS' ELSE 'FAIL' END AS status,
       'Vault secret metadata' AS check_name,m.matching_secret_count,s.decrypted_match_count,
       s.min_secret_length_bytes,s.max_secret_length_bytes,
       'Expected exactly one named secret; >=32 bytes; no secret text returned' AS expected
FROM metadata m CROSS JOIN secret_length s
UNION ALL
SELECT CASE WHEN c.fn_oid IS NULL THEN 'FAIL'
            WHEN has_schema_privilege(current_user,'extensions','USAGE') AND has_function_privilege(current_user,c.fn_oid,'EXECUTE') THEN 'PASS'
            ELSE 'FAIL' END,
       c.signature,NULL,NULL,NULL,NULL,
       'Required extension overload exists; executor has extensions USAGE and EXECUTE'
FROM crypto c
UNION ALL
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto' AND n.nspname='extensions') THEN 'PASS' ELSE 'FAIL' END,
       'pgcrypto extension installation',NULL,NULL,NULL,NULL,
       'pgcrypto must be installed in extensions schema';

-- Result set 10: function-owner privileges and RLS bypass needed by SECURITY DEFINER.
WITH funcs(name,signature,required_object,required_privilege) AS (
  VALUES ('issuer','public.issue_approved_member_id_card()','public.id_cards','INSERT'),
         ('token RPC','public.get_id_card_qr_token(uuid)','public.id_cards','SELECT'),
         ('reissue member lock','public.reissue_member_id_card(uuid)','public.members','SELECT'),
         ('reissue member lock write privilege','public.reissue_member_id_card(uuid)','public.members','UPDATE'),
         ('reissue profile lookup','public.reissue_member_id_card(uuid)','public.profiles','SELECT'),
         ('reissue card lock','public.reissue_member_id_card(uuid)','public.id_cards','SELECT'),
         ('reissue card update','public.reissue_member_id_card(uuid)','public.id_cards','UPDATE'),
         ('reissue history lookup','public.reissue_member_id_card(uuid)','public.id_verifications','SELECT'),
         ('verification card lock read','public.verify_id_card_token(text)','public.id_cards','SELECT'),
         ('verification card lock update privilege','public.verify_id_card_token(text)','public.id_cards','UPDATE'),
         ('verification member lookup','public.verify_id_card_token(text)','public.members','SELECT'),
         ('verification profile lookup','public.verify_id_card_token(text)','public.profiles','SELECT'),
         ('verification history insert','public.verify_id_card_token(text)','public.id_verifications','INSERT')
), resolved AS (
  SELECT f.*,to_regprocedure(f.signature)::oid AS fn_oid,to_regclass(f.required_object) AS rel_oid
  FROM funcs f
), owners AS (
  SELECT r.*,coalesce(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owner_oid,
         p.proowner IS NULL AS function_not_yet_created
  FROM resolved r LEFT JOIN pg_proc p ON p.oid=r.fn_oid
)
SELECT CASE WHEN o.rel_oid IS NULL THEN 'FAIL'
            WHEN has_table_privilege(o.owner_oid,o.rel_oid,o.required_privilege) THEN 'PASS'
            ELSE 'FAIL' END AS status,
       o.name AS permission_check,o.signature,
       CASE WHEN o.function_not_yet_created THEN current_user ELSE pg_get_userbyid(o.owner_oid) END AS actual_or_expected_owner,
       o.required_object,o.required_privilege,
       CASE WHEN o.function_not_yet_created THEN 'new SECURITY DEFINER owner is assumed to be current_user; migration assigns no OWNER' ELSE 'actual pg_proc.proowner' END AS owner_basis
FROM owners o
UNION ALL
SELECT CASE WHEN p.oid IS NULL THEN 'PASS'
            WHEN r.rolbypassrls OR (r.oid=c.relowner AND NOT c.relforcerowsecurity) THEN 'PASS'
            ELSE 'FAIL' END,
       'RLS bypass: '||f.name,f.signature,pg_get_userbyid(coalesce(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user))),
       c.oid::regclass::text,'BYPASSRLS or actual table owner without FORCE RLS',
       'RLS remains enabled; migration does not alter FORCE RLS'
FROM (VALUES ('issuer','public.issue_approved_member_id_card()','public.id_cards'),
             ('token RPC','public.get_id_card_qr_token(uuid)','public.id_cards'),
             ('reissue','public.reissue_member_id_card(uuid)','public.id_cards'),
             ('reissue','public.reissue_member_id_card(uuid)','public.members'),
             ('reissue','public.reissue_member_id_card(uuid)','public.profiles'),
             ('reissue','public.reissue_member_id_card(uuid)','public.id_verifications'),
             ('verification','public.verify_id_card_token(text)','public.id_cards'),
             ('verification','public.verify_id_card_token(text)','public.members'),
             ('verification','public.verify_id_card_token(text)','public.profiles'),
             ('verification','public.verify_id_card_token(text)','public.id_verifications')) f(name,signature,table_name)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.signature)::oid
JOIN pg_class c ON c.oid=to_regclass(f.table_name)
JOIN pg_roles r ON r.oid=coalesce(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user))
WHERE c.relrowsecurity;

-- Result set 11: trigger and constraint state, including migration 007 prerequisite.
SELECT CASE WHEN to_regprocedure('public.assign_membership_number()') IS NOT NULL
                  AND t.tgname='members_assign_membership_number'
                  AND NOT t.tgisinternal AND t.tgenabled<>'D' AND t.tgtype=23
                  AND t.tgfoid=to_regprocedure('public.assign_membership_number()')::oid
                  AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.tgrelid AND a.attname='status' AND NOT a.attisdropped AND a.attnum=ANY(t.tgattr::smallint[]))
             THEN 'PASS' ELSE 'FAIL' END AS status,
       'Migration 007 membership number trigger' AS check_name,
       coalesce(t.tgname,'missing') AS trigger_name,
       coalesce(t.tgtype::text,'') AS tgtype,
       coalesce(t.tgenabled::text,'') AS enabled_state,
       'members_assign_membership_number; enabled; AFTER INSERT OR UPDATE OF status; tgtype=23' AS expected
FROM (SELECT 1) seed
LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.members') AND t.tgname='members_assign_membership_number'
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,
       'Migration 009 trigger-name collision',
       coalesce(string_agg(t.tgname,', '),'absent'),NULL,NULL,
       'members_issue_approved_id_card must be absent before migration; unexpected trigger fails closed'
FROM pg_trigger t WHERE t.tgrelid=to_regclass('public.members') AND t.tgname='members_issue_approved_id_card' AND NOT t.tgisinternal
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'REVIEW' END,
       'Migration related triggers',
       coalesce(string_agg(format('%I.%I:%I',n.nspname,c.relname,t.tgname),', ' ORDER BY c.relname,t.tgname),'none'),NULL,NULL,
       'Inventory of current triggers on members, id_cards, and id_verifications'
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('members','id_cards','id_verifications') AND NOT t.tgisinternal;

-- Result set 12: data readiness and limits of this read-only preflight.
SELECT CASE WHEN count(*) FILTER (WHERE status='approved' AND nullif(btrim(membership_no),'') IS NULL)=0 THEN 'PASS' ELSE 'FAIL' END AS status,
       'approved_members_missing_membership_no' AS check_name,
       count(*) FILTER (WHERE status='approved' AND nullif(btrim(membership_no),'') IS NULL) AS value,
       'Migration 009 refuses approved members without membership numbers' AS interpretation
FROM public.members
UNION ALL
SELECT 'REVIEW','existing_id_cards',count(*)::bigint,'Existing cards are preserved; hash/HMAC compatibility is checked transactionally by Migration 009, not by this preflight'
FROM public.id_cards
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'REVIEW' END,'existing_cards_with_non_hex_or_non_64_hash',count(*)::bigint,'SHA-256 hashes should be 64 lowercase hex; HMAC-to-hash compatibility remains an in-migration check'
FROM public.id_cards WHERE token_hash !~ '^[0-9a-f]{64}$'
UNION ALL
SELECT 'REVIEW','existing_verification_history',count(*)::bigint,'Rows are preserved; newly added snapshot columns remain null for historical rows because prior token generations cannot be reconstructed'
FROM public.id_verifications
UNION ALL
SELECT CASE WHEN count(*) FILTER (WHERE m.status='approved' AND nullif(btrim(m.membership_no),'') IS NOT NULL AND c.id IS NULL)=0 THEN 'PASS' ELSE 'REVIEW' END,
       'approved_members_pending_card_backfill',
       count(*) FILTER (WHERE m.status='approved' AND nullif(btrim(m.membership_no),'') IS NOT NULL AND c.id IS NULL)::bigint,
       'Migration 009 will create cards for this eligible approved-member set'
FROM public.members m LEFT JOIN public.id_cards c ON c.member_id=m.id
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END,'id_cards_orphan_member_references',count(*)::bigint,
       'Every existing card must resolve to one current member record'
FROM public.id_cards c LEFT JOIN public.members m ON m.id=c.member_id WHERE m.id IS NULL
UNION ALL
SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='id_cards' AND column_name='token_generation_id') THEN 'PASS'
            WHEN count(*) FILTER (WHERE to_jsonb(c)->>'token_generation_id' IS NULL)=0 THEN 'PASS'
            ELSE 'REVIEW' END,
       'card_generations_to_backfill',
       count(*) FILTER (WHERE to_jsonb(c)->>'token_generation_id' IS NULL)::bigint,
       'Absent column is expected pre-migration; null values are filled from stable id_cards.id before NOT NULL'
FROM public.id_cards c
UNION ALL
SELECT CASE WHEN count(*)=0 THEN 'PASS' ELSE 'REVIEW' END,'duplicate_current_generation_values',count(*)::bigint,'Migration checks duplicate existing generations before adding uniqueness'
FROM (SELECT to_jsonb(c)->>'token_generation_id' AS generation FROM public.id_cards c GROUP BY to_jsonb(c)->>'token_generation_id' HAVING count(*)>1) d WHERE d.generation IS NOT NULL
UNION ALL
SELECT 'REVIEW','current_membership_number_data',NULL::bigint,'Read-only preflight does not create, change, or allocate membership numbers';

-- Result set 13: DDL executor ownership and migration scope inventory.
SELECT CASE WHEN r.rolsuper OR c.relowner=r.oid THEN 'PASS' ELSE 'REVIEW' END AS status,
       current_user AS migration_executor,
       c.oid::regclass::text AS object_name,
       pg_get_userbyid(c.relowner) AS actual_table_owner,
       r.rolsuper AS executor_is_superuser,
       CASE WHEN r.rolsuper OR c.relowner=r.oid THEN 'executor can perform the migration DDL' ELSE 'Confirm executor can ALTER TABLE/CREATE TRIGGER before applying' END AS interpretation
FROM pg_roles r CROSS JOIN pg_class c
WHERE r.rolname=current_user AND c.oid IN (
  to_regclass('public.members'),to_regclass('public.id_cards'),to_regclass('public.id_verifications')
)
UNION ALL
SELECT CASE WHEN has_schema_privilege(current_user,'public','CREATE') THEN 'PASS' ELSE 'FAIL' END,
       current_user,'public schema',NULL,NULL,
       'CREATE privilege required for migration functions';

-- Result set 14: crypto helper owners and migration executor/backfill context.
WITH helper(name,signature,schema_name,crypto_signature,secret_select) AS (
  VALUES ('derive_id_card_qr_token','public.derive_id_card_qr_token(uuid)','extensions','extensions.hmac(bytea,bytea,text)'::text,true),
         ('hash_id_card_token','public.hash_id_card_token(uuid)','extensions','extensions.digest(bytea,text)'::text,false)
), resolved AS (
  SELECT h.*,to_regprocedure(h.signature)::oid AS fn_oid,
         to_regprocedure(h.crypto_signature)::oid AS crypto_oid,
         to_regclass(CASE WHEN h.secret_select THEN 'vault.decrypted_secrets' ELSE 'extensions.digest' END) AS object_oid
  FROM helper h
), owners AS (
  SELECT r.*,coalesce(p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owner_oid
  FROM resolved r LEFT JOIN pg_proc p ON p.oid=r.fn_oid
)
SELECT CASE WHEN o.crypto_oid IS NULL THEN 'FAIL'
            WHEN NOT has_schema_privilege(o.owner_oid,o.schema_name,'USAGE') THEN 'FAIL'
            WHEN NOT has_function_privilege(o.owner_oid,o.crypto_oid,'EXECUTE') THEN 'FAIL'
            WHEN o.secret_select AND o.object_oid IS NULL THEN 'FAIL'
            WHEN o.secret_select AND (NOT has_schema_privilege(o.owner_oid,'vault','USAGE') OR NOT has_table_privilege(o.owner_oid,o.object_oid,'SELECT')) THEN 'FAIL'
            ELSE 'PASS' END AS status,
       o.name AS helper_name,
       CASE WHEN o.fn_oid IS NULL THEN current_user ELSE pg_get_userbyid(o.owner_oid) END AS actual_or_expected_owner,
       o.schema_name AS required_schema,o.crypto_signature AS required_crypto_function,
       o.secret_select AS requires_vault_select,
       'owner is pg_proc.proowner when present; otherwise current_user (CREATE OR REPLACE does not change owner)' AS owner_basis
FROM owners o
UNION ALL
SELECT CASE WHEN to_regclass('public.id_cards') IS NULL THEN 'FAIL'
            WHEN NOT has_table_privilege(current_user,to_regclass('public.id_cards'),'INSERT') THEN 'FAIL'
            WHEN NOT (r.rolbypassrls OR (r.oid=c.relowner AND NOT c.relforcerowsecurity)) THEN 'FAIL'
            WHEN to_regprocedure('public.derive_id_card_qr_token(uuid)') IS NOT NULL
                 AND NOT has_function_privilege(current_user,to_regprocedure('public.derive_id_card_qr_token(uuid)')::oid,'EXECUTE') THEN 'FAIL'
            WHEN to_regprocedure('public.hash_id_card_token(uuid)') IS NOT NULL
                 AND NOT has_function_privilege(current_user,to_regprocedure('public.hash_id_card_token(uuid)')::oid,'EXECUTE') THEN 'FAIL'
            ELSE 'PASS' END,
       'migration executor backfill',current_user,'public.id_cards INSERT + RLS bypass',
       'both token helper EXECUTE privileges',false,
       'helpers absent before migration are expected to be created with executor ownership; Migration 009 grants executor EXECUTE'
FROM pg_roles r JOIN pg_class c ON c.oid=to_regclass('public.id_cards')
WHERE r.rolname=current_user
UNION ALL
SELECT CASE WHEN to_regprocedure('public.reissue_member_id_card(uuid)') IS NULL THEN 'PASS'
            WHEN has_function_privilege('service_role',to_regprocedure('public.reissue_member_id_card(uuid)')::oid,'EXECUTE') THEN 'PASS'
            ELSE 'REVIEW' END,
       'reissue RPC exposure',coalesce(pg_get_userbyid(p.proowner),'not created yet'),'service_role EXECUTE',
       'anon/authenticated denied; function body requires auth.role()=service_role',false,
       'RPC absent is expected before Migration 009'
FROM (SELECT to_regprocedure('public.reissue_member_id_card(uuid)')::oid AS fn_oid) x
LEFT JOIN pg_proc p ON p.oid=x.fn_oid;

-- Result set 15: named constraints that Migration 009 preserves or adds.
WITH expected(table_name,constraint_name,phase,expected_fragment) AS (
  VALUES ('id_cards','id_cards_pkey','REQUIRED','PRIMARY KEY (id)'),
         ('id_cards','id_cards_member_id_fkey','REVIEW','FOREIGN KEY (member_id) REFERENCES members(id)'),
         ('id_verifications','id_verifications_id_card_id_fkey','REQUIRED','FOREIGN KEY (id_card_id) REFERENCES id_cards(id)'),
         ('id_verifications','id_verifications_verification_status_check','ADDITIVE','verification_status IN'),
         ('id_verifications','id_verifications_token_hash_snapshot_check','ADDITIVE','token_hash_snapshot')
)
SELECT CASE WHEN c.oid IS NULL AND e.phase='ADDITIVE' THEN 'PASS'
            WHEN c.oid IS NULL AND e.phase='REVIEW' THEN 'REVIEW'
            WHEN c.oid IS NULL THEN 'FAIL'
            WHEN e.constraint_name='id_verifications_id_card_id_fkey' AND c.contype='f' AND c.convalidated AND c.confupdtype='a' AND c.confdeltype='a' THEN 'PASS'
            WHEN e.constraint_name='id_cards_pkey' AND c.contype='p' THEN 'PASS'
            WHEN e.constraint_name='id_verifications_verification_status_check' AND c.contype='c'
                 AND pg_get_constraintdef(c.oid) ILIKE '%verification_status%Active%Suspended%Inactive%Invalid%' THEN 'PASS'
            WHEN e.constraint_name='id_verifications_token_hash_snapshot_check' AND c.contype='c'
                 AND pg_get_constraintdef(c.oid) ILIKE '%token_hash_snapshot%' AND pg_get_constraintdef(c.oid) ILIKE '%64%' THEN 'PASS'
            ELSE 'FAIL' END AS status,
       'public.'||e.table_name AS table_name,e.constraint_name,e.phase,
       pg_get_constraintdef(c.oid) AS actual_definition,
       coalesce(e.expected_fragment,'') AS expected_fragment,
       c.convalidated AS validated
FROM expected e
LEFT JOIN pg_constraint c ON c.conrelid=to_regclass('public.'||e.table_name) AND c.conname=e.constraint_name;
