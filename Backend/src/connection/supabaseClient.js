// ─── Supabase Client (Server-Side) ───────────────────────────────────────────
// Uses the SERVICE_ROLE key for admin-level operations (creating users, etc.)
// This client bypasses Row Level Security — use only on the backend.

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

function normalizeJwt(token) {
  if (!token) return token;
  const clean = token.trim();
  const parts = clean.split('.');
  // If only 2 parts (payload.signature), prepend standard HS256 JWT header
  if (parts.length === 2) {
    return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${clean}`;
  }
  return clean;
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceKey = normalizeJwt(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    '❌ Missing Supabase environment variables.\n' +
    '   Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the root .env file.\n' +
    '   Find them at: Supabase Dashboard → Project Settings → API'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: require('ws'),
  },
});

module.exports = supabase;
