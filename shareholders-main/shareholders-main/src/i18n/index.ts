import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar/translation.json';
import en from './locales/en/translation.json';

const savedLang = localStorage.getItem('lang') || 'ar';

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});

export const changeLanguage = (lang: 'ar' | 'en') => {
  i18n.changeLanguage(lang);
  localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
};

// Apply direction on init
document.documentElement.lang = savedLang;
document.documentElement.dir = savedLang === 'ar' ? 'rtl' : 'ltr';

