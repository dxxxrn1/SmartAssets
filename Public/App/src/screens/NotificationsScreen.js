import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getNotificationsApi, markNotificationReadApi } from '../services/api';
import { SCREENS } from '../constants/navigation';

export default function NotificationsScreen({ navigation }) {
  const { token } = useAuth();
  const { isDark } = useTheme();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const bg = isDark ? '#0F172A' : '#F8FAFC';
  const card = isDark ? '#172033' : '#FFFFFF';
  const fg = isDark ? '#F8FAFC' : '#0F172A';
  const muted = isDark ? '#AAB6CC' : '#64748B';

  const load = useCallback(async (refresh = false) => {
    if (!token) { setError('Please sign in to view notifications.'); setLoading(false); return; }
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const result = await getNotificationsApi(token);
      setItems(Array.isArray(result?.notifications) ? result.notifications : []);
    } catch (err) { setError(err.message || 'Notifications could not be loaded.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openItem = async (item) => {
    if (!item.read) {
      setBusyId(item.id);
      try {
        await markNotificationReadApi(item.id, token);
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
      } catch (err) { setError(err.message || 'Could not mark notification as read.'); setBusyId(null); return; }
      setBusyId(null);
    }
    const type = String(item.type || '').toLowerCase();
    if (type.startsWith('support_')) navigation.navigate(SCREENS.PROFILE);
    else if (type.startsWith('deposit_') || type.startsWith('withdrawal_')) navigation.navigate(SCREENS.VAULT);
    else if (item.orderId) navigation.navigate(SCREENS.ESCROW_TRACKER, { orderId: item.orderId });
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity onPress={() => openItem(item)} activeOpacity={0.8} style={[styles.card, { backgroundColor: card, borderColor: isDark ? '#26344D' : '#E2E8F0' }]}>
      <View style={[styles.iconWrap, { backgroundColor: item.read ? (isDark ? '#26344D' : '#F1F5F9') : '#DDF7FF' }]}>
        <Ionicons name={String(item.type).startsWith('support_') ? 'chatbubble-ellipses-outline' : 'wallet-outline'} size={20} color={item.read ? muted : '#0891B2'} />
      </View>
      <View style={styles.copy}>
        <View style={styles.titleLine}><Text style={[styles.title, { color: fg }]}>{item.title}</Text>{!item.read && <View style={styles.dot} />}</View>
        <Text style={[styles.message, { color: muted }]}>{item.message}</Text>
        <Text style={[styles.date, { color: muted }]}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</Text>
      </View>
      {busyId === item.id ? <ActivityIndicator size="small" color="#0891B2" /> : <Ionicons name="chevron-forward" size={18} color={muted} />}
    </TouchableOpacity>
  );

  return <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top']}>
    <View style={styles.top}><TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}><Ionicons name="arrow-back" size={22} color={fg} /></TouchableOpacity><Text style={[styles.heading, { color: fg }]}>Notifications</Text><View style={{ width: 38 }} /></View>
    <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.75} style={[styles.dropdown, { backgroundColor: card, borderColor: isDark ? '#26344D' : '#E2E8F0' }]}>
      <View style={styles.dropdownLabel}><Ionicons name="notifications-outline" size={20} color="#22B8E6" /><Text style={[styles.dropdownText, { color: fg }]}>Notifications</Text><Text style={[styles.count, { color: muted }]}>{items.filter((n) => !n.read).length} unread</Text></View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={muted} />
    </TouchableOpacity>
    {expanded && (loading ? <View style={styles.center}><ActivityIndicator size="large" color="#22B8E6" /><Text style={[styles.stateText, { color: muted }]}>Loading notifications…</Text></View> : error ? <View style={styles.center}><Text style={[styles.stateText, { color: fg }]}>{error}</Text><TouchableOpacity onPress={() => load()}><Text style={styles.retry}>Try again</Text></TouchableOpacity></View> : <FlatList data={items} keyExtractor={(item) => String(item.id)} renderItem={renderItem} contentContainerStyle={items.length ? styles.list : styles.emptyList} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#22B8E6" />} ListEmptyComponent={<View style={styles.center}><Ionicons name="notifications-off-outline" size={34} color={muted} /><Text style={[styles.stateText, { color: fg }]}>You’re all caught up</Text><Text style={[styles.message, { color: muted }]}>Deposit, withdrawal and support updates will appear here.</Text></View>} />)}
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 }, back: { width: 38, height: 38, alignItems: 'flex-start', justifyContent: 'center' }, heading: { fontSize: 20, fontWeight: '700' }, dropdown: { marginHorizontal: 18, marginTop: 8, marginBottom: 12, paddingHorizontal: 16, paddingVertical: 16, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, dropdownLabel: { flexDirection: 'row', alignItems: 'center', gap: 10 }, dropdownText: { fontWeight: '700', fontSize: 15 }, count: { fontSize: 12, marginLeft: 5 }, list: { paddingHorizontal: 18, paddingBottom: 28, gap: 10 }, card: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 4 }, titleLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, title: { fontSize: 14, fontWeight: '700', flexShrink: 1 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#06B6D4' }, message: { fontSize: 13, lineHeight: 18 }, date: { fontSize: 11, marginTop: 2 }, center: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 }, stateText: { fontSize: 15, fontWeight: '600', textAlign: 'center' }, retry: { color: '#0891B2', fontWeight: '700', padding: 8 }, emptyList: { flexGrow: 1, justifyContent: 'center' } });
