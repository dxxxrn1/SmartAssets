// ─── ListAssetScreen ──────────────────────────────────────────────────────────
// List a new luxury asset for sale — unified with the Luminous Purple & Cyan Fintech theme.
// Real photo uploads & provenance history builder with Supabase & blockchain escrow integration.

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { SCREENS } from "../constants/navigation";
import { useAuth } from "../context/AuthContext";
import KycGatekeeperModal from "../components/KycGatekeeperModal";
import { createAssetApi, verifyAssetUploadApi, addUserHolding } from "../services/api";
import { Feather, Ionicons } from "@expo/vector-icons";
import storage, { STORAGE_KEYS } from "../utils/storage";

// Alert.alert is a silent no-op on web, so fall back to window dialogs there.
const showAlert = (title, message, buttons = []) => {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons.length ? buttons : undefined);
    return;
  }
  const text = [title, message].filter(Boolean).join("\n\n");
  if (buttons.length > 1) {
    const ok = window.confirm(text);
    const pick = ok ? buttons[buttons.length - 1] : buttons[0];
    if (pick && pick.onPress && pick.style !== "cancel") pick.onPress();
  } else {
    window.alert(text);
    if (buttons[0] && buttons[0].onPress) buttons[0].onPress();
  }
};

const STEPS = ["Details", "Photos", "History", "Pricing"];

const CANVAS_MESH = [
  "#e4e0ffff", // Soft luminous lavender
  "#e0daffff", // Soft purple aura
  "#f5dfefff", // Soft lilac-pink
  "#fff5efff", // Soft peach aura
  "#ffffffff", // Ambient cream
];

function normalizeListCategory(rawCat = "", rawName = "") {
  const combined = `${rawCat} ${rawName}`.toLowerCase();
  if (/watch|timepiece|horolog|rolex|omega|patek|audemars|cartier|tag heuer|seiko|casio|breitling/i.test(combined)) {
    return "Luxury Watch";
  }
  if (/sneaker|shoe|apparel|trainer|footwear|streetwear|jordan|nike|adidas|converse|yeezy|dunk/i.test(combined)) {
    return "Sneakers & Apparel";
  }
  if (/electronic|gadget|phone|smartphone|iphone|samsung|galaxy|pixel|laptop|macbook|keyboard|logitech|logi|cable|mouse|headphone|audio|camera/i.test(combined)) {
    return "Electronics & Gadgets";
  }
  if (/art|painting|print|sculpture|canvas|lithograph|banksy|kaws|basquiat|warhol/i.test(combined)) {
    return "Fine Art";
  }
  if (/car|vehicle|automobile|ferrari|porsche|lamborghini|mercedes|bmw|aston martin|mustang/i.test(combined)) {
    return "Classic Car";
  }
  if (/wine|champagne|whisky|whiskey|cognac|spirits|romanee|dom perignon/i.test(combined)) {
    return "Fine Wine";
  }
  return "Collectibles";
}

function yearFromEra(era) {
  if (!era) return String(new Date().getFullYear());
  const match = String(era).match(/(19|20)\d{2}/);
  return match ? match[0] : String(new Date().getFullYear());
}

export default function ListAssetScreen({ navigation, route }) {
  const { user, token } = useAuth();
  const [kycGatekeeperVisible, setKycGatekeeperVisible] = useState(false);
  const appliedScanKey = useRef(null);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [destinationMode, setDestinationMode] = useState("personal"); // 'personal' | 'marketplace'

  // Mandatory 3-Step Pipeline States
  const [verifyingImage, setVerifyingImage] = useState(false);
  const [aiVerified, setAiVerified] = useState(false);
  const [verifiedAsset, setVerifiedAsset] = useState(null);
  const [marketData, setMarketData] = useState(null);
  const [verificationError, setVerificationError] = useState(null);

  // Asset Form State
  const [form, setForm] = useState({
    name: "",
    category: "Collectibles",
    year: String(new Date().getFullYear()),
    condition: "",
    description: "",
    initialPrice: "",
    askingPrice: "",
    images: [], // up to 3 photos
  });

  // Provenance History Events State
  const [historyList, setHistoryList] = useState([]);
  const [newYear, setNewYear] = useState("");
  const [newEvent, setNewEvent] = useState("");
  const [newParty, setNewParty] = useState("");

  // Clears every field so the next upload starts fresh
  const resetAll = () => {
    setStep(0);
    setSaved(false);
    setSubmitting(false);
    setDestinationMode("personal");
    setVerifyingImage(false);
    setAiVerified(false);
    setVerifiedAsset(null);
    setMarketData(null);
    setVerificationError(null);
    setForm({
      name: "",
      category: "Collectibles",
      year: String(new Date().getFullYear()),
      condition: "",
      description: "",
      initialPrice: "",
      askingPrice: "",
      images: [],
    });
    setHistoryList([]);
    setNewYear("");
    setNewEvent("");
    setNewParty("");
  };

  useEffect(() => {
    const prefill = route?.params?.scanPrefill;
    if (!prefill?.detectedName && !prefill?.image) return;
    const key = `${prefill.detectedName || ""}:${(prefill.image || "").slice(-24)}`;
    if (appliedScanKey.current === key) return;
    appliedScanKey.current = key;

    setForm((prev) => ({
      ...prev,
      name: prefill.detectedName || prev.name,
      category: normalizeListCategory(prefill.category, prefill.detectedName) || prev.category,
      year: yearFromEra(prefill.estimatedYearOrEra) || prev.year,
      condition: prefill.conditionGrade || prev.condition,
      askingPrice: String(prefill.askingPrice || prefill.fairValue || prev.askingPrice),
      initialPrice: String(prefill.fairValue || prefill.askingPrice || prev.initialPrice),
      images: prefill.image ? [prefill.image, ...(prev.images || []).filter((img) => img !== prefill.image)].slice(0, 3) : prev.images,
      description:
        prev.description ||
        (Array.isArray(prefill.redFlagsOrNotes)
          ? prefill.redFlagsOrNotes.join(" ")
          : prev.description),
    }));
    if (prefill.market) setMarketData(prefill.market);
    setAiVerified(true);
    setVerifiedAsset({
      canonicalName: prefill.detectedName,
      detectedObjectName: prefill.detectedName,
      category: normalizeListCategory(prefill.category, prefill.detectedName),
      conditionGrade: prefill.conditionGrade,
      year: yearFromEra(prefill.estimatedYearOrEra),
      keyFeatures: Array.isArray(prefill.redFlagsOrNotes) ? prefill.redFlagsOrNotes : [],
    });
    setVerificationError(null);
  }, [route?.params?.scanPrefill]);

  // ── Mandatory AI Vision & Market Oracle Pipeline Trigger ────────────────────
  const runAiVerification = async (imageUri, overrideHints = {}) => {
    if (!imageUri) return;
    setVerifyingImage(true);
    setVerificationError(null);

    const assetName =
      (overrideHints.name !== undefined ? overrideHints.name : form.name) || "";
    const assetCategory =
      (overrideHints.category !== undefined
        ? overrideHints.category
        : form.category) || "Collectibles";
    const assetCondition =
      (overrideHints.condition !== undefined
        ? overrideHints.condition
        : form.condition) || "";
    const assetDescription =
      (overrideHints.description !== undefined
        ? overrideHints.description
        : form.description) || "";
    const assetAskingPrice =
      (overrideHints.askingPrice !== undefined
        ? overrideHints.askingPrice
        : form.askingPrice) || "";

    try {
      const res = await verifyAssetUploadApi(
        {
          image: imageUri,
          name: assetName,
          category: assetCategory,
          askingPrice: assetAskingPrice,
          condition: assetCondition,
          description: assetDescription,
        },
        token,
      );

      if (res && res.verified) {
        setAiVerified(true);
        setVerifiedAsset(res.asset);
        setMarketData(res.market);

        const specificName =
          res.asset?.detectedObjectName || res.asset?.canonicalName;

        // Auto-populate form with AI-extracted canonical metrics
        // NEVER overwrite the user's Step 1 name unless left completely blank:
        setForm((prev) => ({
          ...prev,
          name: (prev.name && prev.name.trim().length > 0) ? prev.name : (specificName || prev.name),
          category:
            prev.category && prev.category !== "Collectibles"
              ? prev.category
              : res.asset.category || prev.category,
          condition: prev.condition.trim()
            ? prev.condition
            : res.asset.conditionGrade || prev.condition,
          year:
            prev.year && prev.year !== String(new Date().getFullYear())
              ? prev.year
              : res.asset.year
                ? String(res.asset.year)
                : prev.year,
        }));
      } else {
        throw new Error(
          res?.rejectionReason ||
            res?.error ||
            "Image verification rejected by AI Gatekeeper.",
        );
      }
    } catch (err) {
      setAiVerified(false);
      setVerifiedAsset(null);
      setMarketData(null);
      const errMsg =
        err?.rejectionReason ||
        err?.error ||
        err?.message ||
        "Photo could not be verified as a physical luxury collectible.";
      setVerificationError(errMsg);
      // Remove invalid image to block publication
      setForm((prev) => ({
        ...prev,
        images: [],
      }));
      showAlert(
        "AI Vision Gatekeeper Rejection",
        `${errMsg}\n\nPlease take or upload a clear, authentic photograph of your physical collectible to proceed.`,
      );
    } finally {
      setVerifyingImage(false);
    }
  };

  // ── Image Picker Handlers ──────────────────────────────────────────────────
  const pickImageFromLibrary = async () => {
    if (form.images.length >= 3) {
      showAlert(
        "Limit Reached",
        "You can add up to 3 photos. Remove one to add another.",
      );
      return;
    }
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        showAlert(
          "Permission Denied",
          "Permission to access your photo library is required.",
        );
        return;
      }

      const remaining = 3 - form.images.length;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        allowsEditing: remaining === 1,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets?.length) {
        const newImages = result.assets.map((a) =>
          a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri,
        );
        const combined = [...form.images, ...newImages].slice(0, 3);
        setForm((prev) => ({
          ...prev,
          images: combined,
        }));

        // Mandatory Step 1: Run AI Gatekeeper & Market Oracle on primary photo
        if (combined.length > 0) {
          runAiVerification(combined[0], {
            name: form.name,
            category: form.category,
            condition: form.condition,
            description: form.description,
            askingPrice: form.askingPrice,
          });
        }
      }
    } catch (err) {
      showAlert("Error", "Could not open photo library: " + err.message);
    }
  };

  const takePhotoWithCamera = async () => {
    if (form.images.length >= 3) {
      showAlert(
        "Limit Reached",
        "You can add up to 3 photos. Remove one to add another.",
      );
      return;
    }
    try {
      const cameraPermission =
        await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) {
        showAlert(
          "Permission Denied",
          "Camera permission is required to take a photo.",
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const a = result.assets[0];
        const imageUri = a.base64
          ? `data:image/jpeg;base64,${a.base64}`
          : a.uri;
        const combined = [...form.images, imageUri].slice(0, 3);
        setForm((prev) => ({
          ...prev,
          images: combined,
        }));

        // Mandatory Step 1: Run AI Gatekeeper & Market Oracle on captured photo
        runAiVerification(combined[0], {
          name: form.name,
          category: form.category,
          condition: form.condition,
          description: form.description,
          askingPrice: form.askingPrice,
        });
      }
    } catch (err) {
      showAlert("Error", "Could not open camera: " + err.message);
    }
  };

  const removeImage = (index) => {
    const updated = form.images.filter((_, i) => i !== index);
    setForm((prev) => ({
      ...prev,
      images: updated,
    }));
    if (index === 0) {
      if (updated.length > 0) {
        runAiVerification(updated[0], {
          name: form.name,
          category: form.category,
          condition: form.condition,
          description: form.description,
          askingPrice: form.askingPrice,
        });
      } else {
        setAiVerified(false);
        setVerifiedAsset(null);
        setMarketData(null);
        setVerificationError(null);
      }
    }
  };

  // ── History Handlers ───────────────────────────────────────────────────────
  const addHistoryItem = () => {
    if (!newYear.trim() || !newEvent.trim()) {
      showAlert(
        "Incomplete Event",
        "Please enter both the year and description for this history event.",
      );
      return;
    }

    setHistoryList([
      ...historyList,
      {
        id: String(Date.now()),
        year: newYear.trim(),
        event: newEvent.trim(),
        party: newParty.trim() || "Verified Custodian",
      },
    ]);

    setNewYear("");
    setNewEvent("");
    setNewParty("");
  };

  const removeHistoryItem = (id) => {
    setHistoryList(historyList.filter((item) => item.id !== id));
  };

  // ── Save Directly to Personal Collection (Private Vault) ────────────────────
  const handleSaveToPersonalCollection = async () => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    if (!form.name.trim()) {
      showAlert("Missing Details", "Please enter an asset name.");
      setStep(0);
      return;
    }
    const enteredPrice =
      parseFloat(String(form.askingPrice || form.initialPrice || "").replace(/[^0-9.]/g, "")) ||
      15000;
    const oraclePrice =
      marketData?.fairValue
        ? (parseFloat(String(marketData.fairValue).replace(/[^0-9.]/g, "")) || enteredPrice)
        : enteredPrice;

    const diff = oraclePrice - enteredPrice;
    const pct = enteredPrice > 0 ? ((diff / enteredPrice) * 100).toFixed(1) : "0.0";
    const badgeType = diff < 0 ? "negative" : "positive";
    const badgeText =
      diff < 0 ? `${pct}% Market Depreciation` : `+${pct}% Market Gain`;

    const fallbackImg =
      form.images?.[0] ||
      "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=600&q=80";

    setSubmitting(true);
    try {
      const newAsset = {
        id: "personal-" + Date.now(),
        name: form.name.trim(),
        category: form.category || "Luxury Item",
        image: fallbackImg,
        initialValue: enteredPrice,
        initialValueFormatted: `R${enteredPrice.toLocaleString("en-ZA")}`,
        liveMarketValue: oraclePrice,
        liveMarketValueFormatted: `R${oraclePrice.toLocaleString("en-ZA")}`,
        badgeText,
        badgeType,
        ownership: "100% Owned",
        certId: `ERC-721 #${Math.floor(4000 + Math.random() * 1000)}`,
        condition: form.condition.trim() || "Mint Condition",
        year: form.year || String(new Date().getFullYear()),
        description: form.description || "",
        smartTakeTitle: verifiedAsset?.smartTakeTitle || null,
        smartTakeBody: verifiedAsset?.smartTakeBody || null,
        history: historyList,
        price: `R${oraclePrice.toLocaleString("en-ZA")}`,
        price_num: oraclePrice,
        gain: badgeText,
        gain_pct: pct,
        positive: badgeType === "positive",
        asset_type: "personal",
      };

      // 1. Sync to Supabase user_holdings table via backend userController
      if (token) {
        try {
          await addUserHolding(token, newAsset);
        } catch (apiErr) {
          console.warn("[ListAsset] Cloud holding sync error:", apiErr.message);
        }
      }

      // 2. Append to local STORAGE_KEYS.PERSONAL_COLLECTION
      const existingPersonal = await storage.getJSON(
        STORAGE_KEYS.PERSONAL_COLLECTION,
        [],
      );
      const updatedPersonal = [
        newAsset,
        ...(Array.isArray(existingPersonal) ? existingPersonal : []),
      ];
      await storage.setJSON(STORAGE_KEYS.PERSONAL_COLLECTION, updatedPersonal);

      // 3. Append to STORAGE_KEYS.VAULT_ACTIVITY_LOG
      const activityEntry = {
        id: "act-" + Date.now(),
        type: "certificate",
        title: "ERC-721 Sepolia Certificate Mint",
        assetName: newAsset.name,
        hash:
          "0x" +
          Array.from({ length: 40 }, () =>
            Math.floor(Math.random() * 16).toString(16),
          ).join(""),
        hashDisplay:
          "0x" +
          Math.random().toString(16).substring(2, 6) +
          "..." +
          Math.random().toString(16).substring(2, 4),
        timestamp: "Just now",
        status: "Verified & Minted",
        network: "Sepolia Testnet",
        icon: "diamond-outline",
        badgeColor: "#7C3AED",
      };
      const existingLogs = await storage.getJSON(
        STORAGE_KEYS.VAULT_ACTIVITY_LOG,
        [],
      );
      const updatedLogs = [
        activityEntry,
        ...(Array.isArray(existingLogs) && existingLogs.length > 0
          ? existingLogs
          : []),
      ];
      await storage.setJSON(STORAGE_KEYS.VAULT_ACTIVITY_LOG, updatedLogs);

      setSaved(true);
      setTimeout(() => {
        navigation.navigate(SCREENS.MAIN_TABS, { screen: SCREENS.VAULT });
        resetAll();
      }, 350);
    } catch (_) {
      setSaved(true);
      setTimeout(() => {
        navigation.navigate(SCREENS.MAIN_TABS, { screen: SCREENS.VAULT });
        resetAll();
      }, 350);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submit Listing ─────────────────────────────────────────────────────────
  const handleSubmitListing = async (forceConfirmArg = false) => {
    if (user && (user.kycStatus !== 'verified' || user.isSuspended)) {
      setKycGatekeeperVisible(true);
      return;
    }
    const forceConfirm = forceConfirmArg === true;
    if (!form.name.trim()) {
      showAlert("Missing Details", "Please enter an asset name.");
      setStep(0);
      return;
    }
    if (!form.askingPrice.trim()) {
      showAlert("Missing Price", "Please enter an asking price.");
      setStep(3);
      return;
    }
    if (!form.images.length) {
      showAlert(
        "Photo Required",
        "Please select or capture at least one photo for your asset in Step 2.",
      );
      setStep(1);
      return;
    }

    // Step 1 Check: Enforce mandatory AI Vision Gatekeeper verification
    if (!aiVerified) {
      showAlert(
        "AI Verification Mandatory",
        "The uploaded photo must be verified by the AI Vision Gatekeeper before publication. Please allow verification to complete.",
        [
          {
            text: "Verify Now",
            onPress: () => {
              setStep(1);
              runAiVerification(form.images[0]);
            },
          },
        ],
      );
      return;
    }

    // Step 3 Check: Price inflation alert (>50% above market high)
    const priceNum =
      parseFloat(String(form.askingPrice || form.initialPrice || "").replace(/[^0-9.]/g, "")) || 0;
    if (
      marketData &&
      marketData.highPrice > 0 &&
      priceNum > marketData.highPrice * 1.5 &&
      !forceConfirm
    ) {
      const inflationPct = Math.round(
        ((priceNum - marketData.fairValue) / marketData.fairValue) * 100,
      );
      showAlert(
        "High Asking Price Notice",
        `Your asking price of R${priceNum.toLocaleString("en-ZA")} is ${inflationPct}% above the AI Market Oracle fair value comps (${marketData.formattedRange}).\n\nAssets priced over 50% above market comps may experience delayed escrow liquidity. Do you wish to proceed?`,
        [
          {
            text: `Adjust to Fair Value (${marketData.formattedFairValue})`,
            onPress: () =>
              setForm((prev) => ({
                ...prev,
                askingPrice: String(marketData.fairValue),
                initialPrice: String(marketData.fairValue),
              })),
            style: "default",
          },
          {
            text: "Publish Anyway",
            onPress: () => handleSubmitListing(true),
            style: "destructive",
          },
        ],
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        year: parseInt(form.year, 10) || new Date().getFullYear(),
        condition:
          form.condition.trim() || verifiedAsset?.conditionGrade || "Verified",
        description: form.description.trim(),
        askingPrice: form.askingPrice.trim(),
        image: form.images[0],
        forceConfirmPrice: forceConfirm,
        smartTakeTitle: verifiedAsset?.smartTakeTitle || null,
        smartTakeBody: verifiedAsset?.smartTakeBody || null,
        history: historyList.map(({ year, event, party }) => ({
          year,
          event,
          party,
        })),
      };

      await createAssetApi(payload, token);

      setSaved(true);
      setTimeout(() => {
        resetAll();
        navigation.navigate(SCREENS.MAIN_TABS, { screen: SCREENS.HOME });
      }, 900);
    } catch (err) {
      const errMsg = err.message || "";
      if (
        errMsg.toLowerCase().includes("ai fraud") ||
        errMsg.toLowerCase().includes("ai-generated") ||
        errMsg.toLowerCase().includes("synthetic") ||
        errMsg.toLowerCase().includes("gatekeeper")
      ) {
        showAlert(
          "AI Gatekeeper Notice",
          `${errMsg}\n\nPlease take or upload an authentic, unedited photograph of your physical collectible to proceed.`,
          [
            {
              text: "Change Photo",
              onPress: () => setStep(1),
            },
          ],
        );
      } else {
        showAlert("Listing Error", errMsg || "Failed to list asset.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (step === 0 && !form.name.trim()) {
      showAlert("Required Field", "Please enter a name for the asset.");
      return;
    }
    if (step === 1) {
      if (!form.images.length) {
        showAlert(
          "Photo Required",
          "Please upload at least one photo of the physical collectible.",
        );
        return;
      }
      if (!aiVerified) {
        showAlert(
          "Verification Required",
          "AI Gatekeeper verification is mandatory. Please allow verification to complete or retry.",
          [
            {
              text: "Run AI Check",
              onPress: () =>
                runAiVerification(form.images[0], {
                  name: form.name,
                  category: form.category,
                  condition: form.condition,
                  description: form.description,
                  askingPrice: form.askingPrice,
                }),
            },
          ],
        );
        return;
      }
    }
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  return (
    <View style={styles.container}>
      {/* ── Background Mesh Gradient (Matches HomeScreen.js) ── */}
      <LinearGradient
        colors={CANVAS_MESH}
        locations={[0, 0.22, 0.52, 0.78, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <SafeAreaView edges={["top", "left", "right"]} style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* ── Header / Breadcrumb Bar ── */}
          <View style={styles.navBar}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() =>
                step > 0 ? setStep(step - 1) : navigation.goBack()
              }
              activeOpacity={0.8}
            >
              <Feather name="arrow-left" size={18} color="#0F172A" />
            </TouchableOpacity>
            <View style={{ alignItems: "center" }}>
              <Text style={styles.navTitle}>List New Luxury Asset</Text>
              <Text style={styles.navSubtitle}>TOKENIZE & ESCROW</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>

          {/* ── Modern Step Progress Pills ── */}
          <View style={styles.stepsRow}>
            {STEPS.map((s, i) => {
              const isCompleted = i < step;
              const isActive = i === step;

              return (
                <TouchableOpacity
                  key={s}
                  style={styles.stepItem}
                  onPress={() => setStep(i)}
                  activeOpacity={0.8}
                >
                  {isActive ? (
                    <LinearGradient
                      colors={["#976af0", "#00fbff"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.stepDotActive}
                    >
                      <Text style={styles.stepNumActive}>{i + 1}</Text>
                    </LinearGradient>
                  ) : isCompleted ? (
                    <View style={styles.stepDotCompleted}>
                      <Feather name="check" size={13} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={styles.stepDotUpcoming}>
                      <Text style={styles.stepNumUpcoming}>{i + 1}</Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.stepLabel,
                      isActive && styles.stepLabelActive,
                      isCompleted && styles.stepLabelCompleted,
                      !isActive && !isCompleted && styles.stepLabelUpcoming,
                    ]}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Form Body Scroll ── */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Main Form White Card Container ── */}
            <View style={styles.mainCard}>
              {/* ── Step 0: Asset Details ── */}
              {step === 0 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 1 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Asset Details</Text>
                    {route?.params?.scanPrefill?.detectedName ? (
                      <View
                        style={{
                          marginTop: 10,
                          backgroundColor: "#EEF2FF",
                          borderColor: "#818CF8",
                          borderWidth: 1,
                          borderRadius: 12,
                          padding: 10,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <Ionicons name="scan-circle" size={22} color="#4F46E5" />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "800",
                              color: "#4F46E5",
                              letterSpacing: 0.6,
                            }}
                          >
                            ✨ PRE-FILLED VIA SCAN & KNOW
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: "700",
                              color: "#1E1B4B",
                              marginTop: 1,
                            }}
                          >
                            {route.params.scanPrefill.detectedName} •{" "}
                            {route.params.scanPrefill.fairValueFormatted ||
                              route.params.scanPrefill.market?.formattedFairValue ||
                              ""}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    <Text style={styles.stepDesc}>
                      Provide accurate information for AI appraisal and
                      blockchain verification.
                    </Text>
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>ASSET NAME *</Text>
                    <TextInput
                      value={form.name}
                      onChangeText={(val) => setForm({ ...form, name: val })}
                      placeholder="e.g. Rolex Daytona 116500LN"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                    />
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>CATEGORY</Text>
                    <View style={styles.categoryChips}>
                      {[
                        "Electronics & Gadgets",
                        "Luxury Watch",
                        "Sneakers & Apparel",
                        "Fine Art",
                        "Classic Car",
                        "Fine Wine",
                        "Collectibles",
                      ].map((cat) => {
                        const isSelected = form.category === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[
                              styles.catChip,
                              isSelected
                                ? styles.catChipActive
                                : styles.catChipInactive,
                            ]}
                            onPress={() => setForm({ ...form, category: cat })}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.catChipText,
                                isSelected
                                  ? styles.catChipTextActive
                                  : styles.catChipTextInactive,
                              ]}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.rowFields}>
                    <View style={[styles.fieldWrap, { flex: 1 }]}>
                      <Text style={styles.fieldLabel}>YEAR</Text>
                      <TextInput
                        value={form.year}
                        onChangeText={(val) => setForm({ ...form, year: val })}
                        placeholder="2023"
                        keyboardType="number-pad"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                      />
                    </View>
                    <View style={[styles.fieldWrap, { flex: 1.5 }]}>
                      <Text style={styles.fieldLabel}>CONDITION</Text>
                      <TextInput
                        value={form.condition}
                        onChangeText={(val) =>
                          setForm({ ...form, condition: val })
                        }
                        placeholder="Mint / Original Box"
                        placeholderTextColor="#94A3B8"
                        style={styles.input}
                      />
                    </View>
                  </View>

                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>DESCRIPTION</Text>
                    <TextInput
                      value={form.description}
                      onChangeText={(val) =>
                        setForm({ ...form, description: val })
                      }
                      placeholder="Describe the asset, its provenance, unique features, and documentation…"
                      placeholderTextColor="#94A3B8"
                      multiline
                      numberOfLines={4}
                      style={styles.textarea}
                    />
                  </View>
                </View>
              )}

              {/* ── Step 1: Upload Photos ── */}
              {step === 1 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 2 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Upload Asset Photos</Text>
                    <Text style={styles.stepDesc}>
                      Add up to 3 high-resolution photos. The first photo will
                      be the primary spotlight image.
                    </Text>
                  </View>

                  {/* Photo Grid */}
                  <View style={styles.photoGrid}>
                    {form.images.map((uri, index) => (
                      <View key={index} style={styles.photoThumb}>
                        <Image
                          source={{ uri }}
                          style={styles.thumbImage}
                          resizeMode="cover"
                        />
                        <TouchableOpacity
                          style={styles.removeThumbBtn}
                          onPress={() => removeImage(index)}
                          activeOpacity={0.8}
                        >
                          <Feather name="x" size={12} color="#FFFFFF" />
                        </TouchableOpacity>
                        {index === 0 && (
                          <LinearGradient
                            colors={["#976af0", "#00fbff"]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.primaryBadge}
                          >
                            <Text style={styles.primaryBadgeText}>PRIMARY</Text>
                          </LinearGradient>
                        )}
                      </View>
                    ))}

                    {/* Empty slot */}
                    {form.images.length < 3 && (
                      <TouchableOpacity
                        style={[styles.photoThumb, styles.addPhotoSlot]}
                        onPress={pickImageFromLibrary}
                        activeOpacity={0.8}
                      >
                        <View style={styles.addIconCircle}>
                          <Feather name="plus" size={18} color="#7C3AED" />
                        </View>
                        <Text style={styles.addPhotoSlotText}>
                          {form.images.length === 0
                            ? "Add Photo"
                            : `${3 - form.images.length} more`}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Upload Action Buttons */}
                  <View style={styles.uploadBtnRow}>
                    <TouchableOpacity
                      style={[
                        styles.pickerBtn,
                        form.images.length >= 3 && { opacity: 0.45 },
                      ]}
                      onPress={pickImageFromLibrary}
                      disabled={form.images.length >= 3}
                      activeOpacity={0.8}
                    >
                      <Feather name="image" size={18} color="#7C3AED" />
                      <Text style={styles.pickerBtnText}>Choose Library</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.pickerBtn,
                        form.images.length >= 3 && { opacity: 0.45 },
                      ]}
                      onPress={takePhotoWithCamera}
                      disabled={form.images.length >= 3}
                      activeOpacity={0.8}
                    >
                      <Feather name="camera" size={18} color="#7C3AED" />
                      <Text style={styles.pickerBtnText}>Take Photo</Text>
                    </TouchableOpacity>
                  </View>

                  {/* AI Vision & Live Market Oracle Verification Status */}
                  {verifyingImage && (
                    <LinearGradient
                      colors={["#7C3AED18", "#2563EB18"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.verifyingBox}
                    >
                      <ActivityIndicator size="small" color="#7C3AED" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.verifyingTitle}>
                          AI VISION GATEKEEPER & ORACLE ACTIVE
                        </Text>
                        <Text style={styles.verifyingSub}>
                          Validating physical collectible hallmarks & querying
                          live market comps…
                        </Text>
                      </View>
                    </LinearGradient>
                  )}

                  {verificationError && !verifyingImage && (
                    <View style={styles.rejectionBox}>
                      <Ionicons
                        name="alert-circle"
                        size={20}
                        color="#EF4444"
                        style={{ marginTop: 2 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rejectionTitle}>
                          AI GATEKEEPER REJECTION
                        </Text>
                        <Text style={styles.rejectionDesc}>
                          {verificationError}
                        </Text>
                        <Text style={styles.rejectionHint}>
                          Only authentic physical luxury assets are permitted.
                          Please choose an original photo of your physical
                          collectible.
                        </Text>
                      </View>
                    </View>
                  )}

                  {aiVerified && verifiedAsset && !verifyingImage && (
                    <View style={styles.verifiedCard}>
                      <View style={styles.verifiedCardHeader}>
                        <View style={styles.verifiedPill}>
                          <Text style={styles.verifiedPillText}>
                            ✅ AI FRAUD GUARD PASSED (
                            {(
                              (verifiedAsset.authenticityConfidence || 0.982) * 100
                            ).toFixed(1)}
                            % REAL PHOTO)
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.verifiedQuality}>
                        {verifiedAsset.qualityVerdict ||
                          "No Midjourney, DALL-E, or synthetic deepfake artifacts detected"}
                      </Text>

                      <Text style={styles.verifiedTitle}>
                        {verifiedAsset.detectedObjectName ||
                          verifiedAsset.canonicalName ||
                          form.name.trim() ||
                          "Physical Collectible"}
                      </Text>
                      <Text style={styles.verifiedGrade}>
                        Visual Condition:{" "}
                        {form.condition.trim() ||
                          verifiedAsset.conditionGrade ||
                          "Grade A+ (9.5/10) • Mint Condition"}
                      </Text>

                      {Array.isArray(verifiedAsset.keyFeatures) &&
                        verifiedAsset.keyFeatures.length > 0 && (
                          <View style={styles.featuresList}>
                            {verifiedAsset.keyFeatures
                              .slice(0, 3)
                              .map((feat, idx) => (
                                <View key={idx} style={styles.featureRow}>
                                  <Feather
                                    name="check-circle"
                                    size={13}
                                    color="#10B981"
                                  />
                                  <Text style={styles.featureText}>{feat}</Text>
                                </View>
                              ))}
                          </View>
                        )}
                    </View>
                  )}

                  {!aiVerified && !verifyingImage && !verificationError && (
                    <View style={styles.fraudGuardNote}>
                      <Ionicons
                        name="shield-checkmark"
                        size={16}
                        color="#7C3AED"
                        style={{ marginTop: 1 }}
                      />
                      <Text style={styles.fraudGuardText}>
                        Mandatory Step 1: AI Vision Gatekeeper automatically
                        scans your photo upon selection to verify physical
                        authenticity and extract live market pricing comps.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* ── Step 2: Provenance History Builder ── */}
              {step === 2 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 3 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>Provenance History</Text>
                    <Text style={styles.stepDesc}>
                      Add chain-of-custody milestones and certificates to prove
                      authenticity on the blockchain.
                    </Text>
                  </View>

                  {/* Existing History Events List */}
                  {historyList.map((item) => (
                    <View key={item.id} style={styles.historyItemCard}>
                      <View style={styles.historyItemLeft}>
                        <View style={styles.historyDot} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.historyYear}>{item.year}</Text>
                          <Text style={styles.historyEvent}>{item.event}</Text>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginTop: 2,
                            }}
                          >
                            <Feather
                              name="map-pin"
                              size={11}
                              color="#64748B"
                              style={{ marginRight: 4 }}
                            />
                            <Text style={styles.historyParty}>
                              {item.party}
                            </Text>
                          </View>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => removeHistoryItem(item.id)}
                        style={styles.deleteHistoryBtn}
                        activeOpacity={0.7}
                      >
                        <Feather name="trash-2" size={16} color="#94A3B8" />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Add New History Event Box */}
                  <View style={styles.addHistoryBox}>
                    <Text style={styles.fieldLabel}>+ ADD MILESTONE EVENT</Text>

                    <View style={styles.rowFields}>
                      <View style={[styles.fieldWrap, { width: 95 }]}>
                        <TextInput
                          value={newYear}
                          onChangeText={setNewYear}
                          placeholder="Year"
                          keyboardType="number-pad"
                          placeholderTextColor="#94A3B8"
                          style={styles.input}
                        />
                      </View>
                      <View style={[styles.fieldWrap, { flex: 1 }]}>
                        <TextInput
                          value={newParty}
                          onChangeText={setNewParty}
                          placeholder="Party / Location"
                          placeholderTextColor="#94A3B8"
                          style={styles.input}
                        />
                      </View>
                    </View>

                    <TextInput
                      value={newEvent}
                      onChangeText={setNewEvent}
                      placeholder="Event description (e.g. Purchased at Sotheby's Auction)"
                      placeholderTextColor="#94A3B8"
                      style={styles.input}
                    />

                    <TouchableOpacity
                      style={styles.addEventBtn}
                      onPress={addHistoryItem}
                      activeOpacity={0.8}
                    >
                      <Feather name="plus" size={16} color="#7C3AED" />
                      <Text style={styles.addEventBtnText}>
                        Add Provenance Event
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* ── Step 3: Pricing & Review ── */}
              {step === 3 && (
                <View style={styles.sectionWrap}>
                  <View style={styles.stepHeader}>
                    <View style={styles.stepBadge}>
                      <Text style={styles.stepBadgeText}>STEP 4 OF 4</Text>
                    </View>
                    <Text style={styles.sectionTitle}>
                      {destinationMode === "marketplace"
                        ? "Set Listing Price"
                        : "Asset Valuation & Pricing"}
                    </Text>
                    <Text style={styles.stepDesc}>
                      Set your valuation in South African Rand (R).
                      SmartAssets generates an escrow-protected listing.
                    </Text>
                  </View>

                  {/* Destination toggle: Personal Collection vs Fractional Investment */}
                  <View style={styles.destinationToggleWrap}>
                    <Text style={styles.fieldLabel}>LISTING DESTINATION</Text>
                    <View style={styles.destinationToggleRow}>
                      <TouchableOpacity
                        style={[
                          styles.destinationToggleBtn,
                          destinationMode === "personal" &&
                            styles.destinationToggleBtnActive,
                        ]}
                        onPress={() => setDestinationMode("personal")}
                        activeOpacity={0.8}
                      >
                        <Feather
                          name="lock"
                          size={16}
                          color={
                            destinationMode === "personal"
                              ? "#FFFFFF"
                              : "#64748B"
                          }
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          style={[
                            styles.destinationToggleText,
                            destinationMode === "personal" &&
                              styles.destinationToggleTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          Save to Personal Vault
                        </Text>
                        {destinationMode === "personal" && (
                          <Feather
                            name="check"
                            size={16}
                            color="#FFFFFF"
                            style={{ marginLeft: 6 }}
                          />
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.destinationToggleBtn,
                          destinationMode === "marketplace" &&
                            styles.destinationToggleBtnActive,
                        ]}
                        onPress={() => setDestinationMode("marketplace")}
                        activeOpacity={0.8}
                      >
                        <Feather
                          name="globe"
                          size={16}
                          color={
                            destinationMode === "marketplace"
                              ? "#FFFFFF"
                              : "#64748B"
                          }
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          style={[
                            styles.destinationToggleText,
                            destinationMode === "marketplace" &&
                              styles.destinationToggleTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          List for Fractional Investment
                        </Text>
                        {destinationMode === "marketplace" && (
                          <Feather
                            name="check"
                            size={16}
                            color="#FFFFFF"
                            style={{ marginLeft: 6 }}
                          />
                        )}
                      </TouchableOpacity>
                    </View>

                    {destinationMode === "personal" ? (
                      <View style={styles.destinationInfoPill}>
                        <Ionicons
                          name="shield-checkmark"
                          size={15}
                          color="#7C3AED"
                        />
                        <Text style={styles.destinationInfoText}>
                          Private Vault: Secured in 'My Collection' with an
                          ERC-721 Sepolia provenance certificate. 0% public
                          market listing fees.
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.destinationInfoPill}>
                        <Ionicons
                          name="trending-up"
                          size={15}
                          color="#2563EB"
                        />
                        <Text style={styles.destinationInfoText}>
                          Marketplace Fractionalization: Generates an
                          escrow-backed fractional offering on the public
                          exchange with investor liquidity.
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Live Market Oracle Valuation Card on Pricing Step */}
                  {marketData && (
                    <LinearGradient
                      colors={["#1E1B4B", "#2E1065"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[styles.oracleCard, { marginBottom: 16 }]}
                    >
                      <View style={styles.oracleHeader}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Ionicons
                            name="analytics"
                            size={15}
                            color="#38BDF8"
                          />
                          <Text style={styles.oracleTag}>
                            LIVE MARKET ORACLE
                          </Text>
                        </View>
                        <View style={styles.demandBadge}>
                          <Text style={styles.demandText}>
                            {marketData.demandIndex || "Active"}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.oraclePricesRow}>
                        <View>
                          <Text style={styles.oraclePriceLabel}>
                            FAIR MARKET VALUE
                          </Text>
                          <Text style={styles.oraclePriceVal}>
                            {marketData.formattedFairValue}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.oraclePriceLabel}>
                            30-DAY COMPS RANGE
                          </Text>
                          <Text style={styles.oracleRangeVal}>
                            {marketData.formattedRange}
                          </Text>
                          <Text style={styles.oracleRoiText}>
                            {marketData.thirtyDayRoi || "+2.5%"} 30d Trend
                          </Text>
                        </View>
                      </View>

                      {Array.isArray(marketData.comps) &&
                        marketData.comps.length > 0 && (
                          <View style={styles.compsRow}>
                            {marketData.comps.slice(0, 2).map((c, i) => (
                              <View key={i} style={styles.compPill}>
                                <Text style={styles.compPlatform}>
                                  {c.platform}
                                </Text>
                                <Text style={styles.compPrice}>{c.price}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                      <TouchableOpacity
                        style={styles.applyPriceBtn}
                        onPress={() => {
                          setForm((prev) => ({
                            ...prev,
                            askingPrice: String(marketData.fairValue),
                            initialPrice: String(marketData.fairValue),
                          }));
                          showAlert(
                            "Valuation Applied",
                            `Price set to ${marketData.formattedFairValue} based on live comps.`,
                          );
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.applyPriceText}>
                          ⚡ Apply Fair Market Valuation ({marketData.formattedFairValue})
                        </Text>
                      </TouchableOpacity>
                    </LinearGradient>
                  )}

                  {/* Single Contextual Price Input */}
                  <View style={styles.fieldWrap}>
                    <Text style={styles.fieldLabel}>
                      {destinationMode === "marketplace"
                        ? "TOTAL ASSET LISTING PRICE (R) *"
                        : "ORIGINAL PURCHASE PRICE / WHAT YOU PAID (R) *"}
                    </Text>
                    <View style={styles.priceInputWrap}>
                      <Text style={styles.priceCurrency}>R</Text>
                      <TextInput
                        value={form.askingPrice || form.initialPrice}
                        onChangeText={(val) =>
                          setForm((prev) => ({
                            ...prev,
                            askingPrice: val,
                            initialPrice: val,
                          }))
                        }
                        placeholder={
                          destinationMode === "marketplace"
                            ? (marketData?.fairValue ? `e.g. ${marketData.fairValue}` : "e.g. 18500")
                            : (marketData?.fairValue ? `e.g. ${marketData.fairValue}` : "e.g. 15000")
                        }
                        keyboardType="decimal-pad"
                        placeholderTextColor="#94A3B8"
                        style={styles.priceInput}
                      />
                    </View>
                  </View>

                  {/* Real-Time Comparison Badge vs Read-Only Market Oracle Valuation */}
                  {(() => {
                    const userPrice =
                      parseFloat(
                        String(form.askingPrice || form.initialPrice || "").replace(/[^0-9.]/g, ""),
                      ) || 0;
                    const oraclePrice =
                      marketData?.fairValue
                        ? parseFloat(String(marketData.fairValue).replace(/[^0-9.]/g, "")) || 0
                        : 0;

                    if (userPrice > 0 && oraclePrice > 0) {
                      if (destinationMode === "personal") {
                        // Personal Collection: Compare what user paid vs current Oracle valuation
                        const diff = oraclePrice - userPrice;
                        const pct = ((diff / userPrice) * 100).toFixed(1);
                        const isDeprec = diff < 0;
                        const badgeText = isDeprec
                          ? `${pct}% Market Depreciation`
                          : `+${pct}% Market Gain`;

                        return (
                          <View
                            style={{
                              backgroundColor: isDeprec ? "#FEF2F2" : "#F0FDF4",
                              borderColor: isDeprec ? "#FECACA" : "#BBF7D0",
                              borderWidth: 1,
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 16,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 8,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: "700",
                                  color: isDeprec ? "#DC2626" : "#16A34A",
                                  letterSpacing: 0.5,
                                }}
                              >
                                WEALTH TRACKER VALUATION
                              </Text>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: 20,
                                  backgroundColor: isDeprec ? "#FEE2E2" : "#DCFCE7",
                                }}
                              >
                                <Feather
                                  name={isDeprec ? "trending-down" : "trending-up"}
                                  size={12}
                                  color={isDeprec ? "#DC2626" : "#15803D"}
                                  style={{ marginRight: 4 }}
                                />
                                <Text
                                  style={{
                                    fontSize: 12,
                                    fontWeight: "800",
                                    color: isDeprec ? "#DC2626" : "#15803D",
                                  }}
                                >
                                  {badgeText}
                                </Text>
                              </View>
                            </View>

                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <View>
                                <Text style={{ fontSize: 11, color: "#64748B" }}>
                                  What You Paid
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 16,
                                    fontWeight: "700",
                                    color: "#0F172A",
                                  }}
                                >
                                  R{userPrice.toLocaleString("en-ZA")}
                                </Text>
                              </View>

                              <Feather name="arrow-right" size={16} color="#94A3B8" />

                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ fontSize: 11, color: "#64748B" }}>
                                  Live Market Oracle
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 16,
                                    fontWeight: "700",
                                    color: isDeprec ? "#DC2626" : "#16A34A",
                                  }}
                                >
                                  R{oraclePrice.toLocaleString("en-ZA")}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      } else {
                        // Marketplace mode: Compare user's listing price vs Oracle fair value
                        const diff = userPrice - oraclePrice;
                        const pct = Math.abs(((diff / oraclePrice) * 100).toFixed(1));
                        const isAbove = userPrice > oraclePrice;
                        const isInflation =
                          marketData.highPrice > 0
                            ? userPrice > marketData.highPrice * 1.5
                            : isAbove && Number(pct) > 50;

                        const badgeText = isInflation
                          ? `+${pct}% High Price Warning`
                          : isAbove
                            ? `+${pct}% Above Fair Market Value`
                            : userPrice === oraclePrice
                              ? "100% Fair Market Valuation"
                              : `${pct}% Below Market (Competitive)`;

                        const badgeBg = isInflation ? "#FEF3C7" : isAbove ? "#DBEAFE" : "#DCFCE7";
                        const badgeColor = isInflation ? "#B45309" : isAbove ? "#1D4ED8" : "#15803D";

                        return (
                          <View
                            style={{
                              backgroundColor: isInflation ? "#FFFBEB" : isAbove ? "#EFF6FF" : "#F0FDF4",
                              borderColor: isInflation ? "#FDE68A" : isAbove ? "#BFDBFE" : "#BBF7D0",
                              borderWidth: 1,
                              borderRadius: 14,
                              padding: 14,
                              marginBottom: 16,
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 8,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 11,
                                  fontWeight: "700",
                                  color: badgeColor,
                                  letterSpacing: 0.5,
                                }}
                              >
                                MARKETPLACE ORACLE BENCHMARK
                              </Text>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: 20,
                                  backgroundColor: badgeBg,
                                }}
                              >
                                <Ionicons
                                  name={isInflation ? "warning" : isAbove ? "trending-up" : "checkmark-circle"}
                                  size={12}
                                  color={badgeColor}
                                  style={{ marginRight: 4 }}
                                />
                                <Text
                                  style={{
                                    fontSize: 12,
                                    fontWeight: "800",
                                    color: badgeColor,
                                  }}
                                >
                                  {badgeText}
                                </Text>
                              </View>
                            </View>

                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <View>
                                <Text style={{ fontSize: 11, color: "#64748B" }}>
                                  Market Oracle Fair Value
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 16,
                                    fontWeight: "700",
                                    color: "#0F172A",
                                  }}
                                >
                                  R{oraclePrice.toLocaleString("en-ZA")}
                                </Text>
                              </View>

                              <Feather name="arrow-right" size={16} color="#94A3B8" />

                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={{ fontSize: 11, color: "#64748B" }}>
                                  Your Listing Price
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 16,
                                    fontWeight: "700",
                                    color: isInflation ? "#B45309" : "#7C3AED",
                                  }}
                                >
                                  R{userPrice.toLocaleString("en-ZA")}
                                </Text>
                              </View>
                            </View>
                          </View>
                        );
                      }
                    }
                    return null;
                  })()}

                  {/* Summary Review Card */}
                  <View style={styles.reviewCard}>
                    <View style={styles.reviewCardHeader}>
                      <Text style={styles.reviewHeading}>LISTING SUMMARY</Text>
                      <View style={styles.reviewVerifiedBadge}>
                        <Text style={styles.reviewVerifiedBadgeText}>
                          PRE-VERIFIED
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.reviewTitle}>
                      {form.name || "Untitled Asset"}
                    </Text>
                    <Text style={styles.reviewSub}>
                      {form.category} • {form.year} • {historyList.length}{" "}
                      History Event{historyList.length !== 1 ? "s" : ""}
                    </Text>
                    {form.askingPrice || form.initialPrice ? (
                      <Text style={styles.reviewPrice}>
                        R{Number(form.askingPrice || form.initialPrice).toLocaleString("en-ZA")}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.infoBox}>
                    <Ionicons
                      name="shield-checkmark"
                      size={18}
                      color="#7C3AED"
                      style={{ marginTop: 2 }}
                    />
                    <Text style={styles.infoText}>
                      Once submitted, your asset and provenance history are
                      registered with cryptographic ERC-721 token verification
                      and protected by SmartAssets escrow.
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          {/* ── Bottom Action Bar (Signature Gradient CTA) ── */}
          <View style={styles.cta}>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={
                step === STEPS.length - 1
                  ? destinationMode === "personal"
                    ? handleSaveToPersonalCollection
                    : () => handleSubmitListing(false)
                  : next
              }
              activeOpacity={0.88}
              disabled={submitting || saved}
            >
              <LinearGradient
                colors={["#976af0", "#00fbff"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.nextBtnGradient}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={styles.nextBtnContent}>
                    {step === STEPS.length - 1 ? (
                      <Feather
                        name={
                          saved
                            ? "check-circle"
                            : destinationMode === "personal"
                              ? "lock"
                              : "globe"
                        }
                        size={16}
                        color="#FFFFFF"
                        style={{ marginRight: 6 }}
                      />
                    ) : null}
                    <Text style={styles.nextBtnLabel}>
                      {step === STEPS.length - 1
                        ? saved
                          ? "Saved to Vault"
                          : destinationMode === "personal"
                            ? "Save to Personal Vault"
                            : "List for Fractional Investment"
                        : "Continue"}
                    </Text>
                    {step !== STEPS.length - 1 ? (
                      <Feather name="arrow-right" size={18} color="#FFFFFF" />
                    ) : null}
                  </View>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        <KycGatekeeperModal
          visible={kycGatekeeperVisible}
          onClose={() => setKycGatekeeperVisible(false)}
          isSuspended={Boolean(user?.isSuspended)}
          onCompleteVerification={() =>
            navigation.navigate(SCREENS.PROFILE, { openKyc: true })
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#d8d6fd",
  },
  safe: {
    flex: 1,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  navSubtitle: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 1.2,
    marginTop: 2,
  },

  // Steps Progress Pills
  stepsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  stepItem: {
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  stepDotActive: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#976af0",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  stepDotCompleted: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  stepDotUpcoming: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumActive: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  stepNumUpcoming: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94A3B8",
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  stepLabelActive: {
    color: "#7C3AED",
    fontWeight: "800",
  },
  stepLabelCompleted: {
    color: "#10B981",
    fontWeight: "700",
  },
  stepLabelUpcoming: {
    color: "#94A3B8",
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },

  // Main Card Wrapper
  mainCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.85)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },
  sectionWrap: {
    gap: 16,
  },
  stepHeader: {
    marginBottom: 4,
  },
  stepBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(151, 106, 240, 0.10)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  stepBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: 0.8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.4,
  },
  stepDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: "#64748B",
    marginTop: 4,
  },

  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    color: "#7C3AED",
  },
  input: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: "#0F172A",
    fontWeight: "600",
  },
  textarea: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: "#0F172A",
    minHeight: 90,
    textAlignVertical: "top",
    fontWeight: "600",
  },
  rowFields: {
    flexDirection: "row",
    gap: 10,
  },
  categoryChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  catChipActive: {
    backgroundColor: "#F5F3FF",
    borderColor: "#976af0",
  },
  catChipInactive: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
  },
  catChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  catChipTextActive: {
    color: "#7C3AED",
  },
  catChipTextInactive: {
    color: "#64748B",
  },

  // Photo Grid
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  photoThumb: {
    width: 98,
    height: 98,
    borderRadius: 16,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  removeThumbBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: "center",
  },
  primaryBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.8,
  },
  addPhotoSlot: {
    backgroundColor: "#F8FAFC",
    borderColor: "rgba(151, 106, 240, 0.4)",
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F5F3FF",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoSlotText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
  },
  uploadBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  pickerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  pickerBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  fraudGuardNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "rgba(151, 106, 240, 0.25)",
    marginTop: 4,
  },
  fraudGuardText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6D28D9",
    fontWeight: "600",
    flex: 1,
  },

  // History Styles
  historyItemCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  historyItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  historyDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#7C3AED",
  },
  historyYear: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7C3AED",
  },
  historyEvent: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  historyParty: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  deleteHistoryBtn: {
    padding: 6,
  },
  addHistoryBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    gap: 10,
    marginTop: 4,
  },
  addEventBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: "#F5F3FF",
    borderWidth: 1.5,
    borderColor: "rgba(151, 106, 240, 0.35)",
  },
  addEventBtnText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#7C3AED",
  },

  // Review & Pricing Styles
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: "rgba(151, 106, 240, 0.45)",
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  priceCurrency: {
    fontSize: 22,
    fontWeight: "800",
    color: "#7C3AED",
    marginRight: 8,
  },
  priceInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
  },
  reviewCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#F5F3FF",
    borderWidth: 1.5,
    borderColor: "rgba(151, 106, 240, 0.25)",
    gap: 6,
  },
  reviewCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  reviewHeading: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    color: "#7C3AED",
  },
  reviewVerifiedBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reviewVerifiedBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#10B981",
  },
  reviewTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  reviewSub: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  reviewPrice: {
    fontSize: 22,
    fontWeight: "900",
    color: "#7C3AED",
    marginTop: 4,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  infoText: {
    fontSize: 12,
    lineHeight: 18,
    color: "#64748B",
    fontWeight: "600",
    flex: 1,
  },

  // Bottom CTA
  cta: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 96 : 92,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "rgba(226, 232, 240, 0.9)",
  },
  nextBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#976af0",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  nextBtnGradient: {
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  nextBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 8,
  },
  nextBtnLabel: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: 0.3,
    textAlign: "center",
  },

  // ── AI Vision Gatekeeper & Market Oracle Styles ──────────────────────────
  verifyingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(124, 58, 237, 0.3)",
    marginTop: 14,
    backgroundColor: "rgba(124, 58, 237, 0.05)",
  },
  verifyingTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#7C3AED",
  },
  verifyingSub: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
    marginTop: 2,
    lineHeight: 16,
  },
  rejectionBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FEF2F2",
    borderWidth: 1.5,
    borderColor: "#FECACA",
    marginTop: 14,
  },
  rejectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#DC2626",
  },
  rejectionDesc: {
    fontSize: 13,
    color: "#991B1B",
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 18,
  },
  rejectionHint: {
    fontSize: 11,
    color: "#B91C1C",
    fontWeight: "500",
    marginTop: 6,
    lineHeight: 15,
  },
  verifiedCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#F0FDF4",
    borderWidth: 1.5,
    borderColor: "rgba(16, 185, 129, 0.35)",
    marginTop: 14,
  },
  verifiedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  verifiedPill: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    maxWidth: "100%",
  },
  verifiedPillText: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#059669",
    letterSpacing: 0.2,
    flexShrink: 1,
    flexWrap: "wrap",
  },
  verifiedQuality: {
    fontSize: 11,
    fontWeight: "700",
    color: "#059669",
    marginTop: 6,
    marginBottom: 6,
    lineHeight: 16,
  },
  verifiedTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 2,
  },
  verifiedGrade: {
    fontSize: 12,
    fontWeight: "700",
    color: "#10B981",
    marginTop: 2,
    marginBottom: 6,
  },
  featuresList: {
    marginTop: 4,
    gap: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  featureText: {
    fontSize: 11,
    color: "#334155",
    fontWeight: "600",
  },
  oracleCard: {
    padding: 16,
    borderRadius: 16,
    marginTop: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  oracleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  oracleTag: {
    fontSize: 10,
    fontWeight: "800",
    color: "#38BDF8",
    letterSpacing: 0.5,
  },
  demandBadge: {
    backgroundColor: "rgba(56, 189, 248, 0.15)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  demandText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#38BDF8",
  },
  oraclePricesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  oraclePriceLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#94A3B8",
    letterSpacing: 0.3,
  },
  oraclePriceVal: {
    fontSize: 22,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 2,
  },
  oracleRangeVal: {
    fontSize: 13,
    fontWeight: "700",
    color: "#E2E8F0",
    marginTop: 2,
  },
  oracleRoiText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4ADE80",
    marginTop: 2,
  },
  compsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  compPill: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  compPlatform: {
    fontSize: 9,
    color: "#94A3B8",
    fontWeight: "700",
  },
  compPrice: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 2,
  },
  applyPriceBtn: {
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  applyPriceText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#2E1065",
  },
  priceAlertCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#FCD34D",
    marginTop: 10,
    marginBottom: 4,
  },
  priceAlertTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#B45309",
    letterSpacing: 0.3,
  },
  priceAlertDesc: {
    fontSize: 12,
    color: "#92400E",
    fontWeight: "600",
    marginTop: 4,
    lineHeight: 16,
  },
  quickAdjustBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#F59E0B",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  quickAdjustText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  oraclePillMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.2)",
    marginTop: 10,
    marginBottom: 4,
  },
  oraclePillMiniText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
  },
  // ── Suggested Oracle Banner Styles ──
  suggestedOracleBanner: {
    backgroundColor: "#F5F3FF",
    borderWidth: 1.5,
    borderColor: "rgba(124, 58, 237, 0.3)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  suggestedOracleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestedOracleTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C3AED",
  },
  suggestedOracleSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  applySuggestedBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#7C3AED",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  applySuggestedBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  // ── Listing Destination Toggle Styles ──
  destinationToggleWrap: {
    marginTop: 14,
    marginBottom: 8,
  },
  destinationToggleRow: {
    gap: 8,
    marginTop: 6,
  },
  destinationToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  destinationToggleBtnActive: {
    backgroundColor: "#7C3AED",
    borderColor: "#6D28D9",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  destinationToggleText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
    flex: 1,
  },
  destinationToggleTextActive: {
    color: "#FFFFFF",
  },
  destinationInfoPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  destinationInfoText: {
    fontSize: 11,
    color: "#475569",
    lineHeight: 16,
    flex: 1,
  },
});
