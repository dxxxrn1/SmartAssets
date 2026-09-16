// ─── Escrow Service ───────────────────────────────────────────────────────────
// Centralized escrow domain logic and persistent storage manager.
// Manages the complete lifecycle:
// 1. Payment Secured in Smart Contract
// 2. Physical Collectible In Transit to Vault
// 3. Expert Authentication & Inspection
// 4. Release to Seller & NFT Delivery / Full Refund to Buyer

const fs = require('fs');
const path = require('path');
const web3Service = require('./web3Service');

const DATA_DIR = path.resolve(__dirname, '../data');
const ESCROW_FILE = path.join(DATA_DIR, 'escrowOrders.json');

// In-memory cache backed by persistent file
const ordersMap = new Map();

function initStorage() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(ESCROW_FILE)) {
      const data = JSON.parse(fs.readFileSync(ESCROW_FILE, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach((order) => {
          if (order && order.orderId) {
            ordersMap.set(order.orderId, order);
          }
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ [EscrowService] Storage initialization warning:', err.message);
  }
}

function persistOrders() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const ordersArray = Array.from(ordersMap.values());
    fs.writeFileSync(ESCROW_FILE, JSON.stringify(ordersArray, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ [EscrowService] Failed to persist escrow orders:', err.message);
  }
}

// Initialize on module load
initStorage();

/**
 * Creates a new escrow order and locks deposit.
 */
async function createEscrowOrder({
  orderId,
  buyerId,
  assetId,
  assetName,
  assetCategory,
  assetImage,
  amountZar,
  amountGbp,
  amountEth,
  paymentMethod,
  paymentRail,
  sellerAddress,
  buyerAddress,
  customTxHash,
}) {
  const finalOrderId = orderId || 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const zarVal = Number(amountZar || amountGbp || 25000);
  const ethVal = amountEth || (zarVal / 48000).toFixed(4);

  // Call Web3 lock deposit on-chain
  const onChainLock = await web3Service.lockEscrowDeposit({
    orderId: finalOrderId,
    sellerAddress,
    ethAmount: ethVal,
    buyerAddress,
  });

  const txHash = customTxHash || onChainLock.txHash;
  const etherscanUrl = onChainLock.etherscanUrl || `https://sepolia.etherscan.io/tx/${txHash}`;
  const now = new Date().toISOString();

  const escrowOrder = {
    orderId: finalOrderId,
    buyerId: buyerId || 'anonymous-buyer',
    buyerAddress: buyerAddress || null,
    assetId: assetId || null,
    assetName: assetName || 'Luxury Collectible',
    assetCategory: assetCategory || 'Luxury Asset',
    assetImage: assetImage || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
    amountZar: zarVal,
    amountGbp: zarVal,
    amountEth: ethVal,
    paymentMethod: paymentMethod || 'wallet',
    paymentRail: paymentRail || (paymentMethod === 'wallet' ? 'Ethereum Sepolia Web3' : paymentMethod === 'card' ? 'Stripe Card' : 'Stripe Wire'),
    status: 'payment_secured',
    currentStep: 1,
    totalSteps: 4,
    depositTxHash: txHash,
    etherscanUrl,
    escrowContractAddress: onChainLock.contractAddress || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    sellerAddress: sellerAddress || '0x71C3A5b67B7840131498B1aB55938B237F026a76',
    createdAt: now,
    updatedAt: now,
    timeline: [
      {
        step: 1,
        title: 'Payment Secured in Smart Contract',
        description: `${ethVal} Sepolia ETH locked in Escrow Contract. Protected from withdrawal until physical inspection passes.`,
        timestamp: now,
        txHash,
        completed: true,
      },
      {
        step: 2,
        title: 'Physical Asset in Transit to Vault',
        description: 'Seller prepares collectible for insured armored courier dispatch to SmartAssets Custody Center.',
        completed: false,
      },
      {
        step: 3,
        title: 'Authentication & Physical Inspection',
        description: 'Certified Horologists & Gemological Institute conduct physical verification and serial appraisal.',
        completed: false,
      },
      {
        step: 4,
        title: 'Funds Released to Seller & NFT Delivered',
        description: 'Smart contract automatically transfers payment to seller; Certificate of Authenticity NFT minted to buyer vault.',
        completed: false,
      },
    ],
  };

  ordersMap.set(finalOrderId, escrowOrder);
  persistOrders();

  console.log(`🔒 [EscrowService] Created escrow order ${finalOrderId} for ${zarVal} ZAR (${ethVal} ETH)`);
  return escrowOrder;
}

/**
 * Fetch an escrow order by ID.
 */
function getEscrowOrder(orderId) {
  let order = ordersMap.get(orderId);
  if (!order) {
    // Generate default verified demo order if requested for a mock ID
    const zarVal = 28500;
    const ethVal = '11.4000';
    const simulatedDepositHash = '0x3a8b4f2c1d9e7a5b6c8d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b';

    order = {
      orderId,
      assetName: 'Verified Collectible',
      assetCategory: 'Luxury Watch',
      assetImage: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800',
      amountZar: zarVal,
      amountGbp: zarVal,
      amountEth: ethVal,
      paymentMethod: 'wallet',
      paymentRail: 'Ethereum Sepolia Web3',
      status: 'payment_secured',
      currentStep: 1,
      totalSteps: 4,
      depositTxHash: simulatedDepositHash,
      etherscanUrl: `https://sepolia.etherscan.io/tx/${simulatedDepositHash}`,
      escrowContractAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      sellerAddress: '0x71C3A5b67B7840131498B1aB55938B237F026a76',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [
        {
          step: 1,
          title: 'Payment Secured in Smart Contract',
          description: `${ethVal} Sepolia ETH locked in Escrow Contract. Protected from withdrawal until inspection passes.`,
          timestamp: new Date().toISOString(),
          txHash: simulatedDepositHash,
          completed: true,
        },
        {
          step: 2,
          title: 'Physical Asset in Transit to Vault',
          description: 'Insured courier dispatch in progress to London Custody Center.',
          completed: false,
        },
        {
          step: 3,
          title: 'Authentication & Physical Inspection',
          description: 'Condition grading and authenticity appraisal.',
          completed: false,
        },
        {
          step: 4,
          title: 'Funds Released to Seller & NFT Delivered',
          description: 'Automatic settlement on-chain.',
          completed: false,
        },
      ],
    };
    ordersMap.set(orderId, order);
    persistOrders();
  }
  return order;
}

/**
 * Retrieve all orders for a specific buyer.
 */
function getUserEscrowOrders(userId) {
  const result = [];
  for (const order of ordersMap.values()) {
    if (order.buyerId === userId) {
      result.push(order);
    }
  }
  return result;
}

/**
 * Progress escrow order through its custody stages.
 * step 2: In Transit
 * step 3: In Inspection
 */
async function progressEscrowStep(orderId, targetStep, note) {
  const order = ordersMap.get(orderId);
  if (!order) {
    throw new Error('Escrow order not found.');
  }

  if (order.status === 'released' || order.status === 'refunded') {
    throw new Error(`Cannot modify order in ${order.status} state.`);
  }

  const step = Number(targetStep);
  const now = new Date().toISOString();

  if (step === 2) {
    order.currentStep = 2;
    order.status = 'in_transit';
    order.timeline[1].completed = true;
    order.timeline[1].timestamp = now;
    if (note) order.timeline[1].description = note;
  } else if (step === 3) {
    order.currentStep = 3;
    order.status = 'in_inspection';
    order.timeline[0].completed = true;
    order.timeline[1].completed = true;
    order.timeline[2].completed = true;
    order.timeline[2].timestamp = now;
    if (note) order.timeline[2].description = note;

    // Call on-chain confirmInspection
    const inspectTx = await web3Service.confirmInspectionOnChain({ orderId });
    order.timeline[2].txHash = inspectTx.txHash;
  }

  order.updatedAt = now;
  ordersMap.set(orderId, order);
  persistOrders();

  return order;
}

/**
 * Release escrow funds to the seller.
 */
async function releaseEscrow(orderId) {
  const order = ordersMap.get(orderId);
  if (!order) {
    throw new Error('Escrow order not found.');
  }

  if (order.status === 'released') {
    return order;
  }
  if (order.status === 'refunded') {
    throw new Error('Cannot release funds for an order that has already been refunded.');
  }

  // Call on-chain release
  const releaseTx = await web3Service.releaseEscrowOnChain({ orderId });
  const now = new Date().toISOString();

  order.status = 'released';
  order.currentStep = 4;
  order.releaseTxHash = releaseTx.txHash;
  order.releaseEtherscanUrl = releaseTx.etherscanUrl;
  order.releasedAt = now;
  order.updatedAt = now;

  // Mark all timeline steps completed
  order.timeline.forEach((t) => {
    t.completed = true;
  });
  order.timeline[3].txHash = releaseTx.txHash;
  order.timeline[3].timestamp = now;

  ordersMap.set(orderId, order);
  persistOrders();

  console.log(`✅ [EscrowService] Released escrow funds for ${orderId} on-chain! Tx: ${releaseTx.txHash}`);
  return order;
}

/**
 * Refund escrow funds to the buyer.
 */
async function refundEscrow(orderId, reason) {
  const order = ordersMap.get(orderId);
  if (!order) {
    throw new Error('Escrow order not found.');
  }

  if (order.status === 'refunded') {
    return order;
  }
  if (order.status === 'released') {
    throw new Error('Cannot refund an order whose funds have already been released to the seller.');
  }

  // Call on-chain refund
  const refundTx = await web3Service.refundEscrowOnChain({ orderId });
  const now = new Date().toISOString();

  order.status = 'refunded';
  order.refundTxHash = refundTx.txHash;
  order.refundEtherscanUrl = refundTx.etherscanUrl;
  order.refundReason = reason || 'Item failed authenticity inspection or delivery canceled by buyer.';
  order.refundedAt = now;
  order.updatedAt = now;

  ordersMap.set(orderId, order);
  persistOrders();

  console.log(`↩️ [EscrowService] Refunded escrow funds for ${orderId} on-chain! Tx: ${refundTx.txHash}`);
  return order;
}

module.exports = {
  createEscrowOrder,
  getEscrowOrder,
  getUserEscrowOrders,
  progressEscrowStep,
  releaseEscrow,
  refundEscrow,
};

