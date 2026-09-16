const assert = require('assert');
const escrowService = require('../src/services/escrowService');
const web3Service = require('../src/services/web3Service');

async function runEscrowIntegrationTests() {
  console.log('\n🧪 [TEST 1] Testing Web3 Service Escrow Relayer Status...');
  const relayerStatus = await web3Service.getRelayerStatus();
  console.log('   Relayer Address:', relayerStatus.relayerAddress);
  console.log('   Escrow Contract:', relayerStatus.escrowContractAddress);
  assert.ok(relayerStatus.relayerAddress, 'Relayer address should be defined');
  assert.ok(relayerStatus.escrowContractAddress, 'Escrow contract address should be defined');
  console.log('   ✅ Web3 Relayer status OK');

  console.log('\n🧪 [TEST 2] Testing Escrow Order Creation & Deposit Locking...');
  const testOrderId = 'ORD-INTEG-' + Date.now();
  const createdOrder = await escrowService.createEscrowOrder({
    orderId: testOrderId,
    buyerId: 'buyer-user-123',
    assetId: 'asset-777',
    assetName: 'Patek Philippe Nautilus 5711',
    assetCategory: 'Luxury Watches',
    amountZar: 480000,
    amountEth: '10.0000',
    paymentMethod: 'wallet',
    paymentRail: 'Ethereum Sepolia Web3',
    sellerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  });

  assert.strictEqual(createdOrder.orderId, testOrderId);
  assert.strictEqual(createdOrder.status, 'payment_secured');
  assert.strictEqual(createdOrder.currentStep, 1);
  assert.ok(createdOrder.depositTxHash.startsWith('0x'), 'Deposit txHash should be a valid hex');
  assert.strictEqual(createdOrder.timeline[0].completed, true);
  console.log('   ✅ Deposit locked on-chain/simulated! TxHash:', createdOrder.depositTxHash);

  console.log('\n🧪 [TEST 3] Testing Escrow Order Retrieval...');
  const fetchedOrder = escrowService.getEscrowOrder(testOrderId);
  assert.strictEqual(fetchedOrder.orderId, testOrderId);
  assert.strictEqual(fetchedOrder.amountZar, 480000);
  assert.strictEqual(fetchedOrder.assetName, 'Patek Philippe Nautilus 5711');
  console.log('   ✅ Escrow order successfully retrieved with accurate details');

  console.log('\n🧪 [TEST 4] Testing Step 2 Progression (Courier Transit)...');
  const step2Order = await escrowService.progressEscrowStep(
    testOrderId,
    2,
    'Armored courier picked up timepiece from seller vault.'
  );
  assert.strictEqual(step2Order.currentStep, 2);
  assert.strictEqual(step2Order.status, 'in_transit');
  assert.strictEqual(step2Order.timeline[1].completed, true);
  console.log('   ✅ Escrow progressed to Step 2 (In Transit)');

  console.log('\n🧪 [TEST 5] Testing Step 3 Progression (Appraiser Inspection)...');
  const step3Order = await escrowService.progressEscrowStep(
    testOrderId,
    3,
    'Horologist verified Calibre 324 movement and sapphire crystal.'
  );
  assert.strictEqual(step3Order.currentStep, 3);
  assert.strictEqual(step3Order.status, 'in_inspection');
  assert.strictEqual(step3Order.timeline[2].completed, true);
  assert.ok(step3Order.timeline[2].txHash, 'Inspection confirmation txHash should exist');
  console.log('   ✅ Escrow progressed to Step 3 (In Inspection) with on-chain record');

  console.log('\n🧪 [TEST 6] Testing Step 4 Release to Seller...');
  const releasedOrder = await escrowService.releaseEscrow(testOrderId);
  assert.strictEqual(releasedOrder.status, 'released');
  assert.strictEqual(releasedOrder.currentStep, 4);
  assert.ok(releasedOrder.releaseTxHash.startsWith('0x'), 'Release txHash should be valid hex');
  assert.ok(releasedOrder.timeline.every((t) => t.completed), 'All timeline steps should be completed');
  console.log('   ✅ Escrow released to seller! TxHash:', releasedOrder.releaseTxHash);

  console.log('\n🧪 [TEST 7] Testing Full Buyer Refund Flow...');
  const refundOrderId = 'ORD-REFUND-' + Date.now();
  await escrowService.createEscrowOrder({
    orderId: refundOrderId,
    buyerId: 'buyer-user-456',
    assetName: 'Vintage Rolex Submariner',
    amountZar: 150000,
    amountEth: '3.1250',
    paymentMethod: 'card',
    paymentRail: 'Stripe Card',
  });

  const refundedOrder = await escrowService.refundEscrow(
    refundOrderId,
    'Dial serial does not match reference archive.'
  );
  assert.strictEqual(refundedOrder.status, 'refunded');
  assert.ok(refundedOrder.refundTxHash.startsWith('0x'), 'Refund txHash should be valid hex');
  assert.strictEqual(
    refundedOrder.refundReason,
    'Dial serial does not match reference archive.'
  );
  console.log('   ✅ 100% Escrow refund executed! TxHash:', refundedOrder.refundTxHash);

  console.log('\n🧪 [TEST 8] Testing User Escrow Query...');
  const userOrders = escrowService.getUserEscrowOrders('buyer-user-123');
  assert.ok(userOrders.length > 0, 'User orders should contain created order');
  assert.ok(userOrders.some((o) => o.orderId === testOrderId));
  console.log('   ✅ Found', userOrders.length, 'orders for user buyer-user-123');

  console.log('\n🎉 ALL 8 ESCROW INTEGRATION TESTS PASSED!\n');
}

runEscrowIntegrationTests().catch((err) => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});

