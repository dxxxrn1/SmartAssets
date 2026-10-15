const assert = require('assert');
const supportService = require('../src/services/supportService');

async function testSupportService() {
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

  console.log('\n🎉 ALL 3 SUPPORT TESTS PASSED!\n');
}

testSupportService().catch((err) => {
  console.error('❌ Support test failed:', err);
  process.exit(1);
});

