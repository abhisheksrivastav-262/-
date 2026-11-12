import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QRCodeSVG } from 'qrcode.react';
import { canIssueMembershipCard, deriveMembershipStatus, getVerificationUrl } from '../app/id-card-domain.ts';

const cardMigration = readFileSync(new URL('../supabase/migrations/202611030009_secure_member_id_cards.sql', import.meta.url), 'utf8');

test('pending applications and members without an existing membership number cannot receive cards', () => {
  assert.equal(canIssueMembershipCard('pending', 'ABVDS-2026-000001'), false);
  assert.equal(canIssueMembershipCard('approved', null), false);
  assert.equal(canIssueMembershipCard('approved', '  '), false);
});

test('only approved members with an existing membership number are eligible', () => {
  assert.equal(canIssueMembershipCard('approved', 'ABVDS-2026-000001'), true);
});

test('verification status reflects current suspended, inactive, expired and invalid states', () => {
  const base = { hasCard: true, revoked: false, memberStatus: 'approved', accountStatus: 'active', profileActive: true, today: '2026-11-09' };
  assert.equal(deriveMembershipStatus(base), 'Active');
  assert.equal(deriveMembershipStatus({ ...base, memberStatus: 'blocked' }), 'Suspended');
  assert.equal(deriveMembershipStatus({ ...base, accountStatus: 'suspended' }), 'Suspended');
  assert.equal(deriveMembershipStatus({ ...base, accountStatus: 'suspended', revoked: true }), 'Suspended');
  assert.equal(deriveMembershipStatus({ ...base, accountStatus: 'inactive', profileActive: false }), 'Inactive');
  assert.equal(deriveMembershipStatus({ ...base, memberValidUntil: '2026-11-08' }), 'Inactive');
  assert.equal(deriveMembershipStatus({ ...base, cardValidUntil: '2026-11-08' }), 'Inactive');
  assert.equal(deriveMembershipStatus({ ...base, hasCard: false }), 'Invalid');
  assert.equal(deriveMembershipStatus({ ...base, revoked: true }), 'Invalid');
});

test('verification URLs carry only the opaque token and use the official origin by default', () => {
  assert.equal(getVerificationUrl('a1b2-token'), 'https://www.vdssamiti.com/verify/a1b2-token');
  assert.equal(getVerificationUrl('opaque', 'https://example.test/'), 'https://example.test/verify/opaque');
});

test('QR renderer creates a scannable SVG from the verification URL', () => {
  const svg = renderToStaticMarkup(createElement(QRCodeSVG, { value: getVerificationUrl('a1b2-token'), level: 'Q' }));
  assert.match(svg, /^<svg/);
  assert.match(svg, /<path/);
});

test('database card issuance is gated to approved members with an existing number', () => {
  assert.match(cardMigration, /new\.status='approved'\s+and nullif\(btrim\(new\.membership_no\),''\) is not null/);
  assert.match(cardMigration, /where m\.status='approved'[\s\S]*?nullif\(btrim\(m\.membership_no\),''\) is not null/);
  assert.match(cardMigration, /after insert or update of status on public\.members/i);
  assert.doesNotMatch(cardMigration, /update public\.members\s+set\s+membership_no/i);
  assert.match(cardMigration, /extensions\.digest\(/);
  assert.match(cardMigration, /extensions\.hmac\(/);
  assert.match(cardMigration, /vault\.decrypted_secrets/);
  assert.match(cardMigration, /get_id_card_qr_token/);
  assert.match(cardMigration, /tgtype=23/);
  assert.match(cardMigration, /a\.attnum = any\(t\.tgattr::smallint\[\]\)/);
  assert.match(cardMigration, /Unexpected members_issue_approved_id_card trigger exists/);
  assert.match(cardMigration, /pg_catalog\.gen_random_uuid\(\)/);
  assert.match(cardMigration, /has_table_privilege\(v_owner, 'vault\.decrypted_secrets', 'SELECT'\)/);
  assert.match(cardMigration, /grant execute on function public\.derive_id_card_qr_token/);
  assert.match(cardMigration, /Migration executor lacks INSERT on public\.id_cards/);
  assert.doesNotMatch(cardMigration, /revoke all on table public\.id_cards from service_role/i);
  assert.doesNotMatch(cardMigration, /insert into public\.id_cards\(id,member_id,token_hash,valid_until\)\s*values\s*\(v_token/i);
});

test('QR token is derived server-side and checked against the stored hash', () => {
  const server = readFileSync(new URL('../app/id-card-server.ts', import.meta.url), 'utf8');
  const memberRoute = readFileSync(new URL('../app/api/member/id-card/route.ts', import.meta.url), 'utf8');
  const adminRoute = readFileSync(new URL('../app/api/admin/members/[memberId]/id-card/route.ts', import.meta.url), 'utf8');
  const adminQrRoute = readFileSync(new URL('../app/api/admin/members/[memberId]/id-card/qr/route.ts', import.meta.url), 'utf8');
  assert.match(memberRoute, /member\.status !== 'approved'/);
  assert.match(adminRoute, /member\.status !== 'approved'/);
  assert.match(server, /rpc\('get_id_card_qr_token'/);
  assert.match(server, /hashMembershipCardToken\(token\) !== expectedHash/);
  assert.match(server, /rpc\('verify_id_card_token'/);
  assert.match(server, /p_token_hash: hashMembershipCardToken\(token\)/);
  assert.doesNotMatch(server, /\.eq\('token_hash', hashMembershipCardToken\(token\)\)/);
  assert.match(memberRoute, /qr_image_url: `\/api\/member\/id-card\/qr\?v=/);
  assert.match(adminRoute, /id-card\/qr/);
  assert.doesNotMatch(memberRoute, /getVerificationUrl\(card\.id\)/);
  assert.doesNotMatch(adminRoute, /getVerificationUrl\(card\.id\)/);
  assert.doesNotMatch(adminRoute, /verification_url|verificationUrl/);
  assert.match(adminQrRoute, /await getAdminActor\(\)/);
  assert.match(adminQrRoute, /isUnitInScope\(db, actor, member\.unit_id\)/);
  assert.match(adminQrRoute, /member\.status !== 'approved'/);
});

test('reissue preserves stable card identity and atomically rotates generation and token hash', () => {
  const migration = cardMigration;
  const adminRoute = readFileSync(new URL('../app/api/admin/members/[memberId]/id-card/route.ts', import.meta.url), 'utf8');
  const reissueSql = migration.match(/create or replace function public\.reissue_member_id_card\(p_member_id uuid\)([\s\S]*?)\$\$;/)?.[1];
  assert.ok(reissueSql, 'migration defines the server-only reissue RPC');
  assert.match(reissueSql, /auth\.role\(\).*service_role/s);
  assert.match(reissueSql, /from public\.members m[\s\S]*?for update/i);
  assert.match(reissueSql, /from public\.id_cards c[\s\S]*?for update/i);
  assert.match(reissueSql, /pg_catalog\.gen_random_uuid\(\)/);
  assert.match(reissueSql, /public\.derive_id_card_qr_token\(v_new_generation_id\)/);
  assert.match(reissueSql, /set token_generation_id = v_new_generation_id,[\s\S]*?token_hash = public\.hash_id_card_token\(v_token\)/);
  assert.doesNotMatch(reissueSql, /set\s+id\s*=/i);
  const updateSet = reissueSql.match(/update public\.id_cards\s+set([\s\S]*?)where/i)?.[1] || '';
  assert.doesNotMatch(updateSet, /\b(?:id|member_id)\s*=/i);
  assert.match(reissueSql, /where member_id = p_member_id\s+and id = v_card_id/i);
  assert.match(reissueSql, /return v_card_id/);
  assert.doesNotMatch(reissueSql, /return v_token/);
  assert.doesNotMatch(reissueSql, /membership_no\s*=/i);
  assert.match(migration, /grant execute on function public\.reissue_member_id_card\(uuid\) to service_role/i);
  assert.match(migration, /revoke all on function public\.reissue_member_id_card\(uuid\) from public, anon, authenticated/i);
  assert.match(adminRoute, /db\.rpc\('reissue_member_id_card'/);
  assert.doesNotMatch(adminRoute, /\.from\('id_cards'\)\s*\.update\(/);
  assert.match(adminRoute, /token_generation_rotated: true/);
  assert.doesNotMatch(adminRoute, /token_identity_rotated: true/);
});

test('reissue route retains verified actor, active account, role, and organizational scope gates', () => {
  const adminRoute = readFileSync(new URL('../app/api/admin/members/[memberId]/id-card/route.ts', import.meta.url), 'utf8');
  assert.match(adminRoute, /await getAdminActor\(\)/);
  assert.match(adminRoute, /!actor \|\| !db/);
  assert.match(adminRoute, /\['super_admin', 'admin'\]\.includes\(actor\.role\)/);
  assert.match(adminRoute, /actor\.role !== 'super_admin' && !await isUnitInScope\(db, actor, member\.unit_id\)/);
  assert.match(adminRoute, /member\.status !== 'approved' \|\| !member\.membership_no\?\.trim\(\)/);
  const postHandler = adminRoute.slice(adminRoute.indexOf('export async function POST'));
  assert.doesNotMatch(postHandler, /request\.json\(\)/);
});

test('verification rejects retired identities and reports revoked, expired, or inactive cards as non-active', () => {
  const server = readFileSync(new URL('../app/id-card-server.ts', import.meta.url), 'utf8');
  const base = { hasCard: true, revoked: false, memberStatus: 'approved', accountStatus: 'active', profileActive: true, today: '2026-11-11' };
  assert.equal(deriveMembershipStatus({ ...base, revoked: true }), 'Invalid');
  assert.equal(deriveMembershipStatus({ ...base, cardValidUntil: '2026-11-10' }), 'Inactive');
  assert.equal(deriveMembershipStatus({ ...base, accountStatus: 'inactive', profileActive: false }), 'Inactive');
  assert.equal(deriveMembershipStatus({ ...base, memberStatus: 'pending' }), 'Inactive');
  assert.match(server, /rpc\('verify_id_card_token'/);
  assert.match(server, /p_token_hash: hashMembershipCardToken\(token\)/);
  assert.doesNotMatch(server, /\.eq\('token_hash', hashMembershipCardToken\(token\)\)/);
  assert.match(server, /if \(!card \|\| typeof card\.member_id !== 'string'\) return \{ available: true as const, member: null \}/);
});

test('public verification page does not render mobile and photo remains explicitly public-only', () => {
  const page = readFileSync(new URL('../app/verify/[token]/page.tsx', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../app/id-card-server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /mobile/i);
  assert.match(page, /referrer: 'no-referrer'/);
  assert.match(server, /member\.public_photo === true/);
  assert.match(server, /rpc\('verify_id_card_token'/);
  assert.doesNotMatch(server, /console\.(?:log|error|warn).*token/i);
});

test('verification and reissue serialize on the stable card row and keep history linked', () => {
  const reissueSql = cardMigration.match(/create or replace function public\.reissue_member_id_card\(p_member_id uuid\)([\s\S]*?)\$\$;/)?.[1];
  assert.ok(reissueSql);
  assert.ok((reissueSql.match(/for update/gi) || []).length >= 2, 'member and card rows are locked');
  assert.match(reissueSql, /update public\.id_cards[\s\S]*?set token_generation_id = v_new_generation_id,[\s\S]*?token_hash = public\.hash_id_card_token\(v_token\)/);
  assert.doesNotMatch(reissueSql, /set\s+id\s*=/i);
  const verifySql = cardMigration.match(/create or replace function public\.verify_id_card_token\(p_token_hash text\)([\s\S]*?)\$\$;/)?.[1];
  assert.ok(verifySql);
  assert.match(verifySql, /where c\.token_hash=p_token_hash[\s\S]*?for update of c/i);
  assert.match(verifySql, /if not found or v_hash is distinct from p_token_hash then\s+return/i);
  assert.match(verifySql, /insert into public\.id_verifications[\s\S]*?id_card_id, token_generation_id, token_hash_snapshot, verification_status/i);
  assert.match(verifySql, /v_card_id, v_generation_id, v_hash, v_status/i);
  assert.match(cardMigration, /alter table public\.id_verifications add column if not exists token_generation_id uuid/i);
  assert.match(cardMigration, /id_verifications_id_card_id_fkey/);
  assert.match(reissueSql, /if not found then[\s\S]*?ID card changed during reissue/);
  assert.match(cardMigration, /^begin;/m);
  assert.match(cardMigration, /^commit;/m);
});

test('issuance seeds generation from stable card ID, and reissue rotates only generation/hash', () => {
  const issuer = cardMigration.match(/create or replace function public\.issue_approved_member_id_card\(\)([\s\S]*?)\$\$;/)?.[1];
  const backfill = cardMigration.slice(cardMigration.indexOf('with missing_cards as'));
  assert.ok(issuer);
  assert.match(issuer, /values \(v_card_id,new\.id,[\s\S]*?v_card_id\)/i);
  assert.match(backfill, /token_generation_id\)\s*select card_id,[\s\S]*?valid_until, card_id/i);

  const qrRoutes = [
    readFileSync(new URL('../app/api/member/id-card/qr/route.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../app/api/admin/members/[memberId]/id-card/qr/route.ts', import.meta.url), 'utf8'),
  ];
  for (const route of qrRoutes) {
    assert.match(route, /getIdCardQrSvg\(db, card\.id, card\.token_hash\)/);
    assert.doesNotMatch(route, /verificationUrl|token\s*:/i);
  }
  const cardApi = readFileSync(new URL('../app/api/member/id-card/route.ts', import.meta.url), 'utf8');
  assert.match(cardApi, /qr_image_url/);
  assert.doesNotMatch(cardApi, /verification_url|verificationUrl/);
});

test('history RPC is service-role-only and verification responses omit private mobile data', () => {
  const verifySql = cardMigration.match(/create or replace function public\.verify_id_card_token\(p_token_hash text\)([\s\S]*?)\$\$;/)?.[1];
  const server = readFileSync(new URL('../app/id-card-server.ts', import.meta.url), 'utf8');
  assert.ok(verifySql);
  assert.match(verifySql, /auth\.role\(\).*service_role/s);
  assert.match(cardMigration, /revoke all on function public\.verify_id_card_token\(text\) from public, anon, authenticated/i);
  assert.match(cardMigration, /grant execute on function public\.verify_id_card_token\(text\) to service_role/i);
  assert.match(cardMigration, /revoke all on function public\.get_id_card_qr_token\(uuid\) from public, anon, authenticated/i);
  assert.match(cardMigration, /revoke all on function public\.issue_approved_member_id_card\(\) from public, anon, authenticated/i);
  assert.match(cardMigration, /revoke all on function public\.reissue_member_id_card\(uuid\) from public, anon, authenticated/i);
  assert.match(verifySql, /p_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(verifySql, /return query[\s\S]*?token_hash_snapshot/i);
  assert.doesNotMatch(server, /mobile\s*:/);
  assert.match(server, /member\.public_photo === true/);
});

test('migration preflights all reissue columns, assignment types, foreign keys, and grants before DDL', () => {
  const preflight = cardMigration.slice(0, cardMigration.indexOf('create or replace function public.derive_id_card_qr_token'));
  for (const requiredColumn of [
    "('members','id')",
    "('members','membership_no')",
    "('members','status')",
    "('members','valid_until')",
    "('id_cards','id')",
    "('id_cards','member_id')",
    "('id_cards','token_hash')",
    "('id_cards','valid_until')",
    "('id_cards','revoked_at')",
  ]) assert.ok(preflight.includes(requiredColumn), `preflight checks ${requiredColumn}`);
  assert.match(preflight, /members\.id must have UUID type/);
  assert.match(preflight, /id_cards\.id must have UUID type/);
  assert.match(preflight, /id_cards\.member_id must have UUID type/);
  assert.match(preflight, /pg_cast[\s\S]*?castcontext in \('i','a'\)/);
  assert.match(preflight, /token_hash must be text or varchar/);
  assert.match(preflight, /id_verifications_id_card_id_fkey/);
  assert.doesNotMatch(preflight, /A foreign key references public\.id_cards\.id/);
  assert.match(preflight, /Unexpected PUBLIC\/custom-role id_cards ACL/);
  assert.match(preflight, /anon\/authenticated has direct or inherited id_cards table\/column privileges/);
  assert.match(preflight, /service_role has id_cards privileges beyond the required SELECT\/INSERT\/UPDATE set/);
  assert.ok(cardMigration.indexOf("raise exception 'Unexpected PUBLIC/custom-role id_cards ACL") < cardMigration.indexOf('alter table public.id_cards'));
});

test('migration checks every row-lock and verification-history privilege it uses', () => {
  const migration = cardMigration;
  assert.match(migration, /has_table_privilege\(v_owner, 'public\.members', 'UPDATE'\)/);
  assert.match(migration, /has_table_privilege\(v_owner, 'public\.id_verifications', 'SELECT'\)/);
  assert.match(migration, /has_table_privilege\(v_owner,'public\.id_cards','UPDATE'\)/);
  assert.match(migration, /Reissue RPC owner cannot bypass verification-history RLS/);
  assert.match(migration, /auth\.role\(\).*service_role/s);
  assert.match(migration, /has_function_privilege\(v_owner,'auth\.role\(\)','EXECUTE'\)/);
  assert.match(migration, /valid non-partial UNIQUE index on token_hash/i);
  const tokenRpc = migration.match(/create or replace function public\.get_id_card_qr_token\(p_card_id uuid\)([\s\S]*?)\$\$;/)?.[1];
  assert.ok(tokenRpc);
  assert.doesNotMatch(tokenRpc, /for update/i, 'token artwork lookup does not require row-lock UPDATE rights');
});

test('live Migration 009 preflight is SELECT-only and never returns Vault plaintext', () => {
  const sql = readFileSync(new URL('../supabase/preflight/009_live_final_preflight.sql', import.meta.url), 'utf8');
  const executable = sql.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''").trim();
  const statements = executable.split(';').map((part) => part.trim()).filter(Boolean);
  assert.ok(statements.length >= 10, 'preflight contains multiple result sets');
  for (const statement of statements) assert.match(statement, /^(WITH|SELECT)\b/i, 'each statement starts with a read-only query');
  assert.doesNotMatch(executable, /\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/i);
  assert.match(sql, /vault\.secrets/);
  assert.match(sql, /octet_length\(convert_to\(decrypted_secret/);
  assert.doesNotMatch(executable, /SELECT\s+(?:\w+\.)?decrypted_secret\b/i);
  for (const expectedCheck of [
    'id_verifications_id_card_id_fkey',
    'id_verifications.id UUID',
    'id_verifications.viewed_at timestamp',
    'token_generation_id',
    'token_hash_snapshot',
    'verification_status',
    'pg_get_functiondef',
    'aclexplode',
    'members_assign_membership_number',
    'members_issue_approved_id_card',
    'verify_id_card_token',
  ]) assert.ok(sql.includes(expectedCheck), `preflight includes ${expectedCheck}`);
});
