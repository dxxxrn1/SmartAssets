// ─── Certificate Controller ──────────────────────────────────────────────────
// API handlers for digital certificate query, server-side issuance,
// revocation, and independent cryptographic verification.

const certificateService = require('../services/certificateService');
const {
  verifyCertificateSignature,
  getPublicVerificationKeys,
  buildCanonicalCertificatePayload,
} = require('../services/certificateCryptoService');
const { sendError } = require('../utils/errorHandler');

/**
 * GET /api/certificates/:assetId
 * Retrieves the full certificate dossier for an asset.
 */
async function getCertificate(req, res) {
  try {
    const { assetId } = req.params;
    const dossier = await certificateService.getCertificateDossier(assetId);

    if (!dossier || !dossier.found) {
      return sendError(res, 404, dossier?.error || 'Certificate not found.');
    }

    return res.json({
      success: true,
      dossier,
    });
  } catch (err) {
    console.error('getCertificate error:', err);
    return sendError(res, 500, err.message || 'Internal server error fetching certificate.');
  }
}

/**
 * GET /api/certificates/keys
 * GET /verify/keys
 * Returns public RSA keys for verifiers.
 */
async function getPublicKeys(req, res) {
  try {
    const keysData = getPublicVerificationKeys();
    return res.json({
      success: true,
      ...keysData,
    });
  } catch (err) {
    console.error('getPublicKeys error:', err);
    return sendError(res, 500, 'Could not retrieve verification keys.');
  }
}

/**
 * POST /api/certificates/:assetId/issue
 * Server-side issuance of an authoritative digital certificate.
 * Authorized admin or compliance officer only.
 */
async function issueCertificate(req, res) {
  try {
    const { assetId } = req.params;
    const { evidence, issuer } = req.body || {};

    const issued = await certificateService.issueCertificate({
      assetId,
      evidence,
      issuer,
      authorizedUser: req.user,
    });

    return res.status(201).json({
      success: true,
      message: 'Digital certificate issued and cryptographically signed successfully.',
      certificate: issued,
    });
  } catch (err) {
    console.error('issueCertificate error:', err);
    return sendError(res, 400, err.message || 'Certificate issuance failed.');
  }
}

/**
 * POST /api/certificates/:assetId/revoke
 * Formally revokes an issued certificate with audit record.
 * Authorized admin or compliance officer only.
 */
async function revokeCertificate(req, res) {
  try {
    const { assetId } = req.params;
    const { reason } = req.body || {};

    if (!reason || !reason.trim()) {
      return sendError(res, 400, 'Revocation reason is required.');
    }

    const revoked = await certificateService.revokeCertificate({
      assetId,
      reason,
      authorizedUser: req.user,
    });

    return res.json({
      success: true,
      message: 'Certificate revoked successfully.',
      revocation: revoked,
    });
  } catch (err) {
    console.error('revokeCertificate error:', err);
    return sendError(res, 400, err.message || 'Certificate revocation failed.');
  }
}

/**
 * POST /api/certificates/verify-payload
 * Independent cryptographic verification of any certificate payload & signature.
 */
async function verifyPayload(req, res) {
  try {
    const { payload, signature, keyId } = req.body || {};

    if (!payload || !signature || !keyId) {
      return sendError(res, 400, 'Fields "payload", "signature", and "keyId" are all required.');
    }

    const verification = verifyCertificateSignature(payload, signature, keyId);

    return res.json({
      success: true,
      verification,
    });
  } catch (err) {
    console.error('verifyPayload error:', err);
    return sendError(res, 500, err.message || 'Verification exception occurred.');
  }
}

module.exports = {
  getCertificate,
  getPublicKeys,
  issueCertificate,
  revokeCertificate,
  verifyPayload,
};
