/**
 * Minimal `react-native` stub for the pure-logic jest config.
 *
 * jest.config.js runs these suites in a node environment with a plain babel
 * transform and no jest-expo preset — deliberately, because they test logic and
 * standing up a renderer for that is slow. But react-native's own entry point is
 * untransformed Flow, so ANY module that imports from it fails to parse, even if
 * all it wanted was `Platform.OS`.
 *
 * That is why this exists. It is not a component mock and should not grow into
 * one: if a suite needs real native behaviour it belongs under a jest-expo
 * config, not here.
 *
 * Platform.OS is 'android' because that is what KrushiSarva's users are on and what
 * §40 says to optimise for — a logic test that silently exercised the iOS branch
 * would be testing the wrong path.
 */
module.exports = {
  Platform: {
    OS: 'android',
    select: (spec) => (Object.prototype.hasOwnProperty.call(spec, 'android') ? spec.android : spec.default),
  },
};
