// Mandatory polyfill for crypto.getRandomValues and Buffer in React Native / Ethers.js / MetaMask SDK
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Ensure crypto.getRandomValues is fault-tolerant if native RNGetRandomValues TurboModule is missing
if (typeof global.crypto !== 'object' || !global.crypto) {
  global.crypto = {};
}
const rawGetRandomValues = global.crypto.getRandomValues;
global.crypto.getRandomValues = function safeGetRandomValues(array) {
  if (typeof rawGetRandomValues === 'function') {
    try {
      return rawGetRandomValues(array);
    } catch (_err) {
      // Native RNGetRandomValues TurboModule is not in this dev client APK.
      // Fallback safely to prevent invariant crash in uuid and MetaMaskSDK.
    }
  }

  for (let i = 0, r; i < array.length; i++) {
    if ((i & 0x03) === 0) {
      r = (Math.random() * 0x100000000) ^ ((Date.now() & 0xff) << 24);
    }
    array[i] = (r >>> ((i & 0x03) << 3)) & 0xff;
  }
  return array;
};

if (typeof global.window !== 'undefined' && global.window) {
  try {
    if (!global.window.crypto) {
      global.window.crypto = global.crypto;
    }
  } catch (_e) {
    // In web browsers, window.crypto is a read-only getter
  }
}

if (typeof global.Buffer === 'undefined') {
  global.Buffer = Buffer;
}

if (typeof global.process === 'undefined') {
  global.process = { env: {} };
}
global.process.version = global.process.version || 'v18.0.0';
global.process.browser = true;
if (typeof global.process.nextTick !== 'function') {
  global.process.nextTick = (callback, ...args) => {
    Promise.resolve().then(() => callback(...args));
  };
}

// Mock window and location for SDKs expecting browser-like environments
try {
  if (typeof global.window === 'undefined' || !global.window) {
    global.window = global;
  }
} catch (_) {}

// Event & CustomEvent polyfills for React Native (Hermes)
if (typeof global.Event === 'undefined') {
  global.Event = function Event(type, eventInitDict) {
    this.type = type;
    if (eventInitDict) {
      Object.assign(this, eventInitDict);
    }
  };
}

if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = function CustomEvent(type, eventInitDict) {
    global.Event.call(this, type, eventInitDict);
    this.detail = (eventInitDict && eventInitDict.detail) || null;
  };
}

if (typeof global.window === 'object' && global.window) {
  try { global.window.Event = global.Event; } catch (_) {}
  try { global.window.CustomEvent = global.CustomEvent; } catch (_) {}
}

// Mock Web Storage (localStorage & sessionStorage)
const memoryStore = {};
const mockStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null),
  setItem: (key, value) => {
    memoryStore[key] = String(value);
  },
  removeItem: (key) => {
    delete memoryStore[key];
  },
  clear: () => {
    for (const k in memoryStore) {
      if (Object.prototype.hasOwnProperty.call(memoryStore, k)) {
        delete memoryStore[k];
      }
    }
  },
  key: (i) => Object.keys(memoryStore)[i] || null,
  get length() {
    return Object.keys(memoryStore).length;
  },
};

if (typeof global.localStorage === 'undefined') {
  global.localStorage = mockStorage;
}
if (typeof global.sessionStorage === 'undefined') {
  global.sessionStorage = mockStorage;
}

if (typeof global.window === 'object' && global.window) {
  try { global.window.localStorage = global.window.localStorage || global.localStorage; } catch (_) {}
  try { global.window.sessionStorage = global.window.sessionStorage || global.sessionStorage; } catch (_) {}
}
if (typeof window === 'object' && window) {
  try { window.localStorage = window.localStorage || global.localStorage; } catch (_) {}
  try { window.sessionStorage = window.sessionStorage || global.sessionStorage; } catch (_) {}
}

// Mock document for browser-focused SDK submodules (SocketService, onboarding, etc.)
if (typeof global.document === 'undefined' || !global.document) {
  global.document = {
    readyState: 'complete',
    title: 'SmartAssets',
    URL: 'https://smartassets.io',
    hasFocus: () => true,
    getElementsByTagName: () => [],
    getElementById: () => null,
    createElement: () => ({
      setAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
      click: () => {},
    }),
    body: {
      insertBefore: () => {},
      appendChild: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
} else {
  if (typeof global.document.hasFocus !== 'function') {
    global.document.hasFocus = () => true;
  }
  if (!global.document.title) {
    global.document.title = 'SmartAssets';
  }
  if (!global.document.URL) {
    global.document.URL = 'https://smartassets.io';
  }
  if (typeof global.document.getElementById !== 'function') {
    global.document.getElementById = () => null;
  }
}
global.window.document = global.document;

// Navigator mock for React Native environment identification
if (typeof global.navigator === 'undefined' || !global.navigator) {
  global.navigator = { product: 'ReactNative', userAgent: 'ReactNative' };
} else {
  global.navigator.product = 'ReactNative';
  if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'ReactNative';
  }
}
global.window.navigator = global.navigator;

if (!global.window.location) {
  global.window.location = {
    protocol: 'https:',
    host: 'smartassets.io',
    hostname: 'smartassets.io',
    href: 'https://smartassets.io/',
    origin: 'https://smartassets.io',
    pathname: '/',
    search: '',
    hash: '',
  };
}
if (!global.window.addEventListener) {
  global.window.addEventListener = () => {};
}
if (!global.window.removeEventListener) {
  global.window.removeEventListener = () => {};
}
if (!global.window.dispatchEvent) {
  global.window.dispatchEvent = () => true;
}
if (!global.window.open) {
  global.window.open = () => null;
}

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
