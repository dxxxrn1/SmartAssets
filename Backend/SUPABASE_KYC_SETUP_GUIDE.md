# SmartAssets — Account Verification (KYC) & Bank Approval Setup Guide

This guide covers setting up the database tables, Row-Level Security (RLS) policies, private storage bucket, and promoting your first admin user in Supabase for the **SmartAssets** KYC & Bank Account Approval system.

---

## Step 1: Run the SQL Migration in Supabase

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and select your **SmartAssets** project.
2. Navigate to **SQL Editor** in the left sidebar and click **New query**.
3. Open [`Backend/supabase_migrations/20261025_kyc_and_bank_verification.sql`](./supabase_migrations/20261025_kyc_and_bank_verification.sql), copy the entire SQL script, and paste it into the Supabase SQL Editor.
4. Click **Run** (`Ctrl + Enter`).

### What this migration creates:
- **`public.profiles` extensions:**
  - `role` (`'user' | 'admin'`, default `'user'`)
  - `verification_status` (`'unverified' | 'pending' | 'verified' | 'rejected'`, default `'unverified'`)
- **`public.verification_documents` table:**
  - Stores individual document submissions (`doc_type` in `'id'`, `'tax'`, `'proof_of_residence'`).
  - Unique constraint on `(user_id, doc_type)` so re-uploading a rejected document cleanly replaces/updates that slot.
  - Database trigger (`trg_sync_profile_verification_status`) that automatically recomputes `profiles.verification_status` whenever a document is uploaded, approved, or rejected:
    - All 3 documents (`id`, `tax`, `proof_of_residence`) `'approved'` -> `'verified'`
    - Any document `'rejected'` -> `'rejected'`
    - Any document uploaded -> `'pending'`
    - No documents uploaded -> `'unverified'`
- **`public.bank_accounts` table:**
  - Stores user payout bank details (`account_holder`, `bank_name`, `account_number`, `branch_code`, `account_type`, `status`, `rejection_reason`, `reviewed_by`, `reviewed_at`).
- **Row-Level Security (RLS):**
  - Users can only view and insert/update their own `verification_documents` and `bank_accounts`.
  - Users cannot set `status = 'approved'` or escalate their own `role`.
  - Admins (`profiles.role = 'admin'`) can view and review all rows.

---

## Step 2: Verify or Create the Private Storage Bucket (`verification-docs`)

The SQL migration automatically creates the private `verification-docs` bucket in `storage.buckets` and attaches storage RLS policies. To verify or create it manually via the UI:

1. In your Supabase Dashboard, go to **Storage** in the left sidebar.
2. Confirm that a bucket named **`verification-docs`** exists and has **Public** set to **Off (Private)**.
3. If creating manually:
   - Click **New bucket**
   - Name: `verification-docs`
   - **Public bucket**: **OFF** (keep it private)
   - **File size limit**: `10 MB`
   - **Allowed MIME types**: `image/jpeg, image/png, image/webp, application/pdf`
4. Files are stored under the path convention:
   ```text
   {user_id}/{doc_type}/{filename}
   ```
   - Users can only upload/read files inside their own `{user_id}/...` folder.
   - Admins (`profiles.role = 'admin'`) can read all folders and generate temporary signed preview URLs.

---

## Step 3: Promote Your First Admin User

By default, every registered user receives `role = 'user'`. Regular users who attempt to sign in at the Admin Web App (`/admin/login.html`) will be blocked with **"Access denied"**.

To promote an existing user account to an **Admin**, run the following SQL snippet in the **Supabase SQL Editor**:

```sql
-- Option A: Promote by Email Address
UPDATE public.profiles
SET role = 'admin',
    updated_at = NOW()
WHERE email = 'admin@smartassets.co.za';

-- Option B: Promote by Supabase Auth User UUID
UPDATE public.profiles
SET role = 'admin',
    updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000000';
```

> **Tip:** If the user exists in `auth.users` but doesn't have a row in `public.profiles` yet, run:
> ```sql
> INSERT INTO public.profiles (id, email, full_name, role, verification_status)
> SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', email), 'admin', 'verified'
> FROM auth.users
> WHERE email = 'admin@smartassets.co.za'
> ON CONFLICT (id) DO UPDATE SET role = 'admin', updated_at = NOW();
> ```

---

## Step 4: Configure Backend Environment Variables

Ensure your `Backend/.env` file includes your Supabase project credentials and a strong `ADMIN_JWT_SECRET`:

```env
PORT=5000
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Strong HMAC-SHA256 secret (minimum 32 characters / 256 bits) for signing administrator session tokens.
# Generate via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# NEVER use default values or reuse the Supabase service-role key.
ADMIN_JWT_SECRET=your-random-32-plus-char-secret
```

> **Security Note on Administrator Authentication:**
> SmartAssets enforces strict server-side RBAC. Built-in default passwords, hardcoded credentials, and email allowlists are strictly disabled. Administrators authenticate exclusively via Supabase Auth and must have `profiles.role = 'admin'` in the database. If `ADMIN_JWT_SECRET` is missing or fewer than 32 characters, administrator authentication will fail closed with HTTP 503.

---

## Step 5: Using the Admin Web App & Mobile App

### Admin Web Portal
1. Start the backend server:
   ```bash
   cd Backend
   npm start
   ```
2. Open the Admin Login page at:
   - `http://localhost:5000/admin/login.html` (or via Live Server at `http://127.0.0.1:5500/Backend/public/admin/login.html`)
3. Sign in with an account where `profiles.role = 'admin'`.
4. Use the sidebar tabs:
   - **KYC & FICA Queue**: View users with pending documents, preview each of the 3 documents (`id`, `tax`, `proof_of_residence`), and click **Approve** or **Reject** (with a required rejection reason) on each individual document. When all 3 documents for a user are approved, their account automatically flips to **`verified`**.
   - **Bank Accounts**: View pending bank accounts (account numbers are masked as `****1234` in the table; click **Inspect & Review** to view the full account number, branch code, and holder name in the modal), and click **Approve Bank Account** or **Reject Bank Account**.

### Mobile App (Expo / React Native)
1. Unverified users can register, log in (including with MetaMask), browse the marketplace, and view their profile as usual.
2. A persistent **"Complete your verification"** banner appears on the **Home** and **Profile** screens until `verification_status === 'verified'`.
3. Attempting to **List an Item**, **Deposit Funds**, or **Withdraw Funds** while unverified opens the gatekeeper modal with a direct button to **Verify Your Account** (`VerifyAccountScreen`) or **Bank Details** (`BankDetailsScreen`).
