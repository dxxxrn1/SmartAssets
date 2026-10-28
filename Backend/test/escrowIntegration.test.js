const assert = require('assert');
process.env.NODE_ENV = 'test'; // Enables explicitly test-only simulated non-custodial rails.
const escrowService = require('../src/services/escrowService');
const web3Service = require('../src/services/web3Service');

async function runEscrowIntegrationTests() {
  console.log('\n🧪 [TEST 1] Testing Web3 Service Escrow Relayer Status...');
  const relayerStatus = await web3Service.getRelayerStatus();
  console.log('   Relayer Address:', relayerStatus.relayerAddress);
  console.log('   Escrow Contract:', relayerStatus.escrowContractAddress);
  assert.ok(relayerStatus.network, 'Network should be defined');
  assert.ok(relayerStatus.mode, 'Relayer mode should be defined');
  console.log('   ✅ Web3 Relayer status OK');

  console.log('\n🧪 [TEST 2] Testing Escrow Order Creation & Deposit Locking...');
  const testOrderId = 'ORD-INTEG-' + Date.now();
  const createdOrder = await escrowService.createEscrowOrder({
    orderId: testOrderId,
    buyerId: 'buyer-user-123',
    sellerId: 'seller-user-456',
    assetId: 'asset-777',
    assetName: 'Patek Philippe Nautilus 5711',
    assetCategory: 'Luxury Watches',
    amountZar: 480000,
    amountEth: '10.0000',
    paymentMethod: 'card',
    paymentRail: 'Stripe Card (Sandbox)',
    sellerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    customTxHash: '0x' + '1'.repeat(64),
  });

  assert.strictEqual(createdOrder.orderId, testOrderId);
  assert.strictEqual(createdOrder.status, 'payment_secured');
  assert.strictEqual(createdOrder.currentStep, 1);
  assert.ok(createdOrder.depositTxHash.startsWith('0x'), 'Deposit txHash should be a valid hex');
  assert.strictEqual(createdOrder.timeline[0].completed, true);
  console.log('   ✅ Deposit locked and verified! TxHash:', createdOrder.depositTxHash);

  console.log('\n🧪 [TEST 3] Testing Escrow Order Retrieval...');
  const fetchedOrder = await escrowService.getEscrowOrder(testOrderId, null, 'buyer-user-123', false);
  assert.strictEqual(fetchedOrder.orderId, testOrderId);
  assert.strictEqual(fetchedOrder.amountZar, 480000);
  assert.strictEqual(fetchedOrder.assetName, 'Patek Philippe Nautilus 5711');
  console.log('   ✅ Escrow order successfully retrieved with accurate details');

  console.log('\n🧪 [TEST 4] Testing Step 2 Progression (Courier Transit)...');
  const step2Order = await escrowService.progressEscrowStep(
    testOrderId,
    2,
    { carrier: "Brink's Armored Courier", trackingNumber: 'BRK-892104' },
    { role: 'admin', userId: 'admin-test' }
  );
  assert.strictEqual(step2Order.currentStep, 2);
  assert.strictEqual(step2Order.status, 'in_transit');
  assert.strictEqual(step2Order.timeline[1].completed, true);
  console.log('   ✅ Escrow progressed to Step 2 (In Transit)');

  console.log('\n🧪 [TEST 5] Testing Step 3 Progression (Appraiser Inspection)...');
  const step3Order = await escrowService.progressEscrowStep(
    testOrderId,
    3,
    { note: 'Horologist verified Calibre 324 movement and sapphire crystal.' },
    { role: 'admin', userId: 'admin-test' }
  );
  assert.strictEqual(step3Order.currentStep, 3);
  assert.strictEqual(step3Order.status, 'in_inspection');
  assert.strictEqual(step3Order.timeline[2].completed, true);
  console.log('   ✅ Escrow progressed to Step 3 (In Inspection) with appraisal record');

  console.log('\n🧪 [TEST 6] Testing Delivery, Acceptance, and Step 5 Release to Seller...');
  await escrowService.progressEscrowStep(
    testOrderId,
    4,
    { note: 'Delivered to buyer custody vault.' },
    { role: 'user', userId: 'buyer-user-123' }
  );

  await escrowService.progressEscrowStep(
    testOrderId,
    5,
    { note: 'Buyer verified serial number and accepted physical collectible.' },
    { role: 'user', userId: 'buyer-user-123' }
  );

  const releasedOrder = await escrowService.releaseEscrow(testOrderId, { userId: 'admin-test', role: 'admin' });
  assert.strictEqual(releasedOrder.status, 'released');
  assert.strictEqual(releasedOrder.currentStep, 5);
  assert.ok(releasedOrder.releaseTxHash, 'Release reference must exist');
  assert.ok(releasedOrder.timeline.every((t) => t.completed), 'All timeline steps should be completed');
  console.log('   ✅ Escrow released to seller! Payout Ref:', releasedOrder.releaseTxHash);

  console.log('\n🧪 [TEST 7] Testing Full Buyer Refund Flow...');
  const refundOrderId = 'ORD-REFUND-' + Date.now();
  await escrowService.createEscrowOrder({
    orderId: refundOrderId,
    buyerId: 'buyer-user-456',
    sellerId: 'seller-user-789',
    assetName: 'Vintage Rolex Submariner',
    amountZar: 150000,
    amountEth: '3.1250',
    paymentMethod: 'card',
    paymentRail: 'Stripe Card',
  });

  const refundedOrder = await escrowService.refundEscrow(
    refundOrderId,
    'Dial serial does not match reference archive.',
    { userId: 'admin-test', role: 'admin' }
  );
  assert.strictEqual(refundedOrder.status, 'refunded');
  assert.ok(refundedOrder.refundTxHash, 'Refund reference should exist');
  assert.strictEqual(
    refundedOrder.refundReason,
    'Dial serial does not match reference archive.'
  );
  console.log('   ✅ 100% Escrow refund executed! Ref:', refundedOrder.refundTxHash);

  console.log('\n🧪 [TEST 8] Testing User Escrow Query...');
  const userOrders = await escrowService.getUserEscrowOrders('buyer-user-123');
  assert.ok(userOrders.length > 0, 'User orders should contain created order');
  assert.ok(userOrders.some((o) => o.orderId === testOrderId));
  console.log('   ✅ Found', userOrders.length, 'orders for user buyer-user-123');

  console.log('\n🎉 ALL 8 ESCROW INTEGRATION TESTS PASSED!\n');
}

runEscrowIntegrationTests().catch((err) => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});
