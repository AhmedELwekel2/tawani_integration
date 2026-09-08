/**
 * API surface for the admin panel.
 *
 * This was a single 1275-line module covering ten unrelated domains. It is now a
 * barrel over `./api/*`, one module per domain, so a change to (say) announcements
 * no longer means scrolling past certificates and survey stats.
 *
 * Components keep importing from `services/apiService`, so the split cost no
 * churn at the call sites. New code may import the domain module directly
 * (`services/api/stockholders`) where that reads better.
 */

export * from './api/types';

export * from './api/contact';
export * from './api/feedback';
export * from './api/stockholders';
export * from './api/transactions';
export * from './api/dashboard';
export * from './api/dividends';
export * from './api/certificates';
export * from './api/approvals';
export * from './api/announcements';
export * from './api/subscribers';
