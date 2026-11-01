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

// Startup sanity check: the shared client MUST be service_role for backend writes.
try {
  const payload = JSON.parse(Buffer.from(supabaseServiceKey.split('.')[1], 'base64').toString());
  if (payload.role === 'service_role') {
    console.log('🔑 [SupabaseClient] Shared backend client initialized with role: "service_role"');
  } else {
    console.error(`🚨 [SupabaseClient] SUPABASE_SERVICE_ROLE_KEY has role "${payload.role}", expected "service_role". Escrow/vault writes will fail.`);
  }
} catch (_) {}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: require('ws'),
  },
});

const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ? normalizeJwt(process.env.SUPABASE_ANON_KEY) : null;

const supabaseAnon = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        transport: require('ws'),
      },
    })
  : supabase;

supabase.supabaseAnon = supabaseAnon;

/**
 * Returns a brand-new, disposable client for user-facing auth calls
 * (signInWithPassword, verifyOtp, ...). supabase-js keeps the signed-in user's session
 * in memory on the client that made the call, so running these on the shared
 * service_role client would silently downgrade ALL later backend queries to the
 * 'authenticated' role (-> "permission denied for table escrow_orders").
 */
supabase.createAuthClient = function createAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

module.exports = supabase;
