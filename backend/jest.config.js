/**
 * Jest configuration.
 *
 * Lives here rather than under a "jest" key in package.json so that the notes
 * below can be actual comments. They used to be `_comment_*` string arrays
 * inside the JSON, which jest does not recognise — it printed a two-paragraph
 * "Unknown option" validation warning for each one, twice per run, above every
 * result. Config a reader has to scroll past is config a reader stops reading.
 */
export default {
  testEnvironment: 'node',

  // Covers HOOKS as well as tests, and beforeAll is where the DB-backed API
  // suites spend their time: animaltrade.api.test.js runs ~26 s end to end on a
  // warm laptop, so the previous 30 s left a 12% margin over the whole suite and
  // far less over a cold beforeAll. A cold full run duly failed agristore's
  // beforeAll at exactly 30000 ms while the same suite passed alone — and CI
  // runners are slower than the laptop that produced that.
  //
  // 60 s is calibration, not suppression: a hung hook still fails, just later.
  // A suite that legitimately needs more than a minute of setup is a finding
  // about the suite, not a reason to raise this again.
  testTimeout: 60_000,

  transform: {},

  // REQUIRED, not a tuning knob. Every DB-backed suite truncates all tables in
  // afterAll (tests/fixtures/setup.js cleanupTestData) against ONE shared
  // database. Run in parallel, jest workers delete each other's fixtures
  // mid-test and deadlock in the cleanup transaction: a full run produced 143
  // failures that had nothing to do with the code, and the same 143 twice, so
  // it reads as a real regression rather than a harness problem.
  //
  // It lives here rather than as a --runInBand flag on the test script so it
  // also covers `npx jest <file>` — the way a single suite actually gets run
  // while debugging, and the invocation that would otherwise still be wrong.
  maxWorkers: 1,

  setupFiles: ['<rootDir>/tests/fixtures/jest.env.js'],

  // Strip the .js extension ESM source uses so jest can resolve the specifier.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};
