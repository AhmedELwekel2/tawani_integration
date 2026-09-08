/**
 * Stock certificates. The `stock-certificates` bucket is PRIVATE -- always open
 * files through a short-lived signed URL, never a public URL.
 */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';

const CERTIFICATE_BUCKET = 'stock-certificates';

/** Recover the object path from a legacy full `file_url`. Null if it isn't one. */
const extractCertificatePath = (fileUrl: string | null | undefined): string | null => {
  if (!fileUrl) return null;
  const parts = fileUrl.split(`/${CERTIFICATE_BUCKET}/`);
  if (parts.length < 2) return null;
  return decodeURIComponent(parts[1]);
};

export interface StockCertificate {
  id: string;
  stockholder_id: string;
  transaction_id: string | null;
  /**
   * Legacy full URL, kept only so the shipped Flutter app's fallback path keeps
   * working. The bucket is private, so this URL does NOT resolve -- always go
   * through `storage_path` + a signed URL instead.
   */
  file_url: string;
  /** Object path within the private `stock-certificates` bucket. */
  storage_path: string | null;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string | null;
}

/**
 * Short-lived signed URL for opening a certificate.
 *
 * Mirrors `getApprovalDocumentSignedUrl`. Falls back to the stored `file_url`
 * only for rows predating the storage_path backfill; those URLs are public-style
 * against a private bucket and will fail, which is the honest outcome.
 */
export const getCertificateSignedUrl = async (
  certificate: Pick<StockCertificate, 'storage_path' | 'file_url'>,
  expiresInSeconds = 300
): Promise<string> => {
  if (!certificate.storage_path) {
    if (certificate.file_url) return certificate.file_url;
    throw new Error('Certificate file is unavailable');
  }

  const { data, error } = await supabaseClient.storage
    .from(CERTIFICATE_BUCKET)
    .createSignedUrl(certificate.storage_path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Could not create signed URL');
  }
  return data.signedUrl;
};

/** Get all certificates for a stockholder (one per transaction) */
export const getCertificatesByStockholderId = async (stockholderId: string): Promise<StockCertificate[]> => {
  const { data, error } = await supabaseClient
    .from('stock_certificates')
    .select('*')
    .eq('stockholder_id', stockholderId)
    .order('uploaded_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
};

/** Get one certificate by transaction id */
const getCertificateByTransactionId = async (transactionId: string): Promise<StockCertificate | null> => {
  const { data, error } = await supabaseClient
    .from('stock_certificates')
    .select('*')
    .eq('transaction_id', transactionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
};

export const uploadCertificate = async (
  stockholderId: string,
  file: File,
  adminEmail?: string,
  transactionId?: string
): Promise<StockCertificate> => {
  // 1. Upload file to storage under stockholder's folder
  const fileExt = file.name.split('.').pop();
  const filePath = `${stockholderId}/${transactionId || 'general'}_${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabaseClient.storage
    .from(CERTIFICATE_BUCKET)
    .upload(filePath, file, { upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 2. Record the object path. The bucket is private, so a getPublicUrl() value
  //    would simply not resolve; readers build a signed URL from storage_path.
  //    file_url is still populated because the shipped Flutter app falls back to
  //    it when storage_path is absent, and file_url is NOT NULL in the schema.
  const { data: { publicUrl } } = supabaseClient.storage
    .from(CERTIFICATE_BUCKET)
    .getPublicUrl(filePath);

  // 3. If this is per-transaction, delete old cert for same transaction first
  if (transactionId) {
    const existing = await getCertificateByTransactionId(transactionId);
    if (existing) {
      // delete old storage object silently
      const oldPath = existing.storage_path ?? extractCertificatePath(existing.file_url);
      if (oldPath) {
        await supabaseClient.storage.from(CERTIFICATE_BUCKET).remove([oldPath]);
      }
      await supabaseClient.from('stock_certificates').delete().eq('id', existing.id);
    }
  }

  // 4. Insert record
  const { data, error: dbError } = await supabaseClient
    .from('stock_certificates')
    .insert({
      stockholder_id: stockholderId,
      transaction_id: transactionId || null,
      file_url: publicUrl,
      storage_path: filePath,
      file_name: file.name,
      uploaded_by: adminEmail || null
    })
    .select()
    .single();

  if (dbError) {
    await supabaseClient.storage.from(CERTIFICATE_BUCKET).remove([filePath]);
    throw new Error(`Database record creation failed: ${dbError.message}`);
  }

  logAction(AUDIT_ACTIONS.UPLOAD_CERTIFICATE, 'stock_certificates', data.id, { stockholder_id: stockholderId, transaction_id: transactionId ?? null });
  return data;
};

export const deleteCertificate = async (
  certificateId: string,
  certificate: Pick<StockCertificate, 'storage_path' | 'file_url'>
): Promise<void> => {
  const filePath = certificate.storage_path ?? extractCertificatePath(certificate.file_url);
  if (!filePath) throw new Error('Invalid certificate storage path');

  const { error: storageError } = await supabaseClient.storage
    .from(CERTIFICATE_BUCKET)
    .remove([filePath]);

  if (storageError) throw new Error(`Storage deletion failed: ${storageError.message}`);

  const { error: dbError } = await supabaseClient
    .from('stock_certificates')
    .delete()
    .eq('id', certificateId);

  if (dbError) throw new Error(`Database record deletion failed: ${dbError.message}`);
  logAction(AUDIT_ACTIONS.DELETE_CERTIFICATE, 'stock_certificates', certificateId);
};
