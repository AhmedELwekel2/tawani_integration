import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCountryCallingCode, Country } from 'react-phone-number-input';
import { useTranslation } from 'react-i18next';

interface CountryOption {
  value: string;
  label: string;
}

interface CountrySelectProps {
  name?: string;
  value?: string;
  onChange: (value: string) => void;
  options: CountryOption[];
  disabled?: boolean;
  className?: string;
  iconComponent: React.ComponentType<{ country: string }>;
}

const CountrySelectWithSearch: React.FC<CountrySelectProps> = ({
  value,
  onChange,
  options,
  disabled,
  className,
  iconComponent: Icon,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 320 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return options;
    return options.filter((opt) => {
      if (!opt.value) return false;
      const countryName = opt.label.toLowerCase();
      let callingCode = '';
      try {
        callingCode = getCountryCallingCode(opt.value as Country);
      } catch {
        // Some options might not be real countries
      }
      return countryName.includes(s) || callingCode.includes(s);
    });
  }, [options, search]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 6,
      left: rect.left,
      width: 340,
    });
  };

  const handleOpen = () => {
    if (disabled) return;
    updatePosition();
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleScroll = () => updatePosition();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const handleSelect = (country: string) => {
    onChange(country);
    setIsOpen(false);
    setSearch('');
  };

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="country-select-dropdown"
      style={{
        position: 'fixed',
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
        zIndex: 99999,
      }}
    >
      <div className="country-select-search">
        <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          autoFocus
          type="text"
          placeholder={t('common.searchCountry')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="country-select-options">
        {filteredOptions.length > 0 ? (
          filteredOptions.map((opt: CountryOption) => (
            <button
              key={opt.value}
              type="button"
              className={`country-select-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              <Icon country={opt.value} />
              <span className="country-name">{opt.label}</span>
              {opt.value && (
                <span className="calling-code">
                  +{getCountryCallingCode(opt.value as Country)}
                </span>
              )}
            </button>
          ))
        ) : (
          <div className="no-results">{t('common.noCountriesFound')}</div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={`country-select-container ${className || ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="country-select-trigger"
        onClick={handleOpen}
        disabled={disabled}
      >
        {value && <Icon country={value} />}
        <span className="country-select-arrow">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1L5 5L9 1" />
          </svg>
        </span>
      </button>

      {typeof document !== 'undefined' && createPortal(dropdown, document.body)}
    </div>
  );
};

export default CountrySelectWithSearch;
