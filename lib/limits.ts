// Tweak these numbers to match your Supabase plan.
export const MAX_UPLOAD_MB = 25;                 // largest GIF/photo a guest can upload (the SQL sets the same 25 MB on the bucket)
export const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;

export const STORAGE_LIMIT_MB = 1024;            // Supabase Free = 1 GB of file storage. Raise it if you upgrade.
export const WARN_RATIO = 0.8;                   // host alert when storage passes 80 %
export const MESSAGE_WARN = 20000;               // host alert when the database holds this many messages
export const MEDIA_FILES_WARN = 1000;            // host alert when this many GIF/photo files are stored
