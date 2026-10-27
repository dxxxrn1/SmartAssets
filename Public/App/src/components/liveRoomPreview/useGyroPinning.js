// ─── useGyroPinning Hook ──────────────────────────────────────────────────────
// Smoothly pins 2D/3D objects against device rotation using expo-sensors DeviceMotion.
// Features:
//   - Isolated axis sign flips (AXIS_SIGNS) for cross-platform calibration
//   - Low-pass filtering (~0.15) to eliminate sensor jitter
//   - "Place" reference lock and "Re-center" button functionality for sensor drift

import { useEffect, useRef, useState, useCallback } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { SENSOR_UPDATE_INTERVAL_MS, AXIS_SIGNS, LOW_PASS_ALPHA } from './constants';

export default function useGyroPinning(enabled) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation3D, setRotation3D] = useState({ x: 0, y: 0, z: 0 });
  const [available, setAvailable] = useState(false);
  const [isPlaced, setIsPlaced] = useState(false);

  const baseline = useRef(null);
  const currentFiltered = useRef({ x: 0, y: 0, z: 0 });

  const recenter = useCallback(() => {
    baseline.current = null;
    currentFiltered.current = { x: 0, y: 0, z: 0 };
    setOffset({ x: 0, y: 0 });
    setRotation3D({ x: 0, y: 0, z: 0 });
  }, []);

  const place = useCallback(() => {
    setIsPlaced(true);
    recenter();
  }, [recenter]);

  useEffect(() => {
    let subscription;
    let active = true;
    baseline.current = null;
    currentFiltered.current = { x: 0, y: 0, z: 0 };
    setOffset({ x: 0, y: 0 });
    setRotation3D({ x: 0, y: 0, z: 0 });
    setAvailable(false);

    if (!enabled) return undefined;

    DeviceMotion.isAvailableAsync()
      .then((isAvail) => {
        if (!isAvail || !active) return;
        setAvailable(true);
        DeviceMotion.setUpdateInterval(SENSOR_UPDATE_INTERVAL_MS);

        subscription = DeviceMotion.addListener((data) => {
          if (!data || !active) return;
          const rot = data.rotation;
          if (!rot) return;

          if (!baseline.current) {
            baseline.current = {
              alpha: rot.alpha || 0,
              beta: rot.beta || 0,
              gamma: rot.gamma || 0,
            };
          }

          // Angular delta relative to reference orientation
          const dAlpha = (rot.alpha || 0) - (baseline.current.alpha || 0);
          const dBeta = (rot.beta || 0) - (baseline.current.beta || 0);
          const dGamma = (rot.gamma || 0) - (baseline.current.gamma || 0);

          // 2D Screen pixel offset
          setOffset({
            x: Math.max(-45, Math.min(45, -dGamma * 90)),
            y: Math.max(-45, Math.min(45, -dBeta * 90)),
          });

          // 3D angular rotation with low-pass smoothing
          const targetX = dBeta * AXIS_SIGNS.x;
          const targetY = -dGamma * AXIS_SIGNS.y;
          const targetZ = dAlpha * AXIS_SIGNS.z;

          currentFiltered.current.x =
            currentFiltered.current.x * (1 - LOW_PASS_ALPHA) + targetX * LOW_PASS_ALPHA;
          currentFiltered.current.y =
            currentFiltered.current.y * (1 - LOW_PASS_ALPHA) + targetY * LOW_PASS_ALPHA;
          currentFiltered.current.z =
            currentFiltered.current.z * (1 - LOW_PASS_ALPHA) + targetZ * LOW_PASS_ALPHA;

          setRotation3D({
            x: currentFiltered.current.x,
            y: currentFiltered.current.y,
            z: currentFiltered.current.z,
          });
        });
      })
      .catch(() => {
        if (active) setAvailable(false);
      });

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [enabled]);

  return {
    offset,
    rotation3D,
    available,
    isPlaced,
    place,
    recenter,
  };
}
