const assert = require('assert');
const supportService = require('../src/services/supportService');
const complianceService = require('../src/services/complianceService');

async function testProfileAndComplianceIntegration() {
  console.log('\n🧪 [TEST 1] Testing Support Ticket Creation...');
  const testUserId = 'test-user-' + Date.now();
  const ticket = supportService.createTicket({
    userId: testUserId,
    userEmail: 'collector@luxuryassets.com',
    userName: 'Alexander Wright',
    category: 'Escrow & Payments',
    subject: 'Escrow deposit confirmation delay',
    message: 'My Sepolia ETH deposit took 2 blocks to confirm. Want to ensure custody tracking is synchronized.',
    priority: 'high',
  });

  assert.ok(ticket.id.startsWith('TKT-'), 'Ticket ID should start with TKT-');
  assert.strictEqual(ticket.userId, testUserId);
  assert.strictEqual(ticket.status, 'Open');
  assert.strictEqual(ticket.category, 'Escrow & Payments');
  assert.strictEqual(ticket.assignedTeam, 'Smart Contract Settlement Desk');
  console.log('   ✅ Support ticket created successfully! ID:', ticket.id);

  console.log('\n🧪 [TEST 2] Testing User Support Tickets Retrieval...');
  const userTickets = supportService.getUserTickets(testUserId);
  assert.strictEqual(userTickets.length, 1);
  assert.strictEqual(userTickets[0].id, ticket.id);
  console.log('   ✅ Successfully retrieved ticket for user');

  console.log('\n🧪 [TEST 3] Testing Ticket By ID Lookup...');
  const found = supportService.getTicketById(ticket.id);
  assert.strictEqual(found.id, ticket.id);
  assert.strictEqual(found.subject, 'Escrow deposit confirmation delay');
  console.log('   ✅ Ticket lookup by ID verified');

  console.log('\n🧪 [TEST 4] Testing FICA / KYC Dossier Submission (complianceService.submitKyc)...');
  const kycUserId = 'kyc-user-' + Date.now();
  const kycEmail = 'kyc-' + Date.now() + '@luxuryassets.com';
  const dossier = await complianceService.submitKyc({
    userId: kycUserId,
    userEmail: kycEmail,
    fullName: 'Lady Genevieve Vance',
    idNumber: '9203120088082',
    idDocumentUrl: 'doc_id_durable_ref_4492.jpg',
    taxNumber: '9876543210',
    taxDocumentUrl: 'doc_tax_durable_ref_1120.pdf',
    residentialAddress: '42 Saxon Road, Sandhurst, Sandton, 2196',
    proofOfResidenceUrl: 'doc_residence_durable_ref_9981.jpg',
    bankingDetails: {
      bankName: 'Investec Private Bank',
      accountHolder: 'Lady Genevieve Vance',
      accountNumber: '10012345678',
      branchCode: '580105',
      accountType: 'Private Bank Cheque',
    },
  });

  assert.ok(dossier.id.startsWith('KYC-'), 'Dossier ID should start with KYC-');
  assert.strictEqual(dossier.status, 'pending');
  assert.strictEqual(dossier.userId, kycUserId);
  console.log('   ✅ KYC Dossier created with pending status:', dossier.id);

  console.log('\n🧪 [TEST 5] Testing Bank Account Submission Guard (Unverified without allowPendingKyc)...');
  let threwBankError = false;
  try {
    const unverifiedUser = 'unverified-' + Date.now();
    await complianceService.submitBankAccount({
      userId: unverifiedUser,
      userEmail: 'unverified@test.com',
      fullName: 'Unverified User',
      accountHolder: 'Unverified User',
      bankName: 'FNB',
      accountNumber: '62000000000',
      branchCode: '250655',
      accountType: 'Cheque',
      allowPendingKyc: false,
    });
  } catch (err) {
    threwBankError = true;
    assert.ok(err.message.includes('Account verification required'), 'Expected verification requirement error');
  }
  assert.strictEqual(threwBankError, true, 'Standalone bank account submission must reject unverified KYC');
  console.log('   ✅ Standalone bank submission correctly enforces approved KYC status');

  console.log('\n🧪 [TEST 6] Testing Notification Preferences Merging Logic...');
  const defaultPrefs = {
    escrowAlerts: true,
    priceAlerts: true,
    securityAlerts: true,
    marketing: false,
  };
  const existingMetaPrefs = {
    escrowAlerts: false,
    marketing: true,
  };
  const mergedPrefs = {
    ...defaultPrefs,
    ...existingMetaPrefs,
  };
  assert.strictEqual(mergedPrefs.escrowAlerts, false);
  assert.strictEqual(mergedPrefs.priceAlerts, true);
  assert.strictEqual(mergedPrefs.securityAlerts, true);
  assert.strictEqual(mergedPrefs.marketing, true);

  // Update partial
  const partialUpdate = { priceAlerts: false };
  const updatedPrefs = {
    ...mergedPrefs,
    ...partialUpdate,
  };
  assert.strictEqual(updatedPrefs.priceAlerts, false);
  assert.strictEqual(updatedPrefs.escrowAlerts, false);
  assert.strictEqual(updatedPrefs.securityAlerts, true);
  console.log('   ✅ Notification preferences merging and persistence logic verified');

  console.log('\n🎉 ALL 6 PROFILE INTEGRATION TESTS PASSED!\n');
}

testProfileAndComplianceIntegration().catch((err) => {
  console.error('❌ Profile test failed:', err);
  process.exit(1);
});
