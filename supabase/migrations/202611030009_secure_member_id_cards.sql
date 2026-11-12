-- Migration 009: hash-only QR tokens for approved members.
-- Requires pgcrypto in extensions and one stable Supabase Vault secret named
-- abvds_id_card_token_key (at least 32 bytes). Never rotate this secret without
-- a separately planned QR identity rotation. No membership data is modified.
-- Existing card IDs remain stable permanently because verification history may
-- reference them. QR token rotation uses token_generation_id instead.

begin;

do $$
declare
  v_owner oid;
  v_has_duplicate_generations boolean;
  v_secret_count bigint;
  v_secret_bytes integer;
begin
  if to_regclass('public.members') is null or to_regclass('public.id_cards') is null then
    raise exception 'Migration 009 requires public.members and public.id_cards.';
  end if;
  if exists (
    select 1
    from (values
      ('members','id'),
      ('members','membership_no'),
      ('members','status'),
      ('members','valid_until'),
      ('id_cards','id'),
      ('id_cards','member_id'),
      ('id_cards','token_hash'),
      ('id_cards','valid_until'),
      ('id_cards','revoked_at'),
      ('id_verifications','id_card_id'),
      ('id_verifications','viewed_at'),
      ('profiles','is_active'),
      ('profiles','account_status')
    ) req(table_name,column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public'
        and c.table_name=req.table_name
        and c.column_name=req.column_name
    )
  ) then
    raise exception 'public.members or public.id_cards lacks a required column; members requires id, membership_no, status, valid_until and id_cards requires id, member_id, token_hash, valid_until, revoked_at.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.members'::regclass and a.attname='id'
      and not a.attisdropped and a.atttypid='pg_catalog.uuid'::regtype
  ) then
    raise exception 'public.members.id must have UUID type to match the member RPC parameter.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.members'::regclass and a.attname='user_id'
      and not a.attisdropped and a.atttypid='pg_catalog.uuid'::regtype
  ) or not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.profiles'::regclass and a.attname='id'
      and not a.attisdropped and a.atttypid='pg_catalog.uuid'::regtype
  ) then
    raise exception 'members.user_id and profiles.id must use UUID types for the verification profile join.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='id'
      and not a.attisdropped and a.atttypid='pg_catalog.uuid'::regtype
  ) then
    raise exception 'public.id_cards.id must have UUID type for opaque card identities and reissue rotation.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='member_id'
      and not a.attisdropped and a.atttypid='pg_catalog.uuid'::regtype
  ) then
    raise exception 'public.id_cards.member_id must have UUID type compatible with public.members.id.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='token_hash'
      and not a.attisdropped
      and a.atttypid in ('pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype)
      and (a.atttypmod < 0 or a.atttypmod - 4 >= 64)
  ) then
    raise exception 'public.id_cards.token_hash must be text or varchar with capacity for a 64-character SHA-256 hex digest.';
  end if;
  if not exists (
    select 1
    from pg_attribute ma
    join pg_attribute ca on ca.attrelid='public.id_cards'::regclass and ca.attname='valid_until' and not ca.attisdropped
    where ma.attrelid='public.members'::regclass and ma.attname='valid_until' and not ma.attisdropped
      and (
        ma.atttypid=ca.atttypid
        or exists (
          select 1 from pg_cast c
          where c.castsource=ma.atttypid and c.casttarget=ca.atttypid
            and c.castcontext in ('i','a')
        )
      )
  ) then
    raise exception 'members.valid_until cannot be assigned to id_cards.valid_until; compatible identical or implicit/assignment-cast types are required.';
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid='public.members'::regclass and a.attname='valid_until'
      and not a.attisdropped and a.atttypid not in ('pg_catalog.date'::regtype,'pg_catalog.timestamp'::regtype,'pg_catalog.timestamptz'::regtype)
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='valid_until'
      and not a.attisdropped and a.atttypid not in ('pg_catalog.date'::regtype,'pg_catalog.timestamp'::regtype,'pg_catalog.timestamptz'::regtype)
  ) then
    raise exception 'members.valid_until and id_cards.valid_until must be date/timestamp types comparable with current_date.';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid='public.members'::regclass and a.attname='membership_no'
      and not a.attisdropped
      and a.atttypid in ('pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype, 'pg_catalog.bpchar'::regtype)
  ) then
    raise exception 'public.members.membership_no must use a text-compatible type for trimming and presence checks.';
  end if;
  if not exists (
    select 1
    from pg_attribute a
    join pg_type t on t.oid=a.atttypid
    where a.attrelid='public.members'::regclass and a.attname='status'
      and not a.attisdropped
      and (a.atttypid in ('pg_catalog.text'::regtype, 'pg_catalog.varchar'::regtype, 'pg_catalog.bpchar'::regtype) or t.typtype='e')
  ) then
    raise exception 'public.members.status must use a text-compatible or enum type for the approved-status workflow.';
  end if;
  if exists (
    select 1
    from pg_attribute a
    join pg_type t on t.oid=a.atttypid and t.typtype='e'
    where a.attrelid='public.members'::regclass and a.attname='status'
      and not a.attisdropped
      and not exists (select 1 from pg_enum e where e.enumtypid=t.oid and e.enumlabel='approved')
  ) then
    raise exception 'public.members.status enum must define the approved label.';
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='reissued_at'
      and not a.attisdropped and a.atttypid<>'pg_catalog.timestamptz'::regtype
  ) then
    raise exception 'Existing public.id_cards.reissued_at must be timestamptz; migration will not alter its type.';
  end if;
  if not exists (
    select 1 from pg_attribute a where a.attrelid='public.profiles'::regclass and a.attname='is_active'
      and not a.attisdropped and a.atttypid='pg_catalog.bool'::regtype
  ) or not exists (
    select 1 from pg_attribute a join pg_type t on t.oid=a.atttypid
    where a.attrelid='public.profiles'::regclass and a.attname='account_status'
      and not a.attisdropped
      and (a.atttypid in ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype,'pg_catalog.bpchar'::regtype) or t.typtype='e')
  ) then
    raise exception 'profiles.is_active must be boolean and profiles.account_status text-like or enum.';
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_cards'::regclass and a.attname='token_generation_id'
      and not a.attisdropped and a.atttypid<>'pg_catalog.uuid'::regtype
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_verifications'::regclass and a.attname='token_generation_id'
      and not a.attisdropped and a.atttypid<>'pg_catalog.uuid'::regtype
  ) then
    raise exception 'Existing token_generation_id columns must use UUID type; migration will not alter them.';
  end if;
  if exists (
    select 1 from pg_attribute a where a.attrelid='public.id_cards'::regclass
      and a.attname='token_generation_id' and not a.attisdropped
  ) then
    execute 'select exists (select 1 from public.id_cards where token_generation_id is not null group by token_generation_id having count(*)>1)'
      into v_has_duplicate_generations;
    if v_has_duplicate_generations then
      raise exception 'Duplicate existing id_cards.token_generation_id values must be reviewed before enforcing generation uniqueness.';
    end if;
  end if;
  if exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_verifications'::regclass and a.attname='token_hash_snapshot'
      and not a.attisdropped
      and (a.atttypid not in ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype)
        or (a.atttypmod>=0 and a.atttypmod-4<64))
  ) or exists (
    select 1 from pg_attribute a
    where a.attrelid='public.id_verifications'::regclass and a.attname='verification_status'
      and not a.attisdropped
      and (a.atttypid not in ('pg_catalog.text'::regtype,'pg_catalog.varchar'::regtype)
        or (a.atttypmod>=0 and a.atttypmod-4<9))
  ) then
    raise exception 'Existing verification-history snapshot/status columns have incompatible types or capacity.';
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid='public.id_verifications'::regclass
      and c.conname='id_verifications_verification_status_check'
      and (c.contype<>'c' or pg_get_constraintdef(c.oid) not ilike '%verification_status%Active%Suspended%Inactive%Invalid%')
  ) or exists (
    select 1 from pg_constraint c
    where c.conrelid='public.id_verifications'::regclass
      and c.conname='id_verifications_token_hash_snapshot_check'
      and (c.contype<>'c' or pg_get_constraintdef(c.oid) not ilike '%token_hash_snapshot%[0-9a-f]{64}%')
  ) then
    raise exception 'An existing verification-history check constraint name has an unexpected definition.';
  end if;
  if to_regclass('public.id_cards_token_generation_id_key') is not null and not exists (
    select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid
    join pg_attribute a on a.attrelid=i.indrelid and a.attname='token_generation_id' and not a.attisdropped
    where i.indrelid='public.id_cards'::regclass and ix.relname='id_cards_token_generation_id_key'
      and i.indisunique and i.indisvalid and i.indisready and i.indpred is null
      and i.indimmediate is true and i.indnkeyatts=1 and i.indkey[0]=a.attnum
  ) then
    raise exception 'Existing id_cards_token_generation_id_key is not the expected unique generation index.';
  end if;
  if to_regclass('public.id_verifications_card_viewed_idx') is not null and not exists (
    select 1 from pg_index i join pg_class ix on ix.oid=i.indexrelid
    join pg_attribute card_col on card_col.attrelid=i.indrelid and card_col.attname='id_card_id' and not card_col.attisdropped
    join pg_attribute viewed_col on viewed_col.attrelid=i.indrelid and viewed_col.attname='viewed_at' and not viewed_col.attisdropped
    where i.indrelid='public.id_verifications'::regclass and ix.relname='id_verifications_card_viewed_idx'
      and not i.indisunique and i.indisvalid and i.indisready and i.indpred is null
      and i.indnkeyatts=2 and i.indnatts=2
      and i.indkey[0]=card_col.attnum and i.indkey[1]=viewed_col.attnum
  ) then
    raise exception 'Existing id_verifications_card_viewed_idx has an unexpected definition.';
  end if;
  -- Keep the pre-existing verification-history relationship intact. Reissue
  -- rotates token_generation_id and never changes id_cards.id.
  if to_regclass('public.id_verifications') is null
     or not exists (
       select 1 from pg_constraint fk
       where fk.conrelid=to_regclass('public.id_verifications')
         and fk.conname='id_verifications_id_card_id_fkey'
         and fk.contype='f'
         and fk.confrelid='public.id_cards'::regclass
         and fk.conkey=array[(select attnum from pg_attribute where attrelid='public.id_verifications'::regclass and attname='id_card_id' and not attisdropped)]::smallint[]
         and fk.confkey=array[(select attnum from pg_attribute where attrelid='public.id_cards'::regclass and attname='id' and not attisdropped)]::smallint[]
         and fk.convalidated
         and fk.confupdtype='a' and fk.confdeltype='a'
     ) then
    raise exception 'The validated id_verifications_id_card_id_fkey to stable id_cards.id with NO ACTION must remain present.';
  end if;
  if not exists (
    select 1 from pg_class c where c.oid='public.id_verifications'::regclass and c.relrowsecurity
  ) or exists (select 1 from pg_policies where schemaname='public' and tablename='id_verifications') then
    raise exception 'id_verifications must retain RLS enabled and no client-facing policies.';
  end if;
  if exists (
    select 1 from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    where c.oid='public.id_verifications'::regclass
      and acl.grantee<>c.relowner
      and acl.grantee<>'service_role'::regrole::oid
  ) then
    raise exception 'Unexpected custom/PUBLIC id_verifications table grants exist; review them before restricting verification history.';
  end if;
  if has_table_privilege('anon','public.id_verifications','SELECT')
     or has_table_privilege('anon','public.id_verifications','INSERT')
     or has_table_privilege('anon','public.id_verifications','UPDATE')
     or has_table_privilege('anon','public.id_verifications','DELETE')
     or has_table_privilege('authenticated','public.id_verifications','SELECT')
     or has_table_privilege('authenticated','public.id_verifications','INSERT')
     or has_table_privilege('authenticated','public.id_verifications','UPDATE')
     or has_table_privilege('authenticated','public.id_verifications','DELETE')
     or has_any_column_privilege('anon','public.id_verifications','SELECT')
     or has_any_column_privilege('authenticated','public.id_verifications','SELECT') then
    raise exception 'anon/authenticated has direct or inherited id_verifications table/column access.';
  end if;
  select coalesce(p.proowner,(select oid from pg_roles where rolname=current_user)) into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.verify_id_card_token(text)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if v_owner in ('anon'::regrole::oid,'authenticated'::regrole::oid) then
    raise exception 'Verification RPC owner cannot be anon or authenticated; ownership is not changed by this migration.';
  end if;
  if not has_table_privilege(v_owner,'public.id_cards','SELECT')
     or not has_table_privilege(v_owner,'public.id_cards','UPDATE')
     or not has_table_privilege(v_owner,'public.members','SELECT')
     or not has_table_privilege(v_owner,'public.profiles','SELECT')
     or not has_table_privilege(v_owner,'public.id_verifications','INSERT') then
    raise exception 'Actual or expected verification RPC owner lacks required SELECT/INSERT table privileges.';
  end if;
  if not has_schema_privilege(v_owner,'auth','USAGE')
     or to_regprocedure('auth.role()') is null
     or not has_function_privilege(v_owner,'auth.role()','EXECUTE') then
    raise exception 'Actual or expected verification RPC owner lacks auth schema USAGE or auth.role() EXECUTE.';
  end if;
  if exists (
    select 1 from pg_class c join pg_roles r on r.oid=v_owner
    where c.oid in ('public.id_cards'::regclass,'public.members'::regclass,'public.profiles'::regclass,'public.id_verifications'::regclass)
      and c.relrowsecurity
      and not r.rolbypassrls
      and (r.oid<>c.relowner or c.relforcerowsecurity)
  ) then
    raise exception 'Actual or expected verification RPC owner cannot bypass RLS on one or more required tables.';
  end if;
  if not exists (
    select 1
    from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    join pg_attribute a on a.attrelid=t.oid and a.attname='member_id' and not a.attisdropped
    where n.nspname='public' and t.relname='id_cards'
      and i.indisunique and i.indisvalid and i.indisready
      and i.indpred is null
      and i.indimmediate is true
      and i.indnkeyatts=1 and i.indkey[0]=a.attnum
  ) then
    raise exception 'public.id_cards requires a valid UNIQUE constraint/index on member_id for ON CONFLICT(member_id).';
  end if;
  if not exists (
    select 1
    from pg_index i
    join pg_attribute a on a.attrelid=i.indrelid and a.attname='token_hash' and not a.attisdropped
    where i.indrelid='public.id_cards'::regclass
      and i.indisunique and i.indisvalid and i.indisready
      and i.indpred is null and i.indimmediate is true
      and i.indnkeyatts=1 and i.indkey[0]=a.attnum
  ) then
    raise exception 'public.id_cards requires a valid non-partial UNIQUE index on token_hash.';
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    raise exception 'Migration 009 requires extensions.digest(bytea,text) and extensions.hmac(bytea,bytea,text).';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is required; create the stable abvds_id_card_token_key secret before applying.';
  end if;
  select count(*), min(octet_length(convert_to(decrypted_secret, 'UTF8')))
    into v_secret_count, v_secret_bytes
  from vault.decrypted_secrets
  where name = 'abvds_id_card_token_key';
  if v_secret_count<>1 or coalesce(v_secret_bytes,0)<32 then
    raise exception 'Supabase Vault secret abvds_id_card_token_key must exist exactly once and be at least 32 bytes.';
  end if;
  if not has_schema_privilege(current_user, 'vault', 'USAGE') then
    raise exception 'Migration role lacks USAGE on schema vault.';
  end if;
  -- CREATE OR REPLACE retains an existing function owner. Check that owner's
  -- effective Vault permission; for a new function, PostgreSQL assigns the
  -- migration executor as owner, so verify that role's permissions explicitly.
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.derive_id_card_qr_token(uuid)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_schema_privilege(v_owner, 'vault', 'USAGE')
     or not has_table_privilege(v_owner, 'vault.decrypted_secrets', 'SELECT') then
    raise exception 'Actual or expected owner of derive_id_card_qr_token lacks required Vault USAGE/SELECT privileges.';
  end if;
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.hash_id_card_token(uuid)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_schema_privilege(v_owner, 'extensions', 'USAGE')
     or not has_function_privilege(v_owner, 'extensions.digest(bytea,text)', 'EXECUTE') then
    raise exception 'Actual or expected owner of hash_id_card_token lacks extensions USAGE/digest EXECUTE.';
  end if;
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.derive_id_card_qr_token(uuid)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_schema_privilege(v_owner, 'extensions', 'USAGE')
     or not has_function_privilege(v_owner, 'extensions.hmac(bytea,bytea,text)', 'EXECUTE') then
    raise exception 'Actual or expected owner of derive_id_card_qr_token lacks extensions USAGE/HMAC EXECUTE.';
  end if;
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.issue_approved_member_id_card()');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_table_privilege(v_owner, 'public.id_cards', 'INSERT') then
    raise exception 'Actual or expected issuer function owner lacks id_cards INSERT.';
  end if;
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.get_id_card_qr_token(uuid)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_table_privilege(v_owner, 'public.id_cards', 'SELECT') then
    raise exception 'Actual or expected token RPC owner lacks id_cards SELECT.';
  end if;
  if not has_schema_privilege(v_owner,'auth','USAGE')
     or to_regprocedure('auth.role()') is null
     or not has_function_privilege(v_owner,'auth.role()','EXECUTE') then
    raise exception 'Actual or expected token RPC owner lacks auth schema USAGE or auth.role() EXECUTE.';
  end if;
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)');
  if v_owner is null then v_owner := (select oid from pg_roles where rolname=current_user); end if;
  if not has_table_privilege(v_owner, 'public.members', 'SELECT')
     or not has_table_privilege(v_owner, 'public.members', 'UPDATE')
     or not has_table_privilege(v_owner, 'public.profiles', 'SELECT')
     or not has_table_privilege(v_owner, 'public.id_cards', 'SELECT')
     or not has_table_privilege(v_owner, 'public.id_cards', 'UPDATE')
     or not has_table_privilege(v_owner, 'public.id_verifications', 'SELECT') then
    raise exception 'Actual or expected reissue RPC owner lacks required members SELECT/UPDATE, profiles SELECT, id_cards SELECT/UPDATE, or verification-history SELECT.';
  end if;
  if not has_schema_privilege(v_owner,'auth','USAGE')
     or to_regprocedure('auth.role()') is null
     or not has_function_privilege(v_owner,'auth.role()','EXECUTE') then
    raise exception 'Actual or expected reissue RPC owner lacks auth schema USAGE or auth.role() EXECUTE.';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='id_cards' and c.relrowsecurity
  ) then
    raise exception 'RLS must remain enabled on public.id_cards.';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='id_cards') then
    raise exception 'Existing id_cards RLS policies require manual security review.';
  end if;
  -- Audit current ACLs without changing them. Expected direct table privileges
  -- are limited to the owner and service_role's SELECT/INSERT/UPDATE. Any client,
  -- PUBLIC, or custom-role grant must be reviewed instead of silently revoked.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where n.nspname='public' and c.relname='id_cards'
      and (
        acl.grantee=0
        or acl.grantee not in (c.relowner, 'service_role'::regrole::oid)
        or (acl.grantee='service_role'::regrole::oid
            and (acl.privilege_type not in ('SELECT','INSERT','UPDATE') or acl.is_grantable))
      )
  ) then
    raise exception 'Unexpected PUBLIC/custom-role id_cards ACL or excessive service_role grant exists; review grants manually before Migration 009.';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    cross join lateral aclexplode(a.attacl) acl
    where n.nspname='public' and c.relname='id_cards'
      and a.attacl is not null
      and (
        acl.grantee=0
        or acl.grantee not in (c.relowner, 'service_role'::regrole::oid)
        or (acl.grantee='service_role'::regrole::oid
            and (acl.privilege_type not in ('SELECT','INSERT','UPDATE') or acl.is_grantable))
      )
  ) then
    raise exception 'Unexpected PUBLIC/custom-role id_cards column ACL or excessive service_role column grant exists; review grants manually before Migration 009.';
  end if;
  if has_table_privilege('anon','public.id_cards','SELECT')
     or has_table_privilege('anon','public.id_cards','INSERT')
     or has_table_privilege('anon','public.id_cards','UPDATE')
     or has_table_privilege('anon','public.id_cards','DELETE')
     or has_table_privilege('anon','public.id_cards','TRUNCATE')
     or has_table_privilege('anon','public.id_cards','REFERENCES')
     or has_table_privilege('anon','public.id_cards','TRIGGER')
     or has_any_column_privilege('anon','public.id_cards','SELECT')
     or has_any_column_privilege('anon','public.id_cards','INSERT')
     or has_any_column_privilege('anon','public.id_cards','UPDATE')
     or has_any_column_privilege('anon','public.id_cards','REFERENCES')
     or has_table_privilege('authenticated','public.id_cards','SELECT')
     or has_table_privilege('authenticated','public.id_cards','INSERT')
     or has_table_privilege('authenticated','public.id_cards','UPDATE')
     or has_table_privilege('authenticated','public.id_cards','DELETE')
     or has_table_privilege('authenticated','public.id_cards','TRUNCATE')
     or has_table_privilege('authenticated','public.id_cards','REFERENCES')
     or has_table_privilege('authenticated','public.id_cards','TRIGGER')
     or has_any_column_privilege('authenticated','public.id_cards','SELECT')
     or has_any_column_privilege('authenticated','public.id_cards','INSERT')
     or has_any_column_privilege('authenticated','public.id_cards','UPDATE')
     or has_any_column_privilege('authenticated','public.id_cards','REFERENCES') then
    raise exception 'anon/authenticated has direct or inherited id_cards table/column privileges; review grants manually before Migration 009.';
  end if;
  if has_table_privilege('service_role','public.id_cards','DELETE')
     or has_table_privilege('service_role','public.id_cards','TRUNCATE')
     or has_table_privilege('service_role','public.id_cards','REFERENCES')
     or has_table_privilege('service_role','public.id_cards','TRIGGER')
     or has_any_column_privilege('service_role','public.id_cards','REFERENCES') then
    raise exception 'service_role has id_cards privileges beyond the required SELECT/INSERT/UPDATE set; review grants manually.';
  end if;
  -- With RLS enabled and no policies, SECURITY DEFINER owners and the backfill
  -- executor need effective bypass: BYPASSRLS, or table ownership when FORCE RLS
  -- is off. Membership in another role is intentionally not treated as ownership.
  if exists (
    select 1
    from pg_class c
    join pg_roles executor on executor.rolname=current_user
    left join pg_roles issuer_owner on issuer_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.issue_approved_member_id_card()')),
      executor.oid
    )
    left join pg_roles rpc_owner on rpc_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.get_id_card_qr_token(uuid)')),
      executor.oid
    )
    left join pg_roles reissue_owner on reissue_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
      executor.oid
    )
    where c.oid='public.id_cards'::regclass
      and (
        (not issuer_owner.rolbypassrls and (issuer_owner.oid<>c.relowner or c.relforcerowsecurity))
        or (not rpc_owner.rolbypassrls and (rpc_owner.oid<>c.relowner or c.relforcerowsecurity))
        or (not reissue_owner.rolbypassrls and (reissue_owner.oid<>c.relowner or c.relforcerowsecurity))
        or (not executor.rolbypassrls and (executor.oid<>c.relowner or c.relforcerowsecurity))
      )
  ) then
    raise exception 'Issuer owner, token/reissue RPC owner, or backfill executor cannot bypass id_cards RLS under current ownership/FORCE RLS settings.';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_roles reissue_owner on reissue_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
      (select oid from pg_roles where rolname=current_user)
    )
    where c.oid='public.members'::regclass
      and c.relrowsecurity
      and not reissue_owner.rolbypassrls
      and (reissue_owner.oid<>c.relowner or c.relforcerowsecurity)
  ) then
    raise exception 'Reissue RPC owner cannot bypass members RLS under current ownership/FORCE RLS settings.';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_roles reissue_owner on reissue_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
      (select oid from pg_roles where rolname=current_user)
    )
    where c.oid='public.profiles'::regclass
      and c.relrowsecurity
      and not reissue_owner.rolbypassrls
      and (reissue_owner.oid<>c.relowner or c.relforcerowsecurity)
  ) then
    raise exception 'Reissue RPC owner cannot bypass profiles RLS under current ownership/FORCE RLS settings.';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_roles reissue_owner on reissue_owner.oid=coalesce(
      (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
      (select oid from pg_roles where rolname=current_user)
    )
    where c.oid='public.id_verifications'::regclass
      and c.relrowsecurity
      and not reissue_owner.rolbypassrls
      and (reissue_owner.oid<>c.relowner or c.relforcerowsecurity)
  ) then
    raise exception 'Reissue RPC owner cannot bypass verification-history RLS under current ownership/FORCE RLS settings.';
  end if;
  if to_regprocedure('public.assign_membership_number()') is null or not exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.members'::regclass
      and t.tgname='members_assign_membership_number'
      and not t.tgisinternal and t.tgenabled<>'D'
      and t.tgfoid=to_regprocedure('public.assign_membership_number()')::oid
      and t.tgtype=23
      and exists (
        select 1 from pg_attribute a
        where a.attrelid=t.tgrelid and a.attname='status' and not a.attisdropped
          and a.attnum = any(t.tgattr::smallint[])
      )
  ) then
    raise exception 'Migration 009 requires migration 007 approved-membership trigger.';
  end if;
  if exists (
    select 1 from public.members
    where status='approved' and nullif(btrim(membership_no),'') is null
  ) then
    raise exception 'An approved member lacks a membership number; resolve it without this migration.';
  end if;
  -- Refuse a trigger collision before any DDL. This migration never drops or
  -- replaces an unknown trigger, even though the transaction would roll back.
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid='public.members'::regclass
      and t.tgname='members_issue_approved_id_card'
      and not t.tgisinternal
  ) then
    raise exception 'Unexpected members_issue_approved_id_card trigger exists; migration stopped without changing it.';
  end if;
end;
$$;

-- Stable pseudorandom UUID-shaped token derived from a token-generation UUID.
-- This private derivation helper is called by issuance and the restricted API RPC.
create or replace function public.derive_id_card_qr_token(p_card_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, extensions, vault
as $$
declare
  v_secret text;
  v_bytes bytea;
  v_hex text;
begin
  select s.decrypted_secret into strict v_secret
  from vault.decrypted_secrets s
  where s.name = 'abvds_id_card_token_key';
  if octet_length(convert_to(v_secret, 'UTF8')) < 32 then
    raise exception 'ID card token key is not configured securely.';
  end if;

  v_bytes := substring(
    extensions.hmac(convert_to(p_card_id::text, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256')
    from 1 for 16
  );
  -- Set UUID version 4 and RFC 4122 variant bits while retaining 122 HMAC bits.
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 64);
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);
  v_hex := encode(v_bytes, 'hex');
  return (
    substring(v_hex from 1 for 8) || '-' || substring(v_hex from 9 for 4) || '-' ||
    substring(v_hex from 13 for 4) || '-' || substring(v_hex from 17 for 4) || '-' ||
    substring(v_hex from 21 for 12)
  )::uuid;
end;
$$;

create or replace function public.hash_id_card_token(token uuid)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, extensions
as $$
  select encode(extensions.digest(convert_to(lower(token::text), 'UTF8'), 'sha256'), 'hex')
$$;

alter table public.id_cards add column if not exists reissued_at timestamptz;
alter table public.id_cards add column if not exists token_generation_id uuid;
update public.id_cards set token_generation_id = id where token_generation_id is null;
alter table public.id_cards alter column token_generation_id set not null;
create unique index if not exists id_cards_token_generation_id_key on public.id_cards(token_generation_id);

alter table public.id_verifications add column if not exists token_generation_id uuid;
alter table public.id_verifications add column if not exists token_hash_snapshot text;
alter table public.id_verifications add column if not exists verification_status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.id_verifications'::regclass and conname='id_verifications_verification_status_check') then
    alter table public.id_verifications add constraint id_verifications_verification_status_check
      check (verification_status is null or verification_status in ('Active','Suspended','Inactive','Invalid')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.id_verifications'::regclass and conname='id_verifications_token_hash_snapshot_check') then
    alter table public.id_verifications add constraint id_verifications_token_hash_snapshot_check
      check (token_hash_snapshot is null or token_hash_snapshot ~ '^[0-9a-f]{64}$') not valid;
  end if;
end $$;
create index if not exists id_verifications_card_viewed_idx
  on public.id_verifications(id_card_id, viewed_at desc);
-- History remains server-only: retain RLS and keep client roles without access.
revoke all on table public.id_verifications from public, anon, authenticated;

create or replace function public.issue_approved_member_id_card()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, extensions, vault
as $$
declare
  v_card_id uuid;
  v_token uuid;
begin
  if new.status='approved' and nullif(btrim(new.membership_no),'') is not null then
    v_card_id := pg_catalog.gen_random_uuid();
    v_token := public.derive_id_card_qr_token(v_card_id);
    insert into public.id_cards(id,member_id,token_hash,valid_until,token_generation_id)
    values (v_card_id,new.id,public.hash_id_card_token(v_token),new.valid_until,v_card_id)
    on conflict(member_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.issue_approved_member_id_card() from public, anon, authenticated;

create or replace function public.get_id_card_qr_token(p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, auth, extensions, vault
as $$
declare
  v_token uuid;
  v_hash text;
  v_generation_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'ID card token access is restricted to the service role.' using errcode='42501';
  end if;
  select c.token_hash, c.token_generation_id into v_hash, v_generation_id
  from public.id_cards c
  where c.id = p_card_id;
  if not found then return null; end if;
  v_token := public.derive_id_card_qr_token(v_generation_id);
  if v_hash is distinct from public.hash_id_card_token(v_token) then
    raise exception 'ID card token integrity check failed.';
  end if;
  return v_token;
end;
$$;

revoke all on function public.get_id_card_qr_token(uuid) from public, anon, authenticated;
grant execute on function public.get_id_card_qr_token(uuid) to service_role;

-- Reissue keeps the card primary key stable and rotates its token generation.
-- Locking the member/card serializes concurrent issuance and verification.
-- The raw token stays inside this function and is never stored or returned.
create or replace function public.reissue_member_id_card(p_member_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, auth, extensions, vault
as $$
declare
  v_member_status text;
  v_membership_no text;
  v_member_valid_until public.members.valid_until%type;
  v_user_id uuid;
  v_profile_active boolean;
  v_account_status text;
  v_card_id uuid;
  v_old_generation_id uuid;
  v_new_generation_id uuid;
  v_token uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'ID card reissue is restricted to the service role.' using errcode='42501';
  end if;

  select m.status, nullif(btrim(m.membership_no), ''), m.valid_until, m.user_id
  into v_member_status, v_membership_no, v_member_valid_until, v_user_id
  from public.members m
  where m.id = p_member_id
  for update;
  if not found or v_member_status <> 'approved' or v_membership_no is null then
    raise exception 'Only an approved member with an existing membership number can receive a reissued card.' using errcode='P0002';
  end if;
  if v_user_id is not null then
    select p.is_active,p.account_status into v_profile_active,v_account_status
    from public.profiles p where p.id=v_user_id;
    if not found or v_profile_active is distinct from true or v_account_status is distinct from 'active' then
      raise exception 'Inactive member accounts cannot receive a reissued card.' using errcode='P0002';
    end if;
  end if;

  select c.id, c.token_generation_id into v_card_id, v_old_generation_id
  from public.id_cards c
  where c.member_id = p_member_id
  for update;
  if not found then
    raise exception 'No existing ID card is available to reissue.' using errcode='P0002';
  end if;

  v_new_generation_id := pg_catalog.gen_random_uuid();
  while v_new_generation_id = v_old_generation_id
     or exists (select 1 from public.id_cards c where c.token_generation_id=v_new_generation_id)
     or exists (select 1 from public.id_verifications v where v.token_generation_id=v_new_generation_id) loop
    v_new_generation_id := pg_catalog.gen_random_uuid();
  end loop;
  v_token := public.derive_id_card_qr_token(v_new_generation_id);

  update public.id_cards
  set token_generation_id = v_new_generation_id,
      token_hash = public.hash_id_card_token(v_token),
      valid_until = v_member_valid_until,
      revoked_at = null,
      reissued_at = pg_catalog.now()
  where member_id = p_member_id
    and id = v_card_id;

  if not found then
    raise exception 'ID card changed during reissue; no replacement was issued.' using errcode='40001';
  end if;
  return v_card_id;
end;
$$;

revoke all on function public.reissue_member_id_card(uuid) from public, anon, authenticated;
grant execute on function public.reissue_member_id_card(uuid) to service_role;
do $$
declare
  v_owner oid;
begin
  select p.proowner into v_owner
  from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)');
  if not has_function_privilege('service_role', 'public.reissue_member_id_card(uuid)', 'EXECUTE') then
    raise exception 'service_role lacks reissue RPC EXECUTE after the targeted grant.';
  end if;
  if has_function_privilege('anon', 'public.reissue_member_id_card(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reissue_member_id_card(uuid)', 'EXECUTE') then
    raise exception 'anon/authenticated has direct or inherited reissue RPC EXECUTE.';
  end if;
  if exists (
    select 1 from aclexplode(coalesce(
      (select p.proacl from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
      acldefault('f', v_owner)
    )) acl
    where acl.privilege_type='EXECUTE'
      and acl.grantee<>0
      and acl.grantee not in (v_owner, 'service_role'::regrole::oid)
  ) then
    raise exception 'Unexpected direct EXECUTE grant exists on reissue RPC; review ACL manually.';
  end if;
end;
$$;

-- Hash-only public verification is serialized against reissue by locking the
-- same stable id_cards row. Only the service role may invoke this RPC.
create or replace function public.verify_id_card_token(p_token_hash text)
returns table(id_card_id uuid, member_id uuid, verification_status text)
language plpgsql
security definer
set search_path = pg_catalog, auth
as $$
declare
  v_card_id uuid;
  v_member_id uuid;
  v_generation_id uuid;
  v_hash text;
  v_card_valid_until public.id_cards.valid_until%type;
  v_revoked_at timestamptz;
  v_created_at timestamptz;
  v_member_status text;
  v_membership_no text;
  v_member_valid_until public.members.valid_until%type;
  v_user_id uuid;
  v_profile_active boolean;
  v_account_status text;
  v_status text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'ID card verification is restricted to the server role.' using errcode='42501';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select c.id, c.member_id, c.token_generation_id, c.token_hash,
         c.valid_until, c.revoked_at, c.created_at,
         m.status::text, m.membership_no, m.valid_until, m.user_id,
         p.is_active, p.account_status
    into v_card_id, v_member_id, v_generation_id, v_hash,
         v_card_valid_until, v_revoked_at, v_created_at,
         v_member_status, v_membership_no, v_member_valid_until, v_user_id,
         v_profile_active, v_account_status
  from public.id_cards c
  join public.members m on m.id=c.member_id
  left join public.profiles p on p.id=m.user_id
  where c.token_hash=p_token_hash
  for update of c;

  if not found or v_hash is distinct from p_token_hash then
    return;
  end if;

  v_status := case
    when v_member_status='blocked' or v_account_status='suspended' then 'Suspended'
    when v_member_status<>'approved'
      or (v_user_id is not null and (v_profile_active is distinct from true or v_account_status is distinct from 'active')) then 'Inactive'
    when v_revoked_at is not null or nullif(btrim(v_membership_no),'') is null then 'Invalid'
    when (v_card_valid_until is not null and v_card_valid_until < current_date)
      or (v_member_valid_until is not null and v_member_valid_until < current_date) then 'Inactive'
    else 'Active'
  end;

  insert into public.id_verifications(
    id_card_id, token_generation_id, token_hash_snapshot, verification_status
  ) values (
    v_card_id, v_generation_id, v_hash, v_status
  );

  return query select v_card_id, v_member_id, v_status;
end;
$$;
revoke all on function public.verify_id_card_token(text) from public, anon, authenticated;
grant execute on function public.verify_id_card_token(text) to service_role;
do $$
declare
  v_owner oid;
begin
  select proowner into v_owner from pg_proc where oid=to_regprocedure('public.verify_id_card_token(text)');
  if not has_table_privilege(v_owner,'public.id_cards','SELECT')
     or not has_table_privilege(v_owner,'public.id_cards','UPDATE')
     or not has_table_privilege(v_owner,'public.members','SELECT')
     or not has_table_privilege(v_owner,'public.profiles','SELECT')
     or not has_table_privilege(v_owner,'public.id_verifications','INSERT') then
    raise exception 'Verification RPC owner lacks required SELECT/INSERT table privileges.';
  end if;
  if not has_schema_privilege(v_owner,'auth','USAGE')
     or not has_function_privilege(v_owner,'auth.role()','EXECUTE') then
    raise exception 'Verification RPC owner lacks auth schema USAGE or auth.role() EXECUTE.';
  end if;
  if has_function_privilege('anon','public.verify_id_card_token(text)','EXECUTE')
     or has_function_privilege('authenticated','public.verify_id_card_token(text)','EXECUTE') then
    raise exception 'Client roles have direct or inherited verification RPC EXECUTE.';
  end if;
  if not has_function_privilege('service_role','public.verify_id_card_token(text)','EXECUTE') then
    raise exception 'service_role lacks verification RPC EXECUTE.';
  end if;
  if exists (
    select 1 from pg_proc f
    cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl
    where f.oid=to_regprocedure('public.verify_id_card_token(text)')
      and acl.privilege_type='EXECUTE'
      and (acl.grantee=0
        or acl.grantee not in (v_owner,'service_role'::regrole::oid)
        or (acl.grantee='service_role'::regrole::oid and acl.is_grantable))
  ) then
    raise exception 'Unexpected direct EXECUTE grant exists on verification-history RPC.';
  end if;
end;
$$;

-- The service role is used only by server routes. No client role can read/write cards
-- or call token derivation; QR lookup itself remains server-side.
revoke all on table public.id_cards from public, anon, authenticated;
grant select, insert, update on table public.id_cards to service_role;



-- Restrict helper EXECUTE, then grant it only to the executor and actual owners
-- of the issuer, token, and reissue RPCs. Ownership is never reassigned.
revoke all on function public.derive_id_card_qr_token(uuid) from public, anon, authenticated;
revoke all on function public.hash_id_card_token(uuid) from public, anon, authenticated;
do $$
declare
  v_role name;
  v_role_oid oid;
  v_identities name[];
  v_function_oid oid;
  v_executor_oid oid;
  v_issuer_owner oid;
  v_rpc_owner oid;
  v_reissue_owner oid;
  v_helper_owner oid;
begin
  select array_agg(distinct r.rolname) into v_identities
  from pg_roles r
  where r.oid in (
    (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.issue_approved_member_id_card()')),
    (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.get_id_card_qr_token(uuid)')),
    (select p.proowner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)')),
    (select oid from pg_roles where rolname=current_user)
  );
  select oid into v_executor_oid from pg_roles where rolname=current_user;
  select proowner into v_issuer_owner from pg_proc where oid=to_regprocedure('public.issue_approved_member_id_card()');
  select proowner into v_rpc_owner from pg_proc where oid=to_regprocedure('public.get_id_card_qr_token(uuid)');
  select proowner into v_reissue_owner from pg_proc where oid=to_regprocedure('public.reissue_member_id_card(uuid)');
  if v_identities is null then raise exception 'Could not identify all required function owners.'; end if;
  foreach v_role in array v_identities loop
    select oid into v_role_oid from pg_roles where rolname=v_role;
    if not has_function_privilege(v_role_oid, 'public.derive_id_card_qr_token(uuid)', 'EXECUTE') then
      execute format('grant execute on function public.derive_id_card_qr_token(uuid) to %I', v_role);
    end if;
    if not has_function_privilege(v_role_oid, 'public.hash_id_card_token(uuid)', 'EXECUTE') then
      execute format('grant execute on function public.hash_id_card_token(uuid) to %I', v_role);
    end if;
    if not has_function_privilege(v_role_oid, 'public.derive_id_card_qr_token(uuid)', 'EXECUTE')
       or not has_function_privilege(v_role_oid, 'public.hash_id_card_token(uuid)', 'EXECUTE') then
      raise exception 'Target role % lacks required helper EXECUTE after targeted grants.', v_role;
    end if;
  end loop;

  -- has_function_privilege is effective privilege checking and includes
  -- inherited role membership. Explicitly refuse any client-role access.
  if has_function_privilege('anon', 'public.derive_id_card_qr_token(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.hash_id_card_token(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.derive_id_card_qr_token(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.hash_id_card_token(uuid)', 'EXECUTE') then
    raise exception 'anon/authenticated has direct or inherited helper EXECUTE; migration stopped without changing role memberships.';
  end if;
  foreach v_function_oid in array array[
    to_regprocedure('public.derive_id_card_qr_token(uuid)')::oid,
    to_regprocedure('public.hash_id_card_token(uuid)')::oid
  ] loop
    select proowner into v_helper_owner from pg_proc where oid=v_function_oid;
    -- Inspect the complete explicit ACL (including PUBLIC). Direct EXECUTE for
    -- any role outside executor/function-owner roles is unexpected and is not
    -- silently revoked. Owner's inherent rights are not an ACL grant to others.
    if exists (
      select 1
      from aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid=v_function_oid),
        acldefault('f', (select p.proowner from pg_proc p where p.oid=v_function_oid))
      )) acl
      where acl.privilege_type='EXECUTE'
        and acl.grantee <> 0
        and acl.grantee not in (v_executor_oid,v_issuer_owner,v_rpc_owner,v_reissue_owner,v_helper_owner)
    ) then
      raise exception 'Unexpected direct role EXECUTE grant exists on helper function %; review ACL manually.', v_function_oid::regprocedure;
    end if;
    if exists (
      select 1 from aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid=v_function_oid),
        acldefault('f', (select p.proowner from pg_proc p where p.oid=v_function_oid))
      )) acl
      where acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) then
      raise exception 'PUBLIC retains helper EXECUTE; migration stopped.';
    end if;
  end loop;
end;
$$;

do $$
declare v_owner oid;
begin
  select p.proowner into v_owner from pg_proc p where p.oid=to_regprocedure('public.issue_approved_member_id_card()');
  if not has_table_privilege(v_owner, 'public.id_cards', 'INSERT') then raise exception 'Issuer owner lacks id_cards INSERT.'; end if;
  select p.proowner into v_owner from pg_proc p where p.oid=to_regprocedure('public.get_id_card_qr_token(uuid)');
  if not has_table_privilege(v_owner, 'public.id_cards', 'SELECT') then raise exception 'Token RPC owner lacks id_cards SELECT.'; end if;
  select p.proowner into v_owner from pg_proc p where p.oid=to_regprocedure('public.reissue_member_id_card(uuid)');
  if not has_table_privilege(v_owner, 'public.members', 'SELECT')
     or not has_table_privilege(v_owner, 'public.members', 'UPDATE')
     or not has_table_privilege(v_owner, 'public.profiles', 'SELECT')
     or not has_table_privilege(v_owner, 'public.id_cards', 'SELECT')
     or not has_table_privilege(v_owner, 'public.id_cards', 'UPDATE')
     or not has_table_privilege(v_owner, 'public.id_verifications', 'SELECT') then
    raise exception 'Reissue RPC owner lacks required members SELECT/UPDATE, profiles SELECT, id_cards SELECT/UPDATE, or verification-history SELECT.';
  end if;
  if not has_table_privilege(current_user, 'public.id_cards', 'INSERT') then raise exception 'Migration executor lacks id_cards INSERT; backfill stopped.'; end if;
  if not has_function_privilege(current_user, 'public.derive_id_card_qr_token(uuid)', 'EXECUTE')
     or not has_function_privilege(current_user, 'public.hash_id_card_token(uuid)', 'EXECUTE') then
    raise exception 'Migration executor lacks token helper EXECUTE; backfill stopped.';
  end if;
end;
$$;

create trigger members_issue_approved_id_card
after insert or update of status on public.members
for each row execute function public.issue_approved_member_id_card();


-- Preserve card IDs and hashes. Existing token generation seeds are initialized
-- from the stable card ID above; fail closed on inconsistent stored identities.
do $$
begin
  if exists (
    select 1 from public.id_cards c
    where c.token_hash is distinct from public.hash_id_card_token(
      public.derive_id_card_qr_token(c.token_generation_id)
    )
  ) then
    raise exception 'Existing ID cards use a different token derivation. They were preserved; review/rotate them in a separately approved plan.';
  end if;
end;
$$;

-- Backfill approved members only when they have a pre-existing membership number
-- and no card. Existing cards, pending members, and membership numbers are untouched.
do $$
begin
  if not has_table_privilege(current_user, 'public.id_cards', 'INSERT') then
    raise exception 'Migration executor lacks INSERT on public.id_cards; backfill stopped.';
  end if;
  if not has_function_privilege(current_user, 'public.derive_id_card_qr_token(uuid)', 'EXECUTE')
     or not has_function_privilege(current_user, 'public.hash_id_card_token(uuid)', 'EXECUTE') then
    raise exception 'Migration executor lacks ID token helper EXECUTE privileges; backfill stopped.';
  end if;
end;
$$;
with missing_cards as (
  select m.id as member_id, m.valid_until, pg_catalog.gen_random_uuid() as card_id
  from public.members m
  left join public.id_cards c on c.member_id=m.id
  where m.status='approved'
    and nullif(btrim(m.membership_no),'') is not null
    and c.id is null
), issued as (
  select member_id, valid_until, card_id,
         public.derive_id_card_qr_token(card_id) as qr_token
  from missing_cards
)
insert into public.id_cards(id,member_id,token_hash,valid_until,token_generation_id)
select card_id, member_id, public.hash_id_card_token(qr_token), valid_until, card_id
from issued
on conflict(member_id) do nothing;


commit;
