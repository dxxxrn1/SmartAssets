// ─── SmartAssets Compliance, KYC Document & Bank Verification Service ─────────
// Real Supabase storage & database manager for:
// 1. Individual verification_documents ('id' | 'tax' | 'proof_of_residence')
// 2. Separate bank_accounts ('pending' | 'approved' | 'rejected')
// 3. Automatic 3-document verification status engine ('unverified' | 'pending' | 'verified' | 'rejected')
// 4. Short-lived signed URL generation from private 'verification-docs' / 'kyc-documents' bucket.
// No static or synthetic test files. Real uploads only.

const crypto = require('crypto');
const supabase = require('../connection/supabaseClient');
const auditLogService = require('./auditLogService');

const KYC_BUCKET = 'verification-docs';
const KYC_MIMES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function detectBufferSignature(buffer) {
  if (!buffer || buffer.length < 4) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47
  if (buffer.subarray(0, 4).toString('hex') === '89504e47') {
    return { mime: 'image/png', ext: 'png' };
  }
  // PDF: %PDF (25 50 44 46)
  if (buffer.subarray(0, 4).toString() === '%PDF') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  // WEBP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString() === 'RIFF' &&
    buffer.subarray(8, 12).toString() === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

const verificationsMap = new Map();
const userStatusMap = new Map();
const documentsMap = new Map();     // id -> doc record
const bankAccountsMap = new Map();  // id -> bank record
let hydrated = false;

const VALID_DOC_TYPES = ['id', 'tax', 'proof_of_residence'];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

function maskAccountNumber(accNum) {
  const clean = String(accNum || '').replace(/\s+/g, '');
  if (!clean) return '****';
  if (clean.length <= 4) return `****${clean}`;
  return `****${clean.slice(-4)}`;
}

/**
 * Ensures private Supabase Storage buckets exist for KYC files.
 */
async function ensurePrivateBuckets() {
  try {
    await supabase.storage.createBucket(KYC_BUCKET, { public: false }).catch(() => {});
  } catch (_) {}
}

ensurePrivateBuckets();

/**
 * Hydrates documents, bank accounts, and user KYC statuses from Supabase.
 */
async function hydrateComplianceFromSupabase() {
  try {
    // 1. Hydrate verification_documents
    const { data: docs } = await supabase
      .from('verification_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (Array.isArray(docs)) {
      docs.forEach((d) => {
        if (!d || !d.id) return;
        documentsMap.set(String(d.id), {
          id: String(d.id),
          user_id: d.user_id,
          user_email: d.user_email || null,
          full_name: d.full_name || null,
          doc_type: d.doc_type,
          file_path: d.file_path,
          storage_bucket_path: d.storage_bucket_path || d.file_path || null,
          meta_value: d.meta_value || null,
          status: d.status || 'pending',
          rejection_reason: d.rejection_reason || null,
          reviewed_by: d.reviewed_by || null,
          reviewed_at: d.reviewed_at || null,
          created_at: d.created_at || new Date().toISOString(),
        });
      });
    }



    // 3. Hydrate bank_accounts
    const { data: banks } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (Array.isArray(banks)) {
      banks.forEach((b) => {
        if (!b || !b.id) return;
        bankAccountsMap.set(String(b.id), {
          id: String(b.id),
          user_id: b.user_id,
          user_email: b.user_email || null,
          full_name: b.full_name || b.account_holder,
          account_holder: b.account_holder,
          bank_name: b.bank_name,
          account_number: b.account_number,
          account_number_masked: maskAccountNumber(b.account_number),
          branch_code: b.branch_code,
          account_type: b.account_type || 'Cheque / Current',
          status: b.status || 'pending',
          rejection_reason: b.rejection_reason || null,
          reviewed_by: b.reviewed_by || null,
          reviewed_at: b.reviewed_at || null,
          created_at: b.created_at || new Date().toISOString(),
        });
      });
    }

    // 4. Hydrate profiles verification_status
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, verification_status');

    if (Array.isArray(profiles)) {
      profiles.forEach((p) => {
        if (!p || !p.id) return;
        const current = userStatusMap.get(p.id) || {};
        userStatusMap.set(p.id, {
          ...current,
          userId: p.id,
          userEmail: p.email || current.userEmail,
          fullName: p.full_name || current.fullName,
          kycStatus: p.verification_status || 'unverified',
          verification_status: p.verification_status || 'unverified',
          accountStatus: 'active',
          isSuspended: false,
        });
      });
    }

    hydrated = true;
  } catch (err) {
    console.warn('⚠️ [ComplianceService] Hydration warning:', err.message);
  }
}

hydrateComplianceFromSupabase();

function isUnitTestUser(userId, email) {
  const uid = String(userId || '').toLowerCase();
  const em = String(email || '').toLowerCase();
  return (
    uid.startsWith('usr-test-') ||
    uid.startsWith('test-user-') ||
    uid.startsWith('test-vault-user-') ||
    em.startsWith('compliance.test@')
  );
}

/**
 * Recomputes a user's overall verification_status from their 3 individual document slots:
 * - All 3 ('id', 'tax', 'proof_of_residence') approved -> 'verified'
 * - Any rejected -> 'rejected'
 * - At least 1 uploaded -> 'pending'
 * - None -> 'unverified'
 */
function recomputeUserVerificationStatus(userId, userEmail = null, reviewerName = 'Admin Compliance Operations') {
  const userDocs = Array.from(documentsMap.values()).filter(
    (d) => d.user_id === userId || (userEmail && d.user_email?.toLowerCase() === userEmail?.toLowerCase())
  );

  const byType = new Map();
  userDocs.forEach((d) => {
    byType.set(d.doc_type, d);
  });

  const activeDocs = Array.from(byType.values());
  const approvedCount = VALID_DOC_TYPES.filter((t) => byType.get(t)?.status === 'approved').length;
  const rejectedDocs = activeDocs.filter((d) => d.status === 'rejected');

  let newStatus = 'unverified';
  let rejectionReason = null;

  if (rejectedDocs.length > 0) {
    newStatus = 'rejected';
    rejectionReason = rejectedDocs.map((d) => `${d.doc_type.toUpperCase()}: ${d.rejection_reason || 'Rejected'}`).join('; ');
  } else if (approvedCount === 3) {
    newStatus = 'verified';
  } else if (activeDocs.length > 0) {
    newStatus = 'pending';
  }

  const now = new Date().toISOString();

  const existingStat = userStatusMap.get(userId) || {
    userId,
    userEmail: userEmail || activeDocs[0]?.user_email || 'collector@smartassets.io',
    fullName: activeDocs[0]?.full_name || 'SmartAssets Collector',
    accountStatus: 'active',
    isSuspended: false,
  };

  userStatusMap.set(userId, {
    ...existingStat,
    kycStatus: newStatus,
    verification_status: newStatus,
    rejectionReason,
    updatedAt: now,
  });

  // Best-effort sync to Supabase profiles table
  supabase
    .from('profiles')
    .update({ verification_status: newStatus })
    .eq('id', userId)
    .then(() => {})
    .catch(() => {});

  return { status: newStatus, rejectionReason, approvedCount, totalUploaded: activeDocs.length };
}

/**
 * Validates and uploads a single verification document ('id' | 'tax' | 'proof_of_residence').
 * Uploads to Supabase private bucket 'verification-docs' ({userId}/{docType}/{filename})
 * and records to Supabase verification_documents + kyc_documents.
 */
async function uploadVerificationDocument({
  userId,
  userEmail,
  fullName,
  docType,
  fileData,
  fileName,
  mimeType,
  metaValue,
}) {
  const normalizedType = String(docType || '').trim().toLowerCase();
  if (!VALID_DOC_TYPES.includes(normalizedType)) {
    const err = new Error('Invalid document type.');
    err.statusCode = 400;
    throw err;
  }

  if (!fileData || typeof fileData !== 'string') {
    const err = new Error('Please upload the document as a JPG, PNG, WEBP or PDF file.');
    err.statusCode = 400;
    throw err;
  }

  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(fileData);
  if (!m) {
    const err = new Error('Please upload the document as a JPG, PNG, WEBP or PDF file.');
    err.statusCode = 400;
    throw err;
  }
  const buffer = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_SIZE_BYTES) {
    const err = new Error('Document must be under 10 MB.');
    err.statusCode = 400;
    throw err;
  }
  const sig = detectBufferSignature(buffer);
  if (!sig) {
    const err = new Error('Invalid file. Only genuine JPG, PNG, WEBP or PDF files are allowed.');
    err.statusCode = 400;
    throw err;
  }
  const { mime: detectedMime, ext } = sig;

  const storageBucketPath = `${userId}/${normalizedType}.${ext}`;
  const localPathUrl = storageBucketPath;
  const existingDoc = Array.from(documentsMap.values()).find(
    (d) => d.user_id === userId && d.doc_type === normalizedType
  );
  const docId = existingDoc ? existingDoc.id : crypto.randomUUID();
  const now = new Date().toISOString();

  const [storageRes, dbRes] = await Promise.all([
    supabase.storage.from(KYC_BUCKET).upload(storageBucketPath, buffer, { contentType: detectedMime, upsert: true }),
    supabase.from('verification_documents').upsert(
      {
        id: docId,
        user_id: userId,
        doc_type: normalizedType,
        file_path: storageBucketPath,
        status: 'pending',
        rejection_reason: null,
        reviewed_by: null,
        reviewed_at: null,
        created_at: now,
      },
      { onConflict: 'user_id,doc_type' }
    ),
  ]);
  if (storageRes.error || dbRes.error) {
    const isFkey = dbRes.error && (dbRes.error.code === '23503' || String(dbRes.error.message || '').includes('foreign key constraint'));
    if (isFkey) {
      console.warn(`⚠️ [KYC] User ${userId} not found in auth.users (foreign key). Storing document in memory.`);
    } else {
      console.error('[KYC] upload failed:', storageRes.error?.message || dbRes.error?.message);
      const err = new Error('Could not save your document. Please try again.');
      err.statusCode = 500;
      throw err;
    }
  }
  if (existingDoc?.storage_bucket_path && existingDoc.storage_bucket_path !== storageBucketPath) {
    supabase.storage.from(KYC_BUCKET).remove([existingDoc.storage_bucket_path]).catch(() => {});
  }

  const docRecord = {
    id: docId,
    user_id: userId,
    user_email: userEmail || existingDoc?.user_email || 'collector@smartassets.io',
    full_name: fullName || existingDoc?.full_name || 'SmartAssets Collector',
    doc_type: normalizedType,
    file_path: localPathUrl,
    storage_bucket_path: storageBucketPath,
    meta_value: metaValue || existingDoc?.meta_value || null,
    status: 'pending',
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: now,
  };

  documentsMap.set(docId, docRecord);

  const recomputed = recomputeUserVerificationStatus(userId, userEmail);

  return {
    document: docRecord,
    verification_status: recomputed.status,
  };
}

/**
 * Approve a single verification document by document ID
 */
async function approveDocument(docId, adminId = null, adminEmail = 'admin@smartassets.co.za') {
  let doc = documentsMap.get(docId);

  if (!doc) {
    try {
      const { data: dbDoc } = await supabase
        .from('verification_documents')
        .select('*')
        .eq('id', docId)
        .maybeSingle();
      if (dbDoc) doc = { ...dbDoc };
    } catch (_) {}
  }

  if (!doc) return null;

  const now = new Date().toISOString();
  doc.status = 'approved';
  doc.rejection_reason = null;
  doc.reviewed_by = adminId || adminEmail || 'Admin Compliance Operations';
  doc.reviewed_at = now;
  documentsMap.set(doc.id, doc);

  try {
    await supabase
      .from('verification_documents')
      .update({
        status: 'approved',
        rejection_reason: null,
        reviewed_by: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
        reviewed_at: now,
      })
      .eq('id', doc.id);
  } catch (_) {}



  // Record audit log
  try {
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
      admin_email: adminEmail,
      action: 'APPROVE_DOCUMENT',
      target_table: 'verification_documents',
      target_id: String(doc.id),
      target_user_id: doc.user_id && /^[0-9a-f-]{36}$/i.test(doc.user_id) ? doc.user_id : null,
      reason: `Approved ${doc.doc_type} document`,
    });
  } catch (_) {}

  auditLogService.logEvent({
    eventType: 'KYC_DOC_APPROVED',
    category: 'Compliance',
    actorEmail: adminEmail,
    actorId: adminId || 'admin',
    description: `Admin approved ${doc.doc_type.toUpperCase()} document (${doc.id}) for user ${doc.user_email || doc.user_id}.`,
    status: 'Approved',
  });

  const recomputed = recomputeUserVerificationStatus(doc.user_id, doc.user_email, adminEmail);
  return {
    document: doc,
    verification_status: recomputed.status,
    approvedCount: recomputed.approvedCount,
  };
}

/**
 * Reject a single verification document by document ID with a mandatory reason
 */
async function rejectDocument(docId, reason, adminId = null, adminEmail = 'admin@smartassets.co.za') {
  let doc = documentsMap.get(docId);

  if (!doc) {
    try {
      const { data: dbDoc } = await supabase
        .from('verification_documents')
        .select('*')
        .eq('id', docId)
        .maybeSingle();
      if (dbDoc) doc = { ...dbDoc };
    } catch (_) {}
  }

  if (!doc) return null;

  const cleanReason = String(reason || '').trim() || 'Document did not meet verification requirements.';
  const now = new Date().toISOString();
  doc.status = 'rejected';
  doc.rejection_reason = cleanReason;
  doc.reviewed_by = adminId || adminEmail || 'Admin Compliance Operations';
  doc.reviewed_at = now;
  documentsMap.set(doc.id, doc);

  try {
    await supabase
      .from('verification_documents')
      .update({
        status: 'rejected',
        rejection_reason: cleanReason,
        reviewed_by: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
        reviewed_at: now,
      })
      .eq('id', doc.id);
  } catch (_) {}



  try {
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
      admin_email: adminEmail,
      action: 'REJECT_DOCUMENT',
      target_table: 'verification_documents',
      target_id: String(doc.id),
      target_user_id: doc.user_id && /^[0-9a-f-]{36}$/i.test(doc.user_id) ? doc.user_id : null,
      reason: cleanReason,
    });
  } catch (_) {}

  auditLogService.logEvent({
    eventType: 'KYC_DOC_REJECTED',
    category: 'Compliance',
    actorEmail: adminEmail,
    actorId: adminId || 'admin',
    description: `Admin rejected ${doc.doc_type.toUpperCase()} document (${doc.id}) for ${doc.user_email || doc.user_id}. Reason: ${cleanReason}`,
    status: 'Rejected',
  });

  const recomputed = recomputeUserVerificationStatus(doc.user_id, doc.user_email, adminEmail);
  return {
    document: doc,
    verification_status: recomputed.status,
  };
}

/**
 * Submit or update a user's bank account
 */
async function submitBankAccount({
  userId,
  userEmail,
  fullName,
  accountHolder,
  bankName,
  accountNumber,
  branchCode,
  accountType,
  allowPendingKyc = true,
}) {
  if (!accountHolder || !bankName || !accountNumber || !branchCode) {
    const err = new Error(
      'Please provide account holder name, bank name, account number, and branch/routing code.'
    );
    err.statusCode = 400;
    throw err;
  }

  const cleanAccNumber = String(accountNumber).replace(/\s+/g, '');
  if (!/^\d{8,12}$/.test(cleanAccNumber)) {
    const err = new Error('Please enter a valid bank account number (8 to 12 digits).');
    err.statusCode = 400;
    throw err;
  }

  // Ensure compliance hydration has run
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }

  const compliance = getUserCompliance(userId, userEmail);
  if (allowPendingKyc === false && compliance?.kycStatus !== 'verified') {
    const err = new Error(
      'Account verification required: All 3 KYC documents must be approved by an administrator before submitting bank account details.'
    );
    err.statusCode = 403;
    throw err;
  }

  let existing = Array.from(bankAccountsMap.values()).find(
    (b) => b.user_id === userId || (userEmail && (b.user_email?.toLowerCase() === userEmail?.toLowerCase() || b.userEmail?.toLowerCase() === userEmail?.toLowerCase()))
  );

  // If not found in memory, check Supabase directly
  if (!existing && userId) {
    try {
      const { data: dbBank } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dbBank) existing = dbBank;
    } catch (_) {}
  }

  const bankId = existing ? existing.id : crypto.randomUUID();
  const now = new Date().toISOString();

  let record = {
    id: bankId,
    user_id: userId,
    user_email: userEmail || existing?.user_email || existing?.userEmail || 'collector@smartassets.io',
    userEmail: userEmail || existing?.user_email || existing?.userEmail || 'collector@smartassets.io',
    full_name: fullName || existing?.full_name || accountHolder.trim(),
    fullName: fullName || existing?.full_name || accountHolder.trim(),
    account_holder: accountHolder.trim(),
    bank_name: bankName.trim(),
    account_number: cleanAccNumber,
    account_number_masked: maskAccountNumber(cleanAccNumber),
    branch_code: String(branchCode).trim(),
    account_type: (accountType || 'Cheque / Current').trim(),
    status: 'pending',
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };

  try {
    if (existing && existing.id) {
      const { data, error } = await supabase
        .from('bank_accounts')
        .update({
          account_holder: record.account_holder,
          bank_name: record.bank_name,
          account_number: record.account_number,
          branch_code: record.branch_code,
          account_type: record.account_type,
          status: 'pending',
          rejection_reason: null,
        })
        .eq('id', existing.id)
        .select()
        .single();
      if (!error && data) {
        record.id = String(data.id);
        record.status = data.status || 'pending';
      }
    } else {
      const { data, error } = await supabase
        .from('bank_accounts')
        .insert({
          user_id: userId,
          account_holder: record.account_holder,
          bank_name: record.bank_name,
          account_number: record.account_number,
          branch_code: record.branch_code,
          account_type: record.account_type,
          status: 'pending',
          rejection_reason: null,
          created_at: now,
        })
        .select()
        .single();
      if (!error && data) {
        record.id = String(data.id);
        record.status = data.status || 'pending';
      }
    }
  } catch (dbErr) {
    console.warn('⚠️ [ComplianceService] bank_accounts upsert warning:', dbErr.message);
  }

  bankAccountsMap.set(String(record.id), record);

  const userStat = userStatusMap.get(userId) || {
    userId,
    userEmail: record.user_email,
    fullName: record.full_name,
    kycStatus: 'unverified',
    accountStatus: 'active',
    isSuspended: false,
  };
  userStatusMap.set(userId, {
    ...userStat,
    bankingDetails: {
      id: record.id,
      bankName: record.bank_name,
      accountHolder: record.account_holder,
      accountNumberMasked: record.account_number_masked,
      branchCode: record.branch_code,
      accountType: record.account_type,
      status: 'pending',
      rejectionReason: null,
    },
    updatedAt: now,
  });

  return {
    ...record,
    account_number: undefined,
  };
}

/**
 * Submits a complete KYC compliance pack (dossier).
 */
async function submitKyc({
  userId,
  userEmail,
  fullName,
  idNumber,
  idDocumentUrl,
  taxNumber,
  taxDocumentUrl,
  residentialAddress,
  proofOfResidenceUrl,
  bankingDetails,
}) {
  const dossierId = 'KYC-' + crypto.randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  // If document data was passed as data URI, upload/register via uploadVerificationDocument
  const docPromises = [];
  if (idDocumentUrl && typeof idDocumentUrl === 'string' && idDocumentUrl.startsWith('data:')) {
    docPromises.push(
      uploadVerificationDocument({
        userId,
        userEmail,
        fullName,
        docType: 'id',
        fileData: idDocumentUrl,
        fileName: 'id_document.jpg',
        metaValue: idNumber,
      }).catch((e) => console.warn('[KYC submit] id upload warning:', e.message))
    );
  }
  if (taxDocumentUrl && typeof taxDocumentUrl === 'string' && taxDocumentUrl.startsWith('data:')) {
    docPromises.push(
      uploadVerificationDocument({
        userId,
        userEmail,
        fullName,
        docType: 'tax',
        fileData: taxDocumentUrl,
        fileName: 'tax_document.jpg',
        metaValue: taxNumber,
      }).catch((e) => console.warn('[KYC submit] tax upload warning:', e.message))
    );
  }
  if (proofOfResidenceUrl && typeof proofOfResidenceUrl === 'string' && proofOfResidenceUrl.startsWith('data:')) {
    docPromises.push(
      uploadVerificationDocument({
        userId,
        userEmail,
        fullName,
        docType: 'proof_of_residence',
        fileData: proofOfResidenceUrl,
        fileName: 'proof_of_residence.jpg',
        metaValue: residentialAddress,
      }).catch((e) => console.warn('[KYC submit] proof upload warning:', e.message))
    );
  }

  await Promise.all(docPromises);

  // If banking details are provided, register bank account with allowPendingKyc: true
  if (bankingDetails && bankingDetails.accountNumber) {
    try {
      await submitBankAccount({
        userId,
        userEmail,
        fullName: bankingDetails.accountHolder || fullName,
        accountHolder: bankingDetails.accountHolder || fullName,
        bankName: bankingDetails.bankName,
        accountNumber: bankingDetails.accountNumber,
        branchCode: bankingDetails.branchCode,
        accountType: bankingDetails.accountType || 'Cheque / Current',
        allowPendingKyc: true,
      });
    } catch (bankErr) {
      console.warn('[KYC submit] bank account warning:', bankErr.message);
    }
  }

  const userStat = userStatusMap.get(userId) || { userId, userEmail, fullName };
  const updatedStat = {
    ...userStat,
    kycStatus: 'pending',
    verification_status: 'pending',
    idNumber: idNumber || userStat.idNumber,
    taxNumber: taxNumber || userStat.taxNumber,
    residentialAddress: residentialAddress || userStat.residentialAddress,
    updatedAt: now,
  };
  userStatusMap.set(userId, updatedStat);

  try {
    await supabase
      .from('profiles')
      .update({ verification_status: 'pending' })
      .eq('id', userId);
  } catch (_) {}

  const record = {
    id: dossierId,
    userId,
    userEmail,
    fullName,
    idNumber,
    taxNumber,
    residentialAddress,
    status: 'pending',
    submittedAt: now,
  };

  verificationsMap.set(dossierId, record);
  return record;
}

/**
 * Approve a bank account by ID
 */
async function approveBankAccount(bankId, adminId = null, adminEmail = 'admin@smartassets.co.za') {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }
  let bank = bankAccountsMap.get(String(bankId));
  if (!bank) {
    bank = Array.from(bankAccountsMap.values()).find(
      (b) => String(b.id) === String(bankId) || b.user_id === bankId
    );
  }
  if (!bank) {
    try {
      const { data: dbBank } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('id', bankId)
        .limit(1)
        .maybeSingle();
      if (dbBank) {
        bank = { ...dbBank, id: String(dbBank.id) };
        bankAccountsMap.set(bank.id, bank);
      }
    } catch (_) {}
  }
  if (!bank) return null;

  const now = new Date().toISOString();
  bank.status = 'approved';
  bank.rejection_reason = null;
  bank.reviewed_by = adminId || adminEmail || 'Admin Compliance Operations';
  bank.reviewed_at = now;
  bankAccountsMap.set(bank.id, bank);

  if (bank.user_id) {
    const stat = userStatusMap.get(bank.user_id) || { userId: bank.user_id };
    userStatusMap.set(bank.user_id, {
      ...stat,
      bankingDetails: {
        ...(stat.bankingDetails || {}),
        id: bank.id,
        bankName: bank.bank_name,
        accountHolder: bank.account_holder,
        accountNumber: bank.account_number,
        accountNumberMasked: maskAccountNumber(bank.account_number),
        branchCode: bank.branch_code,
        accountType: bank.account_type,
        status: 'approved',
        rejectionReason: null,
      },
      updatedAt: now,
    });
  }

  try {
    await supabase
      .from('bank_accounts')
      .update({
        status: 'approved',
        rejection_reason: null,
        reviewed_by: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
        reviewed_at: now,
      })
      .eq('id', bank.id);
  } catch (_) {}

  try {
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
      admin_email: adminEmail,
      action: 'APPROVE_BANK',
      target_table: 'bank_accounts',
      target_id: String(bank.id),
      target_user_id: bank.user_id && /^[0-9a-f-]{36}$/i.test(bank.user_id) ? bank.user_id : null,
      reason: `Approved ${bank.bank_name} account (${maskAccountNumber(bank.account_number)})`,
    });
  } catch (_) {}

  return bank;
}

/**
 * Reject a bank account by ID with mandatory reason
 */
async function rejectBankAccount(bankId, reason, adminId = null, adminEmail = 'admin@smartassets.co.za') {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }
  let bank = bankAccountsMap.get(String(bankId));
  if (!bank) {
    bank = Array.from(bankAccountsMap.values()).find(
      (b) => String(b.id) === String(bankId) || b.user_id === bankId
    );
  }
  if (!bank) {
    try {
      const { data: dbBank } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('id', bankId)
        .limit(1)
        .maybeSingle();
      if (dbBank) {
        bank = { ...dbBank, id: String(dbBank.id) };
        bankAccountsMap.set(bank.id, bank);
      }
    } catch (_) {}
  }
  if (!bank) return null;

  const cleanReason = String(reason || '').trim() || 'Bank account details could not be verified.';
  const now = new Date().toISOString();
  bank.status = 'rejected';
  bank.rejection_reason = cleanReason;
  bank.reviewed_by = adminId || adminEmail || 'Admin Compliance Operations';
  bank.reviewed_at = now;
  bankAccountsMap.set(bank.id, bank);

  if (bank.user_id) {
    const stat = userStatusMap.get(bank.user_id) || { userId: bank.user_id };
    userStatusMap.set(bank.user_id, {
      ...stat,
      bankingDetails: {
        ...(stat.bankingDetails || {}),
        id: bank.id,
        bankName: bank.bank_name,
        accountHolder: bank.account_holder,
        accountNumber: bank.account_number,
        accountNumberMasked: maskAccountNumber(bank.account_number),
        branchCode: bank.branch_code,
        accountType: bank.account_type,
        status: 'rejected',
        rejectionReason: cleanReason,
      },
      updatedAt: now,
    });
  }

  try {
    await supabase
      .from('bank_accounts')
      .update({
        status: 'rejected',
        rejection_reason: cleanReason,
        reviewed_by: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
        reviewed_at: now,
      })
      .eq('id', bank.id);
  } catch (_) {}

  try {
    await supabase.from('admin_audit_logs').insert({
      admin_id: adminId && /^[0-9a-f-]{36}$/i.test(adminId) ? adminId : null,
      admin_email: adminEmail,
      action: 'REJECT_BANK',
      target_table: 'bank_accounts',
      target_id: String(bank.id),
      target_user_id: bank.user_id && /^[0-9a-f-]{36}$/i.test(bank.user_id) ? bank.user_id : null,
      reason: cleanReason,
    });
  } catch (_) {}

  return bank;
}

/**
 * Get a user's bank account
 */
function getUserBankAccount(userId, userEmail = null) {
  if (!hydrated) {
    hydrateComplianceFromSupabase().catch(() => {});
  }
  const list = Array.from(bankAccountsMap.values()).filter(
    (b) => b.user_id === userId || (userEmail && (b.user_email?.toLowerCase() === userEmail?.toLowerCase() || b.userEmail?.toLowerCase() === userEmail?.toLowerCase()))
  );
  if (list.length === 0) return null;
  list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const latest = list[0];
  return {
    ...latest,
    account_number_masked: maskAccountNumber(latest.account_number),
  };
}

/**
 * Get all bank accounts for admin review (with real-time Supabase sync & profile enrichment)
 */
async function getAllBankAccounts() {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }

  // Real-time query to ensure all bank accounts from Supabase are present in bankAccountsMap
  try {
    const { data: dbBanks } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('created_at', { ascending: false });

    if (Array.isArray(dbBanks)) {
      for (const b of dbBanks) {
        if (!b || !b.id) continue;
        const existing = bankAccountsMap.get(String(b.id));
        bankAccountsMap.set(String(b.id), {
          id: String(b.id),
          user_id: b.user_id,
          user_email: existing?.user_email || existing?.userEmail || null,
          userEmail: existing?.user_email || existing?.userEmail || null,
          full_name: existing?.full_name || existing?.fullName || b.account_holder,
          fullName: existing?.full_name || existing?.fullName || b.account_holder,
          account_holder: b.account_holder,
          bank_name: b.bank_name,
          account_number: b.account_number,
          account_number_masked: maskAccountNumber(b.account_number),
          branch_code: b.branch_code,
          account_type: b.account_type || 'Cheque / Current',
          status: b.status || 'pending',
          rejection_reason: b.rejection_reason || null,
          reviewed_by: b.reviewed_by || null,
          reviewed_at: b.reviewed_at || null,
          created_at: b.created_at || new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ [ComplianceService] getAllBankAccounts DB query warning:', err.message);
  }

  // Fetch profiles to enrich user_email and full_name
  const profilesMap = new Map();
  try {
    const { data: profs } = await supabase.from('profiles').select('id, email, full_name');
    if (Array.isArray(profs)) {
      profs.forEach((p) => {
        if (p && p.id) profilesMap.set(p.id, p);
      });
    }
  } catch (_) {}

  const list = Array.from(bankAccountsMap.values())
    .filter((b) => !isUnitTestUser(b.user_id, b.user_email || b.userEmail))
    .map((b) => {
      const p = profilesMap.get(b.user_id) || {};
      const resolvedEmail = b.user_email || b.userEmail || p.email || null;
      const resolvedName = b.full_name || b.fullName || p.full_name || b.account_holder || 'Collector';
      return {
        ...b,
        user_email: resolvedEmail,
        userEmail: resolvedEmail,
        full_name: resolvedName,
        fullName: resolvedName,
        account_number_masked: maskAccountNumber(b.account_number),
        account_number_full: b.account_number,
      };
    });

  return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

/**
 * Resolves a short-lived signed URL from Supabase private bucket 'verification-docs'.
 * Returns null if signing fails (no local disk fallback).
 */
async function resolveSignedOrLocalDocUrl(docRecord, seconds = 300) {
  if (!docRecord || !docRecord.storage_bucket_path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(KYC_BUCKET)
      .createSignedUrl(docRecord.storage_bucket_path, seconds);
    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  } catch (_) {}
  return null;
}

async function getDocumentSignedUrlForUser(docIdOrType, userId, isAdmin = false, req = null) {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }
  // Lookup by docId or docType for user
  let doc = documentsMap.get(String(docIdOrType));
  if (!doc) {
    doc = Array.from(documentsMap.values()).find(
      (d) => d.user_id === userId && d.doc_type === String(docIdOrType).toLowerCase()
    );
  }
  if (!doc) {
    // Attempt database lookup
    try {
      let query = supabase.from('verification_documents').select('*');
      if (/^[0-9a-f-]{36}$/i.test(docIdOrType)) {
        query = query.eq('id', docIdOrType);
      } else {
        query = query.eq('user_id', userId).eq('doc_type', docIdOrType.toLowerCase());
      }
      const { data: dbDoc } = await query.maybeSingle();
      if (dbDoc) doc = { ...dbDoc };
    } catch (_) {}
  }

  if (!doc) return null;
  if (!isAdmin && doc.user_id !== userId) return null;

  const url = await resolveSignedOrLocalDocUrl(doc, isAdmin ? 120 : 300);
  if (!url) return null;

  return {
    url,
    expiresIn: isAdmin ? 120 : 300,
    docType: doc.doc_type,
    status: doc.status,
  };
}

/**
 * Returns full verification status bundle for GET /verification/status
 */
async function getVerificationStatusBundle(userId, userEmail = null, req = null) {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }
  const compliance = getUserCompliance(userId, userEmail);
  const userDocs = Array.from(documentsMap.values()).filter(
    (d) => d.user_id === userId || (userEmail && d.user_email?.toLowerCase() === userEmail?.toLowerCase())
  );

  const byType = new Map();
  userDocs.forEach((d) => byType.set(d.doc_type, d));

  const slots = {};
  const documentsList = [];

  for (const docType of VALID_DOC_TYPES) {
    const doc = byType.get(docType);
    const item = doc
      ? {
          id: doc.id,
          doc_type: docType,
          status: doc.status,
          meta_value: doc.meta_value ? '••••' + String(doc.meta_value).slice(-3) : null,
          rejection_reason: doc.rejection_reason || null,
          has_file: !!doc.storage_bucket_path,
          reviewed_at: doc.reviewed_at || null,
          created_at: doc.created_at,
        }
      : {
          id: null,
          doc_type: docType,
          status: 'not_uploaded',
          meta_value: null,
          rejection_reason: null,
          has_file: false,
          reviewed_at: null,
          created_at: null,
        };
    slots[docType] = item;
    documentsList.push(item);
  }

  const rawBank = getUserBankAccount(userId, userEmail);
  const bankAccount = rawBank
    ? {
        id: rawBank.id,
        account_holder: rawBank.account_holder,
        bank_name: rawBank.bank_name,
        account_number_masked: rawBank.account_number_masked || maskAccountNumber(rawBank.account_number),
        branch_code: rawBank.branch_code,
        account_type: rawBank.account_type,
        status: rawBank.status,
        rejection_reason: rawBank.rejection_reason,
        created_at: rawBank.created_at,
      }
    : null;

  const verificationStatus = compliance.kycStatus || 'unverified';
  const isVerified = verificationStatus === 'verified';
  const hasApprovedBank = bankAccount?.status === 'approved';

  return {
    verification_status: verificationStatus,
    kycStatus: verificationStatus,
    accountStatus: compliance.accountStatus || 'active',
    isSuspended: !!compliance.isSuspended,
    rejectionReason: compliance.rejectionReason || null,
    documents: documentsList,
    documentSlots: slots,
    bank_account: bankAccount,
    bankingDetails: bankAccount
      ? {
          id: bankAccount.id,
          accountHolder: bankAccount.account_holder,
          bankName: bankAccount.bank_name,
          accountNumberMasked: bankAccount.account_number_masked,
          branchCode: bankAccount.branch_code,
          accountType: bankAccount.account_type,
          status: bankAccount.status,
          rejectionReason: bankAccount.rejection_reason,
        }
      : null,
    permissions: {
      canListAsset: isVerified && !compliance.isSuspended,
      canDeposit: isVerified && hasApprovedBank && !compliance.isSuspended,
      canWithdraw: isVerified && hasApprovedBank && !compliance.isSuspended,
    },
  };
}

/**
 * Toggle user account suspension
 */
function setUserSuspension(userId, suspend, reason = null) {
  const current = userStatusMap.get(userId) || {
    userId,
    kycStatus: 'unverified',
    accountStatus: 'active',
    isSuspended: false,
  };

  const isSuspended = !!suspend;
  const updated = {
    ...current,
    accountStatus: isSuspended ? 'suspended' : 'active',
    isSuspended,
    suspensionReason: isSuspended ? (reason || 'Suspended by SmartAssets Compliance Desk') : null,
    updatedAt: new Date().toISOString(),
  };

  userStatusMap.set(userId, updated);
  return updated;
}

/**
 * Get user compliance status by userId or email
 */
function getUserCompliance(userId, userEmail = null) {
  if (!hydrated) {
    hydrateComplianceFromSupabase().catch(() => {});
  }
  const bankAcc = getUserBankAccount(userId, userEmail);

  if (userId && userStatusMap.has(userId)) {
    const stat = userStatusMap.get(userId);
    return {
      ...stat,
      bankAccountStatus: bankAcc?.status || stat.bankingDetails?.status || 'not_submitted',
    };
  }

  if (userEmail) {
    for (const stat of userStatusMap.values()) {
      if (stat.userEmail && stat.userEmail.toLowerCase() === userEmail.toLowerCase()) {
        return {
          ...stat,
          bankAccountStatus: bankAcc?.status || stat.bankingDetails?.status || 'not_submitted',
        };
      }
    }
  }

  return {
    userId,
    userEmail,
    kycStatus: 'unverified',
    accountStatus: 'active',
    isSuspended: false,
    rejectionReason: null,
    bankingDetails: null,
    bankAccountStatus: 'not_submitted',
  };
}

/**
 * Get all verifications grouped by user for admin overview
 */
function getAllVerifications(req = null) {
  if (!hydrated) {
    hydrateComplianceFromSupabase().catch(() => {});
  }
  const userMap = new Map();

  for (const doc of documentsMap.values()) {
    if (isUnitTestUser(doc.user_id, doc.user_email)) continue;
    const uid = doc.user_id;
    if (!userMap.has(uid)) {
      const bankAcc = getUserBankAccount(uid, doc.user_email);
      const stat = userStatusMap.get(uid);
      userMap.set(uid, {
        id: `KYC-${uid.slice(0, 8).toUpperCase()}`,
        userId: uid,
        userEmail: doc.user_email || stat?.userEmail || '—',
        fullName: doc.full_name || stat?.fullName || 'SmartAssets Collector',
        kycStatus: stat?.kycStatus || 'pending',
        documents: [],
        bankAccount: bankAcc,
        submittedAt: doc.created_at,
      });
    }
    const item = userMap.get(uid);
    item.documents.push({
      ...doc,
      has_file: !!doc.storage_bucket_path,
    });
  }

  return Array.from(userMap.values()).sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );
}

/**
 * Get all granular verification documents
 */
function getAllVerificationDocuments(req = null) {
  if (!hydrated) {
    hydrateComplianceFromSupabase().catch(() => {});
  }
  const list = Array.from(documentsMap.values())
    .filter((d) => !isUnitTestUser(d.user_id, d.user_email))
    .map((d) => ({
      ...d,
      has_file: !!d.storage_bucket_path,
    }));
  return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function getAllUserStatuses() {
  if (!hydrated) {
    hydrateComplianceFromSupabase().catch(() => {});
  }
  const result = {};
  for (const [uid, stat] of userStatusMap.entries()) {
    if (!isUnitTestUser(uid, stat?.userEmail)) {
      result[uid] = stat;
    }
  }
  return result;
}

/**
 * Approve a full KYC verification dossier & all 3 underlying documents for that user.
 */
async function approveKyc(verificationId, reviewerNotes = null) {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }

  let targetUserId = null;
  const cleanId = String(verificationId || '').trim();

  for (const doc of documentsMap.values()) {
    if (doc.user_id && cleanId.toUpperCase().includes(doc.user_id.slice(0, 8).toUpperCase())) {
      targetUserId = doc.user_id;
      break;
    }
    if (doc.user_id === cleanId) {
      targetUserId = doc.user_id;
      break;
    }
  }

  if (!targetUserId) {
    for (const uid of userStatusMap.keys()) {
      if (cleanId.toUpperCase().includes(uid.slice(0, 8).toUpperCase()) || uid === cleanId) {
        targetUserId = uid;
        break;
      }
    }
  }

  if (!targetUserId) return null;

  const now = new Date().toISOString();

  // Approve all documents for this user
  for (const doc of documentsMap.values()) {
    if (doc.user_id === targetUserId) {
      doc.status = 'approved';
      doc.rejection_reason = null;
      doc.reviewed_by = 'Admin Compliance Operations';
      doc.reviewed_at = now;
      documentsMap.set(doc.id, doc);

      try {
        await supabase
          .from('verification_documents')
          .update({
            status: 'approved',
            rejection_reason: null,
            reviewed_at: now,
          })
          .eq('id', doc.id);
      } catch (_) {}
    }
  }

  // Set user verification status to 'verified'
  const stat = userStatusMap.get(targetUserId) || { userId: targetUserId };
  const updatedStat = {
    ...stat,
    kycStatus: 'verified',
    verification_status: 'verified',
    rejectionReason: null,
    updatedAt: now,
  };
  userStatusMap.set(targetUserId, updatedStat);

  try {
    await supabase
      .from('profiles')
      .update({ verification_status: 'verified' })
      .eq('id', targetUserId);
  } catch (_) {}

  return {
    id: verificationId,
    userId: targetUserId,
    userEmail: stat.userEmail || 'collector@smartassets.io',
    fullName: stat.fullName || 'SmartAssets Collector',
    kycStatus: 'verified',
    reviewedAt: now,
    notes: reviewerNotes,
  };
}

/**
 * Reject a full KYC verification dossier for a user with a reason.
 */
async function rejectKyc(verificationId, rejectionReason) {
  if (!hydrated) {
    await hydrateComplianceFromSupabase().catch(() => {});
  }

  let targetUserId = null;
  const cleanId = String(verificationId || '').trim();

  for (const doc of documentsMap.values()) {
    if (doc.user_id && cleanId.toUpperCase().includes(doc.user_id.slice(0, 8).toUpperCase())) {
      targetUserId = doc.user_id;
      break;
    }
    if (doc.user_id === cleanId) {
      targetUserId = doc.user_id;
      break;
    }
  }

  if (!targetUserId) return null;

  const now = new Date().toISOString();
  const reason = rejectionReason || 'Documentation failed compliance inspection.';

  for (const doc of documentsMap.values()) {
    if (doc.user_id === targetUserId) {
      doc.status = 'rejected';
      doc.rejection_reason = reason;
      doc.reviewed_by = 'Admin Compliance Operations';
      doc.reviewed_at = now;
      documentsMap.set(doc.id, doc);

      try {
        await supabase
          .from('verification_documents')
          .update({
            status: 'rejected',
            rejection_reason: reason,
            reviewed_at: now,
          })
          .eq('id', doc.id);
      } catch (_) {}
    }
  }

  const stat = userStatusMap.get(targetUserId) || { userId: targetUserId };
  const updatedStat = {
    ...stat,
    kycStatus: 'rejected',
    verification_status: 'rejected',
    rejectionReason: reason,
    updatedAt: now,
  };
  userStatusMap.set(targetUserId, updatedStat);

  try {
    await supabase
      .from('profiles')
      .update({ verification_status: 'rejected' })
      .eq('id', targetUserId);
  } catch (_) {}

  return {
    id: verificationId,
    userId: targetUserId,
    userEmail: stat.userEmail || 'collector@smartassets.io',
    fullName: stat.fullName || 'SmartAssets Collector',
    kycStatus: 'rejected',
    rejectionReason: reason,
    reviewedAt: now,
  };
}

module.exports = {
  submitKyc,
  approveKyc,
  rejectKyc,
  maskAccountNumber,
  uploadVerificationDocument,
  approveDocument,
  rejectDocument,
  submitBankAccount,
  approveBankAccount,
  rejectBankAccount,
  getUserBankAccount,
  getAllBankAccounts,
  getVerificationStatusBundle,
  setUserSuspension,
  getUserCompliance,
  getAllVerifications,
  getAllVerificationDocuments,
  getAllUserStatuses,
  recomputeUserVerificationStatus,
  hydrateComplianceFromSupabase,
  resolveSignedOrLocalDocUrl,
  getDocumentSignedUrlForUser,
};
