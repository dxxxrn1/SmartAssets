// ─── SmartAssets Audit Log Service ──────────────────────────────────────────
// High-fidelity security audit ledger capturing auth events, session timeouts,
// KYC state transitions, and administrative account suspensions.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../data');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'auditLogs.json');

const logs = [];

// Seed initial historical audit logs
const INITIAL_LOGS = [
  {
    id: 'SEC-LOG-98102',
    timestamp: new Date(Date.now() - 3600 * 1000 * 3).toISOString(),
    eventType: 'LOGIN',
    category: 'Authentication',
    actorEmail: 'henrik.vanderbilt@smartassets.io',
    actorId: 'usr-demo-01',
    ip: '197.89.201.14',
    device: 'Mobile (iOS 17.5 / Expo Native)',
    description: 'Successful user authentication via password.',
    status: 'Success',
  },
  {
    id: 'SEC-LOG-98103',
    timestamp: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
    eventType: 'KYC_SUBMIT',
    category: 'Compliance',
    actorEmail: 'henrik.vanderbilt@smartassets.io',
    actorId: 'usr-demo-01',
    ip: '197.89.201.14',
    device: 'Mobile (iOS 17.5 / Expo Native)',
    description: 'Submitted FICA compliance pack: SA ID, SARS Tax, Utility Bill, FNB Bank details.',
    status: 'Pending Review',
  },
  {
    id: 'SEC-LOG-98104',
    timestamp: new Date(Date.now() - 3600 * 1000 * 11).toISOString(),
    eventType: 'LOGIN',
    category: 'Authentication',
    actorEmail: 'naledi.khumalo@smartassets.io',
    actorId: 'usr-demo-02',
    ip: '105.186.44.89',
    device: 'Mobile (Android 14 / Expo Native)',
    description: 'Successful user authentication via password.',
    status: 'Success',
  },
  {
    id: 'SEC-LOG-98105',
    timestamp: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
    eventType: 'KYC_SUBMIT',
    category: 'Compliance',
    actorEmail: 'naledi.khumalo@smartassets.io',
    actorId: 'usr-demo-02',
    ip: '105.186.44.89',
    device: 'Mobile (Android 14 / Expo Native)',
    description: 'Submitted FICA compliance pack: Passport, SARS Ref, Address Proof, Standard Bank.',
    status: 'Pending Review',
  },
  {
    id: 'SEC-LOG-98106',
    timestamp: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
    eventType: 'KYC_APPROVED',
    category: 'Compliance',
    actorEmail: 'sophie.moreau@smartassets.io',
    actorId: 'usr-demo-03',
    ip: '127.0.0.1:5000',
    device: 'Admin Portal Console',
    description: 'KYC Dossier KYC-ZA-2026-098 approved by Admin Compliance Operations.',
    status: 'Approved',
  },
];

function initLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      const data = JSON.parse(fs.readFileSync(AUDIT_LOG_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        logs.push(...data);
      } else {
        logs.push(...INITIAL_LOGS);
        persistLogs();
      }
    } else {
      logs.push(...INITIAL_LOGS);
      persistLogs();
    }
  } catch (err) {
    console.warn('⚠️ [AuditLogService] Init warning:', err.message);
  }
}

function persistLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [AuditLogService] Failed to persist audit logs:', err.message);
  }
}

initLogs();

/**
 * Record a security or compliance audit event
 */
function logEvent({
  eventType,
  actorEmail,
  actorId,
  category = 'Security',
  ip = '127.0.0.1',
  device = 'Mobile App / Client',
  description = '',
  status = 'Success',
}) {
  const logId = 'SEC-LOG-' + Math.floor(100000 + Math.random() * 900000);
  const entry = {
    id: logId,
    timestamp: new Date().toISOString(),
    eventType, // 'LOGIN' | 'LOGOUT' | 'SESSION_TIMEOUT' | 'KYC_SUBMIT' | 'KYC_APPROVED' | 'KYC_REJECTED' | 'ACCOUNT_SUSPENDED' | 'ACCOUNT_REACTIVATED'
    category: category || (eventType.startsWith('KYC') ? 'Compliance' : 'Authentication'),
    actorEmail: actorEmail || 'system@smartassets.io',
    actorId: actorId || 'system',
    ip: ip || '127.0.0.1',
    device: device || 'SmartAssets Client',
    description,
    status,
  };

  logs.unshift(entry); // newest first
  if (logs.length > 200) {
    logs.pop(); // keep last 200 logs
  }

  persistLogs();
  console.log(`🛡️ [AuditLog] [${entry.eventType}] ${entry.actorEmail} - ${entry.description}`);
  return entry;
}

/**
 * Retrieve all audit logs
 */
function getAllLogs(limit = 100) {
  return logs.slice(0, limit);
}

module.exports = {
  logEvent,
  getAllLogs,
};
