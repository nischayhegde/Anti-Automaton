/**
 * Auto-Bridge Pipeline
 *
 * Orchestrates the full Solana → Base funding flow:
 * 1. Swap SOL to USDC-SPL via Jupiter (if SOL detected)
 * 2. Bridge USDC-SPL to Base via Wormhole (if USDC-SPL available)
 */

import type { AutomatonDatabase } from "../types.js";
import { loadSolanaKeypair, getSolanaAddress } from "../identity/solana-wallet.js";
import { loadWalletAccount } from "../identity/wallet.js";
import { getSolBalance, getSolanaUsdcBalance } from "./balance.js";
import { swapSolToUsdc } from "./swap.js";
import { bridgeUsdcToBase } from "./bridge.js";

const MIN_SOL_TO_SWAP = 0.05;
const MIN_USDC_TO_BRIDGE = 1.0;

export interface AutoBridgeResult {
  swapped: boolean;
  swapAmount?: number;
  bridged: boolean;
  bridgeAmount?: number;
  error?: string;
}

/**
 * Execute the full auto-bridge pipeline.
 * Called by the check_solana_balance heartbeat task when funds are detected.
 */
export async function executeAutoBridge(
  db: AutomatonDatabase,
): Promise<AutoBridgeResult> {
  const solanaKeypair = loadSolanaKeypair();
  const evmAccount = loadWalletAccount();
  const solanaAddress = getSolanaAddress();

  if (!solanaKeypair || !evmAccount || !solanaAddress) {
    return { swapped: false, bridged: false, error: "Wallets not configured" };
  }

  // Mark bridge as pending to prevent duplicate runs
  db.setKV("solana_bridge_pending", JSON.stringify({
    timestamp: new Date().toISOString(),
  }));

  let swapped = false;
  let swapAmount = 0;

  try {
    // Step 1: Swap SOL to USDC if sufficient SOL balance
    const solBalance = await getSolBalance(solanaAddress);
    if (solBalance > MIN_SOL_TO_SWAP) {
      const swapResult = await swapSolToUsdc(solanaKeypair, solBalance);
      if (swapResult.success) {
        swapped = true;
        swapAmount = swapResult.outputAmount;
        db.setKV("last_sol_swap", JSON.stringify({
          ...swapResult,
          timestamp: new Date().toISOString(),
        }));
      } else {
        db.setKV("last_sol_swap_error", JSON.stringify({
          error: swapResult.error,
          timestamp: new Date().toISOString(),
        }));
      }
    }

    // Step 2: Bridge all USDC-SPL to Base
    const usdcBalance = await getSolanaUsdcBalance(solanaAddress);
    if (usdcBalance >= MIN_USDC_TO_BRIDGE) {
      const bridgeResult = await bridgeUsdcToBase(
        solanaKeypair,
        evmAccount,
        usdcBalance,
      );

      db.setKV("last_bridge_attempt", JSON.stringify({
        ...bridgeResult,
        timestamp: new Date().toISOString(),
      }));

      if (bridgeResult.success) {
        db.deleteKV("solana_bridge_pending");
        return {
          swapped,
          swapAmount,
          bridged: true,
          bridgeAmount: bridgeResult.amount,
        };
      } else {
        db.deleteKV("solana_bridge_pending");
        return {
          swapped,
          swapAmount,
          bridged: false,
          error: `Bridge failed: ${bridgeResult.error}`,
        };
      }
    }

    db.deleteKV("solana_bridge_pending");
    return { swapped, swapAmount, bridged: false };
  } catch (err: any) {
    db.deleteKV("solana_bridge_pending");
    return { swapped: false, bridged: false, error: err.message };
  }
}
