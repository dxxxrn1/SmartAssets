import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useColors } from "../constants/theme";
import { SCREENS } from "../constants/navigation";
import { getMyEscrowOrdersApi, getSellerEscrowOrdersApi } from "../services/api";

const orderIdOf = (order) => order.orderId || order.order_id || order.id;
const statusOf = (order) => order.status || "payment_secured";
const titleOf = (order) => order.assetName || order.asset_name || "Escrow order";
const amountOf = (order) => Number(order.amountZar || order.amount_zar || 0);

export default function EscrowOrdersScreen({ navigation }) {
  // Escrow screens strictly maintain light theme regardless of global/profile theme
  const c = useColors(false);
  const { token } = useAuth();
  const [filter, setFilter] = useState("all");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadOrders = useCallback(async (manual = false) => {
    if (!token) {
      setError("Sign in to view your escrow orders.");
      setOrders([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (manual) setRefreshing(true);
    try {
      const [buyerResult, sellerResult] = await Promise.allSettled([
        getMyEscrowOrdersApi(token),
        getSellerEscrowOrdersApi(token),
      ]);
      const merged = new Map();
      if (buyerResult.status === "fulfilled" && Array.isArray(buyerResult.value?.orders)) {
        buyerResult.value.orders.forEach((order) => merged.set(orderIdOf(order), { ...order, isBuyerOrder: true }));
      }
      if (sellerResult.status === "fulfilled" && Array.isArray(sellerResult.value?.orders)) {
        sellerResult.value.orders.forEach((order) => {
          const id = orderIdOf(order);
          const existing = merged.get(id) || {};
          merged.set(id, { ...existing, ...order, isBuyerOrder: Boolean(existing.isBuyerOrder), isSellerOrder: true });
        });
      }
      const succeeded = buyerResult.status === "fulfilled" || sellerResult.status === "fulfilled";
      if (!succeeded) throw buyerResult.reason || sellerResult.reason || new Error("Could not load escrow orders.");
      setOrders([...merged.values()].filter((order) => orderIdOf(order)).sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0)));
      setError(null);
    } catch (err) {
      setError(err.message || "Could not load escrow orders.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    loadOrders();
    const timer = setInterval(() => loadOrders(), 15000);
    return () => clearInterval(timer);
  }, [loadOrders]));

  const visibleOrders = orders.filter((order) =>
    filter === "all" || (filter === "selling" ? order.isSellerOrder : order.isBuyerOrder)
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.obsidian }]}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.back, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={18} color={c.warm} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.warm }]}>Escrow orders</Text>
          <Text style={[styles.subtitle, { color: c.muted }]}>Track purchases and sales</Text>
        </View>
        <TouchableOpacity style={[styles.back, { backgroundColor: c.card, borderColor: c.border }]} onPress={() => loadOrders(true)}>
          <Feather name="refresh-cw" size={16} color={c.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.filters}>
        {[ ["all", "All orders"], ["selling", "Selling"], ["buying", "Buying"] ].map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => setFilter(key)} style={[styles.filter, { borderColor: filter === key ? c.primary : c.border, backgroundColor: filter === key ? c.primaryBg : c.card }]}>
            <Text style={{ color: filter === key ? c.primary : c.muted, fontWeight: "700", fontSize: 12 }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator color={c.primary} /><Text style={{ color: c.muted, marginTop: 10 }}>Loading escrow orders…</Text></View> : (
        <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadOrders(true)} tintColor={c.primary} />}>
          {error && <Text style={[styles.notice, { color: c.red }]}>{error}</Text>}
          {visibleOrders.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: c.card, borderColor: c.border }]}>
              <Feather name="package" size={30} color={c.primary} />
              <Text style={[styles.emptyTitle, { color: c.warm }]}>No {filter === "all" ? "escrow" : filter} orders yet</Text>
              <Text style={[styles.subtitle, { color: c.muted, textAlign: "center" }]}>Orders will show here when you buy an item or a buyer purchases one of your listings.</Text>
            </View>
          ) : visibleOrders.map((order) => {
            const status = statusOf(order);
            const orderId = orderIdOf(order);
            return (
              <TouchableOpacity key={orderId} style={[styles.order, { backgroundColor: c.card, borderColor: c.border }]} activeOpacity={0.8} onPress={() => navigation.navigate(SCREENS.ESCROW_TRACKER, { orderId })}>
                <View style={styles.orderTop}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[styles.orderTitle, { color: c.warm }]}>{titleOf(order)}</Text>
                    <Text style={[styles.orderId, { color: c.muted }]}>{orderId}</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={c.muted} />
                </View>
                <View style={styles.orderBottom}>
                  <Text style={[styles.amount, { color: c.warm }]}>R{amountOf(order).toLocaleString("en-ZA")}</Text>
                  <View style={[styles.statusPill, { backgroundColor: status === "released" ? c.greenBg : status === "disputed" ? c.amberBg : c.primaryBg }]}>
                    <Text style={{ color: status === "released" ? c.green : status === "disputed" ? c.amber : c.primary, fontSize: 10, fontWeight: "800" }}>{status.replace(/_/g, " ").toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.role, { color: c.muted }]}>{order.isSellerOrder ? "Seller" : "Buyer"}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 14 },
  back: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 19, fontWeight: "800" },
  subtitle: { fontSize: 12, marginTop: 3 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: 18, paddingBottom: 14 },
  filter: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  list: { padding: 18, paddingTop: 4, gap: 10, flexGrow: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  notice: { fontSize: 13, padding: 8 },
  empty: { flex: 1, minHeight: 240, borderWidth: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  emptyTitle: { fontSize: 16, fontWeight: "800" },
  order: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  orderTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  orderTitle: { fontSize: 14, fontWeight: "700" },
  orderId: { fontSize: 11, marginTop: 4 },
  orderBottom: { flexDirection: "row", alignItems: "center", gap: 8 },
  amount: { fontSize: 13, fontWeight: "800", flex: 1 },
  statusPill: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  role: { fontSize: 10, fontWeight: "700" },
});
