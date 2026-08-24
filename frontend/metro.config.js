// Metro config for the KrushiSarva buyer app.
//
// This app and seller-app/ both consume ../shared. `shared` is NOT installed into
// node_modules (no symlink, no workspace) — it is resolved by mapping the
// `@krushisarva/shared` specifier straight at the folder, which keeps the setup the
// same on Windows and CI and avoids touching package-lock.json.
//
// Two pieces are required for that to work:
//   1. watchFolders  — Metro only bundles (and hot-reloads) files it watches, and
//      ../shared sits outside this project root.
//   2. nodeModulesPaths — files under ../shared import react / react-native /
//      expo-*, and there is no node_modules above ../shared to find them in, so
//      resolution is pointed back at THIS app's node_modules. Both apps therefore
//      bundle shared code against their own copy of React Native — never two.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@krushisarva/shared': sharedRoot,
};

module.exports = config;
