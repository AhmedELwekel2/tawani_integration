import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Stockholder, stockholderDisplayName } from '../services/apiService';
import './StockholderSelect.css';

interface StockholderSelectProps {
  stockholders: Pick<Stockholder, 'id' | 'full_name_en' | 'full_name_ar' | 'national_id'>[];
  selectedId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}

const StockholderSelect: React.FC<StockholderSelectProps> = ({
  stockholders,
  selectedId,
  onChange,
  disabled,
  placeholder,
  required,
}) => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedStockholder = useMemo(
    () => stockholders.find((s) => s.id === selectedId),
    [stockholders, selectedId]
  );

  const filteredOptions = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return stockholders;
    return stockholders.filter((opt) => {
      const nameAr = (opt.full_name_ar || '').toLowerCase();
      const nameEn = (opt.full_name_en || '').toLowerCase();
      const nid = (opt.national_id || '').toLowerCase();
      return nameAr.includes(s) || nameEn.includes(s) || nid.includes(s);
    });
  }, [stockholders, search]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearch('');
  };

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div 
      className={`stockholder-select-container ${isOpen ? 'open' : ''}`} 
      ref={containerRef}
    >
      <button
        type="button"
        className="stockholder-select-trigger"
        onClick={toggleDropdown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={!selectedStockholder ? 'stockholder-select-placeholder' : ''}>
          {selectedStockholder
            ? stockholderDisplayName(selectedStockholder, i18n.language)
            : placeholder || t('transactions.modal.selectStockholder')}
        </span>
        <span className="stockholder-select-arrow">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 2 6 6 10 2" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="stockholder-select-dropdown">
          <div className="stockholder-select-search">
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t('transactions.modal.searchStockholderPlaceholder') || t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="stockholder-select-options">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((stockholder) => (
                <button
                  key={stockholder.id}
                  type="button"
                  className={`stockholder-select-option ${stockholder.id === selectedId ? 'selected' : ''}`}
                  onClick={() => handleSelect(stockholder.id)}
                >
                  <span className="stockholder-name">
                    {stockholderDisplayName(stockholder, i18n.language)}
                  </span>
                  {stockholder.national_id && (
                    <span className="stockholder-info">
                      ID: {stockholder.national_id}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="stockholder-select-no-results">
                {t('common.noResults')}
              </div>
            )}
          </div>
        </div>
      )}
      {required && (
        <input
          type="hidden"
          value={selectedId}
          required
        />
      )}
    </div>
  );
};

export default StockholderSelect;
