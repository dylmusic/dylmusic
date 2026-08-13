import { keccak256, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACT_TARGETS } from "./admin";

// Server-only by convention (only ever imported from app/api/ route
// handlers, same as lib/chatStore.ts/lib/siteListing.ts's own "server-only
// env var" pattern) — this codebase doesn't use the `server-only` package
// elsewhere, so it isn't introduced here either.

// Signs burn-claim vouchers server-side with a DEDICATED key — never the
// admin/deploy wallet (see onchain/contracts/BurnClaimRedeemer.sol's own
// doc comment on why that separation matters: this key's only power is
// authorizing free claim mints, so a leak can't touch price/withdraw/
// upgrade). BURN_CLAIM_SIGNER_PRIVATE_KEY is Vercel-only, server-only,
// generated once outside this codebase (never in the browser) — its
// PUBLIC address is what gets set on-chain via /admin's "Deploy Burn
// Redeemer" flow and stored in CONTRACT_TARGETS[chain].claimSignerAddress.
//
// The EIP-712 domain/types here MUST stay byte-for-byte identical to
// BurnClaimRedeemer.sol's own hand-rolled hashing (see that file's comment
// on why it avoids OZ's EIP712Upgradeable) — verified against
// ethers.TypedDataEncoder in onchain/scripts/dry-run-burn-claim-upgrade.ts
// before this was ever wired up server-side.

export interface ClaimVoucher {
  wallet: Address;
  collection: Address;
  trackIds: bigint[];
  quantities: bigint[];
  claimId: `0x${string}`;
  expiry: bigint;
  chainId: bigint;
}

const CLAIM_VOUCHER_TYPES = {
  ClaimVoucher: [
    { name: "wallet", type: "address" },
    { name: "collection", type: "address" },
    { name: "trackIds", type: "uint256[]" },
    { name: "quantities", type: "uint256[]" },
    { name: "claimId", type: "bytes32" },
    { name: "expiry", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

function getSignerAccount() {
  const pk = process.env.BURN_CLAIM_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error("BURN_CLAIM_SIGNER_PRIVATE_KEY is not configured.");
  return privateKeyToAccount(pk as `0x${string}`);
}

/** A fresh random claimId, unique per issued voucher — the on-chain replay guard's own key. */
export function newClaimId(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return keccak256(bytes);
}

/**
 * Signs a real EIP-712 voucher for `chainKey` (Robinhood Chain only today —
 * this reads CONTRACT_TARGETS[chainKey].burnClaimRedeemerAddress and
 * throws if that chain has no deployed redeemer yet, which naturally
 * blocks issuing vouchers for any chain not actually live).
 */
export async function signClaimVoucher(
  chainKey: "robinhood",
  voucher: ClaimVoucher
): Promise<{ signature: `0x${string}` }> {
  const target = CONTRACT_TARGETS.find((t) => t.key === chainKey);
  if (!target?.burnClaimRedeemerAddress || !target.chainId) {
    throw new Error(`No deployed BurnClaimRedeemer for "${chainKey}" yet.`);
  }

  // A LocalAccount signs typed data purely offline (no RPC/transport
  // needed) — signClaimVoucher deliberately never touches the network.
  const account = getSignerAccount();
  const signature = await account.signTypedData({
    domain: {
      name: "DylBurnClaimRedeemer",
      version: "1",
      chainId: target.chainId,
      verifyingContract: target.burnClaimRedeemerAddress as Address,
    },
    types: CLAIM_VOUCHER_TYPES,
    primaryType: "ClaimVoucher",
    message: voucher,
  });

  return { signature };
}

/** The dedicated signer's own public address — for a startup sanity check against CONTRACT_TARGETS[chain].claimSignerAddress, never logged/exposed beyond that. */
export function claimSignerAddress(): Address {
  return getSignerAccount().address;
}
