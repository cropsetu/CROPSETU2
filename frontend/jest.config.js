// Lightweight Jest config for pure-logic unit tests (utils/validators, etc.).
// These modules have no React Native runtime dependency, so a plain babel-jest
// transform + node environment is enough — no need for the heavier jest-expo
// preset. Add component/integration suites under their own config if needed.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.js'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
};
