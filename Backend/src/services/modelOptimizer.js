// ─── 3D Model Optimization Service ─────────────────────────────────────────────
// Uses @gltf-transform, sharp, and meshoptimizer to:
//   1. Deduplicate accessors/materials (dedup)
//   2. Remove unused geometry/nodes/textures (prune)
//   3. Resize textures to 1024x1024 max using sharp
//   4. Count triangles and simplify with meshoptimizer if > 50,000 triangles
//   5. Enforce target file size < 5 MB with single retry stronger pass
//   6. NO Draco or Meshopt compression extensions applied (maintains standard GLTF/GLB compatibility)

const axios = require('axios');
const { NodeIO } = require('@gltf-transform/core');
const { dedup, prune, textureCompress, simplify } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');
const sharp = require('sharp');
const supabase = require('../connection/supabaseClient');

const MAX_TARGET_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB target
const MAX_TRIANGLES = 50000;
const MAX_TEXTURE_DIMENSION = 1024;

/**
 * Counts total triangles across all primitives in a glTF document.
 */
function getTriangleCount(document) {
  let count = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        count += Math.floor(indices.getCount() / 3);
      } else {
        const position = prim.getAttribute('POSITION');
        if (position) {
          count += Math.floor(position.getCount() / 3);
        }
      }
    }
  }
  return count;
}

/**
 * Download a remote binary file into a Buffer.
 * @param {string} url - Direct download URL
 * @returns {Promise<Buffer>}
 */
async function downloadFileBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });
  return Buffer.from(response.data);
}

/**
 * Optimize a GLB buffer using @gltf-transform.
 * @param {Buffer} inputBuffer - Input raw GLB
 * @param {boolean} aggressive - Whether to apply stronger simplification for size reduction
 * @returns {Promise<{ optimizedBuffer: Buffer, triangleCount: number, sizeBytes: number }>}
 */
async function optimizeGlbBuffer(inputBuffer, aggressive = false) {
  await MeshoptSimplifier.ready;

  const io = new NodeIO();
  const document = await io.readBinary(new Uint8Array(inputBuffer));

  // 1. Basic clean-up transforms
  await document.transform(
    dedup(),
    prune(),
    textureCompress({
      encoder: sharp,
      resize: [MAX_TEXTURE_DIMENSION, MAX_TEXTURE_DIMENSION],
    })
  );

  // 2. Triangle budget calculation
  let triangles = getTriangleCount(document);

  if (triangles > MAX_TRIANGLES || aggressive) {
    const targetRatio = aggressive
      ? Math.min(0.4, (MAX_TRIANGLES * 0.7) / Math.max(1, triangles))
      : MAX_TRIANGLES / triangles;

    try {
      await document.transform(
        simplify({
          simplifier: MeshoptSimplifier,
          ratio: Math.max(0.1, Math.min(0.95, targetRatio)),
          error: aggressive ? 0.005 : 0.001,
        })
      );
      triangles = getTriangleCount(document);
    } catch (simErr) {
      console.warn('[ModelOptimizer] Mesh simplification warning:', simErr.message);
    }
  }

  // 3. Write uncompressed standard GLB binary (No Draco / Meshopt compression extension)
  const outputUint8 = await io.writeBinary(document);
  const optimizedBuffer = Buffer.from(outputUint8);

  return {
    optimizedBuffer,
    triangleCount: triangles,
    sizeBytes: optimizedBuffer.length,
  };
}

/**
 * Upload a GLB buffer to Supabase Storage in the 'models' bucket.
 * @param {Buffer} buffer - Optimized GLB binary
 * @param {string} listingId - ID of the listing
 * @returns {Promise<string>} publicUrl
 */
async function uploadToStorage(buffer, listingId) {
  const fileName = `listing_${listingId}_${Date.now()}.glb`;
  const storagePath = `listings/${fileName}`;

  const { error: uploadErr } = await supabase.storage
    .from('models')
    .upload(storagePath, buffer, {
      contentType: 'model/gltf-binary',
      upsert: true,
    });

  if (uploadErr) {
    throw new Error(`Failed to upload optimized 3D model to Supabase storage: ${uploadErr.message}`);
  }

  const { data: publicData } = supabase.storage.from('models').getPublicUrl(storagePath);
  return publicData.publicUrl;
}

/**
 * Full optimization and upload pipeline for a generated GLB model.
 * @param {string} rawGlbUrl - Remote download URL from Tripo
 * @param {string} listingId - Target marketplace listing ID
 * @returns {Promise<{ glbUrl: string, sizeBytes: number, triangleCount: number }>}
 */
async function processAndSaveGlb(rawGlbUrl, listingId) {
  console.log(`[ModelOptimizer] Downloading GLB from Tripo for listing ${listingId}...`);
  const rawBuffer = await downloadFileBuffer(rawGlbUrl);
  console.log(`[ModelOptimizer] Downloaded raw model: ${(rawBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

  // First optimization pass
  let result = await optimizeGlbBuffer(rawBuffer, false);
  console.log(
    `[ModelOptimizer] Pass 1 complete: ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB, ${result.triangleCount} triangles`
  );

  // If still above 5 MB, retry once with stronger simplification
  if (result.sizeBytes > MAX_TARGET_SIZE_BYTES) {
    console.log('[ModelOptimizer] Size exceeds 5MB limit. Retrying stronger simplification pass...');
    try {
      const aggressiveResult = await optimizeGlbBuffer(rawBuffer, true);
      if (aggressiveResult.sizeBytes < result.sizeBytes) {
        result = aggressiveResult;
        console.log(
          `[ModelOptimizer] Pass 2 complete: ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB, ${result.triangleCount} triangles`
        );
      }
    } catch (aggErr) {
      console.warn('[ModelOptimizer] Pass 2 simplification fallback:', aggErr.message);
    }
  }

  // Upload to Supabase Storage 'models' bucket
  console.log(`[ModelOptimizer] Uploading optimized GLB to Supabase Storage 'models' bucket...`);
  const publicUrl = await uploadToStorage(result.optimizedBuffer, listingId);
  console.log(`[ModelOptimizer] Upload complete! Public URL: ${publicUrl}`);

  return {
    glbUrl: publicUrl,
    sizeBytes: result.sizeBytes,
    triangleCount: result.triangleCount,
  };
}

module.exports = {
  processAndSaveGlb,
  optimizeGlbBuffer,
  getTriangleCount,
};
