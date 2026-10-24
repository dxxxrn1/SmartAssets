// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add 3D model and spatial texture extensions for ViroReact AR
['glb', 'gltf', 'obj', 'mtl', 'hdr', 'bin'].forEach((ext) => {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
});

const resolveSafe = (pkg) => {
  try {
    return require.resolve(pkg);
  } catch (_e) {
    try {
      return require.resolve(pkg.replace(/\/$/, ''));
    } catch {
      return null;
    }
  }
};

const cryptoPolyfill = resolveSafe('crypto-browserify');
const bufferPolyfill = resolveSafe('buffer/') || resolveSafe('buffer');
const streamPolyfill = resolveSafe('readable-stream');
const eventsPolyfill = resolveSafe('events/') || resolveSafe('events');
const stringDecoderPolyfill = resolveSafe('string_decoder/') || resolveSafe('string_decoder');

const polyfills = {
  crypto: cryptoPolyfill,
  'node:crypto': cryptoPolyfill,
  buffer: bufferPolyfill,
  'node:buffer': bufferPolyfill,
  stream: streamPolyfill,
  'node:stream': streamPolyfill,
  events: eventsPolyfill,
  'node:events': eventsPolyfill,
  string_decoder: stringDecoderPolyfill,
  'node:string_decoder': stringDecoderPolyfill,
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  ...(bufferPolyfill ? { buffer: bufferPolyfill } : {}),
  ...(cryptoPolyfill ? { crypto: cryptoPolyfill } : {}),
  ...(streamPolyfill ? { stream: streamPolyfill } : {}),
  ...(eventsPolyfill ? { events: eventsPolyfill } : {}),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Noble 1.3 exposes the crypto subpath as "./crypto", not "./crypto.js".
  if (moduleName === '@noble/hashes/crypto.js') {
    return context.resolveRequest(context, '@noble/hashes/crypto', platform);
  }
  if (polyfills[moduleName]) {
    return {
      type: 'sourceFile',
      filePath: polyfills[moduleName],
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
