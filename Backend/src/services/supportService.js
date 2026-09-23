// ─── Support Service ─────────────────────────────────────────────────────────
// Manages luxury platform user support inquiries, ticket lodging, and persistence.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../data');
const TICKETS_FILE = path.join(DATA_DIR, 'supportTickets.json');

const ticketsMap = new Map();

function initStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(TICKETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach((ticket) => {
          if (ticket && ticket.id) {
            ticketsMap.set(ticket.id, ticket);
          }
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ [SupportService] Storage initialization warning:', err.message);
  }
}

function persistTickets() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const ticketsArray = Array.from(ticketsMap.values());
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(ticketsArray, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [SupportService] Failed to persist support tickets:', err.message);
  }
}

// Initialize on module load
initStorage();

/**
 * Creates and logs a new support ticket.
 */
function createTicket({ userId, userEmail, userName, category, subject, message, priority = 'normal' }) {
  const ticketId = 'TKT-' + Math.floor(100000 + Math.random() * 900000);
  const now = new Date().toISOString();

  const ticket = {
    id: ticketId,
    userId,
    userEmail: userEmail || 'collector@smartassets.io',
    userName: userName || 'Valued Collector',
    category: category || 'General Inquiry',
    subject: subject.trim(),
    message: message.trim(),
    priority,
    status: 'Open', // 'Open' | 'In Review' | 'Resolved'
    createdAt: now,
    updatedAt: now,
    responseEstimate: '2-4 hours',
    assignedTeam: category === 'Escrow & Payments' ? 'Smart Contract Settlement Desk' :
                  category === 'Physical Verification' ? 'Horology & Gemology Appraisal Lab' :
                  'Luxury Concierge Team',
  };

  ticketsMap.set(ticketId, ticket);
  persistTickets();

  console.log(`🎫 [SupportService] Lodged ticket ${ticketId} [${category}] for user ${userId}`);
  return ticket;
}

/**
 * Retrieves all tickets lodged by a specific user.
 */
function getUserTickets(userId) {
  const list = [];
  for (const t of ticketsMap.values()) {
    if (t.userId === userId) {
      list.push(t);
    }
  }
  // Sort newest first
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Retrieves a specific ticket by ID.
 */
function getTicketById(ticketId) {
  return ticketsMap.get(ticketId) || null;
}

module.exports = {
  createTicket,
  getUserTickets,
  getTicketById,
};

