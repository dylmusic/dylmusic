// Validates the burn-and-mint upgrade against the REAL, LIVE deployed
// DylCollection proxy on Robinhood Chain (0x156D3422B0997032E7b8a0C16978f2283adCA570)
// on a Hardhat fork — not a fresh test deployment. This is the specific
// check the burn-and-mint plan calls out as the highest-risk step: does
// upgrading the actual already-deployed implementation to the new
// claimMinters/claimMint-carrying DylCollection pass @openzeppelin/
// hardhat-upgrades' storage-layout compatibility check, and does existing
// real state (already-minted tokens, current prices) survive intact.
//
// Zero real funds/risk — Hardhat's fork auto-funds local accounts, and
// hardhat_impersonateAccount lets this script act as the real admin
// wallet's owner privileges without ever touching its actual private key.
import { ethers, network, upgrades } from "hardhat";

const ADMIN_WALLET = "0x9e0149f7CC28c93A3B5F76AB3e8A2a22d14435b5"; // lib/admin.ts ADMIN_WALLET
const ROBINHOOD_RPC = "https://rpc.mainnet.chain.robinhood.com";
// lib/admin.ts CONTRACT_TARGETS["robinhood"].address — the real live proxy.
// Not imported directly: onchain/ is a separate TS project (own tsconfig,
// hardhat runtime) from the Next.js app lib/ lives in.
const REAL_PROXY_ADDRESS = "0x156D3422B0997032E7b8a0C16978f2283adCA570";

async function main() {
  console.log(`\n=== Robinhood Chain (forked from ${ROBINHOOD_RPC}) — REAL proxy ${REAL_PROXY_ADDRESS} ===`);

  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: ROBINHOOD_RPC } }],
  });
  await network.provider.request({
    method: "hardhat_setNextBlockBaseFeePerGas",
    params: ["0x3e8"], // negligible, same reasoning as dry-run.ts
  });
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [ADMIN_WALLET] });
  await network.provider.request({
    method: "hardhat_setBalance",
    params: [ADMIN_WALLET, "0x56BC75E2D63100000"], // 100 ETH, plenty for gas
  });
  // Mine one local block before any `call` (read) against the forked
  // contract — a `call` at the exact fork-tip block asks EDR to simulate
  // REMOTE historical state, which needs real hardfork-activation data for
  // chain 4663 that EDR doesn't ship built in. Once mined locally, reads
  // resolve against EDR's own local block, sidestepping that lookup
  // entirely (same reason dry-run.ts never hits this: its first action is
  // always a send/mine, never a bare read, before touching the fork).
  await network.provider.request({ method: "hardhat_mine", params: ["0x1"] });
  const admin = await ethers.getSigner(ADMIN_WALLET);
  // A real, regular Hardhat-funded local signer — NOT the impersonated
  // admin (impersonation lets EDR accept sends from that address without a
  // real key, but eth_signTypedData genuinely needs one, which an
  // impersonated account doesn't have). This also matches the real design
  // more faithfully: claimSigner is meant to be a dedicated key, never the
  // admin wallet.
  const [, buyer, claimSigner] = await ethers.getSigners();

  const CollectionNow = await ethers.getContractFactory("DylCollection");

  // Snapshot real pre-upgrade state to diff against after.
  const proxyBefore = CollectionNow.attach(REAL_PROXY_ADDRESS);
  const priceBefore = await proxyBefore.mintPriceWei();
  const nextEdTrack1Before = await proxyBefore.nextEditionIndex(1);
  const ownerBefore = await proxyBefore.owner();
  console.log(`  pre-upgrade: mintPriceWei=${priceBefore} nextEditionIndex(1)=${nextEdTrack1Before} owner=${ownerBefore}`);
  if (nextEdTrack1Before === 0n) {
    throw new Error("Expected real pre-existing minted state on track 1 — got 0. Fork may not be pointed at the real chain.");
  }

  // Registers the ALREADY-DEPLOYED proxy with hardhat-upgrades' local
  // manifest so it can compute a real storage-layout diff against the new
  // source, exactly as if this were the actual production upgrade.
  //
  // MUST forceImport using the contract exactly as it exists on-chain
  // TODAY (contracts/test/DylCollectionPreClaimSnapshot.sol — a byte-for-
  // byte copy of DylCollection.sol from `git show HEAD`, before this
  // session's claimMinters/claimMint edits, contract name renamed only so
  // it can coexist in the same build), never the already-edited current
  // source. Passing the NEW source here was a real bug caught while
  // building this script: forceImport doesn't verify the artifact you give
  // it against the real deployed bytecode — it just trusts you and records
  // it as a match. Do that with the new source and upgradeProxy concludes
  // "nothing changed, no upgrade needed" and silently skips deploying a
  // real new implementation, leaving the actual remote proxy still on the
  // OLD implementation — confirmed exactly this failure mode: every
  // pre-existing read (owner/price/nextEditionIndex) kept working
  // correctly (proxy still points at a real, valid, unchanged
  // implementation), but setClaimMinter reverted with completely empty
  // revert data — the unmistakable signature of hitting a selector with no
  // matching function on whatever's actually linked, not an
  // access-control revert (which would carry a decodable custom-error
  // selector).
  const CollectionSnapshot = await ethers.getContractFactory("DylCollectionPreClaimSnapshot");
  await upgrades.forceImport(REAL_PROXY_ADDRESS, CollectionSnapshot, { kind: "uups" });

  const upgraded = await upgrades.upgradeProxy(REAL_PROXY_ADDRESS, CollectionNow.connect(admin), { kind: "uups" });
  await upgraded.waitForDeployment();
  console.log("  ✓ storage-layout check passed, upgradeToAndCall succeeded on the real forked proxy");

  // Real state survived, byte for byte.
  if ((await upgraded.getAddress()) !== REAL_PROXY_ADDRESS) throw new Error("proxy address changed across upgrade");
  if ((await upgraded.mintPriceWei()) !== priceBefore) throw new Error("mintPriceWei changed across upgrade");
  if ((await upgraded.nextEditionIndex(1)) !== nextEdTrack1Before) throw new Error("nextEditionIndex(1) changed across upgrade");
  if ((await upgraded.owner()) !== ownerBefore) throw new Error("owner changed across upgrade");
  console.log("  ✓ real pre-existing state (price, minted editions, owner) survived unchanged");

  // New claimMint surface, exercised against REAL existing track state.
  const BurnClaimRedeemer = await ethers.getContractFactory("BurnClaimRedeemer");
  const redeemer = await upgrades.deployProxy(BurnClaimRedeemer, [admin.address, claimSigner.address], {
    kind: "uups",
    initializer: "initialize",
  });
  await redeemer.waitForDeployment();
  const redeemerAddress = await redeemer.getAddress();
  console.log(`  ✓ BurnClaimRedeemer deployed fresh: ${redeemerAddress}`);

  await (await upgraded.connect(admin).setClaimMinter(redeemerAddress, true)).wait();
  console.log("  ✓ granted claimMinters[redeemer] = true on the real (upgraded) collection");

  await expectRevert(upgraded.connect(buyer).claimMint(1, 1, buyer.address), "NotClaimMinter", "raw EOA cannot call claimMint directly");

  const claimedFromEdition = await upgraded.nextEditionIndex(1); // continues from real live count, not 0
  const trackIds = [1n];
  const quantities = [1n];
  const claimId = ethers.keccak256(ethers.toUtf8Bytes("dry-run-claim-1"));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const voucher = { wallet: buyer.address, collection: REAL_PROXY_ADDRESS, trackIds, quantities, claimId, expiry, chainId };
  const domain = { name: "DylBurnClaimRedeemer", version: "1", chainId, verifyingContract: redeemerAddress };
  const types = {
    ClaimVoucher: [
      { name: "wallet", type: "address" },
      { name: "collection", type: "address" },
      { name: "trackIds", type: "uint256[]" },
      { name: "quantities", type: "uint256[]" },
      { name: "claimId", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "chainId", type: "uint256" },
    ],
  };
  const signature = await claimSigner.signTypedData(domain, types, voucher);

  // On-chain digest must match ethers' own off-chain typed-data hash —
  // proves the hand-rolled EIP-712 implementation (see BurnClaimRedeemer.sol's
  // comment on why it avoids OZ's EIP712Upgradeable) is byte-identical to
  // the real standard, not just "close enough."
  const onChainDigest = await redeemer.claimDigest(voucher);
  const offChainDigest = ethers.TypedDataEncoder.hash(domain, types, voucher);
  if (onChainDigest !== offChainDigest) throw new Error(`EIP-712 digest mismatch: onchain=${onChainDigest} offchain=${offChainDigest}`);
  console.log("  ✓ on-chain EIP-712 digest matches ethers' own standard typed-data hash exactly");

  await (await redeemer.connect(buyer).claim(voucher, signature)).wait(); // permissionless caller check: buyer submits their own
  const mintedTokenId = 1n * 1000n + claimedFromEdition + 1n;
  if ((await upgraded.ownerOf(mintedTokenId)) !== buyer.address) throw new Error("claim: wrong recipient/tokenId");
  console.log(`  ✓ real claim succeeded — tokenId ${mintedTokenId} minted to buyer, continuing from real live edition count`);

  await expectRevert(redeemer.connect(buyer).claim(voucher, signature), "AlreadyClaimed", "replay of the same claimId");

  const badVoucher = { ...voucher, claimId: ethers.keccak256(ethers.toUtf8Bytes("dry-run-claim-2")) };
  const badSig = await buyer.signTypedData(domain, types, badVoucher); // signed by the WRONG key (buyer, not claimSigner)
  await expectRevert(redeemer.connect(buyer).claim(badVoucher, badSig), "InvalidSignature", "voucher signed by a non-claimSigner key");

  const expiredVoucher = { ...voucher, claimId: ethers.keccak256(ethers.toUtf8Bytes("dry-run-claim-3")), expiry: BigInt(Math.floor(Date.now() / 1000) - 10) };
  const expiredSig = await claimSigner.signTypedData(domain, types, expiredVoucher);
  await expectRevert(redeemer.connect(buyer).claim(expiredVoucher, expiredSig), "VoucherExpired", "an expired voucher");

  await (await redeemer.connect(admin).pause()).wait();
  const pausedVoucher = { ...voucher, claimId: ethers.keccak256(ethers.toUtf8Bytes("dry-run-claim-4")) };
  const pausedSig = await claimSigner.signTypedData(domain, types, pausedVoucher);
  await expectRevert(redeemer.connect(buyer).claim(pausedVoucher, pausedSig), "EnforcedPause", "claim() while paused");
  await (await redeemer.connect(admin).unpause()).wait();
  console.log("  ✓ replay / bad-signer / expiry / pause protections all confirmed on the real forked chain");

  console.log("\n=== Robinhood Chain burn-claim upgrade dry run: ALL CHECKS PASSED ===");
}

async function expectRevert(promise: Promise<unknown>, errorName: string, label: string) {
  try {
    await promise;
    throw new Error(`Expected revert (${errorName}) for: ${label} — but it succeeded`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!msg.includes(errorName)) throw new Error(`Expected revert reason "${errorName}" for: ${label} — got: ${msg}`);
    console.log(`  ✓ correctly reverted (${errorName}): ${label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
