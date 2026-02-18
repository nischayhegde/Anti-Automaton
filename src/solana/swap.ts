/**
 * SOL → USDC Swap via Jupiter
 *
 * Swaps native SOL to USDC-SPL using the Jupiter V6 Aggregator REST API.
 * This prepares funds for bridging to Base via Wormhole.
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getSolanaConnection } from "./balance.js";

const JUPITER_API = "https://quote-api.jup.ag/v6";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Reserve SOL for rent exemption + transaction fees
const SOL_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL

export interface SwapResult {
  success: boolean;
  inputAmount: number;   // SOL spent
  outputAmount: number;  // USDC received
  txSignature?: string;
  error?: string;
}

/**
 * Swap SOL to USDC-SPL via Jupiter.
 * Leaves SOL_RESERVE for rent/transaction fees.
 */
export async function swapSolToUsdc(
  keypair: Keypair,
  solAmount: number,
): Promise<SwapResult> {
  try {
    const lamports = Math.floor(solAmount * 1e9);
    if (lamports <= SOL_RESERVE_LAMPORTS) {
      return {
        success: false,
        inputAmount: 0,
        outputAmount: 0,
        error: "Amount too small after fee reserve",
      };
    }
    const swapLamports = lamports - SOL_RESERVE_LAMPORTS;

    // 1. Get quote
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=${swapLamports}&slippageBps=50`;
    const quoteResp = await fetch(quoteUrl);
    if (!quoteResp.ok) {
      return {
        success: false,
        inputAmount: 0,
        outputAmount: 0,
        error: `Quote failed: ${quoteResp.status}`,
      };
    }
    const quote = await quoteResp.json();

    // 2. Get swap transaction
    const swapResp = await fetch(`${JUPITER_API}/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
      }),
    });
    if (!swapResp.ok) {
      return {
        success: false,
        inputAmount: 0,
        outputAmount: 0,
        error: `Swap tx build failed: ${swapResp.status}`,
      };
    }
    const { swapTransaction } = await swapResp.json();

    // 3. Deserialize, sign, send
    const connection = getSolanaConnection();
    const txBuf = Buffer.from(swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([keypair]);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(signature, "confirmed");

    const outputUsdc = Number(quote.outAmount) / 1e6;
    return {
      success: true,
      inputAmount: swapLamports / 1e9,
      outputAmount: outputUsdc,
      txSignature: signature,
    };
  } catch (err: any) {
    return {
      success: false,
      inputAmount: 0,
      outputAmount: 0,
      error: err.message,
    };
  }
}
