// ─── Native Viro AR Scene ───────────────────────────────────────────────────
// Mounts inside ViroARSceneNavigator on physical iOS (ARKit) and Android (ARCore).
// Provides vertical (wall) + horizontal (floor) plane detection, true 1:1 metric scale,
// 3D GLB/procedural model loading, dynamic lighting, soft ground shadows, and gestures.

import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

export default function createViroARScene({
  item,
  lightingIntensity = 450,
  isShadowsEnabled = true,
  onPlaneDetected,
  onTrackingStatusChanged,
  onScaleChanged,
}) {
  return function ViroARSceneComponent(props) {
    const viro = require('@reactvision/react-viro');
    const {
      ViroARScene,
      ViroAmbientLight,
      ViroDirectionalLight,
      Viro3DObject,
      ViroBox,
      ViroQuad,
      ViroNode,
      ViroMaterials,
      ViroTrackingStateConstants,
    } = viro;

    // Local state for transformations
    const [position, setPosition] = useState(item?.initialPosition || [0, 0, -1.2]);
    const [scaleFactor, setScaleFactor] = useState(1.0);
    const [rotation, setRotation] = useState([0, 0, 0]);
    const [detectedAnchor, setDetectedAnchor] = useState(null);
    const [isAnchored, setIsAnchored] = useState(false);

    // Register materials once
    useEffect(() => {
      try {
        ViroMaterials.createMaterials({
          goldFrame: {
            diffuseColor: '#D4AF37',
            lightingModel: 'PBR',
            metalness: 0.7,
            roughness: 0.3,
          },
          canvasArt: {
            diffuseTexture: { uri: item?.highResTexture || item?.image },
            lightingModel: 'Blinn',
          },
          groundShadowMat: {
            diffuseColor: 'rgba(15, 23, 42, 0.45)',
            lightingModel: 'Lambert',
          },
          calibrationGridMat: {
            diffuseColor: '#00C2FF',
            lightingModel: 'Blinn',
          },
          pedestalMat: {
            diffuseColor: '#F8FAFC',
            lightingModel: 'PBR',
            roughness: 0.2,
          },
          acrylicCaseMat: {
            diffuseColor: 'rgba(255, 255, 255, 0.25)',
            lightingModel: 'Blinn',
          },
        });
      } catch (e) {
        // Materials already created
      }
    }, [item]);

    // Handle tracking state (normal, limited, unavailable)
    const handleTrackingUpdated = (state, reason) => {
      if (onTrackingStatusChanged) {
        onTrackingStatusChanged(state, reason);
      }
    };

    // Handle anchor found (wall or floor)
    const handleAnchorFound = (anchor) => {
      setDetectedAnchor(anchor);
      if (onPlaneDetected) {
        onPlaneDetected({
          alignment: anchor.alignment, // "Horizontal" or "Vertical"
          position: anchor.position,
          center: anchor.center,
        });
      }

      // If user hasn't manually placed yet, snap to detected plane
      if (!isAnchored && anchor.position) {
        if (anchor.alignment === 'Vertical' && item.surface === 'vertical') {
          // Snap painting flush to wall
          setPosition([anchor.position[0], anchor.position[1], anchor.position[2] + 0.02]);
          setIsAnchored(true);
        } else if (anchor.alignment === 'Horizontal' && item.surface !== 'vertical') {
          // Snap furniture/sculpture to floor
          setPosition([anchor.position[0], anchor.position[1], anchor.position[2]]);
          setIsAnchored(true);
        }
      }
    };

    // Gestures: Drag / Move
    const handleDrag = (dragToPos) => {
      setPosition(dragToPos);
    };

    // Gestures: Pinch to scale
    const handlePinch = (pinchState, scaleMultiplier) => {
      // 2 = moving, 3 = end
      if (pinchState === 2 || pinchState === 3) {
        const newFactor = Math.max(0.3, Math.min(3.0, scaleFactor * scaleMultiplier));
        setScaleFactor(newFactor);
        if (onScaleChanged) onScaleChanged(newFactor);
      }
    };

    // Gestures: Twist / Rotate along Y-axis
    const handleRotate = (rotateState, rotationDelta) => {
      if (rotateState === 2 || rotateState === 3) {
        setRotation((prev) => [prev[0], prev[1] - rotationDelta, prev[2]]);
      }
    };

    // Base metric scale (meters)
    const baseScale = item?.trueScale || [1, 1, 1];
    const computedScale = [
      baseScale[0] * scaleFactor,
      baseScale[1] * scaleFactor,
      baseScale[2] * scaleFactor,
    ];

    return (
      <ViroARScene
        anchorDetectionTypes={['PlanesHorizontal', 'PlanesVertical']}
        onTrackingUpdated={handleTrackingUpdated}
        onAnchorFound={handleAnchorFound}
        onAnchorUpdated={handleAnchorFound}
      >
        {/* Ambient Room Illumination */}
        <ViroAmbientLight color="#FFFFFF" intensity={lightingIntensity} />

        {/* Directional Sun/Ceiling Light for realistic shadows */}
        {isShadowsEnabled && (
          <ViroDirectionalLight
            color="#FFFFFF"
            direction={[0.3, -1, -0.4]}
            castsShadow={true}
            shadowMapSize={2048}
            shadowBias={0.005}
            shadowNearZ={0.1}
            shadowFarZ={5}
            shadowOpacity={0.65}
          />
        )}

        {/* Root Interactive Node */}
        <ViroNode
          position={position}
          scale={computedScale}
          rotation={rotation}
          dragType="FixedToWorld"
          onDrag={handleDrag}
          onPinch={handlePinch}
          onRotate={handleRotate}
        >
          {/* 1. Canvas Painting (Vertical Wall Mount) */}
          {item?.modelType === 'procedural_framed_canvas' && (
            <ViroNode position={[0, 0, 0]}>
              {/* Outer Golden Frame Box */}
              <ViroBox
                position={[0, 0, 0]}
                scale={[1.04, 1.04, 1.0]}
                materials={['goldFrame']}
              />
              {/* Inner High-Resolution Canvas Face */}
              <ViroBox
                position={[0, 0, 0.002]}
                scale={[0.96, 0.96, 1.02]}
                materials={['canvasArt']}
              />
            </ViroNode>
          )}

          {/* 2. GLB 3D Scanned Model (Furniture or Sculpture) */}
          {item?.modelType === 'glb' && (
            <ViroNode position={[0, 0, 0]}>
              <Viro3DObject
                source={{ uri: item.glbUrl }}
                position={[0, 0, 0]}
                scale={[1, 1, 1]}
                type="GLB"
                castsShadow={isShadowsEnabled}
                lightReceivingBitMask={1}
                shadowCastingBitMask={1}
              />

              {/* Soft Ground Shadow Receiver beneath furniture */}
              {isShadowsEnabled && item.hasGroundShadow && (
                <ViroQuad
                  position={[0, 0.002, 0]}
                  rotation={[-90, 0, 0]}
                  scale={[item.shadowRadiusMeters || 0.6, item.shadowRadiusMeters || 0.6, 1]}
                  materials={['groundShadowMat']}
                  arShadowReceiver={true}
                />
              )}
            </ViroNode>
          )}

          {/* 3. Exhibition Plinth & Watch Vitrine */}
          {item?.modelType === 'pedestal_vitrine' && (
            <ViroNode position={[0, 0, 0]}>
              {/* Museum White Marble Pedestal */}
              <ViroBox
                position={[0, -0.15, 0]}
                scale={[0.3, 0.3, 0.3]}
                materials={['pedestalMat']}
              />
              {/* Anti-Reflective Acrylic Vitrine Bell */}
              <ViroBox
                position={[0, 0.1, 0]}
                scale={[0.26, 0.22, 0.26]}
                materials={['acrylicCaseMat']}
              />
              {/* Ground Shadow */}
              {isShadowsEnabled && (
                <ViroQuad
                  position={[0, -0.3, 0]}
                  rotation={[-90, 0, 0]}
                  scale={[0.4, 0.4, 1]}
                  materials={['groundShadowMat']}
                  arShadowReceiver={true}
                />
              )}
            </ViroNode>
          )}

          {/* 4. Day 1 AR Calibration Target Cube */}
          {item?.modelType === 'test_cube' && (
            <ViroNode position={[0, 0, 0]}>
              <ViroBox
                position={[0, 0, 0]}
                scale={[1, 1, 1]}
                materials={['calibrationGridMat']}
              />
              {isShadowsEnabled && (
                <ViroQuad
                  position={[0, -0.1, 0]}
                  rotation={[-90, 0, 0]}
                  scale={[0.25, 0.25, 1]}
                  materials={['groundShadowMat']}
                  arShadowReceiver={true}
                />
              )}
            </ViroNode>
          )}
        </ViroNode>
      </ViroARScene>
    );
  };
}
