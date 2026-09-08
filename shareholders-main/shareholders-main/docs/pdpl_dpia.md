# PDPL Data Protection Impact Assessment

## System

- Shareholder portal: React/Vite frontend for stockholders
- Admin panel: React/Vite frontend for authorized administrators
- Backend: Supabase Auth, Postgres, Storage, and Edge Functions
- OTP provider: Twilio Verify

## Why A DPIA Is Required

The platform processes high-risk personal and financial information, including Saudi National ID values, contact details, national address data, shareholder records, transaction history, dividends, and supporting documents.

## Personal Data Inventory

- National ID
- Arabic and English names
- Phone numbers
- Email addresses
- Birth details
- National address details
- Shareholder records and balances
- Transactions, dividends, certificates, and approval documents
- Contact submissions and feedback

## Processing Purposes

- Authenticate stockholders by OTP
- Display shareholder information and documents
- Support cooperative administration workflows
- Manage support requests and feedback
- Enforce security controls and incident investigation
- Maintain legal, financial, and governance records

## Key Risks

1. Unauthorized access to other shareholders' records through weak claims or RLS policies
2. Public exposure of certificates or approval documents
3. Abuse of OTP and contact channels
4. Excessive administrative access without role separation
5. Compromise of personal data through XSS or leaked credentials
6. Inadequate handling of data subject rights and retention

## Implemented Controls

- Moved stockholder identity claims from `user_metadata` to `app_metadata`
- Added explicit `portal_admin` claims for administrator authorization
- Rewrote RLS and storage policies around claim-based access
- Set the `stock-certificates` bucket to private and switched certificate access to signed URLs
- Randomized stockholder auth passwords on each OTP login to block direct password bypass
- Added OTP and request rate limiting
- Enabled platform JWT verification for the admin-management function
- Added CSP to both frontends
- Added consent gates and a privacy notice inside the shareholder portal

## Remaining Manual Control

- Enable Supabase Auth leaked-password protection in the project dashboard

## Cross-Border / Third-Party Review

- Supabase hosts application infrastructure and stores personal data
- Twilio processes limited phone data required for OTP delivery
- Contracts, regional hosting decisions, and transfer assessments should be reviewed by the cooperative's legal and governance owners before production sign-off

## Decision

With the implemented technical controls and the remaining manual Auth dashboard change completed, the system can be operated with materially reduced privacy and security risk. Governance owners should review this DPIA whenever data categories, vendors, hosting regions, or authentication flows materially change.
