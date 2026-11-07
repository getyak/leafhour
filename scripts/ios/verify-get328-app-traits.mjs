// Verify observations from three distinct sources. This module never queries a
// Simulator, launches an App, or substitutes an environment declaration.
const appID = 'org.leafhour.get328.acceptance20261107';
const runnerID = appID + '.uitests.xctrunner';
const categories = new Map([
  ['extra-small', 'UICTContentSizeCategoryXS'],
  ['small', 'UICTContentSizeCategoryS'],
  ['medium', 'UICTContentSizeCategoryM'],
  ['large', 'UICTContentSizeCategoryL'],
  ['extra-large', 'UICTContentSizeCategoryXL'],
  ['extra-extra-large', 'UICTContentSizeCategoryXXL'],
  ['extra-extra-extra-large', 'UICTContentSizeCategoryXXXL'],
  ['accessibility-medium', 'UICTContentSizeCategoryAccessibilityM'],
  ['accessibility-large', 'UICTContentSizeCategoryAccessibilityL'],
  ['accessibility-extra-large', 'UICTContentSizeCategoryAccessibilityXL'],
  ['accessibility-extra-extra-large', 'UICTContentSizeCategoryAccessibilityXXL'],
  ['accessibility-extra-extra-extra-large', 'UICTContentSizeCategoryAccessibilityXXXL'],
]);
const methods = new Map([
  ['test38SavedRecordsAndExpandedSettingsPassNativeAccessibilityAudits', 'VideoExperienceUITests'],
  ['test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable', 'VideoExperienceUITests'],
  ['test54PagedNativeCopyAndReflowKeepTheVisibleSourceParagraph', 'VideoExperienceUITests'],
  ['testPDFSystemImportAndLastPage', 'ReadingUITests'],
]);
const triggers = new Set(['startup', 'window-became-key', 'application-active', 'content-size-category-changed']
  .flatMap(value => [value, value + '-settled']));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pid = value => Number.isSafeInteger(value) && value > 1;
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

export function categoryForSystemToken(token) { return categories.get(token) ?? null; }

/** All input samples in unit tests are synthetic. Only the native producers can
 * establish provenance; this verifier checks their identity, time and agreement. */
export function verifyGET328TypeProfile(input = {}) {
  const errors = [], observed = {};
  const fail = message => errors.push(message);
  if (!record(input)) return {ok: false, errors: ['Missing type-profile inputs'], observed};
  const {appReceipt: app, runnerReceipt: runner, osContentSize, notBefore, expectedTestMethod} = input;
  const expected = categoryForSystemToken(osContentSize), since = time(notBefore);
  if (!expected) fail('OS content_size is missing or unknown');
  if (!Number.isFinite(since)) fail('Case-start timestamp is missing or invalid');
  const expectedClass = methods.get(expectedTestMethod);
  if (!expectedClass) fail('Expected test method is not in the four-case contract');
  observed.osCategory = expected;
  if (!record(app)) fail('Missing App receipt');
  else {
    if (app.schemaVersion !== 1 || app.bundleIdentifier !== appID || !pid(app.processIdentifier)) fail('App receipt identity/schema is invalid');
    if (typeof app.launchIdentifier !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(app.launchIdentifier)) fail('App launch identifier is missing or invalid');
    const samples = app.samples;
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > 64) fail('App sample history is empty or outside its bound');
    else {
      let previousSequence = 0, previousTime = -Infinity;
      for (const sample of samples) {
        if (!record(sample)) { fail('Malformed App sample'); continue; }
        const sampledAt = time(sample.sampledAt);
        if (!Number.isSafeInteger(sample.sequence) || sample.sequence <= previousSequence) fail('App sample sequences must increase');
        if (!Number.isFinite(sampledAt) || sampledAt < previousTime) fail('App sample times are invalid or reversed');
        previousSequence = sample.sequence;
        previousTime = sampledAt;
      }
      const latest = samples.at(-1);
      if (record(latest)) {
        if (!triggers.has(latest.trigger) || latest.status !== 'observed'
            || latest.windowIsKey !== true || latest.sceneActivationState !== 'foregroundActive'
            || !Array.isArray(latest.issues) || latest.issues.length !== 0) fail('Latest App sample is not an available foreground key-window observation');
        if (!Number.isFinite(time(latest.sampledAt)) || time(latest.sampledAt) < since) fail('Latest App sample predates this case');
        const accessibility = typeof expected === 'string' && expected.includes('Accessibility');
        for (const [name, flag] of [['applicationCategory', 'applicationIsAccessibilityCategory'], ['windowCategory', 'windowIsAccessibilityCategory']]) {
          if (!expected || latest[name] !== expected) fail('App ' + name + ' does not match the observed OS category');
          if (typeof latest[flag] !== 'boolean' || latest[flag] !== accessibility) fail('App ' + flag + ' is inconsistent');
        }
        observed.appCategory = latest.applicationCategory;
        observed.windowCategory = latest.windowCategory;
        observed.appProcessIdentifier = app.processIdentifier;
        observed.appLaunchIdentifier = app.launchIdentifier;
        observed.appSampledAt = latest.sampledAt;
      }
    }
  }
  if (!record(runner)) fail('Missing Runner receipt');
  else {
    if (runner.schemaVersion !== 1 || runner.bundleIdentifier !== runnerID || !pid(runner.processIdentifier)) fail('Runner receipt identity/schema is invalid');
    if (!Number.isFinite(time(runner.sampledAt)) || time(runner.sampledAt) < since) fail('Runner observation predates this case or has no valid timestamp');
    if (!expected || runner.category !== expected) fail('Runner category does not match the observed OS category');
    if (typeof runner.isAccessibilityCategory !== 'boolean'
        || runner.isAccessibilityCategory !== (typeof expected === 'string' && expected.includes('Accessibility'))) fail('Runner accessibility flag is inconsistent');
    const swiftName = `LeafhourUITests.${expectedClass}.${expectedTestMethod}`;
    const objcName = `-[LeafhourUITests.${expectedClass} ${expectedTestMethod}]`;
    if (!expectedClass || ![swiftName, objcName].includes(runner.testCaseName)) fail('Runner receipt belongs to a different or unknown test case');
    observed.runnerCategory = runner.category;
    observed.runnerProcessIdentifier = runner.processIdentifier;
    observed.runnerSampledAt = runner.sampledAt;
  }
  if (record(app) && record(runner) && pid(app.processIdentifier)
      && app.processIdentifier === runner.processIdentifier) fail('App and Runner must be distinct processes');
  return {ok: errors.length === 0, errors, observed};
}
