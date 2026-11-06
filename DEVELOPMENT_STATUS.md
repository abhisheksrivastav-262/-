# Development status

Updated: 2026-11-03

## Phase 2 delivered in code

- Added role-aware server helpers that re-read active profile, assigned roles and organizational ancestry from Supabase. The service client is server-only; a member role cannot enter staff management endpoints.
- User API supports scoped staff/member listing, invites, role hierarchy checks, organization assignment, reporting officer validation, account activation/deactivation/suspension, detail/activity view, and reset-email requests. Existing Super Admin identity is excluded from modification targets.
- Added dynamic organization unit and designation management. The exact eleven levels are राष्ट्रीय, राज्य, मंडल, जिला, तहसील, ब्लॉक, ग्राम पंचायत, नगर पंचायत, नगरपालिका परिषद, नगर निगम and महानगर निगम. Designations are entered only by Super Admin; no titles or units were fabricated.
- Added scoped application review queue, coordinator → manager → admin stages, rejection history, final approval RPC, account invitation/linking and membership number generation on approved members.
- Added responsive Hindi-first user tables, search, filters, CSV export and print/PDF layout; organization unit and application review panels are on staff dashboards.
- Restricted global website CMS and media mutation to Super Admin in both API authorization and the new RLS migration.
- Added migrations `202611030004_user_scope_workflow.sql`, `202611030005_user_scope_rls_and_approval.sql`, `202611030006_scope_hardening.sql`, plus read-only verification SQL. They preserve records and do not change the existing Super Admin account.

## Existing Supabase state

- Read-only checks against the configured project found the original application tables present. New workflow columns, functions and policies in migrations 004–006 have not been applied from this workspace.
- The known Super Admin Auth user exists with its existing `super_admin` role and active profile. No users, passwords, roles or profiles were modified by this implementation.
- Read-only counts previously showed no members, applications, organizational units or designations. Therefore the new role and approval workflows have not been exercised with real records.
- Supabase Auth connectivity was previously confirmed. Successful email delivery and new workflow behavior still require project Auth redirect/SMTP configuration and the migrations.

## Apply and verify manually

In the matching Supabase project, inspect migration history and apply only missing SQL files, in order: `202611030001_initial.sql`, `202611030002_auth_profiles.sql`, `202611030003_public_cms_media.sql`, `202611030004_user_scope_workflow.sql`, `202611030005_user_scope_rls_and_approval.sql`, `202611030006_scope_hardening.sql`. Do not reset data or rerun already-applied initial migrations. Then run `supabase/verify-schema.sql` in SQL Editor and confirm that the legacy global `admin_*` policies return no rows.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- There is no lint script or ESLint dependency configured in `package.json`.
- Not yet verified against applied 004–006 migrations: invitations, role changes, application approval, RLS scope boundaries and manager/coordinator access. Do not treat these flows as operational until migrations are applied and tested with non-production accounts.
- Member self-service features remain pending: personal profile approval, ID card/QR verification, certificates, appointment letters, receipts, payment history, renewals, complaints and member notifications. Configurable approval stages, XLSX workbook export, bilingual controls and complete security/accessibility review also remain pending.

## Local run

Start with `npm run dev` and open `http://127.0.0.1:3000`. Login routes are `/login/super_admin`, `/login/admin`, `/login/manager`, `/login/coordinator`, and `/login/member`. Apply and verify the database migrations before using Phase 2 management features.
