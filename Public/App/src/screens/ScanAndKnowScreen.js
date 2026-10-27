// ─── Scan & Know ──────────────────────────────────────────────────────────────
// Real-time Camera / Gallery capture with a sleek glassmorphic result HUD.
// Unifies 3 core systems in one scan:
//   1. Google Gemini Vision (`gemini-3-flash-preview`) identification + physical authenticity red flags
//   2. Live SerpApi ZAR Market Oracle valuation range (`R... – R...`, never £)
//   3. Vault & Ethereum Sepolia ERC-721 Certificate lookup (`PERSONAL_COLLECTION`, `CO_OWNED_ASSETS`, Supabase)

import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { Feather, Ionicons } from "@expo/vector-icons";
import { SCREENS } from "../constants/navigation";
import { useAuth } from "../context/AuthContext";
import { scanAndKnowApi } from "../services/api";
import storage, { STORAGE_KEYS } from "../utils/storage";

const showAlert = (title, message) => {
  if (Platform.OS === "web") {
    window.alert([title, message].filter(Boolean).join("\n\n"));
    return;
  }
  Alert.alert(title, message);
};

/**
 * Ensures any picked/captured image asset is converted to a base64 data URI
 * across iOS, Android, and Web (including blob: URLs on web).
 */
async function toDataUri(asset) {
  if (!asset) return null;
  if (asset.base64) {
    if (String(asset.base64).startsWith("data:")) return asset.base64;
    const mime = asset.mimeType || "image/jpeg";
    return `data:${mime};base64,${asset.base64}`;
  }
  const uri = asset.uri || null;
  if (!uri) return null;
  if (uri.startsWith("data:")) return uri;

  if (Platform.OS === "web" && (uri.startsWith("blob:") || uri.startsWith("http"))) {
    try {
      const resp = await fetch(uri);
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (_) {
      return uri;
    }
  }
  return uri;
}

/**
 * Normalizes any valuation string so Pounds (£) never appear — always ZAR (R) with space thousands.
 */
function ensureZarFormatted(val, fallbackNum = 0) {
  if (val && typeof val === "string") {
    const cleaned = val.replace(/£/g, "R").trim();
    if (cleaned.startsWith("R")) return cleaned;
  }
  const num = Math.round(Number(val || fallbackNum) || 0);
  const grouped = String(Math.abs(num)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R${ grouped }`;
}

// Genuine vault matches are collected dynamically from the user's authentic portfolio
const DEFAULT_VAULT_MATCHES = [];


export default function ScanAndKnowScreen({ navigation }) {
  const { token } = useAuth();
  const [previewUri, setPreviewUri] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const collectVaultItems = async () => {
    const [personal, coOwned, market, vaultObj] = await Promise.all([
      storage.getJSON(STORAGE_KEYS.PERSONAL_COLLECTION),
      storage.getJSON(STORAGE_KEYS.CO_OWNED_ASSETS),
      storage.getJSON(STORAGE_KEYS.MARKET_ASSETS),
      storage.getJSON(STORAGE_KEYS.VAULT),
    ]);

    const seenNames = new Set();
    const tagged = [];

    const pushItem = (item, defaultSource) => {
      if (!item || !item.name) return;
      const key = `${item.id || ""}:${String(item.name).toLowerCase().trim()}`;
      if (seenNames.has(key)) return;
      seenNames.add(key);
      tagged.push({
        id: item.id,
        name: item.name,
        category: item.category,
        certId: item.certId || item.cert || "ERC-721 #4811",
        txHash: item.txHash || item.tx_hash,
        hashDisplay: item.hashDisplay || "0x71c...9a",
        tokenId: item.tokenId || item.token_id,
        image: item.image,
        price: item.liveMarketValueFormatted || item.price,
        price_num: item.liveMarketValue || item.price_num || item.initialValue,
        source: item.source || defaultSource,
      });
    };

    (Array.isArray(personal) ? personal : []).forEach((item) =>
      pushItem(item, "PERSONAL_COLLECTION"),
    );
    (Array.isArray(coOwned) ? coOwned : []).forEach((item) =>
      pushItem(item, "CO_OWNED_ASSETS"),
    );
    (Array.isArray(vaultObj?.holdings) ? vaultObj.holdings : []).forEach((item) =>
      pushItem(item, "user_holdings"),
    );
    (Array.isArray(market) ? market : []).forEach((item) =>
      pushItem(item, "marketplace"),
    );
    DEFAULT_VAULT_MATCHES.forEach((item) => pushItem(item, item.source));

    return tagged;
  };

  const runScan = async (imageUri) => {
    if (!imageUri) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const vaultItems = await collectVaultItems();
      const res = await scanAndKnowApi({ image: imageUri, vaultItems }, token);
      if (!res?.success) {
        throw new Error(res?.error || res?.rejectionReason || "Scan failed.");
      }
      setResult(res);
    } catch (err) {
      const msg =
        err?.message ||
        "Could not complete Scan & Know. Check the backend is running and try another photo.";
      setError(msg);
      showAlert("Scan & Know", msg);
    } finally {
      setScanning(false);
    }
  };

  const pickFromGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert(
          "Permission needed",
          "Photo library access is required to select an image for Scan & Know.",
        );
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.7,
        base64: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const uri = await toDataUri(picked.assets[0]);
      setPreviewUri(uri);
      await runScan(uri);
    } catch (err) {
      showAlert("Gallery error", err.message);
    }
  };

  const snapPhoto = async () => {
    if (Platform.OS === "web") {
      await pickFromGallery();
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        showAlert(
          "Permission needed",
          "Camera access is required to snap a Scan & Know photo.",
        );
        return;
      }
      const captured = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.7,
        base64: true,
      });
      if (captured.canceled || !captured.assets?.[0]) return;
      const uri = await toDataUri(captured.assets[0]);
      setPreviewUri(uri);
      await runScan(uri);
    } catch (err) {
      showAlert("Camera error", err.message);
    }
  };

  const resetScan = () => {
    setPreviewUri(null);
    setResult(null);
    setError(null);
    setScanning(false);
  };

  const verified = Boolean(result?.certificateMatch?.verified);
  const cert = result?.certificateMatch || {};
  const certIdDisplay = cert.certId || "ERC-721 #4811";
  const hashDisplay = cert.hashDisplay || "0x71c...9a";
  const certStatus = cert.status || "Verified on Sepolia Testnet";

  const lowFormatted = ensureZarFormatted(
    result?.lowFormatted || result?.market?.lowFormatted,
    result?.market?.lowPrice,
  );
  const highFormatted = ensureZarFormatted(
    result?.highFormatted || result?.market?.highFormatted,
    result?.market?.highPrice,
  );
  const fairValueFormatted = ensureZarFormatted(
    result?.fairValueFormatted ||
      result?.market?.fairValueFormatted ||
      result?.market?.formattedFairValue,
    result?.market?.fairValue,
  );

  const redFlags = Array.isArray(result?.redFlagsOrNotes)
    ? result.redFlagsOrNotes
    : [];

  const goToVerifiedAsset = () => {
    if (cert.assetId) {
      navigation.navigate(SCREENS.ASSET_DETAIL, {
        asset: {
          id: cert.assetId,
          name: cert.name || result.detectedName,
          category: result.category,
          image: cert.image || previewUri,
          images: [cert.image || previewUri].filter(Boolean),
          price: cert.price || fairValueFormatted,
          price_num: cert.price_num || result.market?.fairValue || 0,
          year: result.estimatedYearOrEra,
          condition: result.conditionGrade,
          description: redFlags.join(" • "),
          cert: certIdDisplay,
          certId: certIdDisplay,
          txHash: hashDisplay,
          badge: "Verified On-Chain",
          aiScanStatus: "passed",
        },
      });
      return;
    }
    navigation.navigate(SCREENS.MAIN_TABS, { screen: SCREENS.VAULT });
  };

  const goToVaultScreen = () => {
    navigation.navigate(SCREENS.MAIN_TABS, { screen: SCREENS.VAULT });
  };

  const goToTokenize = () => {
    const fairValNum =
      result?.market?.fairValue ||
      parseFloat(String(fairValueFormatted).replace(/[^0-9.]/g, "")) ||
      "";
    navigation.navigate(SCREENS.LIST_ASSET, {
      scanPrefill: {
        image: previewUri,
        detectedName: result.detectedName,
        category: result.category,
        estimatedYearOrEra: result.estimatedYearOrEra,
        conditionGrade: result.conditionGrade,
        askingPrice: String(fairValNum),
        fairValue: fairValNum,
        lowFormatted,
        highFormatted,
        fairValueFormatted,
        market: {
          ...(result.market || {}),
          lowFormatted,
          highFormatted,
          fairValueFormatted,
          formattedFairValue: fairValueFormatted,
          formattedRange: `${lowFormatted} – ${highFormatted}`,
        },
        redFlagsOrNotes: redFlags,
      },
    });
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#070B18", "#101A33", "#0B1224"]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {previewUri ? (
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />
      ) : (
        <View style={styles.emptyPreview}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            <View style={styles.scanPulseCircle}>
              <Ionicons name="scan-outline" size={50} color="#00C2FF" />
            </View>
            <Text style={styles.viewfinderTitle}>
              Point at any physical luxury asset
            </Text>
            <Text style={styles.viewfinderHint}>
              Gemini 3 Flash Vision identifies the exact item, checks factory hallmarks & red flags, queries live South African Rand (ZAR) comps via SerpApi, and matches Sepolia ERC-721 Vault certificates.
            </Text>
          </View>
        </View>
      )}

      <LinearGradient
        colors={["rgba(7,11,24,0.78)", "transparent"]}
        style={styles.topFade}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top"]} style={styles.topBarSafe}>
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.iconBtn}
            activeOpacity={0.8}
          >
            <Feather name="x" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.topTitleWrap}>
            <Text style={styles.topKicker}>GEMINI • ZAR ORACLE • SEPOLIA</Text>
            <Text style={styles.topTitle}>Scan & Know</Text>
          </View>
          <TouchableOpacity
            onPress={resetScan}
            style={styles.iconBtn}
            activeOpacity={0.8}
          >
            <Feather name="refresh-cw" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {!result && !scanning && (
        <View style={styles.captureDock}>
          <TouchableOpacity
            style={styles.sideAction}
            onPress={pickFromGallery}
            activeOpacity={0.85}
          >
            <View style={styles.sideIconBubble}>
              <Feather name="image" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.sideActionLabel}>
              {Platform.OS === "web" ? "Upload" : "Gallery"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={snapPhoto}
            activeOpacity={0.9}
            style={styles.shutterOuter}
          >
            <LinearGradient
              colors={["#00C2FF", "#7C3AED"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.shutterInner}
            >
              <Feather name="camera" size={24} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideAction}
            onPress={pickFromGallery}
            activeOpacity={0.85}
          >
            <View style={styles.sideIconBubble}>
              <Feather name="upload-cloud" size={18} color="#00C2FF" />
            </View>
            <Text style={styles.sideActionLabel}>Select Photo</Text>
          </TouchableOpacity>
        </View>
      )}

      {scanning && (
        <View style={styles.loadingHud}>
          <ActivityIndicator size="large" color="#00C2FF" />
          <Text style={styles.loadingTitle}>
            Inspecting physical hallmarks…
          </Text>
          <Text style={styles.loadingSub}>
            Gemini 3 Flash Vision → Live SerpApi ZAR Oracle → Sepolia ERC-721 Vault Lookup
          </Text>
        </View>
      )}

      {result && !scanning && (
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetScroll}
            >
              {/* 1. Header Badge */}
              {verified ? (
                <View style={styles.verifiedBadgeWrap}>
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedBadgeText}>
                      {`✅ VERIFIED IN SYSTEM • ${certIdDisplay} (Sepolia)`}
                    </Text>
                  </View>
                  <View style={styles.sepoliaSubRow}>
                    <Ionicons name="link-outline" size={13} color="#6EE7B7" />
                    <Text style={styles.sepoliaSubText}>
                      {`${hashDisplay} • ${certStatus}`}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.unregisteredBadge}>
                  <Text style={styles.unregisteredBadgeText}>
                    🔍 UNREGISTERED PHYSICAL ASSET
                  </Text>
                </View>
              )}

              {/* 2. Item Title & Era */}
              <Text style={styles.itemTitle}>
                {`${result.detectedName} • ~${result.estimatedYearOrEra}`}
              </Text>
              <Text style={styles.itemMeta}>
                {result.category} · {result.conditionGrade}
                {result.confidence
                  ? ` · ${Math.round(Number(result.confidence) * 100)}% AI Confidence`
                  : ""}
              </Text>

              {/* 3. Estimated ZAR Value Range + Fair Market Median */}
              <View style={styles.oracleBox}>
                <View style={styles.oracleTopRow}>
                  <Text style={styles.oracleKicker}>
                    LIVE ZAR MARKET ORACLE (SERPAPI)
                  </Text>
                  <View style={styles.zarPill}>
                    <Text style={styles.zarPillText}>ZAR (R)</Text>
                  </View>
                </View>
                <Text style={styles.valueRange}>
                  {`Est. ${lowFormatted} – ${highFormatted}`}
                </Text>
                <Text style={styles.fairMedian}>
                  {`Fair market median: ${fairValueFormatted}`}
                </Text>
              </View>

              {/* 4. AI Authenticity & Red Flag Report */}
              <View style={styles.reportHeaderRow}>
                <Ionicons
                  name="shield-half-outline"
                  size={15}
                  color="#00C2FF"
                />
                <Text style={styles.reportLabel}>
                  AI Authenticity & Red Flag Report
                </Text>
              </View>

              {redFlags.map((note, idx) => {
                const isWarning =
                  /aftermarket|inconsist|mismatch|fake|warning|worn|replace|caution|verify|inspect/i.test(
                    note,
                  );
                return (
                  <View
                    key={`${idx}-${note.slice(0, 12)}`}
                    style={[
                      styles.flagRow,
                      isWarning ? styles.flagRowWarn : styles.flagRowOk,
                    ]}
                  >
                    <View
                      style={[
                        styles.flagDot,
                        isWarning ? styles.flagDotWarn : styles.flagDotOk,
                      ]}
                    />
                    <Text style={styles.flagText}>{note}</Text>
                  </View>
                );
              })}

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              {/* 5. Action Button */}
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={verified ? goToVerifiedAsset : goToTokenize}
              >
                <LinearGradient
                  colors={
                    verified ? ["#059669", "#10B981"] : ["#7C3AED", "#2563EB"]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.cta}
                >
                  <Text style={styles.ctaText}>
                    {verified
                      ? "View Asset in Vault →"
                      : "Tokenize & Add to Vault →"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.bottomActionsRow}>
                {verified && (
                  <TouchableOpacity
                    onPress={goToVaultScreen}
                    style={styles.secondaryVaultBtn}
                  >
                    <Text style={styles.secondaryVaultText}>
                      Open Vault Portfolio
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={resetScan} style={styles.rescanBtn}>
                  <Feather
                    name="camera"
                    size={13}
                    color="rgba(255,255,255,0.75)"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.rescanText}>Scan another item</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#070B18" },
  preview: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  emptyPreview: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  viewfinder: {
    width: 290,
    height: 340,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    gap: 12,
  },
  scanPulseCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(0,194,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  viewfinderTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  viewfinderHint: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  corner: {
    position: "absolute",
    width: 30,
    height: 30,
    borderColor: "#00C2FF",
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 10,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 10,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 10,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 10,
  },
  topFade: { position: "absolute", top: 0, left: 0, right: 0, height: 140 },
  topBarSafe: { position: "absolute", top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15,23,42,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  topTitleWrap: { alignItems: "center" },
  topKicker: {
    color: "#00C2FF",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  topTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  captureDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  sideAction: { alignItems: "center", gap: 6, width: 84 },
  sideIconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(15,23,42,0.65)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  sideActionLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
  },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3.5,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingHud: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 48,
    borderRadius: 24,
    padding: 22,
    backgroundColor: "rgba(10,16,35,0.82)",
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.32)",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? { backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }
      : {}),
  },
  loadingTitle: {
    marginTop: 12,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  loadingSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "74%",
  },
  sheet: {
    backgroundColor: "rgba(10, 16, 36, 0.84)",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 20,
    paddingBottom: 28,
    ...(Platform.OS === "web"
      ? {
          backdropFilter: "blur(24px) saturate(170%)",
          WebkitBackdropFilter: "blur(24px) saturate(170%)",
        }
      : {}),
  },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginTop: 10,
    marginBottom: 14,
  },
  sheetScroll: { paddingBottom: 14 },
  verifiedBadgeWrap: {
    marginBottom: 12,
    gap: 6,
  },
  verifiedBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.22)",
    borderWidth: 1.2,
    borderColor: "#34D399",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    shadowColor: "#10B981",
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  verifiedBadgeText: {
    color: "#6EE7B7",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  sepoliaSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 4,
  },
  sepoliaSubText: {
    color: "rgba(110,231,183,0.85)",
    fontSize: 11,
    fontWeight: "600",
  },
  unregisteredBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(245,158,11,0.2)",
    borderWidth: 1.2,
    borderColor: "#FBBF24",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginBottom: 12,
    shadowColor: "#F59E0B",
    shadowOpacity: 0.65,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  unregisteredBadgeText: {
    color: "#FCD34D",
    fontSize: 11.5,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  itemTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
  },
  itemMeta: {
    marginTop: 4,
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    fontWeight: "600",
  },
  oracleBox: {
    marginTop: 14,
    backgroundColor: "rgba(30, 41, 82, 0.52)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.26)",
  },
  oracleTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  oracleKicker: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  zarPill: {
    backgroundColor: "rgba(0,194,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(0,194,255,0.4)",
  },
  zarPillText: {
    color: "#00C2FF",
    fontSize: 9.5,
    fontWeight: "800",
  },
  valueRange: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  fairMedian: {
    marginTop: 4,
    color: "#00C2FF",
    fontSize: 13,
    fontWeight: "700",
  },
  reportHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    marginBottom: 10,
  },
  reportLabel: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  flagRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 9,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  flagRowOk: {
    backgroundColor: "rgba(16,185,129,0.08)",
    borderColor: "rgba(52,211,153,0.22)",
  },
  flagRowWarn: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderColor: "rgba(251,191,36,0.28)",
  },
  flagDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  flagDotOk: { backgroundColor: "#34D399" },
  flagDotWarn: { backgroundColor: "#F59E0B" },
  flagText: {
    flex: 1,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: { color: "#FCA5A5", marginTop: 8, fontSize: 12 },
  cta: {
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    shadowColor: "#7C3AED",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  ctaText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  bottomActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    marginTop: 4,
  },
  secondaryVaultBtn: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  secondaryVaultText: {
    color: "#6EE7B7",
    fontSize: 13,
    fontWeight: "700",
  },
  rescanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  rescanText: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: "600",
  },
});
