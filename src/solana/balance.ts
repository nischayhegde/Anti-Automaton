/**
 * Solana Balance Queries
 *
 * Checks SOL and USDC-SPL balances on the automaton's Solana wallet.
 */

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

// USDC-SPL mint address on Solana mainnet
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("mainnet-beta");

export function getSolanaConnection(): Connection {
  return new Connection(SOLANA_RPC_URL, "confirmed");
}

/**
 * Get native SOL balance in SOL (not lamports).
 */
export async function getSolBalance(address: string): Promise<number> {
  try {
    const connection = getSolanaConnection();
    const pubkey = new PublicKey(address);
    const lamports = await connection.getBalance(pubkey);
    return lamports / 1e9;
  } catch {
    return 0;
  }
}

/**
 * Get USDC-SPL balance in USDC units (6 decimals).
 */
export async function getSolanaUsdcBalance(address: string): Promise<number> {
  try {
    const connection = getSolanaConnection();
    const owner = new PublicKey(address);
    const ata = await getAssociatedTokenAddress(USDC_MINT, owner);
    const accountInfo = await connection.getTokenAccountBalance(ata);
    return Number(accountInfo.value.uiAmount || 0);
  } catch {
    return 0;
  }
}
