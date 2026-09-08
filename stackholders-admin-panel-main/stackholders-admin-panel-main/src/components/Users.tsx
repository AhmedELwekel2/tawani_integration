import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listPortalAdmins,
  createPortalAdmin,
  deletePortalAdmin,
  type PortalAdminRow,
} from '../services/adminPortalUsersService';
import {
  getPaginatedSubscribers,
  createSubscriber,
  updateSubscriber,
  setSubscriberActive,
  deleteSubscriber,
  type Subscriber,
} from '../services/api/subscribers';
import { getPaginatedStockholders, createStockholder } from '../services/api/stockholders';
import type { Stockholder } from '../services/api/types';
import { supabaseClient } from '../services/supabaseClient';
import './Tawani.css';
import './Subscribers.css';

/** Every kind of user an admin can create, in one place. */
type UserType = 'admin' | 'editor' | 'shareholder' | 'subscriber';

const USER_TYPES: UserType[] = ['admin', 'editor', 'shareholder', 'subscriber'];

/** Staff sign in with an email and password; members sign in with National ID + OTP. */
const isStaffType = (type: UserType) => type === 'admin' || type === 'editor';

interface UnifiedRow {
  key: string;
  type: UserType;
  /** Email for staff, full name for members. */
  label: string;
  /** National ID for members; blank for staff. */
  identifier: string;
  isActive: boolean;
  /** Set for admin/editor rows, which can be deleted here. */
  authId?: string;
  /** Set for subscriber rows, which are fully managed here. */
  subscriber?: Subscriber;
}

const IconUsers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const EMPTY_FORM = {
  email: '',
  password: '',
  national_id: '',
  full_name_ar: '',
  full_name_en: '',
  phone_number: '',
};

/**
 * One screen for every kind of user.
 *
 * The four types are not stored the same way, and that is deliberate rather than
 * incidental: an admin or editor is a real auth account minted immediately with
 * a password, while a shareholder or subscriber is a directory record whose auth
 * account is created by `auth-login` the first time they pass an OTP. This
 * component hides that split behind a single picker.
 *
 * Subscribers are managed end to end here -- they are only five fields, so a
 * separate screen earned nothing. Shareholders are not: their record carries
 * shares, transactions, dividends and certificates, which belong in the
 * Stockholders tab.
 */
export default function Users() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isAr = i18n.language === 'ar';

  const [type, setType] = useState<UserType>('admin');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingSubscriberId, setEditingSubscriberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: staff = [], isLoading: staffLoading } = useQuery({
    queryKey: ['users', 'staff'],
    queryFn: listPortalAdmins,
    retry: false,
  });

  const { data: subscribers } = useQuery({
    queryKey: ['users', 'subscribers'],
    queryFn: () => getPaginatedSubscribers(1, 100),
    retry: false,
  });

  const { data: stockholders } = useQuery({
    queryKey: ['users', 'stockholders'],
    queryFn: () => getPaginatedStockholders(1, 100),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const rows: UnifiedRow[] = [
    ...staff.map((u: PortalAdminRow) => ({
      key: `staff-${u.id}`,
      type: (u.role ?? 'admin') as UserType,
      label: u.email,
      identifier: '',
      isActive: true,
      authId: u.id,
    })),
    ...((stockholders?.data ?? []) as Stockholder[]).map((s) => ({
      key: `sh-${s.id}`,
      type: 'shareholder' as UserType,
      label: (isAr ? s.full_name_ar : s.full_name_en) || s.national_id,
      identifier: s.national_id,
      isActive: s.is_active,
    })),
    ...((subscribers?.data ?? []) as Subscriber[]).map((s) => ({
      key: `sub-${s.id}`,
      type: 'subscriber' as UserType,
      label: (isAr ? s.full_name_ar : s.full_name_en) || s.national_id,
      identifier: s.national_id,
      isActive: s.is_active,
      subscriber: s,
    })),
  ];

  const describeError = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'DUPLICATE_NATIONAL_ID') {
      return t('users.duplicateId', 'A user with this National ID already exists.');
    }
    return message;
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingSubscriberId(null);
    setError(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const record = {
        national_id: form.national_id.trim(),
        full_name_ar: form.full_name_ar.trim() || null,
        full_name_en: form.full_name_en.trim() || null,
        email: form.email.trim() || null,
        phone_number: form.phone_number.trim() || null,
      };

      if (editingSubscriberId) return updateSubscriber(editingSubscriberId, record);
      if (isStaffType(type)) return createPortalAdmin(form.email.trim(), form.password, type);
      if (type === 'subscriber') return createSubscriber(record);

      // Shareholders carry many more (optional) fields; the detailed record is
      // filled in from the Stockholders tab afterwards.
      return createStockholder({
        ...record,
        is_active: true,
        birth_date_hijri: null,
        birth_date_gregorian: null,
        birth_place: null,
        address_building: null,
        address_street: null,
        address_district: null,
        address_city: null,
        address_postal_code: null,
        address_additional_number: null,
      });
    },
    onSuccess: () => {
      const wasEditing = editingSubscriberId !== null;
      resetForm();
      setNotice(
        wasEditing
          ? t('users.saved', 'Changes saved.')
          : isStaffType(type)
            ? t('users.createdStaff', 'Account created. They can sign in with that email and password.')
            : t('users.createdMember', 'Added. They can sign in to the portal with their National ID.')
      );
      invalidate();
    },
    onError: (err) => {
      setNotice(null);
      setError(describeError(err));
    },
  });

  const removeStaff = useMutation({
    mutationFn: async (authId: string) => {
      const { data } = await supabaseClient.auth.getUser();
      if (data.user?.id === authId) {
        throw new Error(t('users.cannotDeleteSelf', 'You cannot delete your own account.'));
      }
      return deletePortalAdmin(authId);
    },
    onSuccess: invalidate,
    onError: (err) => setError(describeError(err)),
  });

  const toggleSubscriber = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setSubscriberActive(id, next),
    onSuccess: invalidate,
    onError: (err) => setError(describeError(err)),
  });

  const removeSubscriber = useMutation({
    mutationFn: (id: string) => deleteSubscriber(id),
    onSuccess: () => {
      resetForm();
      invalidate();
    },
    onError: (err) => setError(describeError(err)),
  });

  const startEditSubscriber = (subscriber: Subscriber) => {
    setEditingSubscriberId(subscriber.id);
    setType('subscriber');
    setError(null);
    setNotice(null);
    setForm({
      email: subscriber.email ?? '',
      password: '',
      national_id: subscriber.national_id,
      full_name_ar: subscriber.full_name_ar ?? '',
      full_name_en: subscriber.full_name_en ?? '',
      phone_number: subscriber.phone_number ?? '',
    });
  };

  const showStaffFields = isStaffType(type) && !editingSubscriberId;
  const canSubmit = showStaffFields
    ? form.email.trim().length > 0 && form.password.length >= 8
    : form.national_id.trim().length > 0;

  const typeLabel = (value: UserType) =>
    t(`users.type.${value}`, value.charAt(0).toUpperCase() + value.slice(1));

  return (
    <div className="tawani-page">
      <header className="tawani-header">
        <div className="tawani-header-icon">
          <IconUsers />
        </div>
        <div className="tawani-header-text">
          <h1>{t('users.title', 'Users')}</h1>
          <p>{t('users.subtitle', 'Create and manage every kind of user.')}</p>
        </div>
      </header>

      {error && <div className="tawani-notice tawani-notice-error">{error}</div>}
      {notice && <div className="tawani-notice tawani-notice-ok">{notice}</div>}

      {/* Create / edit */}
      <section className="tawani-panel">
        <h2>
          {editingSubscriberId
            ? t('users.editSubscriber', 'Edit subscriber')
            : t('users.addHeading', 'Add user')}
        </h2>

        {!editingSubscriberId && (
          <div className="tawani-segmented" role="group" style={{ marginBottom: '1rem' }}>
            {USER_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                className={`tawani-segment${type === value ? ' active' : ''}`}
                onClick={() => {
                  setType(value);
                  setError(null);
                  setNotice(null);
                }}
              >
                {typeLabel(value)}
              </button>
            ))}
          </div>
        )}

        <p className="tawani-muted" style={{ marginBottom: '1rem' }}>
          {showStaffFields
            ? t('users.staffHint', 'Signs in to this admin panel with an email and password.')
            : t(
                'users.memberHint',
                'Signs in to the portal with their National ID and a one-time code sent to their phone.'
              )}
        </p>

        <div className="subscriber-form">
          {showStaffFields ? (
            <>
              <label className="tawani-field">
                <span>{t('users.email', 'Email')}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  dir="ltr"
                  autoComplete="off"
                />
              </label>
              <label className="tawani-field">
                <span>{t('users.password', 'Password')}</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  dir="ltr"
                  autoComplete="new-password"
                />
                <small className="subscriber-hint">
                  {t('users.passwordHint', 'At least 8 characters.')}
                </small>
              </label>
            </>
          ) : (
            <>
              <label className="tawani-field">
                <span>{t('users.nationalId', 'National ID')}</span>
                <input
                  value={form.national_id}
                  onChange={(e) => setForm({ ...form, national_id: e.target.value })}
                  dir="ltr"
                  inputMode="numeric"
                />
              </label>
              <label className="tawani-field">
                <span>{t('users.nameAr', 'Full name (Arabic)')}</span>
                <input
                  value={form.full_name_ar}
                  onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })}
                  dir="rtl"
                />
              </label>
              <label className="tawani-field">
                <span>{t('users.nameEn', 'Full name (English)')}</span>
                <input
                  value={form.full_name_en}
                  onChange={(e) => setForm({ ...form, full_name_en: e.target.value })}
                  dir="ltr"
                />
              </label>
              <label className="tawani-field">
                <span>{t('users.email', 'Email')}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  dir="ltr"
                />
              </label>
              <label className="tawani-field">
                <span>{t('users.phone', 'Phone number')}</span>
                <input
                  value={form.phone_number}
                  onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  dir="ltr"
                  placeholder="+9665…"
                />
                <small className="subscriber-hint">
                  {t('users.phoneHint', 'Required to receive the login code.')}
                </small>
              </label>
            </>
          )}
        </div>

        <div className="tawani-result-actions">
          <button
            type="button"
            className="tawani-btn"
            disabled={!canSubmit || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? t('users.saving', 'Saving…')
              : editingSubscriberId
                ? t('users.saveChanges', 'Save changes')
                : t('users.create', 'Create user')}
          </button>
          {editingSubscriberId && (
            <button type="button" className="tawani-btn tawani-btn-ghost" onClick={resetForm}>
              {t('common.cancel', 'Cancel')}
            </button>
          )}
        </div>
      </section>

      {/* Everyone */}
      <section className="tawani-panel">
        <h2>{t('users.listHeading', 'All users')}</h2>

        {staffLoading && <p className="tawani-muted">{t('users.loading', 'Loading…')}</p>}

        {!staffLoading && rows.length === 0 && (
          <p className="tawani-muted">{t('users.empty', 'No users yet.')}</p>
        )}

        {rows.length > 0 && (
          <div className="tawani-table-wrap">
            <table className="tawani-table">
              <thead>
                <tr>
                  <th>{t('users.name', 'Name / Email')}</th>
                  <th>{t('users.type.label', 'Type')}</th>
                  <th>{t('users.nationalId', 'National ID')}</th>
                  <th>{t('users.status', 'Status')}</th>
                  <th aria-label={t('users.actions', 'Actions')} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{typeLabel(row.type)}</td>
                    <td dir="ltr">{row.identifier || '—'}</td>
                    <td>
                      <span className={`tawani-status${row.isActive ? ' published' : ''}`}>
                        {row.isActive
                          ? t('users.active', 'Active')
                          : t('users.inactive', 'Inactive')}
                      </span>
                    </td>
                    <td className="tawani-row-actions">
                      {row.authId && (
                        <button
                          type="button"
                          className="tawani-link-btn tawani-link-danger"
                          disabled={removeStaff.isPending}
                          onClick={() => {
                            if (window.confirm(t('users.confirmDelete', 'Delete this account?'))) {
                              removeStaff.mutate(row.authId as string);
                            }
                          }}
                        >
                          {t('users.delete', 'Delete')}
                        </button>
                      )}

                      {row.subscriber && (
                        <>
                          <button
                            type="button"
                            className="tawani-link-btn"
                            onClick={() => startEditSubscriber(row.subscriber as Subscriber)}
                          >
                            {t('users.edit', 'Edit')}
                          </button>
                          <button
                            type="button"
                            className="tawani-link-btn"
                            disabled={toggleSubscriber.isPending}
                            onClick={() =>
                              toggleSubscriber.mutate({ id: row.subscriber!.id, next: !row.isActive })
                            }
                          >
                            {row.isActive
                              ? t('users.deactivate', 'Deactivate')
                              : t('users.activate', 'Activate')}
                          </button>
                          <button
                            type="button"
                            className="tawani-link-btn tawani-link-danger"
                            disabled={removeSubscriber.isPending}
                            onClick={() => {
                              if (window.confirm(t('users.confirmDelete', 'Delete this account?'))) {
                                removeSubscriber.mutate(row.subscriber!.id);
                              }
                            }}
                          >
                            {t('users.delete', 'Delete')}
                          </button>
                        </>
                      )}

                      {row.type === 'shareholder' && (
                        // A shareholder's record carries shares, transactions,
                        // dividends and certificates -- edited on its own screen.
                        <span className="tawani-muted">
                          {t('users.manageInStockholders', 'Manage in Stockholders')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
