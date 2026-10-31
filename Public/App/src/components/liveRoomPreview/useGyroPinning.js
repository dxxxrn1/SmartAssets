// ─── useGyroPinning Hook ──────────────────────────────────────────────────────
// Smoothly pins 3D objects against device rotation using expo-sensors DeviceMotion.
// Features:
//   - Isolated axis sign flips (AXIS_SIGNS) for cross-platform calibration
//   - Low-pass filtering (~0.15) to eliminate sensor jitter
//   - "Place" reference lock and "Re-center" / "resetReference" functionality for sensor drift
//   - Safe default `{ x: 0, y: 0, z: 0 }` rotation and consistent API aliases (`rotation3D` / `rotation`, `recenter` / `resetReference`)

import { useEffect, useRef, useState, useCallback } from 'react';
import { DeviceMotion } from 'expo-sensors';
import { SENSOR_UPDATE_INTERVAL_MS, AXIS_SIGNS, LOW_PASS_ALPHA } from './constants';

export const ZERO_OFFSET = Object.freeze({ x: 0, y: 0 });
export const ZERO_ROTATION_3D = Object.freeze({ x: 0, y: 0, z: 0 });

export default function useGyroPinning(enabled = true) {
  const [offset, setOffset] = useState(ZERO_OFFSET);
  const [rotation3D, setRotation3D] = useState(ZERO_ROTATION_3D);
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
    let subscription = null;
    let active = true;
    baseline.current = null;
    currentFiltered.current = { x: 0, y: 0, z: 0 };
    setOffset({ x: 0, y: 0 });
    setRotation3D({ x: 0, y: 0, z: 0 });
    setAvailable(false);

    if (!enabled || !DeviceMotion || typeof DeviceMotion.isAvailableAsync !== 'function') {
      return undefined;
    }

    DeviceMotion.isAvailableAsync()
      .then((isAvail) => {
        if (!isAvail || !active) return;
        setAvailable(true);
        if (typeof DeviceMotion.setUpdateInterval === 'function') {
          DeviceMotion.setUpdateInterval(SENSOR_UPDATE_INTERVAL_MS);
        }

        subscription = DeviceMotion.addListener((data) => {
          if (!data || !active) return;
          const rot = data.rotation;
          if (!rot) return;

          if (!baseline.current) {
            baseline.current = {
              alpha: Number(rot.alpha) || 0,
              beta: Number(rot.beta) || 0,
              gamma: Number(rot.gamma) || 0,
            };
          }

          // Angular delta relative to reference orientation
          const dAlpha = (Number(rot.alpha) || 0) - (baseline.current.alpha || 0);
          const dBeta = (Number(rot.beta) || 0) - (baseline.current.beta || 0);
          const dGamma = (Number(rot.gamma) || 0) - (baseline.current.gamma || 0);

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
            x: Number(currentFiltered.current.x) || 0,
            y: Number(currentFiltered.current.y) || 0,
            z: Number(currentFiltered.current.z) || 0,
          });
        });
      })
      .catch(() => {
        if (active) setAvailable(false);
      });

    return () => {
      active = false;
      try {
        subscription?.remove?.();
      } catch (_) {}
    };
  }, [enabled]);

  const safeRotation = rotation3D || ZERO_ROTATION_3D;
  const safeOffset = offset || ZERO_OFFSET;

  return {
    offset: safeOffset,
    rotation3D: safeRotation,
    rotation: safeRotation,
    available: Boolean(available),
    isPlaced: Boolean(isPlaced),
    place,
    recenter,
    resetReference: recenter,
  };
}
