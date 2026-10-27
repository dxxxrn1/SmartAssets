// ─── useCachedGlb Hook ──────────────────────────────────────────────────────────
// Downloads and caches GLB 3D model files locally using expo-file-system.
// Converts cached models to base64 data URIs for immediate, CORS-safe WebView injection.

import { useState, useEffect, useRef } from 'react';

let FileSystem = null;
try {
  // Expo SDK 52+ exports legacy filesystem methods under /legacy
  FileSystem = require('expo-file-system/legacy');
} catch (_) {
  try {
    FileSystem = require('expo-file-system');
  } catch (e) {
    FileSystem = null;
  }
}

const cacheDir = FileSystem?.cacheDirectory || FileSystem?.documentDirectory || '';
const MODELS_CACHE_DIR = cacheDir ? `${cacheDir}models/` : '';

/**
 * Sanitizes a URL into a safe, consistent local filename.
 */
function getLocalFilename(url) {
  if (!url) return 'model.glb';
  const clean = url.replace(/[^a-zA-Z0-9]/g, '_');
  const hash = clean.slice(-24);
  return `cached_${hash}.glb`;
}

/**
 * Hook to download, cache, and provide a 3D model file for rendering.
 * @param {string|null} glbUrl - Remote HTTPS URL of the GLB model
 * @returns {{ glbDataUri: string|null, loading: boolean, progress: number, error: string|null }}
 */
export default function useCachedGlb(glbUrl) {
  const [glbDataUri, setGlbDataUri] = useState(null);
  const [loading, setLoading] = useState(Boolean(glbUrl));
  const [progress, setProgress] = useState(0); // 0 to 1
  const [error, setError] = useState(null);
  const activeUrlRef = useRef(glbUrl);

  useEffect(() => {
    activeUrlRef.current = glbUrl;
    if (!glbUrl) {
      setGlbDataUri(null);
      setLoading(false);
      setProgress(0);
      setError(null);
      return;
    }

    let isMounted = true;
    let downloadResumable = null;

    async function loadModel() {
      setLoading(true);
      setProgress(0.05);
      setError(null);

      try {
        if (!FileSystem || !MODELS_CACHE_DIR) {
          if (isMounted && activeUrlRef.current === glbUrl) {
            setGlbDataUri(glbUrl);
            setProgress(1.0);
            setLoading(false);
          }
          return;
        }

        // Ensure cache directory exists
        const dirInfo = await FileSystem.getInfoAsync(MODELS_CACHE_DIR);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(MODELS_CACHE_DIR, { intermediates: true });
        }

        const fileName = getLocalFilename(glbUrl);
        const localUri = `${MODELS_CACHE_DIR}${fileName}`;
        const fileInfo = await FileSystem.getInfoAsync(localUri);

        if (fileInfo.exists && fileInfo.size > 0) {
          // Model is already cached
          setProgress(0.9);
          const base64Data = await FileSystem.readAsStringAsync(localUri, {
            encoding: FileSystem.EncodingType.Base64,
          });

          if (isMounted && activeUrlRef.current === glbUrl) {
            setGlbDataUri(`data:model/gltf-binary;base64,${base64Data}`);
            setProgress(1.0);
            setLoading(false);
          }
          return;
        }

        // Model not cached, start resumable download with progress tracking
        const callback = (downloadProgress) => {
          if (!isMounted) return;
          const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress;
          if (totalBytesExpectedToWrite > 0) {
            const pct = Math.min(0.95, totalBytesWritten / totalBytesExpectedToWrite);
            setProgress(pct);
          }
        };

        downloadResumable = FileSystem.createDownloadResumable(
          glbUrl,
          localUri,
          {},
          callback
        );

        const downloadResult = await downloadResumable.downloadAsync();
        if (!downloadResult || !downloadResult.uri) {
          throw new Error('Download failed to complete');
        }

        setProgress(0.96);
        const base64Data = await FileSystem.readAsStringAsync(downloadResult.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        if (isMounted && activeUrlRef.current === glbUrl) {
          setGlbDataUri(`data:model/gltf-binary;base64,${base64Data}`);
          setProgress(1.0);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[useCachedGlb] Download/cache error:', err.message);
        if (isMounted && activeUrlRef.current === glbUrl) {
          // If local download fails, fallback to passing remote URL directly
          setGlbDataUri(glbUrl);
          setError(err.message);
          setLoading(false);
        }
      }
    }

    loadModel();

    return () => {
      isMounted = false;
      if (downloadResumable) {
        downloadResumable.cancelAsync().catch(() => {});
      }
    };
  }, [glbUrl]);

  return { glbDataUri, loading, progress, error };
}
