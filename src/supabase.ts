import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
}

// Service role key bypasses RLS entirely — this worker is trusted backend code,
// never expose this key to the browser/frontend.
export const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
  realtime: {
    transport: ws as any,
  },
});
