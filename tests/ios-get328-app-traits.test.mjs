// Synthetic unit fixtures only. These receipts are not measurements from an App,
// Runner, Simulator, device, provider, or acceptance run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as traits from '../scripts/ios/verify-get328-app-traits.mjs';

const APP_ID = 'org.leafhour.get328.acceptance20261107';
const RUNNER_ID = APP_ID + '.uitests.xctrunner';
const START = '2026-11-07T06:00:00.000Z';
const FRESH = '2026-11-07T06:00:02.000Z';
const METHODS = [
  'test38SavedRecordsAndExpandedSettingsPassNativeAccessibilityAudits',
  'test41SystemTypeProfileKeepsTheRealTypographyPreviewAndResetUsable',
  'test54PagedNativeCopyAndReflowKeepTheVisibleSourceParagraph',
  'testPDFSystemImportAndLastPage',
];
const CATEGORIES = [
  ['extra-small', 'UICTContentSizeCategoryXS', false],
  ['small', 'UICTContentSizeCategoryS', false],
  ['medium', 'UICTContentSizeCategoryM', false],
  ['large', 'UICTContentSizeCategoryL', false],
  ['extra-large', 'UICTContentSizeCategoryXL', false],
  ['extra-extra-large', 'UICTContentSizeCategoryXXL', false],
  ['extra-extra-extra-large', 'UICTContentSizeCategoryXXXL', false],
  ['accessibility-medium', 'UICTContentSizeCategoryAccessibilityM', true],
  ['accessibility-large', 'UICTContentSizeCategoryAccessibilityL', true],
  ['accessibility-extra-large', 'UICTContentSizeCategoryAccessibilityXL', true],
  ['accessibility-extra-extra-large', 'UICTContentSizeCategoryAccessibilityXXL', true],
  ['accessibility-extra-extra-extra-large', 'UICTContentSizeCategoryAccessibilityXXXL', true],
];

function fixture(token = 'large', method = METHODS[0]) {
  const [, category, accessibility] = CATEGORIES.find(([value]) => value === token);
  const className = method === METHODS[3] ? 'ReadingUITests' : 'VideoExperienceUITests';
  return {
    notBefore: START,
    osContentSize: token,
    expectedTestMethod: method,
    appReceipt: {
      schemaVersion: 1,
      bundleIdentifier: APP_ID,
      processIdentifier: 4101,
      launchIdentifier: '11111111-2222-4333-8444-555555555555',
      samples: [{
        sequence: 1,
        sampledAt: FRESH,
        trigger: 'window-became-key-settled',
        applicationCategory: category,
        applicationIsAccessibilityCategory: accessibility,
        windowCategory: category,
        windowIsAccessibilityCategory: accessibility,
        windowIsKey: true,
        sceneActivationState: 'foregroundActive',
        status: 'observed',
        issues: [],
      }],
    },
    runnerReceipt: {
      schemaVersion: 1,
      bundleIdentifier: RUNNER_ID,
      processIdentifier: 4201,
      sampledAt: FRESH,
      category,
      isAccessibilityCategory: accessibility,
      testCaseName: `LeafhourUITests.${className}.${method}`,
    },
  };
}

function accepted(input, label = '') {
  const result = traits.verifyGET328TypeProfile(input);
  assert.equal(result.ok, true, label + ': ' + JSON.stringify(result.errors));
  assert.deepEqual(result.errors, [], label);
  assert.ok(result.observed && typeof result.observed === 'object'
            && !Array.isArray(result.observed), label);
  return result;
}

function rejected(input, label = '') {
  const result = traits.verifyGET328TypeProfile(input);
  assert.equal(result.ok, false, label);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, label);
  assert.ok(result.errors.every(value => typeof value === 'string'), label);
  assert.ok(result.observed && typeof result.observed === 'object'
            && !Array.isArray(result.observed), label);
  return result;
}

test('ordinary Large accepts matching real-observation-shaped App window and Runner fixtures', () => {
  accepted(fixture());
});

test('AX5 accepts matching accessibility XXXL observations for App window and Runner', () => {
  accepted(fixture('accessibility-extra-extra-extra-large', METHODS[1]));
});

test('all twelve system tokens map to their exact UIKit raw category and accessibility kind', () => {
  for (const [token, category] of CATEGORIES) {
    accepted(fixture(token), token);
    if (typeof traits.categoryForSystemToken === 'function') {
      assert.equal(traits.categoryForSystemToken(token), category, token);
    }
  }
});

test('missing App or Runner receipts fail without treating declarations as observations', () => {
  for (const field of ['appReceipt', 'runnerReceipt']) {
    for (const value of [undefined, null, {}, []]) {
      const input = fixture();
      input[field] = value;
      rejected(input, field + ':' + String(value));
    }
  }
});

test('missing required receipt or latest-sample fields cannot be inferred', () => {
  const fields = [
    ['appReceipt', ['schemaVersion', 'bundleIdentifier', 'processIdentifier', 'launchIdentifier', 'samples']],
    ['runnerReceipt', ['schemaVersion', 'bundleIdentifier', 'processIdentifier', 'sampledAt',
                       'category', 'isAccessibilityCategory', 'testCaseName']],
    ['sample', ['sequence', 'sampledAt', 'trigger', 'applicationCategory',
                'applicationIsAccessibilityCategory', 'windowCategory',
                'windowIsAccessibilityCategory', 'windowIsKey', 'sceneActivationState', 'status', 'issues']],
  ];
  for (const [scope, keys] of fields) {
    for (const key of keys) {
      const input = fixture();
      const target = scope === 'sample' ? input.appReceipt.samples[0] : input[scope];
      delete target[key];
      // A launch argument or environment claim is never a substitute for a sample.
      input.appReceipt.environment = {UIPreferredContentSizeCategoryName: 'UICTContentSizeCategoryL'};
      rejected(input, scope + '.' + key);
    }
  }
});

test('bundle identity and receipt schema must match the exact isolated App and Runner', () => {
  for (const [scope, key, value] of [
    ['appReceipt', 'bundleIdentifier', 'org.leafhour.app'],
    ['appReceipt', 'bundleIdentifier', APP_ID + '.other'],
    ['runnerReceipt', 'bundleIdentifier', APP_ID],
    ['runnerReceipt', 'bundleIdentifier', 'org.leafhour.app.uitests.xctrunner'],
    ['appReceipt', 'schemaVersion', 2],
    ['runnerReceipt', 'schemaVersion', '1'],
  ]) {
    const input = fixture();
    input[scope][key] = value;
    rejected(input, `${scope}.${key}=${value}`);
  }
});

test('both process identifiers must be positive finite integers', () => {
  for (const scope of ['appReceipt', 'runnerReceipt']) {
    for (const value of [0, -1, 1.5, '4101', true, null, NaN, Infinity]) {
      const input = fixture();
      input[scope].processIdentifier = value;
      rejected(input, `${scope} PID ${String(value)}`);
    }
  }
});

test('App and its concurrently running UI Runner cannot claim the same process', () => {
  const input = fixture();
  input.appReceipt.processIdentifier = input.runnerReceipt.processIdentifier;
  rejected(input, 'one PID cannot represent both UIKit processes');
});

test('App launch identity must be an actual UUID-shaped identifier', () => {
  for (const value of ['', 'old-launch', 4101, null, '11111111-2222-4333-8444-55555555555Z']) {
    const input = fixture();
    input.appReceipt.launchIdentifier = value;
    rejected(input, String(value));
  }
});

test('App and Runner observations must have valid ISO times at or after this case start', () => {
  const equal = fixture();
  equal.appReceipt.samples[0].sampledAt = START;
  equal.runnerReceipt.sampledAt = START;
  accepted(equal, 'inclusive case start');
  for (const scope of ['sample', 'runnerReceipt', 'notBefore']) {
    for (const value of ['invalid-time', 1794031200, null,
                         ...(scope === 'notBefore' ? [] : ['2026-11-07T05:59:59.999Z'])]) {
      const input = fixture();
      if (scope === 'sample') input.appReceipt.samples[0].sampledAt = value;
      else if (scope === 'notBefore') input.notBefore = value;
      else input.runnerReceipt.sampledAt = value;
      rejected(input, `${scope} ${String(value)}`);
    }
  }
});

test('sample sequences must increase without duplicates even when the latest sample is valid', () => {
  for (const sequence of [1, 0, -1, 1.5, '2']) {
    const input = fixture();
    input.appReceipt.samples.push({...input.appReceipt.samples[0], sequence,
                                   sampledAt: '2026-11-07T06:00:03.000Z'});
    rejected(input, String(sequence));
  }
});

test('receipt sample time order cannot reverse behind a fresh latest observation', () => {
  const input = fixture();
  input.appReceipt.samples[0].sampledAt = '2026-11-07T06:00:04.000Z';
  input.appReceipt.samples.push({...input.appReceipt.samples[0], sequence: 2,
                                 sampledAt: '2026-11-07T06:00:03.000Z'});
  rejected(input);
});

test('sample history is nonempty and bounded while a pruned 64-sample sequence remains valid', () => {
  const input = fixture();
  const sample = input.appReceipt.samples[0];
  input.appReceipt.samples = Array.from({length: 64}, (_, index) => ({
    ...sample, sequence: 1001 + index,
    sampledAt: new Date(Date.parse(START) + 1000 + index).toISOString(),
  }));
  accepted(input, '64 retained samples after pruning');
  input.appReceipt.samples.push({...sample, sequence: 1065,
                                 sampledAt: '2026-11-07T06:00:04.000Z'});
  rejected(input, '65 samples');
  input.appReceipt.samples = [];
  rejected(input, 'empty history');
});

test('the last unavailable sample cannot be replaced by an older good observation', () => {
  const input = fixture();
  input.appReceipt.samples.push({...input.appReceipt.samples[0], sequence: 2,
    sampledAt: '2026-11-07T06:00:03.000Z', status: 'unavailable',
    windowCategory: 'missing', windowIsKey: false, issues: ['window-not-ready']});
  rejected(input);
});

test('the latest observation requires a real key foreground-active window and no issues', () => {
  for (const [field, value] of [
    ['windowIsKey', false], ['windowIsKey', 'true'],
    ['sceneActivationState', 'foregroundInactive'], ['sceneActivationState', 'background'],
    ['status', 'declared'], ['issues', ['category-unavailable']], ['issues', 'none'],
    ['trigger', 'environment-declaration'],
  ]) {
    const input = fixture();
    input.appReceipt.samples[0][field] = value;
    rejected(input, `${field}=${JSON.stringify(value)}`);
  }
});

test('unknown missing unspecified categories and unknown OS tokens always fail', () => {
  for (const scope of ['applicationCategory', 'windowCategory', 'runner']) {
    for (const category of ['unknown', 'missing', 'UICTContentSizeCategoryUnspecified', '', null, 1]) {
      const input = fixture();
      if (scope === 'runner') input.runnerReceipt.category = category;
      else input.appReceipt.samples[0][scope] = category;
      rejected(input, `${scope}=${String(category)}`);
    }
  }
  for (const token of ['AX5', 'UICTContentSizeCategoryL', 'unspecified', '', null]) {
    const input = fixture();
    input.osContentSize = token;
    rejected(input, `OS ${String(token)}`);
  }
});

test('App window and Runner categories must each equal the exact OS category', () => {
  for (const scope of ['applicationCategory', 'windowCategory', 'runner']) {
    const input = fixture();
    if (scope === 'runner') input.runnerReceipt.category = 'UICTContentSizeCategoryM';
    else input.appReceipt.samples[0][scope] = 'UICTContentSizeCategoryM';
    rejected(input, scope);
  }
  const allWrong = fixture();
  allWrong.appReceipt.samples[0].applicationCategory = 'UICTContentSizeCategoryM';
  allWrong.appReceipt.samples[0].windowCategory = 'UICTContentSizeCategoryM';
  allWrong.runnerReceipt.category = 'UICTContentSizeCategoryM';
  rejected(allWrong, 'agreement with each other does not replace agreement with OS');
});

test('actual accessibility flags are required booleans consistent with their observed category', () => {
  for (const token of ['large', 'accessibility-extra-extra-extra-large']) {
    for (const scope of ['applicationIsAccessibilityCategory', 'windowIsAccessibilityCategory', 'runner']) {
      for (const value of [token === 'large', 'true', 1, null]) {
        const input = fixture(token);
        if (scope === 'runner') input.runnerReceipt.isAccessibilityCategory = value;
        else input.appReceipt.samples[0][scope] = value;
        rejected(input, `${token} ${scope}=${String(value)}`);
      }
    }
  }
});

test('Runner case matching rejects wrong class module method suffix and unsupported expected methods', () => {
  for (const name of [
    `LeafhourUITests.ReadingUITests.${METHODS[0]}`,
    `OtherModule.VideoExperienceUITests.${METHODS[0]}`,
    `LeafhourUITests.VideoExperienceUITests.${METHODS[1]}`,
    `LeafhourUITests.VideoExperienceUITests.${METHODS[0]}Extra`,
    `LeafhourUITests.OtherVideoExperienceUITests.${METHODS[0]}`,
    `prefix LeafhourUITests.VideoExperienceUITests.${METHODS[0]} suffix`,
    `-[LeafhourUITests.VideoExperienceUITests ${METHODS[1]}]`,
    METHODS[0],
  ]) {
    const input = fixture();
    input.runnerReceipt.testCaseName = name;
    rejected(input, name);
  }
  const wrongPDFClass = fixture('large', METHODS[3]);
  wrongPDFClass.runnerReceipt.testCaseName = `LeafhourUITests.VideoExperienceUITests.${METHODS[3]}`;
  rejected(wrongPDFClass, 'PDF belongs to ReadingUITests');
  for (const method of ['test53PDFHorizontalSwipesReportActualPagesAndColdResume',
                        'test23ExistingSyntheticPDFReachesLastPageAndColdRestores']) {
    const input = fixture();
    input.expectedTestMethod = method;
    input.runnerReceipt.testCaseName = `LeafhourUITests.VideoExperienceUITests.${method}`;
    rejected(input, method);
  }
});

test('an early unavailable startup observation may precede a valid latest live-window observation', () => {
  const input = fixture();
  const latest = {...input.appReceipt.samples[0], sequence: 2};
  input.appReceipt.samples = [{
    sequence: 1, sampledAt: '2026-11-07T06:00:00.500Z', trigger: 'startup',
    applicationCategory: 'unknown', applicationIsAccessibilityCategory: false,
    windowCategory: 'missing', windowIsAccessibilityCategory: null, windowIsKey: false,
    sceneActivationState: 'unattached', status: 'unavailable', issues: ['no-key-window-yet'],
  }, latest];
  accepted(input);
});

test('all four exact real methods accept both canonical XCTest name formats and known triggers', () => {
  const triggers = ['startup', 'window-became-key', 'application-active', 'content-size-category-changed'];
  for (const [index, method] of METHODS.entries()) {
    const className = index === 3 ? 'ReadingUITests' : 'VideoExperienceUITests';
    for (const objc of [false, true]) {
      const input = fixture('large', method);
      input.appReceipt.samples[0].trigger = triggers[index] + (objc ? '-settled' : '');
      input.runnerReceipt.testCaseName = objc
        ? `-[LeafhourUITests.${className} ${method}]`
        : `LeafhourUITests.${className}.${method}`;
      accepted(input, input.runnerReceipt.testCaseName);
    }
  }
});
