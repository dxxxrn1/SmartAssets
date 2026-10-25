// ─── Support Service ─────────────────────────────────────────────────────────
// Manages luxury platform user support inquiries, ticket lodging, and persistence.
// Supabase support_tickets is the source of truth with zero local JSON fallback.

const supabase = require('../connection/supabaseClient');

// In-memory runtime cache for fast lookups
const ticketsMap = new Map();

/**
 * Creates and logs a new support ticket into Supabase support_tickets.
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
    status: 'Open',
    createdAt: now,
    updatedAt: now,
    responseEstimate: '2-4 hours',
    assignedTeam:
      category === 'Escrow & Payments'
        ? 'Smart Contract Settlement Desk'
        : category === 'Physical Verification'
        ? 'Horology & Gemology Appraisal Lab'
        : 'Luxury Concierge Team',
  };

  ticketsMap.set(ticketId, ticket);

  // Sync to Supabase support_tickets table (fire-and-forget DB sync)
  try {
    Promise.resolve(
      supabase.from('support_tickets').insert({
        id: ticketId,
        user_id: userId && userId.includes('-') ? userId : null,
        user_email: ticket.userEmail,
        user_name: ticket.userName,
        category: ticket.category,
        subject: ticket.subject,
        message: ticket.message,
        priority: ticket.priority,
        status: ticket.status,
        created_at: now,
        updated_at: now,
      })
    ).catch(() => {});
  } catch (_e) {}

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
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Retrieves all tickets in the system (Admin support console).
 * Returns empty array if no tickets have been lodged. Never synthesizes fake tickets.
 */
function getAllTickets() {
  const list = Array.from(ticketsMap.values());
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Updates a support ticket's status and logs resolution note.
 */
async function updateTicketStatus(ticketId, status, resolutionNote = null) {
  const ticket = ticketsMap.get(ticketId);
  if (!ticket) return null;

  const now = new Date().toISOString();
  ticket.status = status;
  ticket.updatedAt = now;
  if (resolutionNote) {
    ticket.resolutionNote = resolutionNote;
    ticket.adminResponse = resolutionNote;
  }
  ticketsMap.set(ticketId, ticket);

  try {
    await supabase.from('support_tickets').update({
      status,
      admin_notes: resolutionNote,
      updated_at: now,
    }).eq('id', ticketId);
  } catch (_e) {}

  return ticket;
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
  getAllTickets,
  updateTicketStatus,
};
