/** Announcements: content, PDF/cover assets, publishing and notifications. */

import { supabaseClient } from '../supabaseClient';
import { logAction, AUDIT_ACTIONS } from '../auditService';

const ANNOUNCEMENT_BUCKET = 'announcement-files';
const ANNOUNCEMENT_COVER_BUCKET = 'announcement-covers';

export interface Announcement {
  id: string;
  title_ar: string;
  title_en: string;
  /** Sanitized rich-text HTML */
  body_ar: string | null;
  body_en: string | null;
  pdf_storage_path: string | null;
  pdf_file_name: string | null;
  /** Public URL of the optional cover image */
  cover_image_url: string | null;
  cover_image_path: string | null;
  is_published: boolean;
  published_at: string | null;
  notification_sent_at: string | null;
  notification_recipient_count: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields the admin form writes directly. */
export interface AnnouncementWrite {
  title_ar: string;
  title_en: string;
  body_ar: string | null;
  body_en: string | null;
}

export interface AnnouncementNotificationResult {
  sent: number;
  recipient_count: number;
  total_recipients: number;
  notification_sent_at: string;
}

export const getAnnouncements = async (): Promise<Announcement[]> => {
  const { data, error } = await supabaseClient
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data as Announcement[]) || [];
};

export const createAnnouncement = async (row: AnnouncementWrite): Promise<Announcement> => {
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { data, error } = await supabaseClient
    .from('announcements')
    .insert({ ...row, created_by: user?.id ?? null })
    .select()
    .single();

  if (error) throw new Error(error.message);
  const result = data as Announcement;
  logAction(AUDIT_ACTIONS.CREATE_ANNOUNCEMENT, 'announcements', result.id, { title_en: row.title_en });
  return result;
};

export const updateAnnouncement = async (
  id: string,
  updates: Partial<AnnouncementWrite>
): Promise<Announcement> => {
  const { data, error } = await supabaseClient
    .from('announcements')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_ANNOUNCEMENT, 'announcements', id, { fields: Object.keys(updates) });
  return data as Announcement;
};

export const setAnnouncementPublished = async (
  id: string,
  isPublished: boolean
): Promise<Announcement> => {
  const { data, error } = await supabaseClient
    .from('announcements')
    .update({
      is_published: isPublished,
      published_at: isPublished ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.PUBLISH_ANNOUNCEMENT, 'announcements', id, { is_published: isPublished });
  return data as Announcement;
};

/** Upload (or replace) the single PDF attached to an announcement. Stored in a private bucket. */
export const uploadAnnouncementPdf = async (
  announcementId: string,
  file: File,
  previousStoragePath?: string | null
): Promise<Announcement> => {
  const filePath = `${announcementId}/${Date.now()}.pdf`;

  if (previousStoragePath) {
    await supabaseClient.storage.from(ANNOUNCEMENT_BUCKET).remove([previousStoragePath]);
  }

  const { error: uploadError } = await supabaseClient.storage
    .from(ANNOUNCEMENT_BUCKET)
    .upload(filePath, file, { upsert: true, contentType: 'application/pdf' });

  if (uploadError) {
    if (uploadError.message.toLowerCase().includes('bucket not found')) {
      throw new Error("Storage bucket 'announcement-files' not found. Please create it in Supabase dashboard.");
    }
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data, error: dbError } = await supabaseClient
    .from('announcements')
    .update({ pdf_storage_path: filePath, pdf_file_name: file.name })
    .eq('id', announcementId)
    .select()
    .single();

  if (dbError) {
    await supabaseClient.storage.from(ANNOUNCEMENT_BUCKET).remove([filePath]);
    throw new Error(`Failed to save announcement file: ${dbError.message}`);
  }

  logAction(AUDIT_ACTIONS.UPLOAD_ANNOUNCEMENT_PDF, 'announcements', announcementId, { file_name: file.name });
  return data as Announcement;
};

export const removeAnnouncementPdf = async (
  announcementId: string,
  storagePath: string
): Promise<Announcement> => {
  await supabaseClient.storage.from(ANNOUNCEMENT_BUCKET).remove([storagePath]);

  const { data, error } = await supabaseClient
    .from('announcements')
    .update({ pdf_storage_path: null, pdf_file_name: null })
    .eq('id', announcementId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_ANNOUNCEMENT, 'announcements', announcementId, { removed_pdf: true });
  return data as Announcement;
};

/** Upload (or replace) the optional public cover image for an announcement. */
export const uploadAnnouncementCover = async (
  announcementId: string,
  file: File,
  previousPath?: string | null
): Promise<Announcement> => {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const filePath = `covers/${announcementId}/${Date.now()}.${ext}`;

  if (previousPath) {
    await supabaseClient.storage.from(ANNOUNCEMENT_COVER_BUCKET).remove([previousPath]);
  }

  const { error: uploadError } = await supabaseClient.storage
    .from(ANNOUNCEMENT_COVER_BUCKET)
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    if (uploadError.message.toLowerCase().includes('bucket not found')) {
      throw new Error("Storage bucket 'announcement-covers' not found. Please create it in Supabase dashboard.");
    }
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabaseClient.storage
    .from(ANNOUNCEMENT_COVER_BUCKET)
    .getPublicUrl(filePath);

  const { data, error: dbError } = await supabaseClient
    .from('announcements')
    .update({ cover_image_url: publicUrl, cover_image_path: filePath })
    .eq('id', announcementId)
    .select()
    .single();

  if (dbError) {
    await supabaseClient.storage.from(ANNOUNCEMENT_COVER_BUCKET).remove([filePath]);
    throw new Error(`Failed to save cover image: ${dbError.message}`);
  }

  logAction(AUDIT_ACTIONS.UPLOAD_ANNOUNCEMENT_COVER, 'announcements', announcementId, { file_name: file.name });
  return data as Announcement;
};

export const removeAnnouncementCover = async (
  announcementId: string,
  path: string
): Promise<Announcement> => {
  await supabaseClient.storage.from(ANNOUNCEMENT_COVER_BUCKET).remove([path]);

  const { data, error } = await supabaseClient
    .from('announcements')
    .update({ cover_image_url: null, cover_image_path: null })
    .eq('id', announcementId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.UPDATE_ANNOUNCEMENT, 'announcements', announcementId, { removed_cover: true });
  return data as Announcement;
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  const { data: existing } = await supabaseClient
    .from('announcements')
    .select('pdf_storage_path, cover_image_path')
    .eq('id', id)
    .maybeSingle();

  if (existing?.pdf_storage_path) {
    await supabaseClient.storage.from(ANNOUNCEMENT_BUCKET).remove([existing.pdf_storage_path]);
  }
  if (existing?.cover_image_path) {
    await supabaseClient.storage.from(ANNOUNCEMENT_COVER_BUCKET).remove([existing.cover_image_path]);
  }

  const { error } = await supabaseClient.from('announcements').delete().eq('id', id);
  if (error) throw new Error(error.message);
  logAction(AUDIT_ACTIONS.DELETE_ANNOUNCEMENT, 'announcements', id);
};

/** Signed URL so an admin can preview/download the (private) announcement PDF. */
export const getAnnouncementPdfSignedUrl = async (
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string> => {
  const { data, error } = await supabaseClient.storage
    .from(ANNOUNCEMENT_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'Could not create signed URL');
  }
  return data.signedUrl;
};

/**
 * Trigger the bulk email notification for a published announcement.
 * Invokes the send-announcement-notifications Edge Function with the admin's session JWT.
 */
export const sendAnnouncementNotifications = async (
  announcementId: string
): Promise<AnnouncementNotificationResult> => {
  const { data, error } = await supabaseClient.functions.invoke('send-announcement-notifications', {
    body: { announcement_id: announcementId },
  });

  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        if (body?.message) message = body.message;
      } catch {
        // keep original message
      }
    }
    throw new Error(message);
  }

  const result = data as AnnouncementNotificationResult;
  logAction(AUDIT_ACTIONS.SEND_ANNOUNCEMENT_NOTIFICATION, 'announcements', announcementId, {
    recipients: result?.recipient_count,
  });
  return result;
};
