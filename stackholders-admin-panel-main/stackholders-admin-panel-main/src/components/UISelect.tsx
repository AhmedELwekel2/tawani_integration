import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './UISelect.css';

interface Option {
  value: string;
  label: string;
}

interface UISelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const UISelect: React.FC<UISelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  disabled
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div 
      className={`ui-select-container ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''}`} 
      ref={containerRef}
    >
      <button
        type="button"
        className="ui-select-trigger"
        onClick={toggleDropdown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={!selectedOption ? 'ui-select-placeholder' : ''}>
          {selectedOption ? selectedOption.label : placeholder || t('common.select')}
        </span>
        <span className="ui-select-arrow">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2 2 6 6 10 2" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <ul className="ui-select-dropdown" role="listbox">
          {options.map((option) => (
            <li 
              key={option.value}
              className={`ui-select-option ${option.value === value ? 'selected' : ''}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default UISelect;
