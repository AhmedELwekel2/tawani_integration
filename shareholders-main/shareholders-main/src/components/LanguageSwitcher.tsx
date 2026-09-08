import React from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language;

  return (
    <div className="lang-switcher">
      <button
        type="button"
        className={`lang-btn${currentLang === 'ar' ? ' lang-btn--active' : ''}`}
        onClick={() => changeLanguage('ar')}
        aria-label={t('language.arabic')}
      >
        {t('language.arabic')}
      </button>
      <span className="lang-divider" aria-hidden>
        |
      </span>
      <button
        type="button"
        className={`lang-btn${currentLang === 'en' ? ' lang-btn--active' : ''}`}
        onClick={() => changeLanguage('en')}
        aria-label={t('language.english')}
      >
        {t('language.english')}
      </button>
    </div>
  );
};
