import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface PrivacyNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyNoticeModal: React.FC<PrivacyNoticeModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-notice-title"
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id="privacy-notice-title" className="text-2xl font-semibold text-slate-900">
              {t('privacy.title')}
            </h2>
            <p className="mt-2 text-sm text-slate-500">{t('privacy.lastUpdated')}</p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>

        <div className="space-y-6 text-sm leading-7 text-slate-700">
          <section>
            <p>{t('privacy.intro')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.dataTitle')}</h3>
            <p className="mt-2">{t('privacy.dataBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.purposeTitle')}</h3>
            <p className="mt-2">{t('privacy.purposeBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.retentionTitle')}</h3>
            <p className="mt-2">{t('privacy.retentionBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.rightsTitle')}</h3>
            <p className="mt-2">{t('privacy.rightsBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.transferTitle')}</h3>
            <p className="mt-2">{t('privacy.transferBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.securityTitle')}</h3>
            <p className="mt-2">{t('privacy.securityBody')}</p>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-slate-900">{t('privacy.contactTitle')}</h3>
            <p className="mt-2">{t('privacy.contactBody')}</p>
          </section>
        </div>
      </div>
    </div>
  );
};
