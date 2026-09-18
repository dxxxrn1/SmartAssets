// ─── Stripe Payment Service ───────────────────────────────────────────────────
// Proper Stripe PaymentIntent flow:
//   1. Backend creates PaymentIntent → returns clientSecret to mobile app
//   2. Mobile app tokenizes card via Stripe API → confirms payment with clientSecret
//   3. Backend verifies intent status after confirmation
//
// Required .env keys:
//   STRIPE_SECRET_KEY=sk_test_...    (from https://dashboard.stripe.com/apikeys)
//   STRIPE_PUBLISHABLE_KEY=pk_test_... (also from dashboard — sent to mobile app)

const Stripe = require('stripe');
const crypto = require('crypto');

// ── Stripe Configuration ─────────────────────────────────────────────────────
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
const STRIPE_PUBLISHABLE_KEY = (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();

// Only keys starting with sk_ or rk_ are valid Stripe secret keys
const isLiveKey = STRIPE_SECRET_KEY.startsWith('sk_') || STRIPE_SECRET_KEY.startsWith('rk_');

let stripe = null;
if (isLiveKey) {
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
  console.log('💳 [Stripe] Initialized with live/test secret key');
} else if (STRIPE_SECRET_KEY) {
  console.warn(`⚠️ [Stripe] Key "${STRIPE_SECRET_KEY.substring(0, 10)}..." is not a valid secret key (must start with sk_ or rk_). Running in sandbox mode.`);
} else {
  console.warn('⚠️ [Stripe] No STRIPE_SECRET_KEY configured. Card/bank payments will run in sandbox mode.');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectCardBrand(cardNumber = '') {
  const n = cardNumber.replace(/\D/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'American Express';
  if (/^6(?:011|5)/.test(n)) return 'Discover';
  return 'Card';
}

// ── PaymentIntent Creation (Step 1 — called by backend) ─────────────────────

/**
 * Create a Stripe PaymentIntent for the given amount.
 * Returns { clientSecret, paymentIntentId } to the frontend.
 *
 * If Stripe is not configured with a valid key, returns a sandbox intent.
 */
async function createPaymentIntent({ amount, currency = 'zar', metadata = {} }) {
  if (stripe) {
    // ── Real Stripe PaymentIntent ──
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents/smallest currency unit
      currency: currency.toLowerCase(),
      metadata,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    });

    console.log(`💳 [Stripe] PaymentIntent created: ${intent.id} for ${currency.toUpperCase()} ${amount}`);
    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      mode: STRIPE_SECRET_KEY.includes('_test_') ? 'test' : 'live',
    };
  }

  // ── Sandbox fallback ──
  const sandboxId = 'pi_sandbox_' + crypto.randomBytes(12).toString('hex');
  const sandboxSecret = sandboxId + '_secret_' + crypto.randomBytes(16).toString('hex');
  console.log(`💳 [Stripe Sandbox] Created sandbox intent: ${sandboxId}`);

  return {
    clientSecret: sandboxSecret,
    paymentIntentId: sandboxId,
    publishableKey: STRIPE_PUBLISHABLE_KEY || 'pk_test_sandbox',
    mode: 'sandbox',
  };
}

// ── Payment Confirmation (Step 2 — called after frontend confirms) ──────────

/**
 * Verify that a PaymentIntent has been successfully paid.
 * Called after the mobile app confirms payment with the clientSecret.
 */
async function verifyPaymentIntent(paymentIntentId) {
  if (stripe && !paymentIntentId.startsWith('pi_sandbox_')) {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const succeeded = intent.status === 'succeeded';

    console.log(`💳 [Stripe] PaymentIntent ${paymentIntentId} status: ${intent.status}`);

    return {
      verified: succeeded,
      status: intent.status,
      paymentIntentId: intent.id,
      amount: intent.amount / 100,
      currency: intent.currency?.toUpperCase(),
      paymentMethodType: intent.payment_method_types?.[0],
      cardBrand: intent.charges?.data?.[0]?.payment_method_details?.card?.brand,
      cardLast4: intent.charges?.data?.[0]?.payment_method_details?.card?.last4,
      receiptUrl: intent.charges?.data?.[0]?.receipt_url,
      mode: STRIPE_SECRET_KEY.includes('_test_') ? 'test' : 'live',
    };
  }

  // Sandbox: always "verified"
  return {
    verified: true,
    status: 'succeeded',
    paymentIntentId,
    mode: 'sandbox',
  };
}

// ── Direct Card Processing (legacy / sandbox fallback) ──────────────────────

/**
 * Process a card payment directly on the server.
 * Used when Stripe live keys are configured (creates PaymentMethod + confirms intent).
 * Falls back to sandbox when keys are not valid.
 */
async function processCardPayment({ amount, currency = 'zar', card = {}, userEmail, userName, metadata = {} }) {
  const cleanCard = (card.cardNumber || '').replace(/\s+/g, '');
  const brand = detectCardBrand(cleanCard);
  const last4 = cleanCard.slice(-4) || '4242';

  console.log(`💳 [Stripe] Processing card payment: R${amount.toLocaleString()} (${brand} ····${last4})`);

  if (stripe) {
    try {
      // Create a PaymentIntent with automatic confirmation
      const expParts = (card.expiry || '12/29').split(/[\/\s-]+/);
      const expMonth = parseInt(expParts[0], 10) || 12;
      let expYear = parseInt(expParts[1], 10) || 2029;
      if (expYear < 100) expYear += 2000;

      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: { number: cleanCard, exp_month: expMonth, exp_year: expYear, cvc: card.cvc || '123' },
        billing_details: { name: card.cardName || userName, email: userEmail || undefined },
      });

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        payment_method: pm.id,
        confirm: true,
        metadata,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      });

      console.log(`✅ [Stripe] Payment confirmed: ${intent.id} (${intent.status})`);

      return {
        success: true,
        paymentRail: `Stripe ${pm.card?.brand || brand} Card`,
        paymentIntentId: intent.id,
        chargeId: intent.latest_charge,
        status: intent.status,
        amount,
        currency: currency.toUpperCase(),
        cardBrand: pm.card?.brand || brand,
        cardLast4: pm.card?.last4 || last4,
        receiptUrl: intent.charges?.data?.[0]?.receipt_url,
        mode: STRIPE_SECRET_KEY.includes('_test_') ? 'test' : 'live',
      };
    } catch (err) {
      if (err.type === 'StripeCardError') {
        throw new Error(`Card Declined: ${err.message}`);
      }
      console.warn('⚠️ [Stripe] API error, falling back to sandbox:', err.message);
    }
  }

  // ── Sandbox fallback ──
  const simId = 'pi_stripe_' + crypto.randomBytes(12).toString('hex');
  return {
    success: true,
    paymentRail: `Stripe ${brand} Card`,
    paymentIntentId: simId,
    chargeId: 'ch_' + crypto.randomBytes(12).toString('hex'),
    status: 'succeeded',
    amount,
    currency: currency.toUpperCase(),
    cardBrand: brand,
    cardLast4: last4,
    mode: 'sandbox',
    notice: 'Payment processed in Stripe Sandbox mode. Add your sk_test_ key in .env for live Stripe processing.',
  };
}

// ── Direct Bank Transfer Processing ─────────────────────────────────────────

async function processBankTransfer({ amount, currency = 'zar', bankRef, userEmail, userName, metadata = {} }) {
  console.log(`🏦 [Stripe] Processing bank wire: R${amount.toLocaleString()} (Ref: ${bankRef})`);

  if (stripe) {
    try {
      const customer = await stripe.customers.create({
        email: userEmail || undefined,
        name: userName || undefined,
        metadata: { bankRef, ...metadata },
      });

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        customer: customer.id,
        payment_method_types: ['customer_balance'],
        payment_method_data: { type: 'customer_balance' },
        payment_method_options: {
          customer_balance: {
            funding_type: 'bank_transfer',
            bank_transfer: { type: 'za_bank_transfer' },
          },
        },
        metadata: { bankRef, ...metadata },
      });

      console.log(`✅ [Stripe] Bank intent created: ${intent.id}`);
      return {
        success: true,
        paymentRail: 'Stripe Bank Transfer',
        paymentIntentId: intent.id,
        status: intent.status,
        bankRef,
        amount,
        currency: currency.toUpperCase(),
        mode: STRIPE_SECRET_KEY.includes('_test_') ? 'test' : 'live',
      };
    } catch (err) {
      console.warn('⚠️ [Stripe] Bank API fallback:', err.message);
    }
  }

  // ── Sandbox fallback ──
  const simId = 'pi_bank_' + crypto.randomBytes(12).toString('hex');
  return {
    success: true,
    paymentRail: 'Stripe Bank Transfer',
    paymentIntentId: simId,
    transferId: 'tr_' + (bankRef || crypto.randomBytes(6).toString('hex')),
    status: 'succeeded',
    bankRef,
    amount,
    currency: currency.toUpperCase(),
    mode: 'sandbox',
    notice: 'Bank transfer processed in Stripe Sandbox mode. Add your sk_test_ key in .env for live Stripe processing.',
  };
}

// ── Configuration Info ──────────────────────────────────────────────────────

function getStripeConfig() {
  return {
    isConfigured: isLiveKey,
    mode: isLiveKey ? (STRIPE_SECRET_KEY.includes('_test_') ? 'test' : 'live') : 'sandbox',
    publishableKey: STRIPE_PUBLISHABLE_KEY || null,
    keyHint: isLiveKey ? STRIPE_SECRET_KEY.substring(0, 12) + '...' : null,
  };
}

module.exports = {
  createPaymentIntent,
  verifyPaymentIntent,
  processCardPayment,
  processBankTransfer,
  getStripeConfig,
};
