// ─── AI Detection Service ─────────────────────────────────────────────────────
// Scans listing photos to detect AI-generated, synthetic, or deepfake imagery.
// Supports both Hive AI API and Hugging Face multi-model ensemble.
// Rejects fraudulent or synthetic images before assets can enter the marketplace.

const axios = require('axios');

// Environment token
const ACCESS_TOKEN = process.env.HIVE_ACCESS_TOKEN || '';

// Score threshold (0.0 - 1.0) above which an image is flagged as AI-generated/fraudulent
// 0.50 ensures strict blocking of all generative models (Midjourney, DALL-E, SDXL, etc.)
const AI_THRESHOLD = 0.50;

// Hugging Face AI image detection ensemble models
const HF_MODELS = [
  { id: 'umm-maybe/AI-image-detector', name: 'AI Image Detector (General Art & Photos)' },
  { id: 'Organika/sdxl-detector', name: 'SDXL & Diffusion Image Detector' },
  { id: 'dima806/deepfake_vs_real_image_detection', name: 'Deepfake & Synthetic Face Detector' },
];

/**
 * Scan a single image using the active AI detection engine.
 *
 * @param {string} imageInput — Base64 data URI ("data:image/...;base64,...") or public URL
 * @returns {Promise<{ isAiGenerated: boolean, score: number, scanFailed: boolean, details: object }>}
 */
async function scanImage(imageInput) {
  if (!ACCESS_TOKEN) {
    console.warn('⚠️ [AI Detection] No AI detection access token configured');
    return { isAiGenerated: false, score: 0, scanFailed: true, details: { error: 'No API token configured' } };
  }

  // 1. If user provided a Hugging Face access token (`hf_...`), use Hugging Face AI ensemble
  if (ACCESS_TOKEN.startsWith('hf_')) {
    return scanWithHuggingFaceEnsemble(imageInput);
  }

  // 2. Otherwise, treat as Hive AI token and use Hive API
  return scanWithHive(imageInput);
}

/**
 * Scan image using Hugging Face multi-model ensemble router.
 * Combines general AI image detection, SDXL/diffusion detection, and deepfake models.
 */
async function scanWithHuggingFaceEnsemble(imageInput) {
  try {
    let imageBuffer;

    if (imageInput && imageInput.startsWith('data:')) {
      const base64Data = imageInput.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, '');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageInput && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
      const resp = await axios.get(imageInput, {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'SmartAssets-AI-Guard/1.0' },
        timeout: 15000,
      });
      imageBuffer = Buffer.from(resp.data);
    } else {
      return { isAiGenerated: false, score: 0, scanFailed: true, details: { error: 'Invalid image format' } };
    }

    console.log(`🛡️ [AI Detection] Scanning image across ${HF_MODELS.length} AI detection models in parallel...`);

    // Query all models concurrently for fast response
    const modelPromises = HF_MODELS.map(async (model) => {
      try {
        const response = await axios.post(
          `https://router.huggingface.co/hf-inference/models/${model.id}`,
          imageBuffer,
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
              'Content-Type': 'application/octet-stream',
            },
            timeout: 25000,
          }
        );

        const classes = Array.isArray(response.data) ? response.data : [];
        const fakeClass = classes.find((c) =>
          ['artificial', 'fake', 'synthetic', 'ai'].includes(String(c.label).toLowerCase())
        );
        const realClass = classes.find((c) =>
          ['human', 'real', 'authentic'].includes(String(c.label).toLowerCase())
        );

        const aiScore = fakeClass ? Number(fakeClass.score) : 0;
        const realScore = realClass ? Number(realClass.score) : 0;
        const isFlagged = aiScore >= AI_THRESHOLD || (aiScore > 0 && realScore > 0 && aiScore > realScore);

        return {
          modelId: model.id,
          modelName: model.name,
          aiScore,
          realScore,
          isFlagged,
          success: true,
        };
      } catch (err) {
        console.warn(`⚠️ [AI Detection] Model ${model.id} error:`, err.response?.data?.error || err.message);
        return {
          modelId: model.id,
          modelName: model.name,
          error: err.response?.data?.error || err.message,
          success: false,
        };
      }
    });

    const results = await Promise.all(modelPromises);

    let maxAiScore = 0;
    let anyFlagged = false;
    let successfulScans = 0;

    for (const r of results) {
      if (r.success) {
        successfulScans++;
        if (r.aiScore > maxAiScore) maxAiScore = r.aiScore;
        if (r.isFlagged) {
          anyFlagged = true;
          console.warn(`🚫 [AI Detection] Flagged by ${r.modelName}: AI confidence ${(r.aiScore * 100).toFixed(1)}%`);
        } else {
          console.log(`✅ [AI Detection] Passed by ${r.modelName}: AI confidence ${(r.aiScore * 100).toFixed(1)}%`);
        }
      }
    }

    if (successfulScans === 0) {
      console.error('❌ [AI Detection] All Hugging Face detection models failed to respond.');
      return {
        isAiGenerated: false,
        score: 0,
        scanFailed: true,
        details: { error: 'All models failed', results },
      };
    }

    console.log(
      `🛡️ [AI Detection] Ensemble Result: Max AI Score: ${(maxAiScore * 100).toFixed(1)}% → ` +
      `${anyFlagged ? '🚫 BLOCKED AS AI-GENERATED' : '✅ PASSED AUTHENTIC'}`
    );

    return {
      isAiGenerated: anyFlagged,
      score: maxAiScore,
      scanFailed: false,
      details: { maxAiScore, results, engine: 'HuggingFaceEnsemble' },
    };
  } catch (err) {
    console.error('⚠️ [AI Detection] Hugging Face scan fatal error:', err.message);
    return {
      isAiGenerated: false,
      score: 0,
      scanFailed: true,
      details: { error: err.message, engine: 'HuggingFaceEnsemble' },
    };
  }
}

/**
 * Scan image using Hive's AI detection API
 */
async function scanWithHive(imageInput) {
  try {
    const FormData = require('form-data');
    const formData = new FormData();

    if (imageInput && imageInput.startsWith('data:')) {
      const matches = imageInput.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        return { isAiGenerated: false, score: 0, scanFailed: true, details: { error: 'Invalid data URI' } };
      }
      const mimeType = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      formData.append('media', buffer, { filename: 'upload.jpg', contentType: mimeType });
    } else if (imageInput && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
      formData.append('url', imageInput);
    } else {
      return { isAiGenerated: false, score: 0, scanFailed: true, details: { error: 'Unrecognised input format' } };
    }

    console.log('🔍 [AI Detection] Scanning image via Hive API...');

    const response = await axios.post('https://api.thehive.ai/api/v2/task/sync', formData, {
      headers: {
        Authorization: `Token ${ACCESS_TOKEN}`,
        Accept: 'application/json',
        ...formData.getHeaders(),
      },
      timeout: 25000,
    });

    const statusArr = response.data?.status;
    const taskStatus = statusArr?.[0];
    const output = taskStatus?.response?.output;

    if (!Array.isArray(output) || output.length === 0) {
      return { isAiGenerated: false, score: 0, scanFailed: true, details: response.data };
    }

    const classes = output[0]?.classes || [];
    const aiClass = classes.find((c) => c.class === 'ai_generated');
    const aiScore = aiClass?.score ?? 0;
    const isAiGenerated = aiScore >= AI_THRESHOLD;

    console.log(
      `🔍 [AI Detection] Hive Result: ai_generated=${(aiScore * 100).toFixed(1)}% → ` +
      `${isAiGenerated ? '🚫 FLAGGED' : '✅ PASSED'}`
    );

    return {
      isAiGenerated,
      score: aiScore,
      scanFailed: false,
      details: { aiScore, classes, engine: 'Hive' },
    };
  } catch (err) {
    console.error('⚠️ [AI Detection] Hive API error:', err.response?.data || err.message);
    return {
      isAiGenerated: false,
      score: 0,
      scanFailed: true,
      details: { error: err.message, engine: 'Hive' },
    };
  }
}

/**
 * Scan multiple images. If ANY image is flagged as AI-generated, the whole
 * set is considered fraudulent.
 *
 * @param {string[]} images — array of image strings (base64 data URIs or URLs)
 * @returns {Promise<{ isAiGenerated: boolean, highestScore: number, scanFailed: boolean, status: string, results: object[] }>}
 */
async function scanAllImages(images) {
  if (!images || images.length === 0) {
    return { isAiGenerated: false, highestScore: 0, scanFailed: true, status: 'scan_failed', results: [] };
  }

  const unique = [...new Set(images)];
  console.log(`🛡️ [AI Detection] Scanning ${unique.length} image(s) for synthetic/AI fraud...`);

  const results = [];
  let highestScore = 0;
  let anyFlagged = false;
  let anyScanFailed = false;

  for (const img of unique) {
    const result = await scanImage(img);
    results.push(result);

    if (result.score > highestScore) highestScore = result.score;
    if (result.isAiGenerated) anyFlagged = true;
    if (result.scanFailed) anyScanFailed = true;

    if (anyFlagged) {
      console.warn('🚫 [AI Detection] Synthetic/AI image detected — stopping further scans.');
      break;
    }
  }

  const status = anyFlagged ? 'flagged' : anyScanFailed ? 'scan_failed' : 'passed';
  console.log(`🛡️ [AI Detection] Final verdict: ${status.toUpperCase()} (highest AI confidence: ${(highestScore * 100).toFixed(1)}%)`);

  return {
    isAiGenerated: anyFlagged,
    highestScore,
    scanFailed: anyScanFailed && !anyFlagged,
    status,
    results,
  };
}

module.exports = { scanImage, scanAllImages };
