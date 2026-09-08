import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface RichTextContentProps {
  html: string;
  dir?: 'rtl' | 'ltr';
  className?: string;
}

/**
 * Renders admin-authored rich-text HTML. Sanitized with DOMPurify on render
 * (defense in depth — the admin also sanitizes on write).
 */
export const RichTextContent: React.FC<RichTextContentProps> = ({ html, dir = 'ltr', className }) => {
  const clean = useMemo(
    () => DOMPurify.sanitize(html || '', { USE_PROFILES: { html: true } }),
    [html],
  );

  return (
    <div
      dir={dir}
      className={className ? `announcement-body ${className}` : 'announcement-body'}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
};

export default RichTextContent;
