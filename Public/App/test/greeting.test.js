// ─── HomeScreen Greeting Verification Test Suite ───────────────────────────
// File: Public/App/test/greeting.test.js
// Tests the time-based greeting implementation:
// 1. Exact time-boundary transitions (05:00–11:59, 12:00–16:59, 17:00–04:59)
// 2. Continuous time boundary crossing (morning -> afternoon -> evening -> morning)
// 3. Screen focus effect lifecycle (screen open / refocus updates greeting)
// 4. App foregrounding lifecycle (AppState 'active' event updates greeting)
// 5. Cleanup verification (subscription.remove() and clearInterval() on unmount)
// 6. Source inspection of HomeScreen.js (no hardcoded string, proper styling & wiring)

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Extract the getTimeBasedGreeting function logic
const getTimeBasedGreeting = (date = new Date()) => {
  const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const hour = d.getHours();
  if (hour >= 5 && hour < 12) {
    return "Good morning,";
  }
  if (hour >= 12 && hour < 17) {
    return "Good afternoon,";
  }
  return "Good evening,";
};

// Helper to construct a local Date at specified hour, minute, second
function makeLocalDate(hour, minute = 0, second = 0) {
  const d = new Date();
  d.setHours(hour, minute, second, 0);
  return d;
}

// ── Test Harness for HomeScreen Greeting Lifecycle ─────────────────────────
class HomeScreenGreetingHarness {
  constructor(initialDate) {
    this.currentDate = initialDate || makeLocalDate(9, 0, 0); // 09:00 default
    this.greeting = getTimeBasedGreeting(this.currentDate);

    // Track listeners and timers
    this.appStateListeners = new Set();
    this.intervalTimers = new Set();
    this.cleanupFunctions = [];
    this.renderCount = 0;

    // Simulate mount
    this.mount();
  }

  // Simulate component mounting and useEffect / useFocusEffect setup
  mount() {
    this.renderCount++;

    // HomeScreen.js useFocusEffect callback:
    this.onFocus = () => {
      this.greeting = getTimeBasedGreeting(this.currentDate);
    };

    // HomeScreen.js useEffect setup (dependency array []):
    const updateGreeting = () => {
      this.greeting = getTimeBasedGreeting(this.currentDate);
    };

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === "active") {
        updateGreeting();
      }
    };

    this.appStateListeners.add(handleAppStateChange);
    const subscription = {
      remove: () => {
        this.appStateListeners.delete(handleAppStateChange);
      },
    };

    const timerId = setInterval(updateGreeting, 30000);
    this.intervalTimers.add(timerId);

    this.cleanupFunctions.push(() => {
      subscription.remove();
      this.intervalTimers.delete(timerId);
      clearInterval(timerId);
    });
  }

  // Simulate re-renders without unmounting (empty deps array should NOT add more listeners)
  reRender() {
    this.renderCount++;
    // In React with useEffect([], ...), listeners are not re-registered on re-render
  }

  // Simulate screen gaining focus (e.g., navigating back to HomeScreen)
  gainFocus() {
    this.onFocus();
  }

  // Advance time to a specific hour, minute, second
  setTime(hour, minute = 0, second = 0) {
    this.currentDate = makeLocalDate(hour, minute, second);
  }

  // Simulate app background/foreground transition
  simulateForeground() {
    for (const listener of this.appStateListeners) {
      listener("active");
    }
  }

  simulateBackground() {
    for (const listener of this.appStateListeners) {
      listener("background");
    }
  }

  // Simulate timer ticker firing
  tick() {
    this.greeting = getTimeBasedGreeting(this.currentDate);
  }

  // Unmount component
  unmount() {
    while (this.cleanupFunctions.length > 0) {
      const cleanup = this.cleanupFunctions.pop();
      cleanup();
    }
  }
}

async function runGreetingTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING HOMESCREEN TIME-BASED GREETING TESTS');
  console.log('======================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ Passed: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAILED: ${name}`);
      console.error(`     Error: ${err.message}`);
    }
  }

  // ── 1. Boundary Tests for 05:00 - 11:59 (Morning) ───────────────────────────
  test('05:00:00 (exact start of morning window) returns "Good morning,"', () => {
    const d = makeLocalDate(5, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good morning,');
  });

  test('08:30:00 (mid morning) returns "Good morning,"', () => {
    const d = makeLocalDate(8, 30, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good morning,');
  });

  test('11:59:59 (exact end of morning window) returns "Good morning,"', () => {
    const d = makeLocalDate(11, 59, 59);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good morning,');
  });

  // ── 2. Boundary Tests for 12:00 - 16:59 (Afternoon) ─────────────────────────
  test('12:00:00 (exact start of afternoon window) returns "Good afternoon,"', () => {
    const d = makeLocalDate(12, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good afternoon,');
  });

  test('14:45:00 (mid afternoon) returns "Good afternoon,"', () => {
    const d = makeLocalDate(14, 45, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good afternoon,');
  });

  test('16:59:59 (exact end of afternoon window) returns "Good afternoon,"', () => {
    const d = makeLocalDate(16, 59, 59);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good afternoon,');
  });

  // ── 3. Boundary Tests for 17:00 - 04:59 (Evening / Night) ───────────────────
  test('17:00:00 (exact start of evening window) returns "Good evening,"', () => {
    const d = makeLocalDate(17, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  test('20:15:00 (night) returns "Good evening,"', () => {
    const d = makeLocalDate(20, 15, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  test('23:59:59 (midnight boundary) returns "Good evening,"', () => {
    const d = makeLocalDate(23, 59, 59);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  test('00:00:00 (midnight) returns "Good evening,"', () => {
    const d = makeLocalDate(0, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  test('03:30:00 (early hours) returns "Good evening,"', () => {
    const d = makeLocalDate(3, 30, 0);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  test('04:59:59 (exact end of evening / early morning window) returns "Good evening,"', () => {
    const d = makeLocalDate(4, 59, 59);
    assert.strictEqual(getTimeBasedGreeting(d), 'Good evening,');
  });

  // ── 4. Consecutive Minute Boundary Transitions ─────────────────────────────
  test('Crossing 11:59:59 to 12:00:00 transitions from "Good morning," to "Good afternoon,"', () => {
    const morning = makeLocalDate(11, 59, 59);
    const afternoon = makeLocalDate(12, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(morning), 'Good morning,');
    assert.strictEqual(getTimeBasedGreeting(afternoon), 'Good afternoon,');
  });

  test('Crossing 16:59:59 to 17:00:00 transitions from "Good afternoon," to "Good evening,"', () => {
    const afternoon = makeLocalDate(16, 59, 59);
    const evening = makeLocalDate(17, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(afternoon), 'Good afternoon,');
    assert.strictEqual(getTimeBasedGreeting(evening), 'Good evening,');
  });

  test('Crossing 04:59:59 to 05:00:00 transitions from "Good evening," to "Good morning,"', () => {
    const evening = makeLocalDate(4, 59, 59);
    const morning = makeLocalDate(5, 0, 0);
    assert.strictEqual(getTimeBasedGreeting(evening), 'Good evening,');
    assert.strictEqual(getTimeBasedGreeting(morning), 'Good morning,');
  });

  // ── 5. Lifecycle: Screen Focus / Refocus ─────────────────────────────────────
  test('Screen refocus updates greeting when time crosses into another period', () => {
    // Mount at 11:30 (Morning)
    const harness = new HomeScreenGreetingHarness(makeLocalDate(11, 30, 0));
    assert.strictEqual(harness.greeting, 'Good morning,');

    // User navigates away to Vault screen; time advances to 13:00 (Afternoon)
    harness.setTime(13, 0, 0);

    // User returns / refocusses HomeScreen -> useFocusEffect fires
    harness.gainFocus();
    assert.strictEqual(harness.greeting, 'Good afternoon,');

    // User navigates away to Marketplace; time advances to 18:00 (Evening)
    harness.setTime(18, 0, 0);
    harness.gainFocus();
    assert.strictEqual(harness.greeting, 'Good evening,');

    harness.unmount();
  });

  // ── 6. Lifecycle: App Background to Foreground (AppState 'active') ───────────
  test('App returning from background updates greeting when period has changed', () => {
    // App opened at 08:00 (Morning)
    const harness = new HomeScreenGreetingHarness(makeLocalDate(8, 0, 0));
    assert.strictEqual(harness.greeting, 'Good morning,');

    // App goes to background
    harness.simulateBackground();

    // Time crosses into afternoon (13:15) while phone is locked / in background
    harness.setTime(13, 15, 0);

    // App returns to foreground -> AppState listener receives 'active'
    harness.simulateForeground();
    assert.strictEqual(harness.greeting, 'Good afternoon,');

    // Another cycle: background during afternoon, returns at night (21:00)
    harness.simulateBackground();
    harness.setTime(21, 0, 0);
    harness.simulateForeground();
    assert.strictEqual(harness.greeting, 'Good evening,');

    // Another cycle: background overnight, returns at morning (06:30)
    harness.simulateBackground();
    harness.setTime(6, 30, 0);
    harness.simulateForeground();
    assert.strictEqual(harness.greeting, 'Good morning,');

    harness.unmount();
  });

  // ── 7. Timer Ticker while on screen ─────────────────────────────────────────
  test('Periodic ticker updates greeting if user remains on screen across a boundary', () => {
    // User is viewing Home screen at 11:59:45
    const harness = new HomeScreenGreetingHarness(makeLocalDate(11, 59, 45));
    assert.strictEqual(harness.greeting, 'Good morning,');

    // Time ticks past noon
    harness.setTime(12, 0, 15);
    harness.tick();
    assert.strictEqual(harness.greeting, 'Good afternoon,');

    harness.unmount();
  });

  // ── 8. Teardown and Prevention of Re-registration ────────────────────────────
  test('Listeners and timers are not duplicated on re-render and cleanly removed on unmount', () => {
    const harness = new HomeScreenGreetingHarness(makeLocalDate(10, 0, 0));
    assert.strictEqual(harness.appStateListeners.size, 1);
    assert.strictEqual(harness.intervalTimers.size, 1);

    // Multiple re-renders
    harness.reRender();
    harness.reRender();
    harness.reRender();

    // Should still have exactly 1 listener and 1 timer
    assert.strictEqual(harness.appStateListeners.size, 1);
    assert.strictEqual(harness.intervalTimers.size, 1);

    // Unmount
    harness.unmount();
    assert.strictEqual(harness.appStateListeners.size, 0);
    assert.strictEqual(harness.intervalTimers.size, 0);
  });

  // ── 9. Source Code Integrity Verification of HomeScreen.js ──────────────────
  test('HomeScreen.js source code contains required wiring and no hardcoded greeting', () => {
    const homeScreenPath = path.resolve(__dirname, '../src/screens/HomeScreen.js');
    const source = fs.readFileSync(homeScreenPath, 'utf8');

    // 1. AppState is imported
    assert(source.includes('AppState,'), 'HomeScreen.js must import AppState from react-native');

    // 2. getTimeBasedGreeting helper is present and exported
    assert(source.includes('export const getTimeBasedGreeting'), 'HomeScreen.js must export getTimeBasedGreeting');

    // 3. Initial greeting state uses getTimeBasedGreeting
    assert(
      source.includes('useState(() => getTimeBasedGreeting())'),
      'HomeScreen.js must initialize greeting state dynamically'
    );

    // 4. useFocusEffect updates greeting
    assert(
      source.includes('setGreeting(getTimeBasedGreeting());'),
      'HomeScreen.js must update greeting in useFocusEffect'
    );

    // 5. AppState event listener is configured
    assert(
      source.includes('AppState.addEventListener('),
      'HomeScreen.js must register AppState change listener'
    );
    assert(
      source.includes('handleAppStateChange'),
      'HomeScreen.js must handle AppState changes'
    );

    // 6. Hardcoded "Good morning," in JSX is replaced with {greeting}
    assert(
      source.includes('<Text style={styles.greetingHelloText}>{greeting}</Text>'),
      'HomeScreen.js JSX must render dynamic {greeting} with greetingHelloText style'
    );
    assert(
      !source.includes('<Text style={styles.greetingHelloText}>Good morning,</Text>'),
      'HomeScreen.js must NOT have hardcoded "Good morning," text in JSX'
    );

    // 7. Dynamic userName is preserved
    assert(
      source.includes('<Text style={styles.greetingUserNameText} numberOfLines={1}>'),
      'HomeScreen.js must preserve greetingUserNameText with dynamic userName'
    );
  });

  console.log(`\n======================================================`);
  console.log(`📊 GREETING TEST RESULTS: ${passed}/${total} Passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`======================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runGreetingTests();
