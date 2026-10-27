// ─── Safe Local-to-Supabase Data Migration Script ─────────────────────────────
// Scans existing local JSON files for legitimate business records and safely
// synchronizes them into Supabase tables without deleting or overwriting live data.

const fs = require('fs');
const path = require('path');
const supabase = require('../src/connection/supabaseClient');

const DATA_DIR = path.resolve(__dirname, '../src/data');

function isTestIdentifier(str) {
  if (!str) return true;
  const s = String(str).toLowerCase();
  return (
    s.includes('test-') ||
    s.includes('three.approved') ||
    s.includes('unverified-') ||
    s.includes('demo-user') ||
    s.startsWith('00000000-0000-4000-') ||
    s.startsWith('11111111-1111-4111-')
  );
}

function isValidUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || ''));
}

async function runMigration() {
  console.log('================================================================');
  console.log('  SMARTASSETS • Safe Local-to-Supabase Business Data Migration  ');
  console.log('================================================================\n');

  // 1. Migrate Vault Balances -> profiles.balance
  const balFile = path.join(DATA_DIR, 'vaultBalances.json');
  if (fs.existsSync(balFile)) {
    try {
      const balances = JSON.parse(fs.readFileSync(balFile, 'utf8'));
      console.log(`📦 Found ${Object.keys(balances).length} entries in vaultBalances.json`);
      let migratedBalances = 0;

      for (const [userId, balance] of Object.entries(balances)) {
        if (!isValidUuid(userId) || isTestIdentifier(userId)) {
          continue;
        }
        const numBal = Number(balance) || 0;
        // Check if profile exists
        const { data: prof, error: readErr } = await supabase
          .from('profiles')
          .select('id, balance')
          .eq('id', userId)
          .maybeSingle();

        if (prof) {
          // Only update if current DB balance is 0 and local has funds
          if ((!prof.balance || Number(prof.balance) === 0) && numBal > 0) {
            const { error: upErr } = await supabase
              .from('profiles')
              .update({ balance: numBal })
              .eq('id', userId);
            if (!upErr) {
              console.log(`   ✅ Synchronized balance of R${numBal} for user ${userId}`);
              migratedBalances++;
            }
          }
        }
      }
      console.log(`   📊 Total balances safely migrated to Supabase: ${migratedBalances}\n`);
    } catch (err) {
      console.warn('   ⚠️ Error migrating balances:', err.message);
    }
  }

  // 2. Migrate Bank Accounts -> bank_accounts
  const bankFile = path.join(DATA_DIR, 'bankAccounts.json');
  if (fs.existsSync(bankFile)) {
    try {
      const banks = JSON.parse(fs.readFileSync(bankFile, 'utf8'));
      console.log(`📦 Found ${banks.length} bank records in bankAccounts.json`);
      let migratedBanks = 0;

      for (const b of banks) {
        if (!isValidUuid(b.user_id) || isTestIdentifier(b.user_id) || isTestIdentifier(b.user_email)) {
          continue;
        }
        const { error } = await supabase.from('bank_accounts').upsert({
          user_id: b.user_id,
          account_holder: b.account_holder || b.full_name || 'Account Holder',
          bank_name: b.bank_name,
          account_number: b.account_number,
          branch_code: b.branch_code,
          account_type: b.account_type || 'Cheque / Current',
          status: b.status || 'pending',
          reviewed_by: b.reviewed_by || null,
          reviewed_at: b.reviewed_at || null,
        }, { onConflict: 'id' });

        if (!error) {
          migratedBanks++;
        }
      }
      console.log(`   📊 Total real bank accounts migrated to Supabase: ${migratedBanks}\n`);
    } catch (err) {
      console.warn('   ⚠️ Error migrating bank accounts:', err.message);
    }
  }

  console.log('✅ Local-to-Supabase migration check complete.');
}

if (require.main === module) {
  runMigration().then(() => process.exit(0)).catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  });
}

module.exports = runMigration;
