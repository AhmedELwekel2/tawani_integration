import React, { useState, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Mail, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { submitContactForm } from '../services/contactService';
import { useAuth } from '../context/AuthContext';
import { PrivacyNoticeModal } from './PrivacyNoticeModal';
import { translateError } from '../utils/errorUtils';
import './ContactForm.css';


const ContactFormComponent: React.FC = () => {
  const { t } = useTranslation();
  const { stockholder, isAuthenticated } = useAuth();
  const [formData, setFormData] = useState({
    name: stockholder
      ? stockholder.full_name_en?.trim() || stockholder.full_name_ar?.trim() || ''
      : '',
    email: stockholder?.email || '',
    phone_number: stockholder?.phone_number || '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [acceptedPrivacyNotice, setAcceptedPrivacyNotice] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  useEffect(() => {
    if (stockholder) {
      setFormData(prev => ({
        ...prev,
        name:
          stockholder.full_name_en?.trim() ||
          stockholder.full_name_ar?.trim() ||
          prev.name ||
          '',
        email: stockholder.email || prev.email || '',
        phone_number: stockholder.phone_number || prev.phone_number || ''
      }));
    }
  }, [stockholder]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedPrivacyNotice) {
      setStatus('error');
      setErrorMessage(t('contact.privacyConsentRequired'));
      return;
    }

    setIsSubmitting(true);
    setStatus('idle');

    try {
      const finalData = { ...formData };
      if (isAuthenticated && stockholder) {
        finalData.name =
          stockholder.full_name_en?.trim() ||
          stockholder.full_name_ar?.trim() ||
          formData.name;
        finalData.email = stockholder.email || formData.email;
        finalData.phone_number = stockholder.phone_number || formData.phone_number;
      }

      await submitContactForm(finalData);
      setStatus('success');
      setFormData(prev => ({
        ...prev,
        subject: '',
        message: ''
      }));
    } catch (err) {
      setStatus('error');
      setErrorMessage(translateError(err instanceof Error ? err.message : t('contact.errorFallback'), t));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center p-12 text-center space-y-4"
      >
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-10 h-10 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">{t('contact.successTitle')}</h2>
        <p className="text-slate-500 max-w-md">
          {t('contact.successDesc')}
        </p>
        <Button
          onClick={() => setStatus('idle')}
          variant="outline"
          className="mt-6"
        >
          {t('contact.sendAnother')}
        </Button>
      </motion.div>
    );
  }

  return (
    <Card className="border-none bg-transparent shadow-none ring-0">
      <CardHeader className="px-0 pt-0 pb-6">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Mail className="w-5 h-5" />
          </div>
          <CardTitle className="text-2xl">{t('contact.title')}</CardTitle>
        </div>
        <CardDescription className="text-base">
          {t('contact.desc')}
        </CardDescription>
      </CardHeader>

      <CardContent className="px-0">
        <form onSubmit={handleSubmit} className="space-y-6">
          {!isAuthenticated && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label htmlFor="name" className="text-sm font-medium text-slate-700 ms-1">{t('contact.fullName')}</label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder={t('contact.fullNamePlaceholder')}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-slate-700 ms-1">{t('contact.emailAddress')}</label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder={t('contact.emailPlaceholder')}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="phone_number" className="text-sm font-medium text-slate-700 ms-1">{t('contact.phoneNumber')}</label>
                <input
                  id="phone_number"
                  name="phone_number"
                  type="tel"
                  dir="ltr"
                  value={formData.phone_number}
                  onChange={handleChange}
                  placeholder={t('contact.phonePlaceholder')}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <label htmlFor="subject" className="text-sm font-medium text-slate-700 ms-1">{t('contact.subject')}</label>
            <input
              id="subject"
              name="subject"
              type="text"
              required
              value={formData.subject}
              onChange={handleChange}
              placeholder={t('contact.subjectPlaceholder')}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="message" className="text-sm font-medium text-slate-700 ms-1">{t('contact.message')}</label>
            <textarea
              id="message"
              name="message"
              required
              rows={5}
              value={formData.message}
              onChange={handleChange}
              placeholder={t('contact.messagePlaceholder')}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none"
            />
          </div>

          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-rose-50 border border-rose-100 flex items-center space-x-3 text-rose-700"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm font-medium">{errorMessage}</p>
            </motion.div>
          )}

          <div className="space-y-3 rounded-xl border border-slate-200 bg-white/60 p-4">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={acceptedPrivacyNotice}
                onChange={(event) => setAcceptedPrivacyNotice(event.target.checked)}
                className="mt-1"
              />
              <span>{t('contact.privacyConsent')}</span>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPrivacyOpen(true)}
            >
              {t('privacy.open')}
            </Button>
          </div>

          <Button
            type="submit"
            disabled={isSubmitting || !acceptedPrivacyNotice}
            className="w-full py-6 text-lg bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all active:scale-[0.98]"
          >
            {isSubmitting ? (
              <span className="flex items-center">
                <svg className="animate-spin -ms-1 me-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {t('contact.sending')}
              </span>
            ) : (
              <span className="flex items-center">
                <Send className="me-2 w-5 h-5" /> {t('contact.send')}
              </span>
            )}
          </Button>
        </form>
      </CardContent>
      <PrivacyNoticeModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </Card>
  );
};

export const ContactForm = memo(ContactFormComponent);
