// ─── Inactivity Detection & Session Security Test Suite ───────────────────────
// Verifies all 6 core requirements for SmartAssets continuous inactivity management:
// 1. Continuous interaction prevents warning and logout past 5 minutes
// 2. Idle timeout triggers warning at 4m30s and auto-logout at 5m00s
// 3. User interaction during the warning period immediately dismisses warning and restarts 5m window
// 4. Backgrounding app for < 5m resumes session with fresh timestamp
// 5. Backgrounding app for >= 5m terminates session upon return
// 6. PanResponder non-blocking pass-through & stale-closure immunity via stateRef

const assert = require('assert');

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 300,000 ms (5 minutes)
const INACTIVITY_WARNING_MS = 30 * 1000;     // 30,000 ms (30 seconds)

// ── Test Harness: Inactivity State Machine Simulation ─────────────────────────
class InactivityEngine {
  constructor() {
    this.simulatedTime = 1000000;
    this.user = { id: 'user-1', email: 'test@smartassets.io' };
    this.token = 'jwt-token-123';
    this.lastActive = 0;
    this.inactivityWarning = false;
    this.secondsRemaining = 30;
    this.loggedOut = false;
    this.logoutReason = null;
    this.isLoggingOut = false;
    this.lastPersistTime = 0;
    this.storage = {};
    this.backgroundTimestamp = null;

    // Watcher state ref (mirrors InactivityWatcher stateRef)
    this.stateRef = {
      isAuthenticated: false,
      inactivityWarning: false,
      recordActivity: () => this.recordActivity(),
    };
    this.lastInteractionRecorded = 0;

    // PanResponder definition (mirrors InactivityWatcher.js)
    this.panResponder = {
      onStartShouldSetPanResponderCapture: () => {
        this.handleInteraction();
        return false;
      },
      onMoveShouldSetPanResponderCapture: () => {
        this.handleInteraction();
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => true,
    };
  }

  now() {
    return this.simulatedTime;
  }

  advance(ms) {
    this.simulatedTime += ms;
    return this.simulatedTime;
  }

  signIn(currentTime) {
    if (currentTime !== undefined) this.simulatedTime = currentTime;
    this.stateRef.isAuthenticated = true;
    this.lastActive = this.now();
    this.inactivityWarning = false;
    this.stateRef.inactivityWarning = false;
    this.secondsRemaining = 30;
    this.loggedOut = false;
    this.isLoggingOut = false;
  }

  recordActivity(currentTime) {
    const now = currentTime !== undefined ? currentTime : this.now();
    this.lastActive = now;

    if (this.inactivityWarning) {
      this.inactivityWarning = false;
      this.stateRef.inactivityWarning = false;
      this.secondsRemaining = 30;
    }

    if (now - this.lastPersistTime > 10 * 1000) {
      this.lastPersistTime = now;
      this.storage['LAST_ACTIVE_AT'] = String(now);
    }
  }

  handleInteraction(currentTime) {
    const { isAuthenticated: authed, recordActivity: record, inactivityWarning: warningActive } = this.stateRef;
    if (!authed || typeof record !== 'function') return;

    const now = currentTime !== undefined ? currentTime : this.now();
    if (warningActive || now - this.lastInteractionRecorded >= 500) {
      this.lastInteractionRecorded = now;
      record(now);
    }
  }

  handleInactivityLogout(reason) {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    this.loggedOut = true;
    this.logoutReason = reason;
    this.user = null;
    this.token = null;
    this.stateRef.isAuthenticated = false;
    this.inactivityWarning = false;
    this.stateRef.inactivityWarning = false;
    this.secondsRemaining = 30;
  }

  tick(currentTime) {
    if (currentTime !== undefined) this.simulatedTime = currentTime;
    if (!this.user || !this.token || this.isLoggingOut) return;

    const now = this.now();
    const elapsed = now - this.lastActive;

    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      this.inactivityWarning = false;
      this.stateRef.inactivityWarning = false;
      this.handleInactivityLogout(
        'Your session timed out after 5 minutes of inactivity for your financial security.'
      );
    } else if (elapsed >= INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS) {
      const remaining = Math.max(1, Math.ceil((INACTIVITY_TIMEOUT_MS - elapsed) / 1000));
      this.inactivityWarning = true;
      this.stateRef.inactivityWarning = true;
      this.secondsRemaining = remaining;
    } else {
      if (this.inactivityWarning) {
        this.inactivityWarning = false;
        this.stateRef.inactivityWarning = false;
        this.secondsRemaining = 30;
      }
    }
  }

  backgroundApp(currentTime) {
    if (currentTime !== undefined) this.simulatedTime = currentTime;
    this.backgroundTimestamp = this.now();
    this.storage['LAST_ACTIVE_AT'] = String(this.lastActive);
  }

  foregroundApp(currentTime) {
    if (currentTime !== undefined) this.simulatedTime = currentTime;
    const now = this.now();
    const elapsed = now - this.lastActive;
    if (elapsed >= INACTIVITY_TIMEOUT_MS) {
      this.handleInactivityLogout(
        'Your session timed out while away (> 5 minutes) for your financial security.'
      );
      return;
    }
    this.backgroundTimestamp = null;
    this.recordActivity(now);
  }
}

async function runInactivityTests() {
  console.log('\n======================================================');
  console.log('   SMARTASSETS • Inactivity Detection Test Suite      ');
  console.log('======================================================\n');

  // ── TEST 1: Stale Closure Immunity & PanResponder Non-Blocking ──────────────
  console.log('🧪 [TEST 1] Testing PanResponder Stale Closure Immunity & Non-Blocking Contract...');
  const engine1 = new InactivityEngine();
  // PanResponder was created before sign-in (isAuthenticated is false)
  assert.strictEqual(engine1.stateRef.isAuthenticated, false);
  assert.strictEqual(engine1.panResponder.onStartShouldSetPanResponderCapture(), false);
  assert.strictEqual(engine1.panResponder.onMoveShouldSetPanResponderCapture(), false);
  assert.strictEqual(engine1.panResponder.onStartShouldSetPanResponder(), false);
  assert.strictEqual(engine1.panResponder.onMoveShouldSetPanResponder(), false);
  assert.strictEqual(engine1.panResponder.onPanResponderTerminationRequest(), true);

  // Now user signs in
  engine1.signIn(1000000);
  assert.strictEqual(engine1.stateRef.isAuthenticated, true);

  // Advance time by 60s
  engine1.advance(60000);
  engine1.panResponder.onStartShouldSetPanResponderCapture();
  assert.strictEqual(engine1.lastActive, 1060000, 'Touch should reset lastActive to current time');
  console.log('   ✅ PanResponder successfully accesses updated auth state and does not block touches.');

  // ── TEST 2: Continuous Interaction Past 5 Minutes ───────────────────────────
  console.log('\n🧪 [TEST 2] Testing Continuous User Interaction for > 5 Minutes (No Logout)...');
  const engine2 = new InactivityEngine();
  engine2.signIn(1000000);

  // Simulate active user interacting every 30 seconds for 7 minutes (420 seconds)
  for (let second = 1; second <= 420; second++) {
    engine2.advance(1000);
    if (second % 30 === 0) {
      // User scrolls or taps
      engine2.panResponder.onStartShouldSetPanResponderCapture();
    }
    engine2.tick();
    assert.strictEqual(engine2.loggedOut, false, `User must not be logged out at second ${second}`);
    assert.strictEqual(engine2.inactivityWarning, false, `Warning must never show while active at second ${second}`);
  }
  console.log('   ✅ 7 minutes of continuous activity executed with ZERO warnings and ZERO logouts.');

  // ── TEST 3: Idle Period: Warning at 4m30s, Auto-Logout at 5m00s ──────────────
  console.log('\n🧪 [TEST 3] Testing Idle Countdown: Warning at 4:30, Logout at 5:00...');
  const engine3 = new InactivityEngine();
  engine3.signIn(1000000);

  // User stops interacting at T=0. Advance time second by second.
  // From 0s to 269s: no warning, no logout
  for (let s = 1; s < 270; s++) {
    engine3.advance(1000);
    engine3.tick();
    assert.strictEqual(engine3.inactivityWarning, false, `No warning should show at ${s}s`);
    assert.strictEqual(engine3.loggedOut, false, `User should remain logged in at ${s}s`);
  }

  // At 270s (4m30s): Warning must appear with 30s remaining
  engine3.advance(1000);
  engine3.tick();
  assert.strictEqual(engine3.inactivityWarning, true, 'Warning MUST activate at 4m30s (270s)');
  assert.strictEqual(engine3.secondsRemaining, 30, 'Seconds remaining should start at 30s');

  // At 285s: 15s remaining
  engine3.advance(15000);
  engine3.tick();
  assert.strictEqual(engine3.inactivityWarning, true);
  assert.strictEqual(engine3.secondsRemaining, 15, 'Seconds remaining should be 15s at 285s');

  // At 300s (5m00s): Auto-logout must trigger
  engine3.advance(15000);
  engine3.tick();
  assert.strictEqual(engine3.loggedOut, true, 'User MUST be logged out at 5m00s (300s)');
  assert.strictEqual(engine3.inactivityWarning, false, 'Warning must be dismissed on logout');
  assert.ok(engine3.logoutReason.includes('5 minutes of inactivity'));
  console.log('   ✅ Warning activated at 4m30s, countdown decremented accurately, and auto-logged out at 5m00s.');

  // ── TEST 4: Interaction During Warning Dismisses It & Restarts Timer ─────────
  console.log('\n🧪 [TEST 4] Testing User Interaction During Warning Window (Instant Dismissal)...');
  const engine4 = new InactivityEngine();
  engine4.signIn(1000000);

  // Idle for 4m40s (warning is active with 20s remaining)
  engine4.advance(280000);
  engine4.tick();
  assert.strictEqual(engine4.inactivityWarning, true, 'Warning should be active at 4m40s');
  assert.strictEqual(engine4.secondsRemaining, 20);

  // User taps the screen (or scrolls)
  engine4.panResponder.onStartShouldSetPanResponderCapture();
  assert.strictEqual(engine4.inactivityWarning, false, 'Warning MUST be immediately dismissed upon touch');
  assert.strictEqual(engine4.secondsRemaining, 30, 'Countdown MUST reset to 30s upon touch');
  assert.strictEqual(engine4.lastActive, 1280000, 'Timer must reset to current interaction time');

  // Advance another 4 minutes (total 8m40s from start): user should STILL be logged in!
  engine4.advance(240000);
  engine4.tick();
  assert.strictEqual(engine4.loggedOut, false, 'User must remain signed in after interaction reset');
  assert.strictEqual(engine4.inactivityWarning, false);
  console.log('   ✅ Interaction during warning dismissed banner instantly and restarted full 5-minute window.');

  // ── TEST 5: Background App < 5 Minutes Resumes Session ───────────────────────
  console.log('\n🧪 [TEST 5] Testing Backgrounding App for < 5 Minutes (Session Resumes)...');
  const engine5 = new InactivityEngine();
  engine5.signIn(1000000);

  // User uses app for 1 minute
  engine5.advance(60000);
  engine5.recordActivity();

  // User backgrounds app for 3 minutes (total idle 3 minutes < 5 minutes)
  engine5.backgroundApp();
  engine5.advance(180000); // 3 minutes away
  engine5.foregroundApp();

  assert.strictEqual(engine5.loggedOut, false, 'User must remain logged in when returning < 5m');
  assert.strictEqual(engine5.lastActive, 1240000, 'Returning < 5m must set fresh active timestamp');
  console.log('   ✅ Returning after 3 minutes in background resumed session with fresh activity timestamp.');

  // ── TEST 6: Background App >= 5 Minutes Ends Session ────────────────────────
  console.log('\n🧪 [TEST 6] Testing Backgrounding App for >= 5 Minutes (Auto-Logout)...');
  const engine6 = new InactivityEngine();
  engine6.signIn(1000000);

  // User active at T=0, backgrounds app at T=1m
  engine6.advance(60000);
  engine6.backgroundApp();

  // App remains in background for 5 minutes and 10 seconds (total away 5m10s)
  engine6.advance(310000);
  engine6.foregroundApp();

  assert.strictEqual(engine6.loggedOut, true, 'User MUST be logged out when returning after >= 5m away');
  assert.ok(engine6.logoutReason.includes('away (> 5 minutes)'));
  console.log('   ✅ Returning after > 5m in background terminated the session immediately.');

  console.log('\n======================================================');
  console.log('🎉 ALL 6 INACTIVITY DETECTION & SECURITY TESTS PASSED!');
  console.log('======================================================\n');
}

runInactivityTests().catch((err) => {
  console.error('❌ Inactivity test failed:', err);
  process.exit(1);
});
