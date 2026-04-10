# UX Journeys

This document defines how users traverse the application, role by role. Every route, form, redirect, empty state, and navigation link is specified so that teammates building new components know exactly how their work fits into the existing user experience.

**This is a living document.** When a component adds new routes or changes navigation, update the relevant journey here.

---

## 1. Public visitor (unauthenticated)

### 1.1 Landing and discovery

1. **`/`** - Landing page. Four CTAs: "Find a care provider" (`/providers`), "I need care" (`/auth/sign-up`), "I'm helping a loved one" (`/auth/sign-up`), "I provide care" (`/auth/provider-sign-up`).
2. **`/providers`** - Provider directory. Search by keyword and postcode with radius. Collapsible advanced filters (gender, rate range, services, capabilities, certifications). All filters in URL params (shareable). Results show provider cards with headline, location, distance, rate, experience. Each card links to `/providers/[id]`.
3. **`/providers/[id]`** - Provider profile viewer. Shows headline, location, experience, verified date, about, services, capabilities, certifications, rates, service area. CTA depends on auth state:
   - Not signed in: "Contact this provider" links to `/auth/sign-up?return=/receiver/contacts/new?provider=[id]` (sign-up honours `?return=` and redirects there after account creation)
   - Signed in as receiver: links to `/receiver/contacts/new?provider=[id]`
   - Signed in as provider/admin: disabled (providers do not contact providers)

### 1.2 Authentication

All auth pages share a centered card layout with the unified brand mark (no blue or purple).

4. **`/auth/sign-in`** - Email/password sign-in. On success, redirects by role:
   - admin -> `/admin`
   - provider, provider_company -> `/provider`
   - receiver, family_member -> `/receiver`
   - Honours `?next=` param (validated against open redirect). Links: "Create an account" (`/auth/sign-up`), "Register as provider" (`/auth/provider-sign-up`).
5. **`/auth/sign-up`** - Receiver/family account creation. Display name, email, password. On success -> `/receiver`. Links: "Sign in" (`/auth/sign-in`), "Register here" as provider (`/auth/provider-sign-up`).
6. **`/auth/provider-sign-up`** - Individual provider registration. Display name, email, password, confirmation checkbox. On success -> `/provider/onboarding?welcome=1`. Links: "Create a care receiver account" (`/auth/sign-up`), "Sign in" (`/auth/sign-in`).
7. **`/auth/company-sign-up`** - Company provider registration. Company name, display name, email, password, confirmation checkbox. On success -> `/provider/company?welcome=1`. Links: "Individual provider sign-up" (`/auth/provider-sign-up`), "Sign in" (`/auth/sign-in`).
8. **`/auth/family-invite`** - Family member invitation acceptance. Reads token from URL. Shows account creation form with email prefilled. On success, auto-signs in and redirects to `/receiver/family`.

### 1.3 Public safeguarding

9. **`/safeguarding`** - Public safeguarding report form. No auth required. Subject type, description, severity, summary, details. On submit, shows confirmation with follow-up guidance.

---

## 2. Care provider (individual) - purple theme

### 2.1 First-time flow (onboarding)

After sign-up, the provider lands on `/provider/onboarding?welcome=1`.

1. **`/provider`** - Dashboard. Welcome message, onboarding checklist (7 items with status badges):
   - Profile -> `/provider/onboarding` (Edit/Start)
   - Services -> `/provider/onboarding/services`
   - Capabilities -> `/provider/onboarding/capabilities`
   - Identity doc -> `/provider/documents/upload`
   - DBS check -> `/provider/documents/upload`
   - Insurance -> `/provider/documents/upload`
   - Certifications -> `/provider/onboarding/certifications`
   
   Also shows quick-access cards: Messages (`/provider/messages`), Care plans (`/provider/care-plans`), Documents (`/provider/documents`).

2. **`/provider/onboarding`** - Profile form. Fields: headline, bio, DOB, phone, address (line1, line2, city, postcode, country), service postcode, service radius, years experience, hourly rate. Below the form: links to Services, Capabilities, Certifications sub-pages. "Save profile" submits to `updateProviderProfile`. "Back to dashboard" -> `/provider`.

3. **`/provider/onboarding/services`** - Service category checkboxes. Save -> `submitProviderServices`. Back -> `/provider/onboarding`.

4. **`/provider/onboarding/capabilities`** - Capability checkboxes grouped by service. Save -> `submitProviderCapabilities`. Back -> `/provider/onboarding`.

5. **`/provider/onboarding/certifications`** - List existing certs with delete. Add form: type, reference, issued date, expires date, linked document. "Upload a certification document" -> `/provider/documents/upload`. Back -> `/provider/onboarding`.

### 2.2 Document vault

6. **`/provider/documents`** - Document list. Shows title, kind badge, status badge (quarantine/available), verification badge (pending/approved/rejected), upload date, file size, expiry, rejection reason. "Upload document" -> `/provider/documents/upload`. Each doc has a two-step "Remove" (soft-delete with confirmation). Empty state: "Upload your first document" -> `/provider/documents/upload`.

7. **`/provider/documents/upload`** - Upload form. Document kind, title, description, file, expiry date. Submits to quarantine path.

### 2.3 Contact requests (inbound)

8. **`/provider/contacts`** - Incoming contact request list. Shows status, receiver info, subject, date.
9. **`/provider/contacts/[id]`** - Request detail. Accept/decline/message actions. On accept, a contact thread opens automatically (via database trigger).

### 2.4 Messaging

10. **`/provider/messages`** - Conversation list. Shows participant names, subject, unread badge, latest message preview, timestamp. "New message" -> `/provider/messages/new`. Empty state: "View contact requests" -> `/provider/contacts`.
11. **`/provider/messages/new`** - Start conversation. Receiver picker, compose message.
12. **`/provider/messages/[conversationId]`** - Realtime conversation view (client component with Supabase Realtime subscription). Send text, upload attachments.

### 2.5 Care plans

13. **`/provider/care-plans`** - Care plan list. Title, receiver name, status badge, updated date. "New care plan" -> `/provider/care-plans/new`. Each row -> `/provider/care-plans/[planId]`.
14. **`/provider/care-plans/new`** - Create form. Title, receiver picker. On create -> redirects to `/provider/care-plans/[planId]`.
15. **`/provider/care-plans/[planId]`** - Plan detail. Title, receiver, status, latest version summary. Actions (conditional on status): "Submit for approval", "Pause", "Complete", "Resume", "Cancel plan". Links: "Create new version" -> `/provider/care-plans/[planId]/versions/new`, "View details" -> version detail, "View version history" -> `/provider/care-plans/[planId]/versions`.
16. **`/provider/care-plans/[planId]/versions`** - Version history list.
17. **`/provider/care-plans/[planId]/versions/new`** - Version editor. Activities, line items with pricing, notes.
18. **`/provider/care-plans/[planId]/versions/[versionId]`** - Version detail. Full pricing table, PDF export.

### 2.6 Safeguarding and settings

19. **`/provider/safeguarding`** - Provider's own safeguarding reports (submitted by them).
20. **`/provider/settings/data`** - Data/privacy settings. Request data export, view export history with download links. Request erasure with 30-day cool-off, cancel during cool-off.

---

## 3. Care provider company - purple theme

Company providers share the `/provider` route prefix but have a parallel set of company management pages.

### 3.1 First-time flow

After company sign-up, lands on `/provider/company?welcome=1`.

1. **`/provider/company`** - Company dashboard. Setup checklist (5 items):
   - Profile -> `/provider/company/profile`
   - Services -> `/provider/company/services`
   - Capabilities -> `/provider/company/capabilities`
   - Documents -> `/provider/company/documents`
   - Members -> `/provider/company/members`

2. **`/provider/company/profile`** - Company profile form. Company name, company number, registered address, service postcode, description, website, phone. Save -> `updateCompanyProfile`.

3. **`/provider/company/services`** - Service category picker (same pattern as individual).

4. **`/provider/company/capabilities`** - Capability picker.

5. **`/provider/company/documents`** - Company document vault. Same pattern as individual provider documents. Upload -> `/provider/company/documents/upload`.

6. **`/provider/company/members`** - Member management. List members with role badges. "Invite member" -> form. Remove member with confirmation. Shows pending invitations.

---

## 4. Care receiver - blue theme

### 4.1 First-time flow

After sign-up, lands on `/receiver`.

1. **`/receiver`** - Dashboard. Welcome message, four quick-access cards:
   - "Find a provider" -> `/providers`
   - "Messages" -> `/receiver/messages`
   - "Contact requests" -> `/receiver/contacts`
   - "Care plans" -> `/receiver/care-plans`

### 4.2 Needs profile

2. **`/receiver/profile`** - Needs profile editor. Care needs, preferences, mobility, communication, dietary, medical summary, postcode. Save -> `upsertReceiverProfile`.
3. **`/receiver/profile/view`** - Read-only profile preview.

### 4.3 Finding and contacting providers

4. **`/providers`** (public route, but linked from receiver dashboard). Search, filter, browse.
5. **`/receiver/contacts`** - Outgoing contact request list. Status badges (Pending/Accepted/Declined/Expired/Withdrawn). "Find providers" -> `/providers`. Each row -> `/receiver/contacts/[id]`. Empty state: "Browse providers" -> `/providers`.
6. **`/receiver/contacts/new`** - Create contact request. Optional `?provider=[id]` pre-selects. Provider picker, subject, message. On success -> `/receiver/contacts`.
7. **`/receiver/contacts/[id]`** - Contact request detail with messaging thread.

### 4.4 Messaging

8. **`/receiver/messages`** - Conversation list. Same layout as provider messages but blue theme. "New message" -> `/receiver/messages/new`. Empty state: "View contacts" -> `/receiver/contacts`.
9. **`/receiver/messages/new`** - Start conversation.
10. **`/receiver/messages/[conversationId]`** - Realtime conversation view.

### 4.5 Care plans

11. **`/receiver/care-plans`** - Care plan list. Title, provider name, status, updated date. Empty state: "No care plans yet. Your provider will create one for you."
12. **`/receiver/care-plans/[planId]`** - Plan detail with approval flow. Shows line items, pricing, visit media consent checkbox. Actions: "Approve" (with consent decision), "Reject" (with reason, transitions back to draft).
13. **`/receiver/care-plans/[planId]/versions`** - Version history.
14. **`/receiver/care-plans/[planId]/versions/[versionId]`** - Version detail with pricing and PDF export.

### 4.6 Family circle

15. **`/receiver/family`** - Care circle overview. Circle name, member list (role badges: Primary/Member, joined/invited dates), pending invitations. "Invite member" -> `/receiver/family/invite`. "Remove" member (with confirmation). Empty state: "Invite a family member" -> `/receiver/family/invite`.
16. **`/receiver/family/invite`** - Send invitation. Email, role (primary/member).
17. **`/receiver/family/[memberId]`** - Member detail with authorisation document upload.

### 4.7 Safeguarding and settings

18. **`/receiver/safeguarding`** - Receiver's own safeguarding reports.
19. **`/receiver/settings/data`** - Data/privacy settings. Same DSAR/erasure flows as provider, blue theme.

---

## 5. Family member - blue theme

Family members share the receiver route group and blue theme. Their access is scoped by care circle membership.

- Same dashboard as receiver (`/receiver`) but some actions may be restricted based on circle role (primary vs member).
- Can view care plans, messages, and family circle for the receiver they are associated with.
- Can submit safeguarding reports.
- Can request own data export and erasure.
- **Cannot** invite additional family members unless they hold the "primary" role in the circle.

---

## 6. Administrator - neutral slate theme

### 6.1 Console

1. **`/admin`** - Admin home. Three main CTAs: "Verification queue" (`/admin/verification`), "Safeguarding" (`/admin/safeguarding`), "Users" (`/admin/users`).

### 6.2 User management

2. **`/admin/users`** - Admin list table. "Invite admin" -> `/admin/users/invite`.
3. **`/admin/users/invite`** - Invite form. Email, role.

### 6.3 Verification

4. **`/admin/verification`** - Queue dashboard. Four cards with pending counts: provider documents, providers, companies, family authorisations. Each links to its queue.
5. **`/admin/verification/providers`** - Pending providers and documents.
6. **`/admin/verification/providers/[id]`** - Provider review. Document preview, metadata, approve/reject form with notes.
7. **`/admin/verification/companies`** - Pending companies.
8. **`/admin/verification/companies/[id]`** - Company review.
9. **`/admin/verification/family`** - Pending family authorisations.
10. **`/admin/verification/family/[id]`** - Authorisation review.

### 6.4 Safeguarding

11. **`/admin/safeguarding`** - Safeguarding dashboard. Stat cards (total, by status, overdue triage). Report table with severity, status, triage deadline. Each row -> `/admin/safeguarding/[id]`.
12. **`/admin/safeguarding/[id]`** - Report detail. Full report, events timeline, triage form (set severity, assign reviewer), escalation form (statutory targets: local authority, police, CQC), resolution form.

### 6.5 DSAR

13. **`/admin/dsar`** - DSAR queue. Two tables: data export requests, erasure requests. Each row -> `/admin/dsar/[id]`.
14. **`/admin/dsar/[id]`** - Request detail. Type, requester, scope, approval/rejection form, export generation, erasure processing.

---

## 7. Cross-cutting navigation rules

### 7.1 Header and sidebar

- **Public pages**: top header with logo (`/`), "Browse providers" (`/providers`), conditional: role-based "My dashboard" link + display name + sign out when logged in; sign in/up/register links when logged out.
- **Provider pages**: sidebar or top nav linking to Dashboard, Messages, Care Plans, Contacts, Documents, Settings. Company providers also see Company section.
- **Receiver pages**: sidebar or top nav linking to Dashboard, Messages, Contacts, Care Plans, Family, Profile, Settings.
- **Admin pages**: sidebar or top nav linking to Console, Verification, Safeguarding, DSAR, Users.

### 7.2 Role-based redirects

- Unauthenticated user hitting `/provider/**`, `/receiver/**`, or `/admin/**` -> `/auth/sign-in?next=<original-path>`
- Authenticated user at wrong role hitting a gated route -> redirect to their home (`/admin`, `/provider`, `/receiver`)
- Post-sign-in redirect follows the `?next=` param if present, otherwise redirects by role

### 7.3 Empty states

Every list page must have a meaningful empty state that guides the user to the next action:
- Provider messages empty -> "View contact requests" link
- Receiver contacts empty -> "Browse providers" link
- Receiver care plans empty -> "No care plans yet. Your provider will create one for you."
- Provider documents empty -> "Upload your first document" link
- Receiver family empty -> "Invite a family member" link

### 7.4 Error and success feedback

- Form errors display via `?error=` URL param, rendered as `role="alert"` with `tabIndex={-1}`
- Success feedback via `?saved=1`, `?invited=1`, `?removed=1` etc. URL params
- Server action errors that cannot redirect throw and are caught by error boundaries

### 7.5 Theme consistency

- Every page renders in exactly one theme: blue (receiver), purple (provider), neutral slate (admin), or unified (public)
- A persistent audience label in the header identifies the current context ("Care receiver", "Care provider", "Administrator")
- PDFs and emails are themed by recipient role, not author role

---

## 8. Future journeys (not yet built)

The following journeys will be defined when their components ship:

- **C11 - Visit scheduling**: provider schedules visits from care plan, GPS check-in, visit notes, media upload (consent-gated), receiver/family verification
- **C12 - Medication management**: provider creates medication schedules, records administration, receiver/family receives change notifications
- **C13 - Payments**: provider Stripe onboarding, invoice generation, receiver payment processing, payment history
- **C14 - Direct debits**: GoCardless mandate capture, recurring payment setup
- **C26 - Dispute resolution**: structured dispute submission, admin adjudication queue
