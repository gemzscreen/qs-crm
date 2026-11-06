// QS CRM — connection settings. Fill these once, then upload this file next to index.html.
// The anon key is meant to be public: the data is protected by sign-in and row-level security in the database.
// NEVER put the secret / service_role key here (it goes only into the Apps Script file service, setSupabase()).
window.QSCRM_CONFIG = {
  supabaseUrl: 'https://pasqkzohnecptbhzznxm.supabase.co/rest/v1/',   // Supabase › Connect (or Project Settings › Data API) › Project URL, e.g. https://abcdefgh.supabase.co
  supabaseKey: 'sb_publishable_i7DPeYESDvYNJMqzXoXqVg_PSUka53m',   // Supabase › Project Settings › API Keys › publishable key (sb_publishable_…)
  driveUrl: 'https://script.google.com/macros/s/AKfycbzkUuRlfjvVLqI48Rd0-4rpYqYGzgc3Trgq7-_XkoEusWP43RAHPC6Bz8-ZzihInspIGQ/exec'       // Apps Script file service › Deploy › Web app URL (ends with /exec)
};
