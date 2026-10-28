// ─── useLinkedWallet Hook ─────────────────────────────────────────────────────
// React Native & Web hook for Web3 wallet linking, EIP-191 signature verification,
// network enforcement (Sepolia), and accountsChanged / chainChanged live synchronization.
// Fully decoupled from window.ethereum — operates via mobileWalletService.

import { useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  getWalletNonceApi,
  linkWalletApi,
  unlinkWalletApi,
} from '../services/api';
import {
  getMobileEthereumProvider,
  connectMobileWallet,
  signPersonalMessage,
  switchChainToSepolia,
  getActiveWalletAccount,
  getActiveChainId,
  isMetaMaskAppInstalled,
  SEPOLIA_CHAIN_ID_HEX,
} from '../services/mobileWalletService';

export function useLinkedWallet() {
  const { user, token, updateUser } = useAuth();
  const linkedWallet = (user?.walletAddress || user?.wallet_address || '').toLowerCase() || null;

  const [activeMetaMaskAccount, setActiveMetaMaskAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [isSepolia, setIsSepolia] = useState(true);
  const [isMismatch, setIsMismatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [installModalVisible, setInstallModalVisible] = useState(false);

  // ── Sync with Mobile Provider Events ───────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    let removeListeners = () => {};

    async function initProviderSync() {
      const provider = await getMobileEthereumProvider();
      if (!provider || !isMounted) return;

      const handleAccountsChanged = (accounts) => {
        if (!isMounted) return;
        const active = accounts && accounts[0] ? accounts[0].toLowerCase() : null;
        setActiveMetaMaskAccount(active);
        if (linkedWallet && active && active !== linkedWallet) {
          setIsMismatch(true);
        } else {
          setIsMismatch(false);
        }
      };

      const handleChainChanged = (chainId) => {
        if (!isMounted) return;
        setCurrentChainId(chainId);
        setIsSepolia(chainId === SEPOLIA_CHAIN_ID_HEX || chainId === '11155111');
      };

      try {
        const accounts = await provider.request({ method: 'eth_accounts' });
        handleAccountsChanged(accounts);
        const chain = await provider.request({ method: 'eth_chainId' });
        handleChainChanged(chain);
      } catch (_) {}

      provider.on?.('accountsChanged', handleAccountsChanged);
      provider.on?.('chainChanged', handleChainChanged);

      removeListeners = () => {
        provider.removeListener?.('accountsChanged', handleAccountsChanged);
        provider.removeListener?.('chainChanged', handleChainChanged);
      };
    }

    initProviderSync();
    return () => {
      isMounted = false;
      removeListeners();
    };
  }, [linkedWallet]);

  // ── Connect & Sign Cryptographic Nonce ─────────────────────────────────────
  const requestSignatureFromWallet = useCallback(async (targetAddress) => {
    const cleanAddress = targetAddress.toLowerCase();

    // 1. Get challenge nonce from backend
    const challengeRes = await getWalletNonceApi(cleanAddress);
    if (!challengeRes?.success || !challengeRes?.message || !challengeRes?.nonce) {
      throw new Error(challengeRes?.error || 'Failed to get wallet authentication challenge.');
    }

    // 2. Request cryptographic signature from user via mobile personal_sign
    const signature = await signPersonalMessage(challengeRes.message, cleanAddress);

    return {
      walletAddress: cleanAddress,
      signature,
      nonce: challengeRes.nonce,
    };
  }, []);

  // ── Link MetaMask to Current Real Account ──────────────────────────────────
  const linkWallet = useCallback(async (customAddress = null) => {
    setError(null);
    setLoading(true);

    try {
      let addressToLink = customAddress;

      if (!addressToLink) {
        const isInstalled = await isMetaMaskAppInstalled();
        if (!isInstalled && Platform.OS !== 'web') {
          setInstallModalVisible(true);
          return null;
        }

        try {
          addressToLink = await connectMobileWallet();
        } catch (connErr) {
          if (connErr.message === 'METAMASK_NOT_INSTALLED') {
            setInstallModalVisible(true);
            return null;
          }
          throw connErr;
        }
      }

      const cleanAddress = addressToLink.trim().toLowerCase();

      // Sign the challenge nonce
      const { signature, nonce } = await requestSignatureFromWallet(cleanAddress);

      // Verify and link on backend
      const res = await linkWalletApi({ walletAddress: cleanAddress, signature, nonce }, token);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to link wallet.');
      }

      // Update AuthContext user state with linked wallet
      updateUser({ walletAddress: cleanAddress, wallet_address: cleanAddress });

      if (Platform.OS === 'web') {
        alert('MetaMask wallet linked successfully to your account!');
      } else {
        Alert.alert('Wallet Linked', 'Your MetaMask wallet is now linked to your account.');
      }

      return res;
    } catch (err) {
      const msg = err?.message || 'Could not link wallet.';
      setError(msg);
      if (Platform.OS === 'web') {
        alert(msg);
      } else {
        Alert.alert('Link Error', msg);
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, [token, updateUser, requestSignatureFromWallet]);

  // ── Unlink / Disconnect Wallet ─────────────────────────────────────────────
  const unlinkWallet = useCallback(async (options = {}) => {
    const { silent = false } = options || {};
    setError(null);
    setLoading(true);

    try {
      const res = await unlinkWalletApi(token);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to unlink wallet.');
      }

      updateUser({ walletAddress: null, wallet_address: null });

      if (!silent) {
        if (Platform.OS === 'web') {
          // If not silent, show notification
          alert('Wallet unlinked successfully.');
        } else {
          Alert.alert('Wallet Disconnected', 'Your wallet has been disconnected from your profile.');
        }
      }

      return res;
    } catch (err) {
      const msg = err?.message || 'Could not unlink wallet.';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [token, updateUser]);

  // ── Guard for Transaction Screens ──────────────────────────────────────────
  // Transaction screens invoke this before dispatching any on-chain transaction.
  const verifyTransactionWallet = useCallback(async () => {
    if (!linkedWallet) {
      const msg = 'No wallet linked: Please connect and link your MetaMask wallet in Profile before making transactions.';
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Action Required', msg);
      return false;
    }

    const current = await getActiveWalletAccount();
    if (current && current !== linkedWallet) {
      const short = `${linkedWallet.substring(0, 6)}...${linkedWallet.slice(-4)}`;
      const msg = `Please switch MetaMask to your linked wallet ${short}.`;
      if (Platform.OS === 'web') alert(msg); else Alert.alert('Wallet Mismatch', msg);
      return false;
    }

    const chain = await getActiveChainId();
    if (chain && chain !== SEPOLIA_CHAIN_ID_HEX && chain !== '11155111') {
      const switched = await switchChainToSepolia();
      if (!switched) {
        const msg = 'Please switch your MetaMask network to the Ethereum Sepolia testnet to proceed.';
        if (Platform.OS === 'web') alert(msg); else Alert.alert('Network Switch Required', msg);
        return false;
      }
    }

    return true;
  }, [linkedWallet]);

  return {
    linkedWallet,
    activeMetaMaskAccount,
    isMismatch,
    isSepolia,
    loading,
    error,
    installModalVisible,
    setInstallModalVisible,
    linkWallet,
    unlinkWallet,
    switchToSepolia: switchChainToSepolia,
    verifyTransactionWallet,
    requestSignatureFromWallet,
  };
}

export default useLinkedWallet;
