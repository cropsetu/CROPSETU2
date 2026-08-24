// Lightweight Jest config for pure-logic unit tests (utils/validators, etc.).
// These modules have no React Native runtime dependency, so a plain babel-jest
// transform + node environment is enough — no need for the heavier jest-expo
// preset. Add component/integration suites under their own config if needed.
//
// `roots` also covers ../shared so the shared package's tests run from here
// rather than needing a second runner, and moduleNameMapper mirrors the
// `@krushisarva/shared` alias metro.config.js sets up for the bundler.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/../shared'],
  testMatch: ['**/__tests__/**/*.test.js'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
  // ../shared has no node_modules of its own, so a file transformed there
  // (translations.js pulls in @babel/runtime helpers) cannot resolve them by
  // normal upward lookup. Point resolution at this package's install.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    // react-native's entry point is untransformed Flow, so any module importing
    // it — even only for `Platform.OS` — fails to parse under this config's
    // plain babel transform. See src/__mocks__/react-native.js for why a stub is
    // the right answer here rather than adding the jest-expo preset.
    '^react-native$': '<rootDir>/src/__mocks__/react-native.js',
    '^@krushisarva/shared/(.*)$': '<rootDir>/../shared/$1',
    // AsyncStorage is a native module, so importing it under the node
    // environment throws. The package ships an in-memory mock for exactly this
    // — it lets the offline-cache and preference helpers be tested as the plain
    // logic they are, without standing up a React Native renderer.
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
  },
};
