// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 3D model and spatial texture extensions for ViroReact AR
['glb', 'gltf', 'obj', 'mtl', 'hdr', 'bin'].forEach((ext) => {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
});

const polyfills = {
  crypto: require.resolve('crypto-browserify'),
  'node:crypto': require.resolve('crypto-browserify'),
  buffer: require.resolve('buffer/'),
  'node:buffer': require.resolve('buffer/'),
  stream: require.resolve('readable-stream'),
  'node:stream': require.resolve('readable-stream'),
  events: require.resolve('events/'),
  'node:events': require.resolve('events/'),
  string_decoder: require.resolve('string_decoder/'),
  'node:string_decoder': require.resolve('string_decoder/'),
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer/'),
  crypto: require.resolve('crypto-browserify'),
  stream: require.resolve('readable-stream'),
  events: require.resolve('events/'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (polyfills[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: polyfills[moduleName],
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
