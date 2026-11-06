# अखिल भारतीय वैदिक धर्म संरक्षक समिति

Hindi-first public website and initial secure platform foundation for the organization management system.

## Local setup

1. Install Node.js 20 or later and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and enter `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
4. Apply migrations `202611030001_initial.sql` through `202611030006_scope_hardening.sql` in numerical order using the Supabase SQL Editor. Only apply migrations not already present in the target project; inspect migration history first and never reset the database.
5. Run `npm run dev` and open `http://localhost:3000`.

The current workspace `.env.local` has the project URL and publishable key configured. Never put the service-role/secret key in a `NEXT_PUBLIC_` variable. It is used only by server-side invitation, scoped-management and content endpoints.

## Supabase setup and access

The migration creates the relational foundation, role enum and row-level security. Public clients may submit membership applications and contact enquiries; they cannot read those rows, access member records, or assign roles. Apply additional reviewed RLS policies when implementing each authenticated feature. Provision the first super-admin role through a trusted, authenticated database operator only; do not expose role assignment through public signup. Sensitive identity uploads belong in private Storage buckets with policies tied to authenticated roles.

### Apply the migrations and verify the schema

In Supabase Dashboard, select the matching project and open **SQL Editor**. Check which migrations are already applied before running anything. Run each missing migration as a complete file, in order: `202611030001_initial.sql`, `202611030002_auth_profiles.sql`, `202611030003_public_cms_media.sql`, `202611030004_user_scope_workflow.sql`, `202611030005_user_scope_rls_and_approval.sql`, and `202611030006_scope_hardening.sql`. Never rerun an initial migration blindly or reset existing data. Then run `supabase/verify-schema.sql`; expected new policies should exist and the legacy global `admin_*` policies should return no rows.

Afterward, run `supabase/verify-schema.sql` in SQL Editor. It reports whether expected tables have RLS enabled, their policy counts, expected policy names and the public-media bucket. For first admin provisioning, create/invite only your own user in **Authentication → Users**, copy that user UUID, replace both UUID placeholders in `supabase/first-super-admin.sql`, and run it in SQL Editor. Verify the returned row before signing in at `/login/super_admin`. Do not paste secret keys or invite links into chat.

The app has no public signup page and role assignment is never based on user metadata. Review **Authentication → URL Configuration** and allow `http://localhost:3000/**` and `http://127.0.0.1:3000/**` for local password reset/invite redirects. Configure SMTP for reliable invite/reset delivery.

The service-role/secret key, when configured locally, must use `SUPABASE_SERVICE_ROLE_KEY`, stay in `.env.local`, and never appear in browser-prefixed variables, source control, responses or logs.

The membership form currently collects only name, phone, optional email/state and message. Add expanded personal-data fields only with a documented lawful purpose, consent wording, retention policy and secure access path. No identity-document upload is enabled.

## Integrations and deployment

Razorpay variables are placeholders only. The payment flow, webhook signature verification, receipts and refunds are not activated until credentials and server-side payment routes are implemented. Do not claim or accept payments through this starter.

Deploy the Next.js app to Vercel and Supabase separately. Set environment variables in the deployment provider, configure authentication redirect URLs and domain allowlists, and apply migrations before enabling public forms. Configure verified organization contact details, official logo/poster, approved leadership, report documents, privacy notice, legal/80G eligibility and payment provider settings before publishing those claims.

## Current scope

Implemented: responsive public homepage and informational routes, the eleven-level hierarchy display, bilingual brand labeling, and validated public contact/membership submission endpoints backed by Supabase when configured. The migration lays groundwork for roles, hierarchy, membership, payment ledgers, verification records, CMS content, projects, events, reporting and audit logs.

Phase 2 implementation: role-specific login and routing; server-authorized user invitations, scoped user profile/role updates, account status controls, reset email, activity details, CSV/print exports, dynamic 11-level units, approved designation lookup, scoped application queue and staged approval. CMS/media mutation is limited to Super Admin. The new scope migrations must be applied before these new endpoints can work. See [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for verified state and remaining work.

Still pending: complete member self-service dashboard (ID card/QR public verification, certificates, letters, receipts, payments, renewals, complaints and profile approval); configurable approval paths; test accounts and authenticated end-to-end/RLS integration tests; Excel workbook export (CSV and browser print are available); bilingual controls and wider accessibility/security review. This is not yet production ready for operational member or financial data.
