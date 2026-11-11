// Supabase project. The anon key is public by design: all data is protected by
// Row Level Security (see supabase/schema.sql), and the AI key lives only in the
// Edge Function secrets (see supabase/functions/ai/index.ts).
export const SUPABASE_URL = "https://atnjolykwqgzouqvorfe.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0bmpvbHlrd3Fnem91cXZvcmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDM3MTUsImV4cCI6MjA5Nzk3OTcxNX0.7xA6LCJ--DfDgiatWijyMAs_TtfKcpc8TxVj6vZImSY";
export const AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ai`;
