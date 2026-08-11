// Full deploy -> upgrade -> mint -> albumBuy -> tokenURI cycle, run against a
// local Hardhat network forked from each chain's REAL, live mainnet RPC —
// real deployed bytecode against real current chain state, but using
// Hardhat's own auto-funded local test accounts (never real funds, never a
// real testnet faucet). See onchain/hardhat.config.ts for why this replaces
// the original real-testnet plan (faucets are CAPTCHA/wallet-gated, not
// reliably scriptable here).
import { ethers, network, upgrades } from "hardhat";

interface ChainTarget {
  label: string;
  chainSlug: string;
  forkUrl: string;
}

const TARGETS: ChainTarget[] = [
  { label: "Robinhood Chain", chainSlug: "robinhood", forkUrl: "https://rpc.mainnet.chain.robinhood.com" },
  { label: "Base", chainSlug: "base", forkUrl: "https://mainnet.base.org" },
  { label: "Ethereum", chainSlug: "ethereum", forkUrl: "https://ethereum-rpc.publicnode.com" },
];

const PRICE = ethers.parseEther("0.0003");

async function runOne(target: ChainTarget) {
  console.log(`\n=== ${target.label} (forked from ${target.forkUrl}) ===`);

  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: target.forkUrl } }],
  });
  // Once forked, this local network mines its OWN blocks from that snapshot,
  // but ethers still estimates maxFeePerGas from the forked chain's stale
  // historical fee data — pinning the NEXT block's base fee to something
  // negligible (not a "realistic" value, deliberately near-zero) guarantees
  // it can never exceed whatever ethers independently estimates, however
  // stale. Hit this for real: Ethereum mainnet's base fee moved between
  // snapshot and submission on two different runs, unrelated to any
  // contract change, and an earlier attempt pinning a "realistic" 2 gwei
  // base fee still occasionally exceeded ethers' own lower estimate.
  await network.provider.request({
    method: "hardhat_setNextBlockBaseFeePerGas",
    params: ["0x3e8"], // 1000 wei — negligible, never the binding constraint
  });

  const [admin, buyer] = await ethers.getSigners();
  console.log(`admin=${admin.address} buyer=${buyer.address}`);

  // 1. Deploy implementation
  const Collection = await ethers.getContractFactory("DylCollection");
  const proxy = await upgrades.deployProxy(
    Collection,
    ["Dyl", "Dyl", admin.address, PRICE, `https://dylmusic.vercel.app/api/metadata/${target.chainSlug}/`],
    { kind: "uups", initializer: "initialize" }
  );
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log(`✓ proxy deployed: ${proxyAddress}`);

  // 2. adminMint editions 1-10 for trackId 1
  await (await proxy.connect(admin).adminMint(1, 10, admin.address)).wait();
  const owner1001 = await proxy.ownerOf(1001);
  if (owner1001 !== admin.address) throw new Error("adminMint: wrong owner");
  console.log(`✓ adminMint editions 1-10 for track 1 -> admin (tokenId 1001 owner correct)`);

  // 3. public mint edition 11 for trackId 1
  await (await proxy.connect(buyer).mint(1, 1, buyer.address, { value: PRICE })).wait();
  const owner1011 = await proxy.ownerOf(1011);
  if (owner1011 !== buyer.address) throw new Error("public mint: wrong owner/tokenId math");
  console.log(`✓ public mint edition 11 -> buyer (tokenId 1011 owner correct)`);

  // 4. deploy AlbumBuyer proxy, batch mint across tracks 2 and 3
  const AlbumBuyer = await ethers.getContractFactory("AlbumBuyer");
  const albumBuyer = await upgrades.deployProxy(AlbumBuyer, [admin.address], {
    kind: "uups",
    initializer: "initialize",
  });
  await albumBuyer.waitForDeployment();
  const albumBuyerAddress = await albumBuyer.getAddress();
  await (
    await albumBuyer.connect(buyer).batchMint(proxyAddress, [2, 3], [1, 1], buyer.address, { value: PRICE * 2n })
  ).wait();
  if ((await proxy.ownerOf(2001)) !== buyer.address || (await proxy.ownerOf(3001)) !== buyer.address) {
    throw new Error("AlbumBuyer: wrong recipient");
  }
  console.log(`✓ AlbumBuyer proxy (${albumBuyerAddress}) minted tracks 2+3 to buyer in one tx`);

  // 4b. real UUPS upgrade against the live-forked AlbumBuyer proxy
  const AlbumBuyerV2 = await ethers.getContractFactory("AlbumBuyerV2Test");
  const upgradedAlbumBuyer = await upgrades.upgradeProxy(albumBuyerAddress, AlbumBuyerV2, { kind: "uups" });
  if ((await upgradedAlbumBuyer.getAddress()) !== albumBuyerAddress) {
    throw new Error("AlbumBuyer upgrade: proxy address changed");
  }
  await (await upgradedAlbumBuyer.connect(admin).setUpgradeMarker("dry-run-ok")).wait();
  console.log(`✓ AlbumBuyer upgraded to V2, new function works`);

  // 5. tokenURI shape check
  const uri1001 = await proxy.tokenURI(1001);
  const expected = `https://dylmusic.vercel.app/api/metadata/${target.chainSlug}/1001`;
  if (uri1001 !== expected) throw new Error(`tokenURI mismatch: got ${uri1001}, want ${expected}`);
  console.log(`✓ tokenURI(1001) = ${uri1001}`);

  // 6. real UUPS upgrade against the live-forked proxy
  const V2 = await ethers.getContractFactory("DylCollectionV2Test");
  const upgraded = await upgrades.upgradeProxy(proxyAddress, V2, { kind: "uups" });
  if ((await upgraded.getAddress()) !== proxyAddress) throw new Error("upgrade: proxy address changed");
  if ((await upgraded.ownerOf(1011)) !== buyer.address) throw new Error("upgrade: state lost");
  await (await upgraded.connect(admin).setUpgradeMarker("dry-run-ok")).wait();
  console.log(`✓ upgraded to V2, state preserved, new function works`);

  console.log(`=== ${target.label}: ALL CHECKS PASSED ===`);
}

async function main() {
  for (const target of TARGETS) {
    await runOne(target);
  }
  console.log("\nAll chains passed the full dry run.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
