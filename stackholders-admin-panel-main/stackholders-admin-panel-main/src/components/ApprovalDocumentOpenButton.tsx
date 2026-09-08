import React, { useState } from 'react';
import { getApprovalDocumentSignedUrl } from '../services/apiService';

type Props = {
  storagePath: string;
  fileName?: string | null;
  className?: string;
  label?: string;
};

export const ApprovalDocumentOpenButton: React.FC<Props> = ({
  storagePath,
  fileName,
  className = 'document-link',
  label = 'View',
}) => {
  const [busy, setBusy] = useState(false);

  const handleOpen = async () => {
    setBusy(true);
    try {
      const url = await getApprovalDocumentSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not open document');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleOpen}
      disabled={busy}
      title={fileName || 'Open document'}
    >
      {busy ? '…' : label}
    </button>
  );
};
