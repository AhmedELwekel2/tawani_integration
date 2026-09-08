/**
 * Login Component
 * Handles two-step authentication: National ID -> OTP via Twilio
 */

import React, { useState, FormEvent, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import logoUrl from '../assets/logo.png';
import './Login.css';
import { LanguageSwitcher } from './LanguageSwitcher';
import { PrivacyNoticeModal } from './PrivacyNoticeModal';
import { translateError } from '../utils/errorUtils';

import coverImage from '../assets/login-cover.jpg';

type LoginStep = 'INITIAL' | 'OTP';

export const Login: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { login, sendOtp, isLoading, isActionLoading, error } = useAuth();
  const [nationalId, setNationalId] = useState<string>('');
  const [otpCode, setOtpCode] = useState<string>('');
  const [step, setStep] = useState<LoginStep>('INITIAL');
  const [verificationHint, setVerificationHint] = useState<string>('');
  const [verifyMethod, setVerifyMethod] = useState<string>('sms');
  const [localError, setLocalError] = useState<string | null>(null);
  const [acceptedPrivacyNotice, setAcceptedPrivacyNotice] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (resendCooldown > 0) {
      timerRef.current = window.setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resendCooldown]);

  const [otpArray, setOtpArray] = useState<string[]>(new Array(6).fill(''));
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const isSubmittingRef = useRef(false);

  // Single-flight OTP submission. The code can be submitted from two places: the
  // auto-submit effect below and the form's onSubmit. The verification code is
  // single-use on the server, so two concurrent calls race — the first consumes
  // the code and signs in, the second comes back "Invalid or expired". That race
  // is what made pasting a code sometimes bounce back to the login start. The ref
  // is set synchronously, so any duplicate trigger in the same tick is dropped.
  const submitOtp = useCallback(async (code: string): Promise<void> => {
    if (isSubmittingRef.current || code.length !== 6) return;

    isSubmittingRef.current = true;
    setLocalError(null);
    try {
      await login(nationalId.trim(), code);
    } catch (err) {
      setLocalError(translateError(err instanceof Error ? err.message : t('login.errors.verificationFailed'), t));
    } finally {
      isSubmittingRef.current = false;
    }
  }, [login, nationalId, t]);

  useEffect(() => {
    const code = otpArray.join('');
    setOtpCode(code);

    if (code.length === 6 && step === 'OTP') {
      submitOtp(code);
    }
  }, [otpArray]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOtpChange = (value: string, index: number) => {
    // Only allow numbers
    const sanitizedValue = value.replace(/\D/g, '');
    if (!sanitizedValue && value !== '') return;

    if (sanitizedValue.length > 1) {
      // Handle Multi-digit input (iOS Autofill or Paste)
      const digits = sanitizedValue.slice(0, 6).split('');
      const newOtpArray = [...otpArray];
      
      digits.forEach((char, i) => {
        if (index + i < 6) {
          newOtpArray[index + i] = char;
        }
      });
      
      setOtpArray(newOtpArray);
      
      // Move focus: either to the end of the input or the last filled box
      const targetIndex = Math.min(index + digits.length, 5);
      otpRefs.current[targetIndex]?.focus();
    } else {
      // Normal single digit input
      const newOtpArray = [...otpArray];
      newOtpArray[index] = sanitizedValue;
      setOtpArray(newOtpArray);

      if (sanitizedValue && index < 5) {
        otpRefs.current[index + 1]?.focus();
      }
    }
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace' && !otpArray[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
      return;
    }
    // Keep LTR box-to-box navigation even when the page is RTL
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 5) {
      e.preventDefault();
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6).split('');
    if (pastedData.some(char => isNaN(Number(char)))) return;

    const newOtpArray = [...otpArray];
    pastedData.forEach((char, index) => {
      if (index < 6) newOtpArray[index] = char;
    });
    setOtpArray(newOtpArray);

    const nextIndex = Math.min(pastedData.length, 5);
    otpRefs.current[nextIndex]?.focus();
  };

  const handleSendOtp = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setLocalError(null);

    const trimmedId = nationalId.trim();
    if (!trimmedId) {
      setLocalError(t('login.errors.enterNationalId'));
      return;
    }

    if (!acceptedPrivacyNotice) {
      setLocalError(t('login.errors.acceptPrivacy'));
      return;
    }

    try {
      const result = await sendOtp(trimmedId, i18n.language);
      setVerificationHint(result.hint);
      setVerifyMethod(result.verify_method);
      setStep('OTP');
      setResendCooldown(60);
    } catch (err) {
      setLocalError(translateError(err instanceof Error ? err.message : t('login.errors.failedToSend'), t));
    }
  };

  const handleVerifyOtp = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setLocalError(null);

    const trimmedOtp = otpCode.trim();
    if (!trimmedOtp || trimmedOtp.length !== 6) {
      setLocalError(t('login.errors.enterCode'));
      return;
    }

    void submitOtp(trimmedOtp);
  };

  const handleResend = async (): Promise<void> => {
    if (resendCooldown > 0) return;

    setLocalError(null);
    try {
      const result = await sendOtp(nationalId.trim(), i18n.language);
      setVerificationHint(result.hint);
      setVerifyMethod(result.verify_method);
      setResendCooldown(60);
      setOtpArray(new Array(6).fill(''));
    } catch (err) {
      setLocalError(translateError(err instanceof Error ? err.message : t('login.errors.failedToResend'), t));
    }
  };

  const resetFlow = (): void => {
    setStep('INITIAL');
    setOtpCode('');
    setOtpArray(new Array(6).fill(''));
    setLocalError(null);
  };

  const displayError = localError || error;

  return (
    <div 
      className="login-container"
      style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url(${coverImage})` }}
    >
      <motion.div
        className="login-card"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div className="login-lang-bar">
          <LanguageSwitcher />
        </div>

        <div className="login-logo-container">
          <img src={logoUrl} alt="Company Logo" className="login-logo" />
        </div>

        <AnimatePresence mode="wait">
          {step === 'INITIAL' ? (
            <motion.div
              key="initial"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              <p className="login-subtitle">{t('login.subtitle')}</p>
              <form onSubmit={handleSendOtp} className="login-form">
                <div className="form-group">
                  <label htmlFor="nationalId" className="form-label">
                    {t('login.nationalIdLabel')}
                  </label>
                  <input
                    id="nationalId"
                    type="text"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder={t('login.nationalIdPlaceholder')}
                    className="form-input"
                    disabled={isLoading || isActionLoading}
                    autoComplete="off"
                    autoFocus
                  />
                </div>

                {displayError && (
                  <motion.div
                    className="error-message"
                    role="alert"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {displayError}
                  </motion.div>
                )}

                <div className="form-group login-privacy-group">
                  <label className="login-privacy-consent">
                    <input
                      type="checkbox"
                      checked={acceptedPrivacyNotice}
                      onChange={(event) => setAcceptedPrivacyNotice(event.target.checked)}
                      disabled={isLoading || isActionLoading}
                    />
                    <span>{t('login.privacyConsent')}</span>
                  </label>
                  <button
                    type="button"
                    className="login-privacy-link"
                    onClick={() => setIsPrivacyOpen(true)}
                    disabled={isLoading || isActionLoading}
                  >
                    {t('privacy.open')}
                  </button>
                </div>

                <button
                  type="submit"
                  className="login-button"
                  disabled={isLoading || isActionLoading || !nationalId.trim() || !acceptedPrivacyNotice}
                >
                  {isActionLoading ? t('login.processing') : t('login.sendCode')}
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <p className="login-subtitle">{t('login.verificationRequired')}</p>
              <div className="otp-feedback">
                {verifyMethod === 'email' 
                  ? t('login.codeSentToEmail', { email: verificationHint })
                  : t('login.codeSentToPhone', { phone: verificationHint.slice(-4) })
                }
              </div>

              <form onSubmit={handleVerifyOtp} className="login-form">
                <div className="form-group">
                  <label className="form-label">
                    {t('login.verificationCodeLabel')}
                  </label>
                  <div className="otp-input-group" dir="ltr">
                    {otpArray.map((digit, index) => (
                      <input
                        key={index}
                        ref={(el) => (otpRefs.current[index] = el)}
                        dir="ltr"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={digit}
                        onChange={(e) => handleOtpChange(e.target.value, index)}
                        onKeyDown={(e) => handleOtpKeyDown(e, index)}
                        onPaste={handleOtpPaste}
                        className={`otp-box ${digit ? 'filled' : ''}`}
                        disabled={isLoading || isActionLoading}
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        autoFocus={index === 0}
                      />
                    ))}
                  </div>
                </div>

                {displayError && (
                  <motion.div
                    className="error-message"
                    role="alert"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {displayError}
                  </motion.div>
                )}

                <button
                  type="submit"
                  className="login-button"
                  disabled={isLoading || isActionLoading || otpCode.length !== 6}
                >
                  {isActionLoading ? (
                    <span className="login-button-verifying">
                      <span className="login-spinner" />
                      {t('login.verifying')}
                    </span>
                  ) : t('login.login')}
                </button>

                <div className="resend-container">
                  <button
                    type="button"
                    className="resend-button"
                    onClick={handleResend}
                    disabled={isLoading || isActionLoading || resendCooldown > 0}
                  >
                    {resendCooldown > 0
                      ? t('login.resendCodeIn', { seconds: resendCooldown })
                      : t('login.resendCode')}
                  </button>

                  <button
                    type="button"
                    className="change-id-button"
                    onClick={resetFlow}
                    disabled={isLoading || isActionLoading}
                  >
                    {t('login.changeNationalId')}
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <footer className="login-footer">
        <a
          className="login-footer-link"
          href="/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('privacy.fullPolicy')}
        </a>
      </footer>
      <PrivacyNoticeModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </div>
  );
};
