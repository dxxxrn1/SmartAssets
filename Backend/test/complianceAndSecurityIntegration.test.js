// ─── SmartAssets Compliance, KYC Gatekeeper & Security Integration Tests ─────────
const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DATA_DIR = path.resolve(__dirname, '../src/data');
const KYC_UPLOADS_DIR = path.resolve(__dirname, '../uploads/kyc');
const SNAPSHOT_FILES = [
  'kycVerifications.json',
  'verificationDocuments.json',
  'bankAccounts.json',
  'userStatus.json',
  'auditLogs.json',
  'supportTickets.json',
];

const snapshots = {};
SNAPSHOT_FILES.forEach((f) => {
  const fullPath = path.join(DATA_DIR, f);
  if (fs.existsSync(fullPath)) {
    snapshots[fullPath] = fs.readFileSync(fullPath, 'utf8');
  }
});

const complianceService = require('../src/services/complianceService');
const auditLogService = require('../src/services/auditLogService');
const supportService = require('../src/services/supportService');

async function runTests() {
  console.log('\n🚀 Starting SmartAssets Compliance, 3-Doc KYC & Bank Approval Suite...\n');
  let generatedDossierId = null;

  try {
    // TEST 1: Compliance Service Initial Queue & Seeding
    console.log('🧪 [TEST 1] Verifying Pre-seeded KYC Compliance Dossiers...');
    const verifications = complianceService.getAllVerifications();
    assert(Array.isArray(verifications), 'Verifications should be an array');
    assert(verifications.length >= 3, 'Should have at least 3 pre-seeded dossiers');
    const first = verifications[0];
    assert(first.id, 'Dossier must have an id');
    assert(first.bankingDetails, 'Dossier must contain bankingDetails');
    assert(first.idDocumentUrl.includes('/uploads/kyc/'), 'Dossier must reference authentic KYC SVG document');
    console.log(`   ✅ Pre-seeded queue active with ${verifications.length} dossiers.`);

    // TEST 2: KYC Submission Cycle
    console.log('🧪 [TEST 2] Testing User KYC Submission...');
    const testUserId = 'usr-verify-' + Date.now();
    const testEmail = 'verify.collector@smartassets.io';
    const submitResult = complianceService.submitKyc({
      userId: testUserId,
      userEmail: testEmail,
      fullName: 'Verification Collector',
      idNumber: '9501015009081',
      idDocumentUrl: null,
      taxNumber: '9182736450',
      taxDocumentUrl: null,
      residentialAddress: '100 Sandton Dr, Sandton, 2196',
      proofOfResidenceUrl: null,
      bankingDetails: {
        bankName: 'FNB',
        accountHolder: 'Verification Collector',
        accountNumber: '62899182736',
        branchCode: '250655',
      },
    });
    generatedDossierId = submitResult.id;

    assert(submitResult.id, 'Submission must generate a dossier ID');
    assert.strictEqual(submitResult.kycStatus, 'pending', 'KYC status must be pending');
    assert(submitResult.idDocumentUrl.includes('/uploads/kyc/'), 'Submission must generate SA ID SVG');
    console.log(`   ✅ KYC submitted successfully: Dossier ID ${submitResult.id} (Status: ${submitResult.kycStatus})`);

    // Verify compliance state lookup
    let userComp = complianceService.getUserCompliance(testUserId, testEmail);
    assert.strictEqual(userComp.kycStatus, 'pending', 'User compliance status must be pending');
    assert.strictEqual(userComp.isSuspended, false, 'User must not be suspended by default');

    // TEST 3: Admin Approval Workflow
    console.log('🧪 [TEST 3] Testing Admin KYC Approval Workflow...');
    const approved = complianceService.approveKyc(submitResult.id, 'FICA verified by compliance officer');
    assert.strictEqual(approved.kycStatus, 'verified', 'Dossier should now be verified');
    assert(approved.reviewedAt, 'reviewedAt timestamp must be recorded');
    userComp = complianceService.getUserCompliance(testUserId, testEmail);
    assert.strictEqual(userComp.kycStatus, 'verified', 'User state must immediately flip to verified');
    console.log(`   ✅ KYC Dossier approved and user status flipped to "${userComp.kycStatus}".`);

    // TEST 4: Admin Rejection Workflow
    console.log('🧪 [TEST 4] Testing Admin KYC Rejection Workflow...');
    const rejected = complianceService.rejectKyc(submitResult.id, 'Utility bill older than 90 days');
    assert.strictEqual(rejected.kycStatus, 'rejected', 'Dossier should now be rejected');
    assert.strictEqual(rejected.rejectionReason, 'Utility bill older than 90 days');
    userComp = complianceService.getUserCompliance(testUserId, testEmail);
    assert.strictEqual(userComp.kycStatus, 'rejected', 'User state must reflect rejection');
    console.log(`   ✅ KYC Dossier rejected with reason: "${rejected.rejectionReason}".`);

    // Re-approve for downstream tests
    complianceService.approveKyc(submitResult.id, 'Re-approved after resubmission');

    // TEST 5: User Suspension & Reactivation Lock
    console.log('🧪 [TEST 5] Testing Compliance Suspension & Reactivation...');
    const suspended = complianceService.setUserSuspension(testUserId, true, 'Suspicious fraud investigation');
    assert.strictEqual(suspended.accountStatus, 'suspended');
    assert.strictEqual(suspended.isSuspended, true);
    userComp = complianceService.getUserCompliance(testUserId, testEmail);
    assert.strictEqual(userComp.isSuspended, true, 'User compliance must report suspended');
    console.log(`   ✅ User account suspended: isSuspended = ${userComp.isSuspended}`);

    const reactivated = complianceService.setUserSuspension(testUserId, false);
    assert.strictEqual(reactivated.accountStatus, 'active');
    assert.strictEqual(reactivated.isSuspended, false);
    userComp = complianceService.getUserCompliance(testUserId, testEmail);
    assert.strictEqual(userComp.isSuspended, false, 'User compliance must report active');
    console.log(`   ✅ User account reactivated: isSuspended = ${userComp.isSuspended}`);

    // TEST 6: Granular 3-Document Verification Workflow (id, tax, proof_of_residence)
    console.log('🧪 [TEST 6] Testing Granular 3-Document Upload, Rejection & Full Verification...');
    const threeDocUserId = 'usr-3doc-' + Date.now();
    const threeDocEmail = 'threedoc.collector@smartassets.io';

    const idDoc = await complianceService.uploadVerificationDocument({
      userId: threeDocUserId,
      userEmail: threeDocEmail,
      fullName: 'Three Doc Collector',
      docType: 'id',
      fileData: '/uploads/kyc/KYC_ZA_884210_id.svg',
      fileName: 'sa_id_card.jpg',
      mimeType: 'image/jpeg',
    });
    const taxDoc = await complianceService.uploadVerificationDocument({
      userId: threeDocUserId,
      userEmail: threeDocEmail,
      fullName: 'Three Doc Collector',
      docType: 'tax',
      fileData: '/uploads/kyc/KYC_ZA_884210_tax.svg',
      fileName: 'sars_tax_cert.pdf',
      mimeType: 'application/pdf',
    });
    const residenceDoc = await complianceService.uploadVerificationDocument({
      userId: threeDocUserId,
      userEmail: threeDocEmail,
      fullName: 'Three Doc Collector',
      docType: 'proof_of_residence',
      fileData: '/uploads/kyc/KYC_ZA_884210_residence.svg',
      fileName: 'municipal_bill.pdf',
      mimeType: 'application/pdf',
    });

    assert.strictEqual(idDoc.document.status, 'pending');
    assert.strictEqual(taxDoc.document.status, 'pending');
    assert.strictEqual(residenceDoc.document.status, 'pending');

    // Approve ID and Tax, Reject Proof of Residence -> overall status should be 'rejected'
    await complianceService.approveDocument(idDoc.document.id, 'admin-1');
    await complianceService.approveDocument(taxDoc.document.id, 'admin-1');
    const rejRes = await complianceService.rejectDocument(
      residenceDoc.document.id,
      'Address does not match profile',
      'admin-1'
    );

    assert.strictEqual(rejRes.verification_status, 'rejected', 'Overall status must be rejected if any of the 3 docs is rejected');

    // Re-upload Proof of Residence -> status should flip back to 'pending'
    const reuploadedResDoc = await complianceService.uploadVerificationDocument({
      userId: threeDocUserId,
      userEmail: threeDocEmail,
      fullName: 'Three Doc Collector',
      docType: 'proof_of_residence',
      fileData: '/uploads/kyc/KYC_ZA_884210_residence.svg',
      fileName: 'municipal_bill_updated.pdf',
      mimeType: 'application/pdf',
    });
    assert.strictEqual(reuploadedResDoc.document.status, 'pending');
    assert.strictEqual(reuploadedResDoc.document.rejection_reason, null);
    assert.strictEqual(reuploadedResDoc.verification_status, 'pending', 'Overall status must be pending when 2 approved + 1 pending');

    // Approve 3rd document -> overall status must flip to 'verified'
    const finalApproved = await complianceService.approveDocument(reuploadedResDoc.document.id, 'admin-1');
    assert.strictEqual(finalApproved.verification_status, 'verified', 'Overall status must be verified when all 3 docs are approved');
    console.log(`   ✅ 3-Document KYC lifecycle verified: pending -> rejected -> re-uploaded -> verified.`);

    // TEST 7: Separate Bank Account Submission, Masking & Admin Approval
    console.log('🧪 [TEST 7] Testing Bank Account Submission, Masking & Approval Rule...');
    const bankRecord = await complianceService.submitBankAccount({
      userId: threeDocUserId,
      userEmail: threeDocEmail,
      accountHolder: 'Three Doc Collector',
      bankName: 'Standard Bank',
      accountNumber: '10192837465',
      branchCode: '051001',
      accountType: 'cheque',
    });
    assert.strictEqual(bankRecord.status, 'pending');
    assert.strictEqual(complianceService.maskAccountNumber(bankRecord.account_number), '****7465');

    const rejectedBank = await complianceService.rejectBankAccount(bankRecord.id, 'Account holder name mismatch', 'admin-1');
    assert.strictEqual(rejectedBank.status, 'rejected');
    assert.strictEqual(rejectedBank.rejection_reason, 'Account holder name mismatch');

    const approvedBank = await complianceService.approveBankAccount(bankRecord.id, 'admin-1');
    assert.strictEqual(approvedBank.status, 'approved');
    assert.strictEqual(approvedBank.rejection_reason, null);
    console.log(`   ✅ Bank account lifecycle verified: masked (${complianceService.maskAccountNumber(bankRecord.account_number)}) -> rejected -> approved.`);

    // TEST 8: Audit Log Recording & Retrieval
    console.log('🧪 [TEST 8] Testing Security & Auth Audit Log Ledger...');
    const loginLog = auditLogService.logEvent({
      eventType: 'LOGIN',
      actorEmail: testEmail,
      actorId: testUserId,
      ip: '197.89.201.14',
      device: 'Mobile (iOS 17.5 / Expo Native)',
      description: 'Successful user authentication via password.',
    });
    assert(loginLog.id, 'Audit log must have ID');
    assert.strictEqual(loginLog.eventType, 'LOGIN');

    const timeoutLog = auditLogService.logEvent({
      eventType: 'SESSION_TIMEOUT',
      actorEmail: testEmail,
      actorId: testUserId,
      ip: '197.89.201.14',
      device: 'Mobile (iOS 17.5 / Expo Native)',
      description: '5-minute inactivity session timeout triggered.',
      status: 'Session Expired',
    });
    assert.strictEqual(timeoutLog.eventType, 'SESSION_TIMEOUT');

    const allLogs = auditLogService.getAllLogs();
    assert(allLogs.length >= 2, 'Audit logs must contain recorded events');
    const foundTimeout = allLogs.some((l) => l.eventType === 'SESSION_TIMEOUT');
    assert(foundTimeout, 'SESSION_TIMEOUT event must exist in audit log');
    console.log(`   ✅ Audit ledger active with ${allLogs.length} events logged.`);

    // TEST 9: Customer Support Desk Resolution Notes
    console.log('🧪 [TEST 9] Testing Support Resolution Desk & Admin Notes...');
    const ticket = supportService.createTicket({
      userId: testUserId,
      userEmail: testEmail,
      userName: 'Verification Collector',
      category: 'Escrow & Payments',
      subject: 'Deposit inquiry',
      message: 'Can I deposit via Standard Bank EFT?',
      priority: 'Normal',
    });
    assert(ticket.id, 'Support ticket must have ID');
    assert.strictEqual(ticket.status, 'Open');

    const updatedTicket = supportService.updateTicketStatus(
      ticket.id,
      'Resolved',
      'EFT transfers from Standard Bank are accepted and settled instantly.'
    );
    assert.strictEqual(updatedTicket.status, 'Resolved');
    assert(updatedTicket.resolutionNote, 'Resolution note must be saved');
    assert(updatedTicket.adminResponse, 'Admin response must be saved');
    console.log(`   ✅ Support ticket ${ticket.id} marked Resolved with Admin Response.`);

    console.log('\n🎉 ALL 9 COMPLIANCE, 3-DOC KYC, BANK APPROVAL & SECURITY TESTS PASSED PERFECTLY!\n');
  } finally {
    // Restore original JSON snapshots so test runs never pollute live data stores
    Object.entries(snapshots).forEach(([filePath, content]) => {
      try {
        fs.writeFileSync(filePath, content, 'utf8');
      } catch (_) {}
    });
    if (generatedDossierId) {
      const safeId = String(generatedDossierId).replace(/[^a-zA-Z0-9_-]/g, '_');
      ['_id.svg', '_tax.svg', '_residence.svg'].forEach((suffix) => {
        try {
          const p = path.join(KYC_UPLOADS_DIR, safeId + suffix);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
      });
    }
  }
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
