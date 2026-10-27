// ─── Portfolio Snapshot Service ───────────────────────────────────────────────
// Records and queries dated portfolio valuation snapshots for authentic time-series
// calculations (e.g. month-to-date performance and graph trend lines).
// Persists authoritatively to Supabase portfolio_snapshots with in-memory sync.

const supabase = require('../connection/supabaseClient');

// In-memory runtime cache for snapshots: userId -> Array<{ id, userId, portfolioValue, cashBalance, totalValue, holdingsCount, snapshotDate, createdAt }>
const snapshotsMap = new Map();

/**
 * Format a Date object to YYYY-MM-DD in UTC or local calendar
 */
function formatDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get start of current calendar month formatted as YYYY-MM-01
 */
function getStartOfMonthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Record or update a dated portfolio snapshot for a user.
 * @param {string} userId - UUID of user
 * @param {object} params
 * @param {number} params.portfolioValue - Total value of user's holdings
 * @param {number} [params.cashBalance=0] - Available cash balance
 * @param {number} [params.totalValue=0] - Combined net worth (assets + cash)
 * @param {number} [params.holdingsCount=0] - Number of asset holdings
 * @param {Date|string} [params.date] - Snapshot date (defaults to today)
 */
async function recordDailySnapshot(userId, {
  portfolioValue = 0,
  cashBalance = 0,
  totalValue = 0,
  holdingsCount = 0,
  date = new Date(),
} = {}) {
  if (!userId) return null;

  const dateStr = formatDateKey(date);
  const pVal = Number(portfolioValue) || 0;
  const cBal = Number(cashBalance) || 0;
  const tVal = totalValue ? Number(totalValue) : pVal + cBal;
  const count = Number(holdingsCount) || 0;

  const snapshotObj = {
    userId,
    portfolioValue: pVal,
    cashBalance: cBal,
    totalValue: tVal,
    holdingsCount: count,
    snapshotDate: dateStr,
    createdAt: new Date().toISOString(),
  };

  // 1. Update in-memory cache
  const userList = snapshotsMap.get(userId) || [];
  const existingIdx = userList.findIndex((s) => s.snapshotDate === dateStr);
  if (existingIdx >= 0) {
    userList[existingIdx] = { ...userList[existingIdx], ...snapshotObj };
  } else {
    userList.push(snapshotObj);
    userList.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }
  snapshotsMap.set(userId, userList);

  // 2. Persist to Supabase if available
  try {
    const { data, error } = await supabase
      .from('portfolio_snapshots')
      .upsert(
        {
          user_id: userId,
          portfolio_value: pVal,
          cash_balance: cBal,
          total_value: tVal,
          holdings_count: count,
          snapshot_date: dateStr,
        },
        { onConflict: 'user_id,snapshot_date' }
      )
      .select()
      .single();

    if (error) {
      // If table doesn't exist yet, gracefully warn without failing
      if (error.code !== '42P01' && !error.message?.includes('relation "public.portfolio_snapshots" does not exist')) {
        console.warn('⚠️ [PortfolioSnapshot] Supabase upsert error:', error.message);
      }
    } else if (data) {
      snapshotObj.id = data.id;
    }
  } catch (err) {
    console.warn('⚠️ [PortfolioSnapshot] DB persist skipped:', err.message);
  }

  return snapshotObj;
}

/**
 * Fetch all recorded snapshots for a user, ordered chronologically.
 */
async function getUserSnapshots(userId) {
  if (!userId) return [];

  // Try Supabase first
  try {
    const { data, error } = await supabase
      .from('portfolio_snapshots')
      .select('*')
      .eq('user_id', userId)
      .order('snapshot_date', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      const mapped = data.map((row) => ({
        id: row.id,
        userId: row.user_id,
        portfolioValue: Number(row.portfolio_value) || 0,
        cashBalance: Number(row.cash_balance) || 0,
        totalValue: Number(row.total_value) || 0,
        holdingsCount: Number(row.holdings_count) || 0,
        snapshotDate: row.snapshot_date,
        createdAt: row.created_at,
      }));
      snapshotsMap.set(userId, mapped);
      return mapped;
    }
  } catch (_err) {
    // Fall back to in-memory
  }

  return snapshotsMap.get(userId) || [];
}

/**
 * Computes monthly performance by comparing currentPortfolioValue with the value
 * at the start of the current calendar month.
 *
 * Rules:
 * - Start of month: Baseline snapshot on or immediately before YYYY-MM-01.
 * - If no baseline snapshot exists on or before the start of the current month (e.g. brand new user,
 *   or account created mid-month with no prior history), returns neutral unavailable state:
 *   `hasPerformanceHistory: false`, `monthlyChangePct: null`, `monthlyChangeFormatted: null`.
 * - If starting value is 0:
 *     - If current value is 0 -> 0.0%
 *     - If current value > 0 -> +100.0% (avoids division by zero)
 * - Negative changes are properly signed (e.g. -5.4%, -R250 this month) without errors.
 * - Returns dated graph history series for the current evaluation window.
 *
 * @param {string} userId
 * @param {number} currentPortfolioValue
 * @param {Date|string} [asOfDate=new Date()]
 */
async function getMonthlyPerformance(userId, currentPortfolioValue = 0, asOfDate = new Date()) {
  const currentVal = Number(currentPortfolioValue) || 0;
  const d = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
  const startOfMonthStr = getStartOfMonthKey(d);
  const todayStr = formatDateKey(d);

  const snapshots = await getUserSnapshots(userId);

  // Look for authoritative baseline snapshot on or before the start of current month
  const priorOrAtStart = snapshots.filter((s) => s.snapshotDate <= startOfMonthStr);
  const baselineSnapshot = priorOrAtStart.length > 0
    ? priorOrAtStart[priorOrAtStart.length - 1]
    : null;

  // Build time-series history
  const historySeries = [];

  if (!baselineSnapshot) {
    // No baseline snapshot at or before the start of this month.
    // Include current valuation point in history (or any snapshots recorded during month),
    // but report performance history as unavailable.
    snapshots.forEach((s) => {
      historySeries.push({ date: s.snapshotDate, value: s.portfolioValue });
    });

    // Ensure current valuation point is included
    const hasToday = historySeries.some((h) => h.date === todayStr);
    if (!hasToday) {
      historySeries.push({ date: todayStr, value: currentVal });
    }

    return {
      hasPerformanceHistory: false,
      performanceStatus: 'unavailable',
      performanceMessage: 'Performance history unavailable',
      baselineDate: null,
      baselineValue: null,
      currentValue: currentVal,
      monthlyChangeNum: null,
      monthlyChangePct: null,
      monthlyChangeFormatted: null,
      isPositive: true,
      history: historySeries,
    };
  }

  // Baseline exists! Calculate performance
  const startVal = Number(baselineSnapshot.portfolioValue) || 0;
  const diff = currentVal - startVal;

  let pctStr = '0.0%';
  if (startVal > 0) {
    const pct = ((diff / startVal) * 100).toFixed(1);
    pctStr = (diff >= 0 ? '+' : '') + pct + '%';
  } else if (startVal === 0) {
    if (currentVal > 0) {
      pctStr = '+100.0%';
    } else {
      pctStr = '0.0%';
    }
  }

  const isPositive = diff >= 0;
  const absDiff = Math.abs(Math.round(diff));
  const monthlyChangeFormatted = (diff >= 0 ? '+' : '-') + 'R' + absDiff.toLocaleString('en-ZA') + ' this month';

  // Construct dated graph history from baseline through snapshots up to current value
  const relevantSnapshots = snapshots.filter((s) => s.snapshotDate >= baselineSnapshot.snapshotDate);
  relevantSnapshots.forEach((s) => {
    historySeries.push({ date: s.snapshotDate, value: s.portfolioValue });
  });

  // Ensure current evaluation date is present as the latest point
  const lastPoint = historySeries[historySeries.length - 1];
  if (!lastPoint || lastPoint.date !== todayStr) {
    historySeries.push({ date: todayStr, value: currentVal });
  } else {
    // Update latest point with current valuation
    lastPoint.value = currentVal;
  }

  return {
    hasPerformanceHistory: true,
    performanceStatus: 'available',
    performanceMessage: monthlyChangeFormatted,
    baselineDate: baselineSnapshot.snapshotDate,
    baselineValue: startVal,
    currentValue: currentVal,
    monthlyChangeNum: diff,
    monthlyChangePct: pctStr,
    monthlyChangeFormatted,
    isPositive,
    history: historySeries,
  };
}

/**
 * Clear in-memory cache (primarily for tests)
 */
function clearMemoryCache() {
  snapshotsMap.clear();
}

/**
 * Seed a snapshot directly into memory (primarily for tests)
 */
function seedMemorySnapshot(userId, snapshot) {
  const list = snapshotsMap.get(userId) || [];
  list.push({
    userId,
    portfolioValue: Number(snapshot.portfolioValue) || 0,
    cashBalance: Number(snapshot.cashBalance) || 0,
    totalValue: Number(snapshot.totalValue) || 0,
    holdingsCount: Number(snapshot.holdingsCount) || 0,
    snapshotDate: snapshot.snapshotDate || formatDateKey(),
    createdAt: snapshot.createdAt || new Date().toISOString(),
  });
  list.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  snapshotsMap.set(userId, list);
}

module.exports = {
  recordDailySnapshot,
  getUserSnapshots,
  getMonthlyPerformance,
  formatDateKey,
  getStartOfMonthKey,
  clearMemoryCache,
  seedMemorySnapshot,
};
