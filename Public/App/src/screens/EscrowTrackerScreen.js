// ─── EscrowTrackerScreen ──────────────────────────────────────────────────────
// Real-time Smart Contract Escrow tracker for luxury collectibles:
// 1. Payment Secured in Smart Contract (Locked on Sepolia)
// 2. Physical Asset in Transit to Vault
// 3. Appraiser Inspection & Authentication
// 4. Funds Released to Seller & NFT Delivered to Buyer / 100% Refunded

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Linking,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useColors } from "../constants/theme";
import { useAuth } from "../context/AuthContext";
import {
  getEscrowOrderApi,
  getMyEscrowOrdersApi,
  disputeEscrowApi,
  progressEscrowStepApi,
  postSellerEscrowUpdateApi,
  resolveImageUrl,
} from "../services/api";
import { SCREENS } from "../constants/navigation";

export default function EscrowTrackerScreen({ navigation, route, isDark }) {
  const c = useColors(isDark);
  const { token, user } = useAuth();
  const orderId = route?.params?.orderId || "ORD-892104";
  const initialAsset = route?.params?.asset || {};

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progressing, setProgressing] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [sellerUpdate, setSellerUpdate] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [savingUpdate, setSavingUpdate] = useState(false);

  useEffect(() => {
    fetchOrder();
    const timer = setInterval(fetchOrder, 15000);
    return () => clearInterval(timer);
  }, [orderId, token]);

  const fetchOrder = () => {
    getEscrowOrderApi(orderId, token)
      .then((res) => {
        if (res?.success && res.order) {
          setOrder(res.order);
        }
      })
      .catch((err) => {
        console.warn("Escrow fetch warning:", err.message);
      })
      .finally(() => setLoading(false));
  };

  const handleSellerUpdate = async () => {
    setSavingUpdate(true);
    try {
      const res = await postSellerEscrowUpdateApi(order?.orderId || orderId, {
        update: sellerUpdate,
        carrier,
        trackingNumber,
      }, token);
      if (!res?.success || !res.order) throw new Error(res?.error || "Update was not saved.");
      setOrder(res.order);
      setSellerUpdate("");
      Alert.alert("Update Shared", "The buyer can now see this product and shipping update.");
    } catch (err) {
      Alert.alert("Update Failed", err.message || "Could not save the update.");
    } finally {
      setSavingUpdate(false);
    }
  };

  // ── Advance Step (Courier Transit or Appraiser Inspection) ──
  const handleProgressStep = async (nextStep, note, extra = {}) => {
    setProgressing(true);
    try {
      const res = await progressEscrowStepApi(
        order?.orderId || orderId,
        nextStep,
        { note, ...extra },
        token,
      );
      if (res?.success && res.order) {
        setOrder(res.order);
        Alert.alert(
          "Stage Updated",
          nextStep === 2
            ? "Insured armored courier dispatch recorded."
            : nextStep === 3
            ? "Authenticity appraisal and physical inspection completed."
            : nextStep === 4
            ? "Physical delivery confirmed."
            : "Buyer accepted collectible condition.",
        );
      } else {
        throw new Error(res?.error || "Stage update not confirmed by server.");
      }
    } catch (err) {
      Alert.alert("Update Failed", err.message || "Stage update failed.");
      // Do NOT optimistically advance step on error — refresh from server
      fetchOrder();
    } finally {
      setProgressing(false);
    }
  };

  // ── Dispute & Refund ──
  const handleDispute = () => {
    Alert.alert(
      "SmartAssets Escrow Protection",
      "If the asset has not arrived or its condition differs from the agreement, submit a dispute for administrator review.",
      [
        { text: "Back", style: "cancel" },
        {
          text: "Open Official Dispute",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Open Dispute",
              "Enter reason for dispute. This will freeze escrow release until arbitrated by the compliance team.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Submit Dispute",
                  style: "destructive",
                  onPress: async () => {
                    setDisputing(true);
                    try {
                      const res = await disputeEscrowApi(
                        order?.orderId || orderId,
                        `${isSeller ? "Seller" : "Buyer"} raised a dispute: Item discrepancy / delivery issue.`,
                        "Initial buyer dispute claim",
                        token
                      );
                      if (res?.success && res.order) {
                        setOrder(res.order);
                        Alert.alert("Dispute Opened", "Escrow funds frozen pending resolution.");
                      }
                    } catch (err) {
                      Alert.alert("Dispute Failed", err.message || "Could not open dispute.");
                      fetchOrder();
                    } finally {
                      setDisputing(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ],
    );
  };

  const currentStep = order?.currentStep || ({ payment_secured: 1, in_transit: 2, in_inspection: 3, delivered: 4, accepted: 4, released: 5 }[order?.status] || 1);
  const isReleased = order?.status === "released";
  const isRefunded = order?.status === "refunded";
  const isSeller = Boolean(user?.id && order?.sellerId && String(user.id) === String(order.sellerId));
  const isBuyer = Boolean(user?.id && order?.buyerId && String(user.id) === String(order.buyerId));
  const statusInfo = ({
    pending_payment: ["Payment settlement pending", "The order is waiting for payment settlement verification."],
    payment_secured: ["Payment secured — awaiting shipment", "Funds are held in escrow while the seller prepares the shipment."],
    in_transit: ["Shipment in transit", "The seller recorded shipment. The buyer confirms delivery after it arrives."],
    in_inspection: ["Item under inspection", "The item is being checked before the buyer confirms delivery."],
    delivered: ["Buyer confirmed delivery", "Delivery is confirmed. The buyer still needs to accept the item condition."],
    accepted: ["Buyer accepted — awaiting administrator release", "The administrator can review the order and release the escrow funds to the seller."],
    release_processing: ["Administrator release processing", "The accepted order is being settled to the seller."],
    disputed: ["Escrow dispute active", "Funds remain frozen while the administrator reviews the dispute."],
    released: ["Escrow completed and settled", "The administrator released the funds to the seller."],
    refunded: ["Escrow refunded", "The funds were returned to the buyer."],
  })[order?.status] || ["Loading escrow status", "Order status will appear here when loaded."];
  if (order?.paymentMethod === "bank" && order?.status === "payment_secured") {
    statusInfo[0] = "Bank settlement verified — awaiting shipment";
    statusInfo[1] = "The administrator verified the bank settlement. The seller can now record carrier and tracking details.";
  }

  const assetName =
    order?.assetName || initialAsset.name || "Luxury Collectible";
  const assetCategory =
    order?.assetCategory || initialAsset.category || "Verified Luxury";
  const assetImage = resolveImageUrl(
    order?.assetImage ||
      initialAsset.image ||
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800",
  );
  const amountZar =
    order?.amountZar || order?.amountGbp || initialAsset.price_num || 25000;
  const amountEth = order?.amountEth || (amountZar / 48000).toFixed(4);

  const STEPS = [
    {
      step: 1,
      title: order?.status === "pending_payment"
        ? "Payment Settlement Pending"
        : order?.paymentMethod === "bank"
          ? "Bank Settlement Verified"
          : "Payment Secured in Smart Contract",
      detail: order?.status === "pending_payment"
        ? "Bank payment was submitted and is awaiting administrator settlement verification. Funds are not yet marked as secured."
        : order?.paymentMethod === "bank"
          ? "Administrator verified the bank settlement for this order. Shipment can now be recorded."
          : `${amountEth} Sepolia ETH locked in Escrow Contract. Protected from withdrawal.`,
      icon: "lock",
      txHash: order?.depositTxHash,
      done: order?.status !== "pending_payment",
    },
    {
      step: 2,
      title: "Physical Asset in Transit to Vault",
      detail:
        order?.timeline?.[1]?.description ||
        "Brink's Armored Courier #BRK-8921 in transit to SmartAssets Custody Center.",
      icon: "truck",
      txHash: order?.timeline?.[1]?.txHash,
      done: currentStep >= 2 && !isRefunded,
    },
    {
      step: 3,
      title: "Authentication & Physical Inspection",
      detail:
        order?.timeline?.[2]?.description ||
        "Certified Horologist & Gemological Institute evaluating serial numbers and physical condition.",
      icon: "check-circle",
      txHash: order?.timeline?.[2]?.txHash,
      done: currentStep >= 3 && !isRefunded,
    },
    {
      step: 4,
      title: isRefunded
        ? "100% Refunded to Buyer"
        : "Funds Released & NFT Transferred",
      detail: isRefunded
        ? "Smart contract executed 100% refund of deposit back to buyer on Ethereum Sepolia."
        : "Smart contract executes automatic payout to seller and transfers ownership NFT to buyer.",
      icon: isRefunded ? "arrow-left-circle" : "award",
      txHash: isRefunded ? order?.refundTxHash : order?.releaseTxHash,
      done: isReleased || isRefunded,
    },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      {/* ── Nav Bar ── */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={[
            styles.backBtn,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
        >
          <Feather name="x" size={18} color={c.warm} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={[styles.navTitle, { color: c.warm }]}>
            Smart Contract Escrow
          </Text>
          <Text style={[styles.navSub, { color: c.primary }]}>{orderId}</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.backBtn,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onPress={handleDispute}
        >
          <Feather name="help-circle" size={18} color={c.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Status Banner ── */}
        <View
          style={[
            styles.escrowBanner,
            {
              backgroundColor: order?.status === "disputed"
                ? c.amberBg
                : isRefunded
                ? "#FEF2F2"
                : isReleased
                  ? c.greenBg
                  : c.primaryBg,
              borderColor: order?.status === "disputed"
                ? c.amber
                : isRefunded
                ? "#EF4444"
                : isReleased
                  ? c.green
                  : c.primary,
            },
          ]}
        >
          <Ionicons
              name={
              isRefunded
                ? "refresh-circle"
                : isReleased
                  ? "checkmark-circle"
                    : order?.status === "disputed"
                      ? "alert-circle"
                      : "shield-checkmark"
            }
            size={24}
            color={isRefunded ? "#EF4444" : isReleased ? c.green : order?.status === "disputed" ? c.amber : c.primary}
          />
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.escrowBannerTitle,
                {
                  color: isRefunded
                    ? "#DC2626"
                    : isReleased
                      ? c.green
                      : order?.status === "disputed" ? c.amber : c.primary,
                },
              ]}
            >
              {statusInfo[0]}
            </Text>
            <Text style={[styles.escrowBannerSub, { color: c.muted }]}>
              {statusInfo[1]}
            </Text>
          </View>
        </View>

        {isSeller && ["pending_payment", "payment_secured", "in_transit"].includes(order?.status) && (
          <View style={[styles.simCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.warm, marginBottom: 8 }}>{order?.status === "pending_payment" ? "Share a product preparation update" : "Confirm shipment or share an update"}</Text>
            <TextInput value={sellerUpdate} onChangeText={setSellerUpdate} placeholder="Product condition, packing, dispatch progress…" placeholderTextColor={c.muted} multiline style={[styles.updateInput, { color: c.warm, borderColor: c.border }]} />
            {order?.status === "pending_payment" ? (
              <Text style={{ color: c.amber, fontSize: 11, lineHeight: 16, marginBottom: 8 }}>The buyer’s bank payment is awaiting admin verification. Shipment recording unlocks after the funds are verified.</Text>
            ) : (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={carrier} onChangeText={setCarrier} placeholder="Carrier" placeholderTextColor={c.muted} style={[styles.updateInput, styles.halfInput, { color: c.warm, borderColor: c.border }]} />
                <TextInput value={trackingNumber} onChangeText={setTrackingNumber} placeholder="Tracking number" placeholderTextColor={c.muted} style={[styles.updateInput, styles.halfInput, { color: c.warm, borderColor: c.border }]} />
              </View>
            )}
            <TouchableOpacity style={[styles.simBtn, { backgroundColor: c.primary }]} onPress={handleSellerUpdate} disabled={savingUpdate}>
              {savingUpdate ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>{order?.status === "pending_payment" ? "Share preparation update" : "Record shipment / share update"}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {(order?.timeline || []).filter((event) => event.type === "seller_update").length > 0 && (
          <View style={[styles.simCard, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: c.warm, marginBottom: 8 }}>Product & shipment updates</Text>
            {(order.timeline || []).filter((event) => event.type === "seller_update").slice().reverse().map((event, index) => (
              <View key={`${event.timestamp || "update"}-${index}`} style={{ paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: c.border }}>
                <Text style={{ color: c.warm, fontSize: 13 }}>{event.description}</Text>
                <Text style={{ color: c.muted, fontSize: 11, marginTop: 3 }}>{event.timestamp ? new Date(event.timestamp).toLocaleString() : ""}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Asset Summary Card ── */}
        <View
          style={[
            styles.assetCard,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Image
            source={{ uri: assetImage }}
            style={styles.assetImage}
            resizeMode="cover"
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.assetName, { color: c.warm }]}>
              {assetName}
            </Text>
            <Text style={[styles.assetCategory, { color: c.primary }]}>
              {assetCategory}
            </Text>
            <Text style={[styles.assetPrice, { color: c.warm }]}>
              R{Number(amountZar).toLocaleString()} · {amountEth} ETH
            </Text>
            <Text style={{ fontSize: 10, color: c.muted, marginTop: 2 }}>
              Rail: {order?.paymentRail || "Ethereum Sepolia Web3"}
            </Text>
          </View>
        </View>

        {/* ── 4-Stage Stepper ── */}
        <View
          style={[
            styles.stepperCard,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Text style={[styles.stepperTitle, { color: c.warm }]}>
            Escrow Verification Lifecycle
          </Text>

          {STEPS.map((item, index) => {
            const isCompleted = item.done;
            const isCurrent =
              currentStep === item.step && !isReleased && !isRefunded;

            return (
              <View key={item.step} style={styles.stepRow}>
                {/* Dot & connector */}
                <View style={styles.stepperCol}>
                  <View
                    style={[
                      styles.stepIconWrap,
                      {
                        backgroundColor:
                          isRefunded && item.step === 4
                            ? "#EF4444"
                            : isCompleted
                              ? c.primary
                              : isCurrent
                                ? c.primaryBg
                                : c.cardLight,
                        borderColor:
                          isRefunded && item.step === 4
                            ? "#EF4444"
                            : isCompleted
                              ? c.primary
                              : isCurrent
                                ? c.primary
                                : c.border,
                      },
                    ]}
                  >
                    <Feather
                      name={
                        isRefunded && item.step === 4
                          ? "rotate-ccw"
                          : isCompleted
                            ? "check"
                            : item.icon
                      }
                      size={14}
                      color={
                        isCompleted || (isRefunded && item.step === 4)
                          ? "#FFFFFF"
                          : isCurrent
                            ? c.primary
                            : c.muted
                      }
                    />
                  </View>
                  {index < STEPS.length - 1 && (
                    <View
                      style={[
                        styles.connector,
                        { backgroundColor: isCompleted ? c.primary : c.border },
                      ]}
                    />
                  )}
                </View>

                {/* Step content */}
                <View style={styles.stepContent}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={[
                        styles.stepHeading,
                        {
                          color:
                            isRefunded && item.step === 4
                              ? "#EF4444"
                              : isCompleted || isCurrent
                                ? c.warm
                                : c.muted,
                        },
                      ]}
                    >
                      {item.title}
                    </Text>
                    {isCompleted && (
                      <View
                        style={[
                          styles.doneBadge,
                          {
                            backgroundColor:
                              isRefunded && item.step === 4
                                ? "#FEE2E2"
                                : c.greenBg,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 9,
                            fontWeight: "700",
                            color:
                              isRefunded && item.step === 4
                                ? "#EF4444"
                                : c.green,
                          }}
                        >
                          {isRefunded && item.step === 4
                            ? "REFUNDED"
                            : "VERIFIED"}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.stepDesc, { color: c.muted }]}>
                    {item.detail}
                  </Text>

                  {item.txHash?.startsWith("0x") ? (
                    <TouchableOpacity
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 6,
                      }}
                      onPress={() =>
                        Linking.openURL(
                          `https://sepolia.etherscan.io/tx/${item.txHash}`,
                        )
                      }
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontFamily: "Courier",
                          color: c.primary,
                        }}
                      >
                        {item.txHash.substring(0, 18)}…
                      </Text>
                      <Feather
                        name="external-link"
                        size={12}
                        color={c.primary}
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Escrow Contract Address ── */}
        <View
          style={[
            styles.infoCard,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Text style={[styles.infoLabel, { color: c.muted }]}>
            ESCROW SMART CONTRACT
          </Text>
          <Text
            style={[styles.infoValue, { color: c.warm, fontFamily: "Courier" }]}
          >
            {order?.escrowContractAddress ||
              "0x5FbDB2315678afecb367f032d93F642f64180aa3"}
          </Text>
          <Text style={[styles.infoSub, { color: c.primary }]}>
            Ethereum Sepolia (Chain ID: 11155111)
          </Text>
        </View>

        {/* ── Explorer Button ── */}
        <TouchableOpacity
          style={[
            styles.contractBtn,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
          onPress={() =>
            Linking.openURL(
              order?.depositTxHash
                ? `https://sepolia.etherscan.io/tx/${order.depositTxHash}`
                : "https://sepolia.etherscan.io",
            )
          }
        >
          <Ionicons
            name="open-outline"
            size={16}
            color={c.primary}
            style={{ marginRight: 6 }}
          />
          <Text style={{ color: c.primary, fontWeight: "700", fontSize: 13 }}>
            View Escrow On Etherscan Sepolia
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Action Footer ── */}
      <SafeAreaView
        edges={["bottom"]}
        style={[
          styles.ctaWrap,
          { backgroundColor: c.vault, borderTopColor: c.border },
        ]}
      >
        {isRefunded ? (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: "#EF4444" }]}
            onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
          >
            <Text style={styles.actionBtnText}>
              Escrow Refunded — Return to Vault
            </Text>
          </TouchableOpacity>
        ) : order?.status === 'disputed' ? (
          <View style={{ gap: 8 }}>
            <View style={[styles.actionBtn, { backgroundColor: "#F59E0B" }]}>
              <Text style={styles.actionBtnText}>
                Dispute Active — Escrow Funds Frozen
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: "#EF4444" }]}
              onPress={handleDispute}
            >
              <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600", textAlign: "center" }}>
                View Dispute Terms or Request Settlement Refund
              </Text>
            </TouchableOpacity>
          </View>
        ) : order?.status === 'accepted' ? (
          <View style={{ gap: 8 }}>
            <View style={[styles.actionBtn, { backgroundColor: c.cardLight, borderColor: c.border, borderWidth: 1 }]}>
              <Text style={[styles.actionBtnText, { color: c.muted, textAlign: 'center' }]}>
                Buyer accepted — awaiting administrator review
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: "#EF444440" }]}
              onPress={handleDispute}
            >
              <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600", textAlign: "center" }}>
                Having an issue? Open Official Dispute
              </Text>
            </TouchableOpacity>
          </View>
        ) : !isReleased ? (
          <View style={{ gap: 8 }}>
            {isBuyer ? <TouchableOpacity
              style={[
                styles.actionBtn,
                {
                  backgroundColor: order?.status === 'delivered'
                    ? c.primary
                    : c.cardLight,
                  borderColor: c.border,
                  borderWidth: 1,
                },
              ]}
              onPress={() => {
                if (order?.status === 'delivered') {
                  handleProgressStep(5, "Buyer confirmed receipt and accepted condition.");
                } else if (['in_transit', 'in_inspection'].includes(order?.status)) {
                  handleProgressStep(4, "Collectible delivered to recipient.");
                }
              }}
              disabled={!['delivered', 'in_transit', 'in_inspection'].includes(order?.status) || progressing}
            >
              <Text
                style={[
                  styles.actionBtnText,
                  {
                    color: ['delivered', 'in_transit', 'in_inspection'].includes(order?.status)
                      ? '#FFFFFF'
                      : c.muted,
                  },
                ]}
              >
                {order?.status === 'pending_payment'
                  ? 'Awaiting bank settlement verification'
                  : order?.status === 'delivered'
                  ? 'Accept Collectible Condition'
                  : ['in_transit', 'in_inspection'].includes(order?.status)
                  ? 'Confirm Delivery Receipt'
                  : 'Funds Secured — Awaiting Shipment'}
              </Text>
            </TouchableOpacity> : <View style={[styles.actionBtn, { backgroundColor: c.cardLight }]}><Text style={[styles.actionBtnText, { color: c.muted }]}>{isSeller && order?.status === "pending_payment" ? "Awaiting admin settlement verification before shipment" : isSeller && order?.status === "payment_secured" ? "Payment secured — seller shipment is next" : isSeller && order?.status === "delivered" ? "Delivery confirmed — awaiting buyer acceptance" : isSeller && order?.status === "in_inspection" ? "Item under inspection — awaiting buyer delivery confirmation" : isSeller && order?.status === "in_transit" ? "Shipment in transit — awaiting buyer delivery confirmation" : order?.status === "pending_payment" ? "Awaiting bank settlement verification" : "Awaiting buyer delivery confirmation"}</Text></View>}

            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: "#EF444440" }]}
              onPress={handleDispute}
              disabled={disputing}
            >
              <Text
                style={{
                  color: "#EF4444",
                  fontSize: 12,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                Having an issue? Open a dispute for administrator review
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: c.green }]}
            onPress={() => navigation.navigate(SCREENS.MAIN_TABS)}
          >
            <Text style={styles.actionBtnText}>
              Escrow Completed — Back to Vault
            </Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 15, fontWeight: "700" },
  navSub: { fontSize: 11, fontWeight: "700", fontFamily: "Courier" },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  escrowBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  escrowBannerTitle: { fontSize: 13, fontWeight: "700" },
  escrowBannerSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  assetCard: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
  },
  assetImage: { width: 68, height: 68, borderRadius: 14 },
  assetName: { fontSize: 14, fontWeight: "700" },
  assetCategory: { fontSize: 10, fontWeight: "600", marginTop: 2 },
  assetPrice: { fontSize: 13, fontWeight: "700", marginTop: 4 },
  simCard: {
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  updateInput: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    fontSize: 13,
  },
  halfInput: { flex: 1, minWidth: 0 },
  simBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  stepperCard: { padding: 16, borderRadius: 20, borderWidth: 1, gap: 8 },
  stepperTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  stepRow: { flexDirection: "row", gap: 12 },
  stepperCol: { alignItems: "center", width: 28 },
  stepIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: { width: 2, flex: 1, marginVertical: 4 },
  stepContent: { flex: 1, paddingBottom: 18 },
  stepHeading: { fontSize: 13, fontWeight: "700" },
  doneBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  stepDesc: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  infoCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  infoLabel: { fontSize: 10, fontWeight: "700" },
  infoValue: { fontSize: 12 },
  infoSub: { fontSize: 10, fontWeight: "600" },
  contractBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
  },
  ctaWrap: { paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1 },
  actionBtn: { borderRadius: 18, paddingVertical: 16, alignItems: "center" },
  actionBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  secondaryBtn: { paddingVertical: 6 },
});
