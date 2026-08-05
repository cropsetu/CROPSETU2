// Metro config for the CropSetu seller app.
//
// Mirrors frontend/metro.config.js — see ../shared/README.md for why ../shared is
// resolved by specifier mapping rather than being installed into node_modules.
//   1. watchFolders  — Metro only bundles files it watches, and ../shared sits
//      outside this project root.
//   2. nodeModulesPaths — files under ../shared import react / react-native /
//      expo-*; there is no node_modules above ../shared, so resolution is pointed
//      back at THIS app's node_modules. Both apps bundle shared code against
//      their own React Native copy — never two.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [sharedRoot];

config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@cropsetu/shared': sharedRoot,
};

module.exports = config;
