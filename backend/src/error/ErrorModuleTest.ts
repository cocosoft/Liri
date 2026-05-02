import { ErrorCategory, ErrorSeverity, AppError, NetworkError, ValidationError } from './types';
import { errorTracker, ErrorTracker } from './tracker/ErrorTracker';
import { errorRecoverer, ErrorRecoverer } from './recovery/ErrorRecoverer';
import { errorWarner, ErrorWarner } from './warning/ErrorWarner';
import { errorManager, ErrorManager } from './ErrorManager';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  if (actual !== expected) {
    console.error(`  ✗ FAIL: ${message} (expected: ${expected}, actual: ${actual})`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function assertNotEqual(actual: any, expected: any, message: string): void {
  if (actual === expected) {
    console.error(`  ✗ FAIL: ${message} (should not equal: ${expected})`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

function makeError(category: ErrorCategory = ErrorCategory.NETWORK, severity: ErrorSeverity = ErrorSeverity.MEDIUM, code?: string): AppError {
  return new AppError(`Test ${category} error`, category, severity, code);
}

async function trackerTests(): Promise<void> {
  console.log('\n--- ErrorTracker Tests ---');

  const tracker = new ErrorTracker();

  const err1 = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_001');
  const err2 = makeError(ErrorCategory.FILESYSTEM, ErrorSeverity.MEDIUM, 'FS_001');
  const err3 = makeError(ErrorCategory.VALIDATION, ErrorSeverity.LOW, 'VAL_001');

  const id1 = tracker.track(err1, { requestId: 'req1' });
  const id2 = tracker.track(err2, { requestId: 'req2' });
  const id3 = tracker.track(err3, { requestId: 'req3' });

  assert(id1 !== undefined, 'track returns non-empty id');
  assertNotEqual(id1, id2, 'track returns unique ids');

  const retrieved = tracker.get(id1);
  assert(retrieved !== undefined, 'get returns tracked error');
  assertEqual(retrieved!.error.category, ErrorCategory.NETWORK, 'tracked error has correct category');
  assertEqual(retrieved!.context?.requestId, 'req1', 'tracked error has context');

  tracker.resolve(id1, 'Fixed by retrying');
  const resolved = tracker.get(id1);
  assert(resolved!.resolvedAt !== undefined, 'resolve sets resolvedAt');
  assertEqual(resolved!.resolution, 'Fixed by retrying', 'resolve stores resolution');

  const searchAll = tracker.search({});
  assertEqual(searchAll.length, 3, 'search returns all tracked errors');

  const searchNetwork = tracker.search({ categories: [ErrorCategory.NETWORK] });
  assertEqual(searchNetwork.length, 1, 'search filters by category');

  const searchResolved = tracker.search({ resolved: true });
  assertEqual(searchResolved.length, 1, 'search filters resolved');

  const searchUnresolved = tracker.search({ resolved: false });
  assertEqual(searchUnresolved.length, 2, 'search filters unresolved');

  const searchCode = tracker.search({ code: 'NET_001' });
  assertEqual(searchCode.length, 1, 'search filters by code');

  const analysis = tracker.analyze();
  assertEqual(analysis.totalTracked, 3, 'analyze returns total tracked');
  assertEqual(analysis.resolved, 1, 'analyze counts resolved');

  assertEqual(tracker.getUnresolvedCount(), 2, 'getUnresolvedCount returns correct count');

  tracker.clear();
  assertEqual(tracker.search({}).length, 0, 'clear removes all tracked errors');

  console.log('  --- Tracker tests passed ---');
}

async function recovererTests(): Promise<void> {
  console.log('\n--- ErrorRecoverer Tests ---');

  const recoverer = new ErrorRecoverer({ maxRetries: 2, retryDelay: 10 });

  let fallbackExecuted = false;
  recoverer.registerFallback('test_fallback', async () => {
    fallbackExecuted = true;
    return true;
  });

  let compensationExecuted = false;
  recoverer.registerCompensation('test_comp', async () => {
    compensationExecuted = true;
    return true;
  });

  const err = makeError(ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, 'NET_001');
  const result = await recoverer.recover('test1', err, {
    maxRetries: 1,
    retryDelay: 5,
    retryableErrors: [{ category: ErrorCategory.NETWORK }],
  });

  assert(result.success, 'recover succeeds for recoverable error');
  assert(result.executedActions.length > 0, 'recovery executes at least one action');
  assert(result.duration >= 0, 'recovery measures duration');

  assert(!fallbackExecuted, 'recovery does not execute fallback when retry succeeds');

  const plan = recoverer.getPlan('test1');
  assert(plan !== undefined, 'getPlan returns stored plan');

  const stats = recoverer.getStats();
  assertEqual(stats.succeeded, 1, 'recovery stats count successes');

  const nonRecoverable = makeError(ErrorCategory.FILESYSTEM, ErrorSeverity.CRITICAL, 'CRIT_001');
  const critResult = await recoverer.recover('test2', nonRecoverable);
  assert(!critResult.success, 'recovery skips non-recoverable errors');

  recoverer.clear();
  assertEqual(recoverer.getStats().totalPlans, 0, 'clear removes all plans');

  console.log('  --- Recoverer tests passed ---');
}

async function warnerTests(): Promise<void> {
  console.log('\n--- ErrorWarner Tests ---');

  const warner = new ErrorWarner();

  warner.addThreshold({
    name: 'high_network_count',
    type: 'count',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    window: 60000,
    value: 3,
    level: 'warning',
  });

  warner.addThreshold({
    name: 'critical_any',
    type: 'count',
    severity: ErrorSeverity.CRITICAL,
    window: 60000,
    value: 1,
    level: 'critical',
  });

  const err = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_001');
  const err2 = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_002');

  let alert1 = warner.evaluate(err);
  assert(alert1 === null, 'no alert before threshold exceeded');

  const err3 = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_003');
  let alert2 = warner.evaluate(err3);
  assert(alert2 === null, 'still no alert with 2 errors (threshold=3)');

  const err4 = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_004');
  let alert3 = warner.evaluate(err4);
  assert(alert3 !== null, 'alert triggered when threshold exceeded');
  if (alert3) {
    assertEqual(alert3.threshold, 'high_network_count', 'alert references correct threshold');
    assertEqual(alert3.level, 'warning', 'alert has correct level');
  }

  const criticalErr = makeError(ErrorCategory.PERMISSION, ErrorSeverity.CRITICAL, 'CRIT_001');
  const criticalAlert = warner.evaluate(criticalErr);
  assert(criticalAlert !== null, 'critical severity triggers immediate alert');
  if (criticalAlert) {
    assertEqual(criticalAlert.level, 'critical', 'critical alert has critical level');
  }

  warner.acknowledgeAlert(alert3!.id, 'test_user');
  const acknowledged = warner.getAlerts({ acknowledged: true });
  assert(acknowledged.length >= 1, 'acknowledgeAlert marks alert as acknowledged');

  const stats = warner.getStats();
  assert(stats.totalAlerts >= 2, 'getStats returns total alerts');
  assert(stats.criticalCount >= 1, 'getStats counts critical alerts');

  warner.clear();
  assertEqual(warner.getStats().totalAlerts, 0, 'clear removes all alerts');

  console.log('  --- Warner tests passed ---');
}

async function integrationTests(): Promise<void> {
  console.log('\n--- Integration Tests ---');

  const mgr = new ErrorManager({
    autoTrack: true,
    autoRecover: true,
    autoWarn: true,
    defaultRetryOptions: {
      maxRetries: 1,
      retryDelay: 5,
      retryableErrors: [{ category: ErrorCategory.NETWORK }],
    },
  });

  const recoverer = mgr.getRecoverer();
  recoverer.registerFallback('int_fallback', async () => true);

  const warner = mgr.getWarner();
  warner.addThreshold({
    name: 'int_network_threshold',
    type: 'count',
    category: ErrorCategory.NETWORK,
    window: 60000,
    value: 2,
    level: 'warning',
  });

  const err = makeError(ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'NET_INT');
  const result = await mgr.handleError(err, { source: 'integration_test' });

  assert(result.trackedId !== undefined, 'integration handleError tracks error');

  const tracker = mgr.getTracker();
  const tracked = tracker.get(result.trackedId!);
  assert(tracked !== undefined, 'tracked error is retrievable');
  assertEqual(tracked!.error.code, 'NET_INT', 'tracked error has correct code');

  const stats = mgr.getStats();
  assert(stats.monitor.totalErrors >= 1, 'getStats includes monitor data');
  assert(stats.tracker.totalTracked >= 1, 'getStats includes tracker data');

  const summary = mgr.getSummary();
  assert(summary.includes('Error Manager Summary'), 'getSummary returns formatted summary');

  mgr.reset();
  assertEqual(mgr.getStats().tracker.totalTracked, 0, 'reset clears all data');

  let wrappedCalled = false;
  const wrappedFn = mgr.wrapAsync(async () => {
    wrappedCalled = true;
    return 'success';
  });

  const wrappedResult = await wrappedFn();
  assertEqual(wrappedResult, 'success', 'wrapAsync returns function result on success');
  assert(wrappedCalled, 'wrapAsync executes wrapped function');

  console.log('  --- Integration tests passed ---');
}

async function main(): Promise<void> {
  console.log('=== Error Module Tests ===');

  await trackerTests();
  await recovererTests();
  await warnerTests();
  await integrationTests();

  console.log('\n=== All Error Module Tests Complete ===');
}

main().catch(console.error);
