import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  X,
} from 'lucide-react';

// Worker is loaded from the same pdfjs-dist version react-pdf depends on
// (deduped in package.json), so the API and worker versions always match.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  fileUrl: string;
  fileName?: string | null;
  onClose: () => void;
}

const iconBtn =
  'p-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

export const PdfViewer: React.FC<PdfViewerProps> = ({ fileUrl, fileName, onClose }) => {
  const { t } = useTranslation();
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [baseWidth, setBaseWidth] = useState(600);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setBaseWidth(Math.min(containerRef.current.clientWidth - 32, 900));
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLoadSuccess = useCallback((doc: { numPages: number }) => {
    setNumPages(doc.numPages);
    setPageNumber(1);
    setLoadError(false);
  }, []);

  const goPrev = () => setPageNumber((p) => Math.max(1, p - 1));
  const goNext = () => setPageNumber((p) => Math.min(numPages || 1, p + 1));
  const zoomIn = () => setScale((s) => Math.min(2.5, +(s + 0.25).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));

  return (
    <div
      className="fixed inset-0 z-[1100] bg-slate-900/70 backdrop-blur-sm flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 p-3 bg-white shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate font-medium text-slate-700 min-w-0">
          {fileName || t('announcements.viewer.title')}
        </span>
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button onClick={goPrev} disabled={pageNumber <= 1} className={iconBtn} title={t('announcements.viewer.prev')}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm text-slate-600 whitespace-nowrap">
            {t('announcements.viewer.page', { page: pageNumber, total: numPages || 1 })}
          </span>
          <button
            onClick={goNext}
            disabled={pageNumber >= (numPages || 1)}
            className={iconBtn}
            title={t('announcements.viewer.next')}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <span className="w-px h-6 bg-slate-200 mx-1" />
          <button onClick={zoomOut} className={iconBtn} title={t('announcements.viewer.zoomOut')}>
            <ZoomOut className="w-5 h-5" />
          </button>
          <button onClick={zoomIn} className={iconBtn} title={t('announcements.viewer.zoomIn')}>
            <ZoomIn className="w-5 h-5" />
          </button>
          <a
            href={fileUrl}
            download={fileName || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={iconBtn}
            title={t('announcements.download')}
          >
            <Download className="w-5 h-5" />
          </a>
          <button onClick={onClose} className={iconBtn} title={t('announcements.viewer.close')}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Document */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4 flex justify-center" onClick={(e) => e.stopPropagation()}>
        <Document
          file={fileUrl}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={() => setLoadError(true)}
          loading={
            <div className="flex items-center gap-2 text-white pt-10">
              <Loader2 className="w-6 h-6 animate-spin" /> {t('announcements.viewer.loadingPdf')}
            </div>
          }
          error={
            <div className="flex items-center gap-2 text-white pt-10">
              <AlertCircle className="w-6 h-6" /> {t('announcements.viewer.pdfError')}
            </div>
          }
        >
          {!loadError && (
            <Page
              pageNumber={pageNumber}
              width={baseWidth * scale}
              className="shadow-2xl bg-white"
            />
          )}
        </Document>
      </div>
    </div>
  );
};

export default PdfViewer;
