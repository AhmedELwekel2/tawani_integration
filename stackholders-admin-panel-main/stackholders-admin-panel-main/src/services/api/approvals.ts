/**
 * Transaction approval documents. Private bucket + admin-only table; opened via
 * short-lived signed URLs.
 */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';

const APPROVAL_BUCKET = 'approval-documents';

/** Signed URL for admins to open a private approval document */
export const getApprovalDocumentSignedUrl = async (
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> => {
  const { data, error } = await supabaseClient.storage
    .from(APPROVAL_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Could not create signed URL');
  }
  return data.signedUrl;
};

/** Upload an approval document for a transaction (admin-only table + private bucket) */
export const uploadApprovalDocument = async (
  stockholderId: string,
  transactionId: string,
  file: File
): Promise<{ storagePath: string; name: string }> => {
  const fileExt = file.name.split('.').pop();
  const filePath = `${stockholderId}/${transactionId}_${Date.now()}.${fileExt}`;

  const { data: existing } = await supabaseClient
    .from('stockholder_transaction_approvals')
    .select('storage_path')
    .eq('transaction_id', transactionId)
    .maybeSingle();

  if (existing?.storage_path) {
    await supabaseClient.storage.from(APPROVAL_BUCKET).remove([existing.storage_path]);
  }

  const { error: uploadError } = await supabaseClient.storage
    .from(APPROVAL_BUCKET)
    .upload(filePath, file, { upsert: true });

  if (uploadError) {
    if (uploadError.message.toLowerCase().includes('bucket not found')) {
      throw new Error("Storage bucket 'approval-documents' not found. Please create it in Supabase dashboard.");
    }
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { error: dbError } = await supabaseClient
    .from('stockholder_transaction_approvals')
    .upsert(
      {
        transaction_id: transactionId,
        storage_path: filePath,
        file_name: file.name,
      },
      { onConflict: 'transaction_id' }
    );

  if (dbError) {
    await supabaseClient.storage.from(APPROVAL_BUCKET).remove([filePath]);
    throw new Error(`Failed to save approval document: ${dbError.message}`);
  }

  logAction(AUDIT_ACTIONS.UPLOAD_APPROVAL_DOC, 'stockholder_transaction_approvals', transactionId, { file_name: file.name });
  return { storagePath: filePath, name: file.name };
};

export const deleteApprovalDocument = async (transactionId: string, storagePath: string): Promise<void> => {
  const { error: storageError } = await supabaseClient.storage
    .from(APPROVAL_BUCKET)
    .remove([storagePath]);

  if (storageError) throw new Error(`Storage deletion failed: ${storageError.message}`);

  const { error: dbError } = await supabaseClient
    .from('stockholder_transaction_approvals')
    .delete()
    .eq('transaction_id', transactionId);

  if (dbError) throw new Error(`Database record deletion failed: ${dbError.message}`);
};
