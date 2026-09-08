import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Stockholder, stockholderDisplayName } from '../services/stockholderService';
import { motion } from 'framer-motion';
import { Mail, Phone, Calendar, PieChart, Info, Building2, User, MapPin, Globe, Wallet } from 'lucide-react';

const prefersReducedMotion = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

interface StockholderInfoProps {
  stockholder: Stockholder;
  calculatedShares?: number | null;
  calculatedValue?: number | null;
  isCalculatingShares?: boolean;
}

function Field({
  label,
  value,
  icon: Icon,
  iconClass,
  ltr = false,
}: {
  label: string;
  value: string;
  icon: typeof Mail;
  iconClass: string;
  ltr?: boolean;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0 },
      }}
      initial={prefersReducedMotion ? false : 'hidden'}
      animate={prefersReducedMotion ? false : 'show'}
      className="flex items-start space-x-4 p-5 rounded-2xl bg-white hover:bg-slate-50 hover:shadow-md transition-all border border-slate-100 text-start shadow-sm"
    >
      <div className={`p-3 rounded-xl shadow-sm border ${iconClass}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-400 font-semibold uppercase tracking-wider">{label}</p>
        <p className="text-slate-800 mt-1 font-medium break-words whitespace-pre-wrap rtl:text-right" dir={ltr ? 'ltr' : undefined}>{value || '—'}</p>
      </div>
    </motion.div>
  );
}

const StockholderInfoComponent: React.FC<StockholderInfoProps> = ({
  stockholder,
  calculatedShares,
  calculatedValue,
  isCalculatingShares = false,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-SA' : 'en-GB';

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return t('common.notProvided');
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  const formatJoined = (dateString: string | null): string => {
    if (!dateString) return t('common.notAvailable');
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat(locale).format(num);
  };

  const formatCurrency = (num: number): string => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'SAR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const display = stockholderDisplayName(stockholder, i18n.language);
  const initialsSource = stockholder.full_name_en?.trim() || stockholder.full_name_ar?.trim() || stockholder.national_id;
  const initials = initialsSource
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || stockholder.national_id.slice(0, 2);

  const nationalAddressParts = [
    stockholder.address_building && `${t('info.addressBuilding')} ${stockholder.address_building}`,
    stockholder.address_street,
    stockholder.address_district,
    stockholder.address_city,
    stockholder.address_postal_code && `${t('info.addressPostal')} ${stockholder.address_postal_code}`,
    stockholder.address_additional_number && `${t('info.addressAdditional')} ${stockholder.address_additional_number}`,
  ].filter(Boolean);

  const nationalAddress = nationalAddressParts.length > 0 ? nationalAddressParts.join(' · ') : '';

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.04 },
    },
  };

  return (
    <div className="p-10 relative">
      <div className="absolute top-0 end-0 w-64 h-64 bg-primary/5 rounded-bl-full opacity-50 pointer-events-none" />

      <div className="flex items-center space-x-6 pb-8 border-b border-slate-100 mb-8 relative z-10">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-white text-3xl font-bold shadow-xl shadow-primary/20 ring-4 ring-white"
        >
          {initials}
        </motion.div>
        <div>
          <h2 className="text-3xl font-bold text-slate-800 tracking-tight flex items-center">
            {display}
          </h2>
          <div className="flex flex-col sm:flex-row sm:items-center mt-2 space-y-2 sm:space-y-0 sm:space-x-4">
            <span className="inline-flex items-center text-slate-500 bg-slate-100 px-3 py-1 rounded-full text-sm font-medium border border-slate-200">
              <Info className="w-4 h-4 me-2 text-primary" />
              {t('info.nationalId')}:{' '}
              <span className="ms-1 font-mono text-slate-700">{stockholder.national_id}</span>
            </span>
            <span className="inline-flex items-center text-slate-500 bg-primary/10 px-3 py-1 rounded-full text-sm font-medium border border-primary/20">
              <span className="w-2 h-2 rounded-full bg-primary me-2 animate-pulse" />
              {t('info.activeMember')}
            </span>
          </div>
        </div>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10"
      >
        <Field label={t('info.fullNameAr')} value={stockholder.full_name_ar || ''} icon={User} iconClass="bg-violet-50 text-violet-700 border border-violet-100" />
        <Field label={t('info.fullNameEn')} value={stockholder.full_name_en || ''} icon={Globe} iconClass="bg-sky-50 text-sky-700 border border-sky-100" ltr />
        <Field label={t('info.email')} value={stockholder.email || ''} icon={Mail} iconClass="bg-secondary/10 text-secondary border border-secondary/20" ltr />
        <Field label={t('info.phone')} value={stockholder.phone_number || ''} icon={Phone} iconClass="bg-primary/10 text-primary border border-primary/20" ltr />
        <Field label={t('info.birthHijri')} value={stockholder.birth_date_hijri || ''} icon={Calendar} iconClass="bg-amber-50 text-amber-700 border border-amber-100" />
        <Field label={t('info.birthGregorian')} value={stockholder.birth_date_gregorian ? formatDate(stockholder.birth_date_gregorian) : ''} icon={Calendar} iconClass="bg-emerald-50 text-emerald-700 border border-emerald-100" />
        <Field label={t('info.birthPlace')} value={stockholder.birth_place || ''} icon={MapPin} iconClass="bg-rose-50 text-rose-700 border border-rose-100" />

        <motion.div
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? false : 'show'}
          className="md:col-span-2 flex items-start space-x-4 p-5 rounded-2xl bg-white hover:bg-slate-50 hover:shadow-md transition-all border border-slate-100 text-start shadow-sm"
        >
          <div className="p-3 bg-indigo-50 rounded-xl text-indigo-700 shadow-sm border border-indigo-100">
            <MapPin className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-400 font-semibold uppercase tracking-wider">{t('info.nationalAddress')}</p>
            <p className="text-slate-800 mt-2 font-medium whitespace-pre-wrap break-words">
              {nationalAddress || '—'}
            </p>
          </div>
        </motion.div>

        <Field label={t('info.joinedDate')} value={formatJoined(stockholder.created_at)} icon={Calendar} iconClass="bg-amber-50 text-amber-600 border border-amber-100" />

        <motion.div
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? false : 'show'}
          className="flex items-start space-x-4 p-5 rounded-2xl bg-gradient-to-br from-secondary to-secondary/80 text-white shadow-lg shadow-secondary/30 transform transition-transform hover:scale-[1.02] border border-secondary/20 border-t-white/20"
        >
          <div className="p-3 bg-white/20 rounded-xl text-white backdrop-blur-sm shadow-inner">
            <PieChart className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-white/90 font-semibold uppercase tracking-wider flex items-center justify-between">
              {t('info.totalShares')}
              <Building2 className="w-4 h-4 opacity-70" />
            </p>
            <div className="mt-1 flex items-baseline">
              {isCalculatingShares ? (
                <span className="text-white/70 animate-pulse text-lg font-medium">{t('common.calculating')}</span>
              ) : (
                <span className="text-3xl font-bold tracking-tight drop-shadow-md">
                  {calculatedShares !== null && calculatedShares !== undefined
                    ? formatNumber(calculatedShares)
                    : '0'}
                </span>
              )}
            </div>
            <p className="text-xs text-white/80 mt-1 opacity-80 font-medium tracking-wide">
              {t('info.sharesSource')}
            </p>
          </div>
        </motion.div>

        <motion.div
          variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
          initial={prefersReducedMotion ? false : 'hidden'}
          animate={prefersReducedMotion ? false : 'show'}
          className="flex items-start space-x-4 p-5 rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg shadow-primary/30 transform transition-transform hover:scale-[1.02] border border-primary/20 border-t-white/20"
        >
          <div className="p-3 bg-white/20 rounded-xl text-white backdrop-blur-sm shadow-inner">
            <Wallet className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-white/90 font-semibold uppercase tracking-wider flex items-center justify-between">
              {t('info.totalValue')}
              <Building2 className="w-4 h-4 opacity-70" />
            </p>
            <div className="mt-1 flex items-baseline">
              {isCalculatingShares ? (
                <span className="text-white/70 animate-pulse text-lg font-medium">{t('common.calculating')}</span>
              ) : (
                <span className="text-3xl font-bold tracking-tight drop-shadow-md">
                  {formatCurrency(calculatedValue ?? 0)}
                </span>
              )}
            </div>
            <p className="text-xs text-white/80 mt-1 opacity-80 font-medium tracking-wide">
              {t('info.valueSource')}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};

export const StockholderInfo = memo(StockholderInfoComponent);
