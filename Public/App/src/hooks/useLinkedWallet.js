// ─── useLinkedWallet Hook ─────────────────────────────────────────────────────
// Plain JavaScript React Native / Web hook for Web3 wallet linking, signature verification,
// network enforcement (Sepolia), and accountsChanged / chainChanged live synchronization.

import { useState, useEffect, useCallback } from 'react';
import { Platform, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import {
  getWalletNonceApi,
  linkWalletApi,
  unlinkWalletApi,
} from '../services/api';

const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'; // 11155111 in hex

export function useLinkedWallet() {
  const { user, token, updateUser } = useAuth();
  const linkedWallet = (user?.walletAddress || user?.wallet_address || '').toLowerCase() || null;

  const [activeMetaMaskAccount, setActiveMetaMaskAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [isSepolia, setIsSepolia] = useState(true);
  const [isMismatch, setIsMismatch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Sync with window.ethereum provider (MetaMask) ──────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      const active = accounts && accounts[0] ? accounts[0].toLowerCase() : null;
      setActiveMetaMaskAccount(active);
      if (linkedWallet && active && active !== linkedWallet) {
        setIsMismatch(true);
      } else {
        setIsMismatch(false);
      }
    };

    const handleChainChanged = (chainId) => {
      setCurrentChainId(chainId);
      setIsSepolia(chainId === SEPOLIA_CHAIN_ID_HEX || chainId === '11155111');
    };

    window.ethereum.request?.({ method: 'eth_accounts' })
      .then(handleAccountsChanged)
      .catch(() => {});

    window.ethereum.request?.({ method: 'eth_chainId' })
      .then(handleChainChanged)
      .catch(() => {});

    window.ethereum.on?.('accountsChanged', handleAccountsChanged);
    window.ethereum.on?.('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [linkedWallet]);

  // ── Switch to Sepolia Testnet ──────────────────────────────────────────────
  const switchToSepolia = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return false;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
      });
      setIsSepolia(true);
      return true;
    } catch (switchError) {
      // 4902: Unrecognized chain, request user to add Sepolia
      if (switchError.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: SEPOLIA_CHAIN_ID_HEX,
                chainName: 'Sepolia Testnet',
                nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://rpc.sepolia.org'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              },
            ],
          });
          setIsSepolia(true);
          return true;
        } catch (_) {}
      }
      return false;
    }
  }, []);

  // ── Connect & Sign Cryptographic Nonce ─────────────────────────────────────
  const requestSignatureFromWallet = useCallback(async (targetAddress) => {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask is not installed or not available in this environment.');
    }

    const cleanAddress = targetAddress.toLowerCase();

    // 1. Get challenge nonce from backend
    const challengeRes = await getWalletNonceApi(cleanAddress);
    if (!challengeRes.success || !challengeRes.message || !challengeRes.nonce) {
      throw new Error(challengeRes.error || 'Failed to get wallet authentication challenge.');
    }

    // 2. Prompt user in MetaMask to sign the message via personal_sign (free, no gas)
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [challengeRes.message, cleanAddress],
    });

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
        if (typeof window !== 'undefined' && window.ethereum) {
          const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
          if (!accounts || !accounts[0]) {
            throw new Error('No account selected in MetaMask.');
          }
          addressToLink = accounts[0];
        } else {
          throw new Error('MetaMask is not installed. Please provide your Ethereum address.');
        }
      }

      const cleanAddress = addressToLink.trim().toLowerCase();

      // Sign the challenge nonce
      const { signature, nonce } = await requestSignatureFromWallet(cleanAddress);

      // Verify and link on backend
      const res = await linkWalletApi({ walletAddress: cleanAddress, signature, nonce }, token);
      if (!res.success) {
        throw new Error(res.error || 'Failed to link wallet.');
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
  const unlinkWallet = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await unlinkWalletApi(token);
      if (!res.success) {
        throw new Error(res.error || 'Failed to unlink wallet.');
      }

      updateUser({ walletAddress: null, wallet_address: null });

      if (Platform.OS === 'web') {
        alert('Wallet unlinked successfully.');
      } else {
        Alert.alert('Wallet Disconnected', 'Your wallet has been disconnected from your profile.');
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

    if (typeof window !== 'undefined' && window.ethereum) {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      const current = accounts && accounts[0] ? accounts[0].toLowerCase() : null;

      if (!current || current !== linkedWallet) {
        const short = `${linkedWallet.substring(0, 6)}...${linkedWallet.slice(-4)}`;
        const msg = `Please switch MetaMask to your linked wallet ${short}.`;
        if (Platform.OS === 'web') alert(msg); else Alert.alert('Wallet Mismatch', msg);
        return false;
      }

      const chain = await window.ethereum.request({ method: 'eth_chainId' });
      if (chain !== SEPOLIA_CHAIN_ID_HEX && chain !== '11155111') {
        const switched = await switchToSepolia();
        if (!switched) {
          const msg = 'Please switch your MetaMask network to the Ethereum Sepolia testnet to proceed.';
          if (Platform.OS === 'web') alert(msg); else Alert.alert('Network Switch Required', msg);
          return false;
        }
      }
    }

    return true;
  }, [linkedWallet, switchToSepolia]);

  return {
    linkedWallet,
    activeMetaMaskAccount,
    isMismatch,
    isSepolia,
    loading,
    error,
    linkWallet,
    unlinkWallet,
    switchToSepolia,
    verifyTransactionWallet,
    requestSignatureFromWallet,
  };
}

export default useLinkedWallet;
