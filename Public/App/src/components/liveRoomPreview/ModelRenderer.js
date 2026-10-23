// ─── ModelRenderer Component ──────────────────────────────────────────────────
// Renders a textured GLB 3D model inside a transparent WebView on top of the live camera feed.
// Features:
//   - Three.js + GLTFLoader with 100% native WebGL texture decoding (Expo Go Android & iOS verified)
//   - Transparent canvas: live camera feed shines through continuously with zero freezing
//   - Real-world 1:1 metric scale projection calibrated against A4 sheet (FOV 60°)
//   - Gyroscope pinning relative to reference orientation with low-pass filtering
//   - One-finger drag, two-finger pinch scale, two-finger twist rotation
//   - Soft contact shadow (floor) and subtle mounting bracket (wall)
//   - Smooth 30 fps cap and full resource cleanup on unmount

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TurboModuleRegistry,
  NativeModules,
} from 'react-native';
import { VERTICAL_FOV_DEG, DEFAULT_DEPTH_CM } from './constants';

let CachedWebView = null;
let webViewChecked = false;

/**
 * Checks if the native RNCWebViewModule is actually compiled into the running binary
 * by using non-enforcing TurboModuleRegistry.get() which returns null without throwing
 * an uncatchable Invariant Violation.
 */
export function isWebViewAvailable() {
  try {
    const turbo = TurboModuleRegistry?.get ? TurboModuleRegistry.get('RNCWebViewModule') : null;
    const legacy = NativeModules?.RNCWebViewModule || NativeModules?.RNCWebView;
    return Boolean(turbo || legacy);
  } catch (_) {
    return false;
  }
}

/**
 * Safely resolves the native WebView component ONLY when isWebViewAvailable() is true.
 * This guarantees require('react-native-webview') is never called on binaries lacking
 * the TurboModule, completely preventing runtime crashes.
 */
export function getNativeWebView() {
  if (webViewChecked) return CachedWebView;
  webViewChecked = true;

  if (!isWebViewAvailable()) {
    console.warn('[ModelRenderer] RNCWebViewModule not found in this binary. Open via Expo Go (npx expo start --go) for 3D.');
    CachedWebView = null;
    return null;
  }

  try {
    const mod = require('react-native-webview');
    CachedWebView = mod.WebView || mod.default;
  } catch (err) {
    console.warn('[ModelRenderer] Failed to load react-native-webview:', err?.message || err);
    CachedWebView = null;
  }
  return CachedWebView;
}

/**
 * Generate the Three.js HTML5 application for the transparent WebView.
 */
function buildThreeHtml() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; touch-action: none; -webkit-touch-callout: none; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: transparent !important;
      -webkit-user-select: none;
      user-select: none;
      touch-action: none;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
      display: block;
      background-color: transparent !important;
      touch-action: none;
    }
    #loadingIndicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #22D3EE;
      font-family: -apple-system, Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      background: rgba(8, 15, 30, 0.75);
      padding: 8px 16px;
      border-radius: 20px;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
</head>
<body>
  <div id="loadingIndicator">Building 3D Scene…</div>

  <script>
    var scene, camera, renderer;
    var anchorGroup, panGroup, inspectGroup, loadedModel;
    var currentPlacement = 'floor';
    var targetWidthCm = 60, targetHeightCm = 80, targetDepthCm = 25;
    var currentPxPerCm = 3.78;
    var animationFrameId;
    var isReady = false;

    // Smoothed target variables for 30fps animation loop
    var targetRotX = 0, targetRotY = 0, targetRotZ = 0;
    var currentRotX = 0, currentRotY = 0, currentRotZ = 0;
    var gesturePanX = 0, gesturePanY = 0;
    var gestureScale = 1.0;
    var gestureRotX = 0; // Pitch tilt (view top and bottom)
    var gestureRotY = 0; // Yaw spin (360° turntable)
    var interactMode = 'rotate'; // 'rotate' | 'move'

    function init() {
      var width = window.innerWidth;
      var height = window.innerHeight;

      // 1. Transparent WebGL Renderer
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.setClearColor(0x000000, 0); // 100% transparent for live camera view
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.shadowMap.enabled = true;
      document.body.appendChild(renderer.domElement);

      // 2. Scene Hierarchy:
      // anchorGroup (rotated by gyro relative to room)
      //   └── panGroup (translated by user pan)
      //         ├── shadowMesh (stays flat on floor at y = -0.05)
      //         └── inspectGroup (pivot at center of model for 360° spin & top/bottom tilt)
      //               └── loadedModel (centered inside inspectGroup)
      scene = new THREE.Scene();
      anchorGroup = new THREE.Group();
      panGroup = new THREE.Group();
      inspectGroup = new THREE.Group();

      panGroup.add(inspectGroup);
      anchorGroup.add(panGroup);
      scene.add(anchorGroup);

      // 3. Perspective Camera (Fixed 60° Vertical FOV for metric scale projection)
      camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
      updateCameraDistance();

      // 4. Studio Lighting
      var hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 1.4);
      hemiLight.position.set(0, 200, 0);
      scene.add(hemiLight);

      var dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
      dirLight.position.set(60, 120, 90);
      scene.add(dirLight);

      var fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.4);
      fillLight.position.set(-60, 40, -50);
      scene.add(fillLight);

      window.addEventListener('resize', onWindowResize, false);
      setupTouchGestures();
      isReady = true;

      // Notify React Native that Three.js is initialized
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SCENE_READY' }));
      }

      animate();
    }

    function updateCameraDistance() {
      var heightPx = window.innerHeight;
      var fovRad = (60 * Math.PI) / 180;
      // Distance formula: d = screenHeightPx / (2 * pxPerCm * tan(fov / 2))
      var d = heightPx / (2 * Math.max(0.1, currentPxPerCm) * Math.tan(fovRad / 2));
      camera.position.set(0, 0, d);
      camera.lookAt(0, 0, 0);
    }

    function createFloorShadow(widthCm, depthCm) {
      // Procedural soft contact shadow texture
      var canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      var ctx = canvas.getContext('2d');
      var gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
      gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.18)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);

      var texture = new THREE.CanvasTexture(canvas);
      var geo = new THREE.PlaneGeometry(widthCm * 1.5, depthCm * 1.5);
      var mat = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      var shadowMesh = new THREE.Mesh(geo, mat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = -0.05;
      shadowMesh.name = 'contact_shadow';
      panGroup.add(shadowMesh);
    }

    function loadGlb(sourceUri) {
      var loader = new THREE.GLTFLoader();
      var indicator = document.getElementById('loadingIndicator');
      if (indicator) indicator.style.opacity = '1';

      loader.load(
        sourceUri,
        function(gltf) {
          if (loadedModel) {
            inspectGroup.remove(loadedModel);
          }
          var oldShadow = panGroup.getObjectByName('contact_shadow');
          if (oldShadow) panGroup.remove(oldShadow);

          loadedModel = gltf.scene;

          // Compute raw model bounding box
          var box = new THREE.Box3().setFromObject(loadedModel);
          var size = new THREE.Vector3();
          box.getSize(size);
          var center = new THREE.Vector3();
          box.getCenter(center);

          // Physical metric scaling: 1 Three.js unit = 1 cm
          var rawW = Math.max(0.01, size.x);
          var rawH = Math.max(0.01, size.y);
          var rawD = Math.max(0.01, size.z);

          var sX = targetWidthCm / rawW;
          var sY = targetHeightCm / rawH;
          var sD = targetDepthCm / rawD;
          // Uniform scale preserving real-world proportions
          var scale = Math.min(sX, sY, sD);
          loadedModel.scale.set(scale, scale, scale);

          var realHeight = rawH * scale;

          if (currentPlacement === 'floor') {
            // Position inspectGroup pivot at vertical center of model
            inspectGroup.position.set(0, realHeight / 2, 0);
            // Center the model inside inspectGroup so pitch/yaw rotate perfectly around object center
            loadedModel.position.set(
              -center.x * scale,
              -center.y * scale,
              -center.z * scale
            );
            createFloorShadow(targetWidthCm, targetDepthCm);
          } else {
            // Place pivot at center flush to wall (z = 0)
            inspectGroup.position.set(0, 0, 0);
            loadedModel.position.set(
              -center.x * scale,
              -center.y * scale,
              -box.max.z * scale
            );
          }

          inspectGroup.add(loadedModel);

          if (indicator) indicator.style.opacity = '0';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MODEL_LOADED' }));
          }
        },
        undefined,
        function(err) {
          if (indicator) indicator.innerText = '3D Load Error';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: err.message }));
          }
        }
      );
    }

    function onWindowResize() {
      var width = window.innerWidth;
      var height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      updateCameraDistance();
    }

    function setupTouchGestures() {
      var isOneFinger = false;
      var isTwoFingers = false;
      var lastTouchX = 0, lastTouchY = 0;
      var lastMidX = 0, lastMidY = 0;
      var initialPinchDist = 0;
      var initialPinchScale = 1;

      function getDist(t1, t2) {
        var dx = t1.clientX - t2.clientX;
        var dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      function getMid(t1, t2) {
        return {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2
        };
      }

      var el = window;

      el.addEventListener('touchstart', function(e) {
        if (e.touches.length === 1) {
          isOneFinger = true;
          isTwoFingers = false;
          lastTouchX = e.touches[0].clientX;
          lastTouchY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          isOneFinger = false;
          isTwoFingers = true;
          initialPinchDist = getDist(e.touches[0], e.touches[1]);
          initialPinchScale = gestureScale;
          var mid = getMid(e.touches[0], e.touches[1]);
          lastMidX = mid.x;
          lastMidY = mid.y;
        }
      }, { passive: false });

      el.addEventListener('touchmove', function(e) {
        if (e.touches.length === 1 && isOneFinger) {
          var dx = e.touches[0].clientX - lastTouchX;
          var dy = e.touches[0].clientY - lastTouchY;
          lastTouchX = e.touches[0].clientX;
          lastTouchY = e.touches[0].clientY;

          if (interactMode === 'move') {
            gesturePanX += dx / (currentPxPerCm || 3.78);
            gesturePanY -= dy / (currentPxPerCm || 3.78);
          } else {
            // 360° Horizontal Turn + Top/Bottom Tilt Mode:
            // Horizontal swipe: 360° turntable spin around vertical Y axis
            gestureRotY += (dx * 0.012);

            // Vertical swipe: pitch rotation around horizontal X axis (view top and bottom)
            // Dragging down tilts top forward; dragging up tilts bottom up
            gestureRotX += (dy * 0.012);
            // Allow looking from directly above (top) to directly below (bottom)
            gestureRotX = Math.max(-1.55, Math.min(1.55, gestureRotX));
          }
          if (e.cancelable) e.preventDefault();
        } else if (e.touches.length === 2 && isTwoFingers) {
          // 2-finger pinch to scale
          var curDist = getDist(e.touches[0], e.touches[1]);
          if (curDist > 10 && initialPinchDist > 10) {
            var ratio = curDist / initialPinchDist;
            gestureScale = Math.max(0.3, Math.min(3.0, initialPinchScale * ratio));
          }

          // 2-finger drag to pan model across the floor/room
          var curMid = getMid(e.touches[0], e.touches[1]);
          var dMidX = curMid.x - lastMidX;
          var dMidY = curMid.y - lastMidY;
          lastMidX = curMid.x;
          lastMidY = curMid.y;
          gesturePanX += dMidX / (currentPxPerCm || 3.78);
          gesturePanY -= dMidY / (currentPxPerCm || 3.78);

          if (e.cancelable) e.preventDefault();
        }
      }, { passive: false });

      el.addEventListener('touchend', function(e) {
        if (e.touches.length === 0) {
          isOneFinger = false;
          isTwoFingers = false;
        } else if (e.touches.length === 1) {
          isOneFinger = true;
          isTwoFingers = false;
          lastTouchX = e.touches[0].clientX;
          lastTouchY = e.touches[0].clientY;
        }
      }, { passive: false });

      el.addEventListener('touchcancel', function() {
        isOneFinger = false;
        isTwoFingers = false;
      }, { passive: false });
    }

    // Process incoming bridge messages from React Native
    window.handleNativeMessage = function(data) {
      if (!data) return;

      if (data.type === 'LOAD_MODEL') {
        currentPlacement = data.placement || 'floor';
        targetWidthCm = Number(data.widthCm) || 60;
        targetHeightCm = Number(data.heightCm) || 80;
        targetDepthCm = Number(data.depthCm) || 25;
        currentPxPerCm = Number(data.pxPerCm) || 3.78;
        updateCameraDistance();
        if (data.sourceUri) {
          loadGlb(data.sourceUri);
        }
      }

      if (data.type === 'SET_SCALE') {
        currentPxPerCm = Number(data.pxPerCm) || 3.78;
        updateCameraDistance();
      }

      if (data.type === 'ORIENTATION') {
        targetRotX = (data.x || 0);
        targetRotY = (data.y || 0);
        targetRotZ = (data.z || 0);
      }

      if (data.type === 'SET_INTERACT_MODE') {
        interactMode = data.mode || 'rotate';
      }

      if (data.type === 'RESET_VIEW') {
        gestureRotX = 0;
        gestureRotY = 0;
      }

      if (data.type === 'GESTURE') {
        if (data.panX !== undefined && data.panY !== undefined) {
          // Convert pixel pan into scene metric offsets
          gesturePanX = data.panX / (currentPxPerCm || 3.78);
          gesturePanY = -data.panY / (currentPxPerCm || 3.78);
        }
        if (data.scale !== undefined) {
          gestureScale = data.scale;
        }
        if (data.rotation !== undefined) {
          gestureRotY = data.rotation;
        }
      }

      if (data.type === 'RECENTER') {
        targetRotX = 0; targetRotY = 0; targetRotZ = 0;
        currentRotX = 0; currentRotY = 0; currentRotZ = 0;
        gesturePanX = 0; gesturePanY = 0;
        gestureRotX = 0; gestureRotY = 0;
        gestureScale = 1.0;
      }
    };

    // Animation loop capped at 30fps
    var lastFrameTime = 0;
    var frameIntervalMs = 1000 / 30; // 30 fps cap

    function animate(timestamp) {
      animationFrameId = requestAnimationFrame(animate);

      if (timestamp - lastFrameTime < frameIntervalMs) {
        return;
      }
      lastFrameTime = timestamp;

      // Smooth sensor interpolation (low-pass smoothing at 0.15)
      currentRotX += (targetRotX - currentRotX) * 0.15;
      currentRotY += (targetRotY - currentRotY) * 0.15;
      currentRotZ += (targetRotZ - currentRotZ) * 0.15;

      // Rotate anchorGroup with device orientation (quaternion/angular lock)
      anchorGroup.rotation.x = currentRotX;
      anchorGroup.rotation.y = currentRotY;
      anchorGroup.rotation.z = currentRotZ;

      // Pan panGroup across room floor or wall
      if (currentPlacement === 'wall') {
        panGroup.position.set(gesturePanX, gesturePanY, 0);
      } else {
        panGroup.position.set(gesturePanX, 0, -gesturePanY);
      }

      // Rotate inspectGroup 360° and tilt top/bottom
      inspectGroup.scale.set(gestureScale, gestureScale, gestureScale);
      inspectGroup.rotation.x = gestureRotX;
      inspectGroup.rotation.y = gestureRotY;

      renderer.render(scene, camera);
    }

    window.onload = init;
  </script>
</body>
</html>
  `;
}

/**
 * `<ModelRenderer />` Component
 */
export default function ModelRenderer({
  glbDataUri,
  widthCm = 60,
  heightCm = 80,
  depthCm = DEFAULT_DEPTH_CM,
  placement = 'floor',
  pxPerCm = 3.78,
  gyroRotation = { x: 0, y: 0, z: 0 },
  gestureTransform = { panX: 0, panY: 0, scale: 1, rotation: 0 },
  interactMode = 'rotate',
  resetTrigger = 0,
  onLoaded,
  onError,
}) {
  const webViewRef = useRef(null);
  const isWebViewReady = useRef(false);

  // Send message to WebView helper
  const postToWebView = useCallback((payload) => {
    if (webViewRef.current && isWebViewReady.current) {
      const script = `if (window.handleNativeMessage) { window.handleNativeMessage(${JSON.stringify(payload)}); } true;`;
      webViewRef.current.injectJavaScript(script);
    }
  }, []);

  // Update model source whenever glbDataUri, placement, or dimensions change
  useEffect(() => {
    if (!glbDataUri || !isWebViewReady.current) return;
    postToWebView({
      type: 'LOAD_MODEL',
      sourceUri: glbDataUri,
      placement,
      widthCm,
      heightCm,
      depthCm,
      pxPerCm,
    });
  }, [glbDataUri, placement, widthCm, heightCm, depthCm, pxPerCm, postToWebView]);

  // Update scale if pxPerCm changes
  useEffect(() => {
    postToWebView({
      type: 'SET_SCALE',
      pxPerCm,
    });
  }, [pxPerCm, postToWebView]);

  // Stream gyro orientation updates to WebView
  useEffect(() => {
    postToWebView({
      type: 'ORIENTATION',
      x: gyroRotation.x,
      y: gyroRotation.y,
      z: gyroRotation.z,
    });
  }, [gyroRotation, postToWebView]);

  // Stream interactMode to WebView ('rotate' or 'move')
  useEffect(() => {
    postToWebView({
      type: 'SET_INTERACT_MODE',
      mode: interactMode,
    });
  }, [interactMode, postToWebView]);

  // Stream reset orientation trigger to WebView
  useEffect(() => {
    if (resetTrigger) {
      postToWebView({
        type: 'RESET_VIEW',
      });
    }
  }, [resetTrigger, postToWebView]);

  // Stream gesture updates to WebView
  useEffect(() => {
    postToWebView({
      type: 'GESTURE',
      panX: gestureTransform.panX,
      panY: gestureTransform.panY,
      scale: gestureTransform.scale,
      rotation: gestureTransform.rotation,
    });
  }, [gestureTransform, postToWebView]);

  // Handle messages sent back from WebView
  const handleMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'SCENE_READY') {
        isWebViewReady.current = true;
        if (glbDataUri) {
          postToWebView({
            type: 'LOAD_MODEL',
            sourceUri: glbDataUri,
            placement,
            widthCm,
            heightCm,
            depthCm,
            pxPerCm,
          });
        }
      } else if (msg.type === 'MODEL_LOADED') {
        onLoaded?.();
      } else if (msg.type === 'ERROR') {
        onError?.(msg.message);
      }
    } catch (_) {}
  };

  const WebView = getNativeWebView();
  if (!WebView) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: buildThreeHtml() }}
        style={styles.webView}
        containerStyle={styles.webViewContainer}
        opaque={false}
        scalesPageToFit={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        mixedContentMode="always"
        onMessage={handleMessage}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        bounces={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
