// ─── Native AR Platform Loader ───────────────────────────────────────────────
// Loads @reactvision/react-viro ONLY when the native C++/Java/Obj-C binary modules
// (ARKit/ARCore via VRTMaterialManager / VRTARSceneNavigator) are actually linked.
// In Expo Go or standard simulators, returns false immediately so ARStudioPreview
// runs without throwing native bridge errors.

import { NativeModules, Platform } from 'react-native';

let ViroModules = null;
let isViroLoaded = false;

// Checks whether Viro native binary bridge is actually compiled into the app
export function hasViroNativeBinary() {
  if (Platform.OS === 'web') return false;

  const nm = NativeModules || {};
  return Boolean(
    nm.VRTMaterialManager ||
    nm.VRTARSceneNavigator ||
    nm.VRTSceneNavigator
  );
}

export function loadViroModules() {
  if (isViroLoaded) return ViroModules;
  if (!hasViroNativeBinary()) {
    // Native binary not present (Expo Go or Simulator)
    return null;
  }

  try {
    const viro = require('@reactvision/react-viro');
    if (viro && (viro.ViroARSceneNavigator || viro.ViroARScene)) {
      ViroModules = viro;
      isViroLoaded = true;
      return ViroModules;
    }
  } catch (err) {
    console.log('[arPlatform] Native ViroReact initialization failed. Using 3D studio fallback.');
  }

  return null;
}

export function isNativeARAvailable() {
  if (Platform.OS === 'web' || Platform.OS === 'android') {
    // On Android, ViroReact hard-requires Google Play Services for AR (ARCore).
    // On uncertified or standard devices, this triggers an external Play Store prompt
    // stating "Your device isn't compatible with this version".
    // We return false on Android so the app uses our Universal Live Camera AR engine.
    return false;
  }
  if (!hasViroNativeBinary()) return false;
  const modules = loadViroModules();
  return Boolean(modules && modules.ViroARSceneNavigator);
}

export function getViroModules() {
  if (Platform.OS === 'android') return null;
  return loadViroModules();
}
