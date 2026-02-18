/**
 * Solana Wallet Management
 *
 * Creates and manages a Solana keypair for the automaton's funding on-ramp.
 * SOL or USDC-SPL sent to this address will be auto-bridged to Base.
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import type { SolanaWalletData } from "../types.js";
import { getAutomatonDir } from "./wallet.js";

const SOLANA_WALLET_FILE = path.join(getAutomatonDir(), "solana-wallet.json");

/**
 * Get or create the automaton's Solana wallet.
 * Used as a funding on-ramp — funds are bridged to Base automatically.
 */
export async function getSolanaWallet(): Promise<{
  keypair: Keypair;
  isNew: boolean;
}> {
  const dir = getAutomatonDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(SOLANA_WALLET_FILE)) {
    const data: SolanaWalletData = JSON.parse(
      fs.readFileSync(SOLANA_WALLET_FILE, "utf-8"),
    );
    const keypair = Keypair.fromSecretKey(bs58.decode(data.secretKey));
    return { keypair, isNew: false };
  }

  const keypair = Keypair.generate();
  const data: SolanaWalletData = {
    secretKey: bs58.encode(Buffer.from(keypair.secretKey)),
    publicKey: keypair.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(SOLANA_WALLET_FILE, JSON.stringify(data, null, 2), {
    mode: 0o600,
  });

  return { keypair, isNew: true };
}

/**
 * Get the Solana wallet address without loading the full keypair.
 */
export function getSolanaAddress(): string | null {
  if (!fs.existsSync(SOLANA_WALLET_FILE)) {
    return null;
  }

  const data: SolanaWalletData = JSON.parse(
    fs.readFileSync(SOLANA_WALLET_FILE, "utf-8"),
  );
  return data.publicKey;
}

/**
 * Load the full Solana keypair (needed for signing swaps and bridges).
 */
export function loadSolanaKeypair(): Keypair | null {
  if (!fs.existsSync(SOLANA_WALLET_FILE)) {
    return null;
  }

  const data: SolanaWalletData = JSON.parse(
    fs.readFileSync(SOLANA_WALLET_FILE, "utf-8"),
  );
  return Keypair.fromSecretKey(bs58.decode(data.secretKey));
}

export function solanaWalletExists(): boolean {
  return fs.existsSync(SOLANA_WALLET_FILE);
}
