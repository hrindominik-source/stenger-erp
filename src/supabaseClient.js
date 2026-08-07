import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Chyba VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Skopirujte .env.example do .env.local a doplnte udaje z vasho Supabase projektu."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
