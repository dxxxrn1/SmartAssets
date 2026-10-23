// ─── Tripo 3D AI API Service (V3) ──────────────────────────────────────────
// Official Documentation Reference:
// - Tripo Developer Portal: https://developers.tripo3d.ai
// - Platform Documentation: https://platform.tripo3d.ai/docs
// - OpenAPI Base URL: https://openapi.tripo3d.ai/v3
//
// NOTE ON API VERSIONS:
// As documented by Tripo AI, API v2 (https://api.tripo3d.ai/v2/openapi/...)
// was deprecated in October 2026 and officially retired on November 1, 2026.
// This service strictly uses the recommended Tripo API v3 endpoints:
//   - Account Balance: GET  /v3/account/balance
//   - Image to 3D:     POST /v3/generation/image-to-model
//   - Task Status:     GET  /v3/tasks/:task_id

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const TRIPO_BASE_URL = 'https://openapi.tripo3d.ai/v3';

function getTripoApiKey() {
  const key = (process.env.TRIPO_API_KEY || process.env.TRIPO_SECRETE_KEY || '').trim();
  if (!key) {
    throw new Error('TRIPO_API_KEY is not configured in backend/.env');
  }
  return key;
}

/**
 * Returns axios headers for Tripo v3 API.
 * The API key is injected directly and never printed to console/logs.
 */
function getHeaders() {
  return {
    Authorization: `Bearer ${getTripoApiKey()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Check Tripo user wallet credit balance.
 * Endpoint: GET https://openapi.tripo3d.ai/v3/account/balance
 * Returns: { balance: number, frozen: number }
 */
async function checkCreditBalance() {
  try {
    const res = await axios.get(`${TRIPO_BASE_URL}/account/balance`, {
      headers: getHeaders(),
      timeout: 10000,
    });

    if (res.data && res.data.code === 0 && res.data.data) {
      return {
        balance: Number(res.data.data.balance) || 0,
        frozen: Number(res.data.data.frozen) || 0,
      };
    }

    throw new Error(res.data?.message || 'Failed to retrieve Tripo account balance');
  } catch (err) {
    if (err.response?.data?.message) {
      throw new Error(`Tripo API Error (${err.response.status}): ${err.response.data.message}`);
    }
    throw new Error(`Tripo connection error: ${err.message}`);
  }
}

/**
 * Create an Image-to-3D generation task.
 * Endpoint: POST https://openapi.tripo3d.ai/v3/generation/image-to-model
 *
 * Parameters per Tripo V3 docs:
 * - model: "v3.1-20260211" (Flagship high-precision model)
 * - input: Public image URL or file token
 * - face_limit: Face count budget (30,000 to 50,000 for mobile fidelity)
 * - texture: true (generate texture map)
 * - pbr: true (PBR materials)
 *
 * @param {string} imageUrl - Publicly accessible HTTPS URL of the reference photo
 * @param {object} options - Optional generation overrides
 * @returns {Promise<string>} task_id
 */
async function createImageToModelTask(imageUrl, options = {}) {
  if (!imageUrl) {
    throw new Error('Image URL is required for 3D model generation');
  }

  // 1. Check credit balance before attempting generation
  const balanceInfo = await checkCreditBalance();
  if (balanceInfo.balance <= 0) {
    throw new Error(
      `Insufficient Tripo credits. Your available balance is ${balanceInfo.balance.toFixed(
        2
      )} credits. Please top up your account at https://platform.tripo3d.ai`
    );
  }

  // 2. Prepare v3 payload
  const payload = {
    model: options.model || 'v3.1-20260211',
    input: imageUrl,
    face_limit: options.face_limit || 40000,
    texture: options.texture !== undefined ? options.texture : true,
    pbr: options.pbr !== undefined ? options.pbr : true,
  };

  try {
    const res = await axios.post(`${TRIPO_BASE_URL}/generation/image-to-model`, payload, {
      headers: getHeaders(),
      timeout: 15000,
    });

    if (res.data && res.data.code === 0 && res.data.data?.task_id) {
      return res.data.data.task_id;
    }

    throw new Error(res.data?.message || 'Tripo did not return a valid task ID');
  } catch (err) {
    if (err.response?.data) {
      const apiMsg = err.response.data.message || err.response.data.suggestion || 'Tripo task creation error';
      throw new Error(`Tripo API Error (${err.response.status}): ${apiMsg}`);
    }
    throw err;
  }
}

/**
 * Query the status of an asynchronous 3D generation task.
 * Endpoint: GET https://openapi.tripo3d.ai/v3/tasks/:task_id
 *
 * Status values: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'banned'
 *
 * @param {string} taskId - Tripo task ID
 * @returns {Promise<{ status: string, progress: number, modelUrl?: string, renderedImageUrl?: string, error?: string }>}
 */
async function getTaskStatus(taskId) {
  if (!taskId) {
    throw new Error('Task ID is required to query status');
  }

  try {
    const res = await axios.get(`${TRIPO_BASE_URL}/tasks/${taskId}`, {
      headers: getHeaders(),
      timeout: 10000,
    });

    if (res.data && res.data.code === 0 && res.data.data) {
      const task = res.data.data;
      const status = task.status; // 'queued' | 'running' | 'success' | 'failed'

      return {
        status,
        progress: task.progress || 0,
        modelUrl: task.output?.pbr_model_url || task.output?.model_url || null,
        renderedImageUrl: task.output?.rendered_image_url || null,
        error: task.error_message || null,
      };
    }

    throw new Error(res.data?.message || 'Failed to parse task status from Tripo');
  } catch (err) {
    if (err.response?.data?.message) {
      throw new Error(`Tripo task check error (${err.response.status}): ${err.response.data.message}`);
    }
    throw err;
  }
}

module.exports = {
  checkCreditBalance,
  createImageToModelTask,
  getTaskStatus,
};
