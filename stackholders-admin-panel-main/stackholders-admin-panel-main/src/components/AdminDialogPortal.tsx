import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Renders dialog markup on document.body so fixed overlays sit above the sidebar
 * (sidebar uses z-index; overlays inside main were trapped below it).
 */
export function AdminDialogPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
