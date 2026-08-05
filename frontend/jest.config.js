// Lightweight Jest config for pure-logic unit tests (utils/validators, etc.).
// These modules have no React Native runtime dependency, so a plain babel-jest
// transform + node environment is enough — no need for the heavier jest-expo
// preset. Add component/integration suites under their own config if needed.
//
// `roots` also covers ../shared so the shared package's tests run from here
// rather than needing a second runner, and moduleNameMapper mirrors the
// `@cropsetu/shared` alias metro.config.js sets up for the bundler.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/../shared'],
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
  moduleNameMapper: { '^@cropsetu/shared/(.*)$': '<rootDir>/../shared/$1' },
};
