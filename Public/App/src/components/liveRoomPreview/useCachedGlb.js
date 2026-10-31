// ─── useCachedGlb Hook ──────────────────────────────────────────────────────────
// Downloads and caches GLB 3D model files locally using expo-file-system.
// Converts cached models to base64 data URIs for immediate, CORS-safe WebView injection
// on both Expo Go and standalone Android APKs.

import { useState, useEffect, useRef, useCallback } from 'react';

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
  const withoutQuery = String(url).split('?')[0];
  const clean = withoutQuery.replace(/[^a-zA-Z0-9]/g, '_');
  const hash = clean.slice(-32);
  return `cached_${hash}.glb`;
}

/**
 * Hook to download, cache, and provide a 3D model file for rendering.
 * @param {string|null} glbUrl - Remote HTTPS URL of the GLB model
 * @returns {{ glbDataUri: string|null, dataUri: string|null, localUri: string|null, loading: boolean, progress: number, error: string|null, reload: () => void }}
 */
export default function useCachedGlb(glbUrl) {
  const [glbDataUri, setGlbDataUri] = useState(null);
  const [localUri, setLocalUri] = useState(null);
  const [loading, setLoading] = useState(Boolean(glbUrl));
  const [progress, setProgress] = useState(0); // 0 to 1
  const [error, setError] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const activeUrlRef = useRef(glbUrl);

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    activeUrlRef.current = glbUrl;
    if (!glbUrl) {
      setGlbDataUri(null);
      setLocalUri(null);
      setLoading(false);
      setProgress(0);
      setError(null);
      return undefined;
    }

    let isMounted = true;
    let downloadResumable = null;

    async function loadModel() {
      setLoading(true);
      setProgress(0.05);
      setError(null);

      try {
        if (String(glbUrl).startsWith('data:')) {
          if (isMounted && activeUrlRef.current === glbUrl) {
            setGlbDataUri(glbUrl);
            setLocalUri(glbUrl);
            setProgress(1.0);
            setLoading(false);
          }
          return;
        }

        if (!FileSystem || !MODELS_CACHE_DIR || typeof FileSystem.getInfoAsync !== 'function') {
          if (isMounted && activeUrlRef.current === glbUrl) {
            setGlbDataUri(glbUrl);
            setLocalUri(glbUrl);
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
        const targetLocalUri = `${MODELS_CACHE_DIR}${fileName}`;
        const fileInfo = await FileSystem.getInfoAsync(targetLocalUri);

        if (fileInfo.exists && fileInfo.size > 0 && reloadNonce === 0) {
          setProgress(0.9);
          const base64Data = await FileSystem.readAsStringAsync(targetLocalUri, {
            encoding: FileSystem.EncodingType?.Base64 || 'base64',
          });

          if (isMounted && activeUrlRef.current === glbUrl) {
            const dataUriVal = `data:model/gltf-binary;base64,${base64Data}`;
            setGlbDataUri(dataUriVal);
            setLocalUri(targetLocalUri);
            setProgress(1.0);
            setLoading(false);
          }
          return;
        }

        // Model not cached, start resumable download with progress tracking
        const callback = (downloadProgress) => {
          if (!isMounted) return;
          const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgress || {};
          if (totalBytesExpectedToWrite > 0) {
            const pct = Math.min(0.95, totalBytesWritten / totalBytesExpectedToWrite);
            setProgress(pct);
          }
        };

        downloadResumable = FileSystem.createDownloadResumable(
          glbUrl,
          targetLocalUri,
          {},
          callback,
        );

        const downloadResult = await downloadResumable.downloadAsync();
        if (!downloadResult || !downloadResult.uri || (downloadResult.status && downloadResult.status >= 400)) {
          throw new Error(`3D model download failed${downloadResult?.status ? ` (HTTP ${downloadResult.status})` : ''}`);
        }

        setProgress(0.96);
        const base64Data = await FileSystem.readAsStringAsync(downloadResult.uri, {
          encoding: FileSystem.EncodingType?.Base64 || 'base64',
        });

        if (isMounted && activeUrlRef.current === glbUrl) {
          const dataUriVal = `data:model/gltf-binary;base64,${base64Data}`;
          setGlbDataUri(dataUriVal);
          setLocalUri(downloadResult.uri);
          setProgress(1.0);
          setLoading(false);
        }
      } catch (err) {
        console.warn('[useCachedGlb] Download/cache warning:', err?.message || err);
        if (isMounted && activeUrlRef.current === glbUrl) {
          // Pass remote URL directly so WebView GLTFLoader can still attempt HTTPS fetch if CORS permits,
          // while exposing the error state if WebView also cannot load it.
          setGlbDataUri(glbUrl);
          setLocalUri(glbUrl);
          setError(err?.message || 'Could not download 3D model');
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
  }, [glbUrl, reloadNonce]);

  return {
    glbDataUri,
    dataUri: glbDataUri,
    localUri,
    loading,
    progress,
    error,
    reload,
  };
}
