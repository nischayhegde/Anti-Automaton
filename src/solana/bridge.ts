/**
 * Wormhole Bridge: Solana → Base
 *
 * Bridges USDC from Solana to Base using the Wormhole SDK v4
 * with Circle CCTP (native USDC bridging) and automatic relaying.
 */

import type { Keypair } from "@solana/web3.js";
import type { PrivateKeyAccount } from "viem";

export interface BridgeResult {
  success: boolean;
  amount: number;
  sourceTx?: string;
  destinationTx?: string;
  error?: string;
  status: "pending" | "completed" | "failed";
}

// Wormhole relayer fees make smaller amounts uneconomical
const MIN_BRIDGE_AMOUNT_USDC = 1.0;

/**
 * Bridge USDC from Solana to Base via Wormhole CCTP (Circle's native bridge).
 *
 * Uses automatic relaying so the agent does not need to manually
 * redeem on Base. The relayer handles the destination-side completion.
 * Funds typically arrive within 5-20 minutes.
 */
export async function bridgeUsdcToBase(
  solanaKeypair: Keypair,
  evmAccount: PrivateKeyAccount,
  usdcAmount: number,
): Promise<BridgeResult> {
  if (usdcAmount < MIN_BRIDGE_AMOUNT_USDC) {
    return {
      success: false,
      amount: 0,
      error: `Amount ${usdcAmount} below minimum ${MIN_BRIDGE_AMOUNT_USDC} USDC`,
      status: "failed",
    };
  }

  try {
    // Dynamic import to keep startup lean — only loaded when bridging
    const sdk = await import("@wormhole-foundation/sdk");
    const { getSolanaSignAndSendSigner } = await import("@wormhole-foundation/sdk-solana");
    const { getEvmSigner } = await import("@wormhole-foundation/sdk-evm");

    // Initialize Wormhole context for Mainnet
    // Platform loaders are functions that return PlatformDefinitions
    const wh = await sdk.wormhole("Mainnet", [
      () => import("@wormhole-foundation/sdk-solana") as any,
      () => import("@wormhole-foundation/sdk-evm") as any,
    ]);

    // Get chain contexts
    const solanaChain = wh.getChain("Solana");
    const baseChain = wh.getChain("Base");

    // Create signers
    const solanaSigner = await getSolanaSignAndSendSigner(
      await solanaChain.getRpc() as any,
      solanaKeypair,
    );
    const evmSigner = await getEvmSigner(
      await baseChain.getRpc() as any,
      evmAccount.address,
    );

    // USDC amount in atomic units (6 decimals)
    const amount = BigInt(Math.floor(usdcAmount * 1_000_000));

    // Build source and destination chain addresses
    const from = sdk.Wormhole.chainAddress("Solana", solanaSigner.address());
    const to = sdk.Wormhole.chainAddress("Base", evmSigner.address());

    // Use CCTP (Circle Transfer) for native USDC bridging
    const xfer = await wh.circleTransfer(
      amount,
      from,
      to,
      true, // automatic = use relayer for redemption
    );

    // Initiate the transfer on Solana
    const srcTxids = await xfer.initiateTransfer(solanaSigner as any);

    // Wait for Circle attestation
    await xfer.fetchAttestation(120_000);

    // Try to complete on Base (relayer may handle this automatically)
    let destTxids: string[] = [];
    try {
      destTxids = await xfer.completeTransfer(evmSigner as any);
    } catch {
      // Automatic relayer likely already completed it — funds will arrive
    }

    return {
      success: true,
      amount: usdcAmount,
      sourceTx: srcTxids[0] || undefined,
      destinationTx: destTxids[0] || undefined,
      status: destTxids.length > 0 ? "completed" : "pending",
    };
  } catch (err: any) {
    return {
      success: false,
      amount: 0,
      error: err.message,
      status: "failed",
    };
  }
}
