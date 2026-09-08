# PDPL Data Rights And Retention

## Scope

This operational note covers the shareholder portal, admin panel, and Supabase backend used to process Saudi shareholder records, support requests, and governance data.

## Data Subject Rights Workflow

1. Intake channel: receive privacy and data-rights requests through the portal `Contact` form or an equivalent verified support channel.
2. Identity verification: confirm the requester's identity using their National ID, registered mobile number, and account context before disclosing or changing any data.
3. Request categories:
   - Access request
   - Correction or completion request
   - Deletion request where legally permitted
   - Restriction or objection request where applicable
   - Data copy / portability request when operationally feasible
4. Triage and ownership: assign the request to the cooperative's authorized admin team for review.
5. Response target: acknowledge and route requests within 5 business days and complete the internal review within 30 days unless legal or audit obligations require an extension.
6. Evidence: log the request date, requester identity verification steps, action taken, approver, and completion date.

## Retention Schedule

| Data Category | Examples | Retention Rule |
| --- | --- | --- |
| Shareholder master records | National ID, names, address, birth details, contact details | Retain while the shareholder relationship exists and for as long as legal, tax, audit, and cooperative governance obligations require |
| Financial and transaction records | Stockholder transactions, dividends, supporting notes | Retain for statutory accounting, audit, and governance retention periods |
| Certificates and approval documents | Stock certificates, approval attachments | Retain while tied to an active shareholder or transaction record, then archive or delete according to legal retention duties |
| Authentication and abuse-prevention data | OTP attempts, rate-limit logs, session metadata | Retain only as long as needed for fraud prevention, incident investigation, and security evidence |
| Contact submissions and feedback | Messages, ratings, support context | Retain only as long as needed to resolve the request, support governance review, and demonstrate compliance |

## Deletion Rules

- Do not delete records that must be retained for legal, financial, audit, dispute, or governance purposes.
- When deletion is legally permitted, delete both the application record and any linked storage object.
- Where immediate deletion is not permitted, restrict access and document the retention reason.

## Security Handling

- Privacy requests must be handled only by portal administrators with an approved business need.
- Exported files containing personal data must use secure transfer channels and limited-time access where possible.
- Any suspected unauthorized disclosure must trigger the incident workflow and the Saudi PDPL breach assessment process.
