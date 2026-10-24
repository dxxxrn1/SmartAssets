// ─── mobileWalletService.js ──────────────────────────────────────────────────
// React Native (Expo) Mobile Wallet Provider for MetaMask on iOS, Android & Web.
// Uses @metamask/sdk with deep-linking & return-scheme ('smartassets://'),
// integrated with Ethers.js v6 for EIP-191 personal_sign and Sepolia on-chain transactions.
// NO window.ethereum reliance on mobile.

import { Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'; // 11155111
export const SEPOLIA_CHAIN_ID_DEC = 11155111;

let sdkInstance = null;
let providerInstance = null;
let isInitializing = false;

// ── Check if MetaMask is installed ──────────────────────────────────────────
export async function isMetaMaskAppInstalled() {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && Boolean(window.ethereum);
  }

  try {
    const canOpen = await Linking.canOpenURL('metamask://');
    return Boolean(canOpen);
  } catch (err) {
    console.warn('[mobileWalletService] Error checking metamask:// scheme:', err.message);
    // On Android 11+, canOpenURL might return false if queries are not declared,
    // but the SDK can still attempt connection. Default to checking SDK.
    return false;
  }
}

// ── Open Official MetaMask Store Page ───────────────────────────────────────
export async function openMetaMaskStore() {
  const storeUrl =
    Platform.OS === 'ios'
      ? 'https://apps.apple.com/app/metamask/id1438144201'
      : 'https://play.google.com/store/apps/details?id=io.metamask';

  try {
    const supported = await Linking.canOpenURL(storeUrl);
    if (supported) {
      await Linking.openURL(storeUrl);
    } else {
      await Linking.openURL('https://metamask.io/download/');
    }
  } catch (err) {
    console.error('[mobileWalletService] Failed to open app store:', err);
    await Linking.openURL('https://metamask.io/download/');
  }
}

// ── Initialize MetaMask SDK Provider ────────────────────────────────────────
export async function getMobileEthereumProvider() {
  if (providerInstance) {
    return providerInstance;
  }

  // If in web browser, use injected window.ethereum
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.ethereum) {
      providerInstance = window.ethereum;
      return providerInstance;
    }
    return null;
  }

  // On Native Mobile: Initialize @metamask/sdk with Expo deep linking
  try {
    const { MetaMaskSDK } = require('@metamask/sdk');

    sdkInstance = new MetaMaskSDK({
      dappMetadata: {
        name: 'SmartAssets',
        url: 'https://smartassets.io',
        scheme: 'smartassets',
        iconUrl: 'https://smartassets.io/icon.png',
      },
      openDeeplink: (link) => {
        try {
          Linking.openURL(link);
        } catch (linkErr) {
          console.warn('[mobileWalletService] openDeeplink error:', linkErr.message);
        }
      },
      storage: {
        enabled: true,
      },
      checkInstallationImmediately: false,
    });

    providerInstance = sdkInstance.getProvider();
    return providerInstance;
  } catch (sdkError) {
    console.warn('[mobileWalletService] @metamask/sdk load warning:', sdkError.message);

    // Fallback: Custom lightweight EIP-1193 bridge using native deep links
    providerInstance = createDeepLinkFallbackProvider();
    return providerInstance;
  }
}

// ── Fallback Provider via Native Deep-Linking ───────────────────────────────
function createDeepLinkFallbackProvider() {
  const listeners = new Map();

  return {
    isMetaMask: true,
    async request(payload) {
      const method = payload ? payload.method : null;
      const params = payload && payload.params ? payload.params : [];
      console.log(`[mobileWalletService:fallback] Requesting ${method}`, params);

      if (method === 'eth_requestAccounts' || method === 'eth_accounts') {
        const canOpen = await Linking.canOpenURL('metamask://');
        if (!canOpen) {
          throw new Error('METAMASK_NOT_INSTALLED');
        }
        await Linking.openURL('metamask://dapp/smartassets.io');
        throw new Error('Please return to SmartAssets after approving in MetaMask.');
      }

      if (method === 'personal_sign') {
        await Linking.openURL('metamask://');
        throw new Error('Please approve the signature in your MetaMask mobile app.');
      }

      return null;
    },
    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeListener: (event, handler) => {
      if (!listeners.has(event)) return;
      const list = listeners.get(event).filter((h) => h !== handler);
      listeners.set(event, list);
    },
  };
}

// ── Connect Wallet (eth_requestAccounts) ────────────────────────────────────
export async function connectMobileWallet() {
  const provider = await getMobileEthereumProvider();
  if (!provider) {
    throw new Error('METAMASK_NOT_INSTALLED');
  }

  try {
    let accounts;
    if (sdkInstance && typeof sdkInstance.connect === 'function' && Platform.OS !== 'web') {
      accounts = await sdkInstance.connect();
    } else {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    }

    if (!accounts || !accounts[0]) {
      throw new Error('No account was returned by MetaMask.');
    }

    return accounts[0].toLowerCase();
  } catch (err) {
    if (
      err?.message?.includes('METAMASK_NOT_INSTALLED') ||
      err?.message?.toLowerCase().includes('not installed')
    ) {
      throw new Error('METAMASK_NOT_INSTALLED');
    }
    if (err?.code === 4001 || err?.message?.toLowerCase().includes('reject') || err?.message?.toLowerCase().includes('cancel')) {
      throw new Error('Connection request was cancelled in MetaMask.');
    }
    throw err;
  }
}

// ── Sign Personal Message (EIP-191 Cryptographic Challenge) ─────────────────
export async function signPersonalMessage(challengeMessage, targetAddress) {
  const provider = await getMobileEthereumProvider();
  if (!provider) {
    throw new Error('METAMASK_NOT_INSTALLED');
  }

  const cleanAddress = targetAddress.toLowerCase();

  try {
    const signature = await provider.request({
      method: 'personal_sign',
      params: [challengeMessage, cleanAddress],
    });

    if (!signature || typeof signature !== 'string') {
      throw new Error('Failed to retrieve cryptographic signature from MetaMask.');
    }

    return signature;
  } catch (err) {
    if (err?.code === 4001 || err?.message?.toLowerCase().includes('reject') || err?.message?.toLowerCase().includes('cancel')) {
      throw new Error('Signature was cancelled in MetaMask.');
    }
    throw err;
  }
}

// ── Switch Network to Sepolia Testnet ───────────────────────────────────────
export async function switchChainToSepolia() {
  const provider = await getMobileEthereumProvider();
  if (!provider) return false;

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
    });
    return true;
  } catch (switchError) {
    // 4902: Unrecognized chain, request user to add Sepolia
    if (switchError.code === 4902) {
      try {
        await provider.request({
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
        return true;
      } catch (_) {
        return false;
      }
    }
    return false;
  }
}

// ── Get Active Accounts & Chain ─────────────────────────────────────────────
export async function getActiveWalletAccount() {
  const provider = await getMobileEthereumProvider();
  if (!provider) return null;

  try {
    const accounts = await provider.request({ method: 'eth_accounts' });
    return accounts && accounts[0] ? accounts[0].toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

export async function getActiveChainId() {
  const provider = await getMobileEthereumProvider();
  if (!provider) return null;

  try {
    return await provider.request({ method: 'eth_chainId' });
  } catch (_) {
    return null;
  }
}

// ── Ethers.js v6 Integration Helpers ─────────────────────────────────────────
export async function getEthersBrowserProvider() {
  const provider = await getMobileEthereumProvider();
  if (!provider) return null;

  try {
    const { BrowserProvider } = require('ethers');
    return new BrowserProvider(provider);
  } catch (err) {
    console.warn('[mobileWalletService] Ethers BrowserProvider initialization warning:', err.message);
    return null;
  }
}

export async function getEthersSigner() {
  const browserProvider = await getEthersBrowserProvider();
  if (!browserProvider) return null;

  try {
    return await browserProvider.getSigner();
  } catch (err) {
    console.warn('[mobileWalletService] Ethers getSigner warning:', err.message);
    return null;
  }
}
