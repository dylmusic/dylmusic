import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const PRICE = ethers.parseEther("0.0003");

async function buildDomainAndTypes(chainId: bigint, verifyingContract: string) {
  const domain = { name: "DylBurnClaimRedeemer", version: "1", chainId, verifyingContract };
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
  return { domain, types };
}

describe("BurnClaimRedeemer", () => {
  let admin: HardhatEthersSigner;
  let claimSigner: HardhatEthersSigner;
  let wallet: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let collection: any;
  let redeemer: any;
  let chainId: bigint;

  beforeEach(async () => {
    [admin, claimSigner, wallet, other] = await ethers.getSigners();

    const Collection = await ethers.getContractFactory("DylCollection");
    collection = await upgrades.deployProxy(
      Collection,
      ["Dyl", "Dyl", admin.address, PRICE, "https://dylmusic.vercel.app/api/metadata/robinhood/"],
      { kind: "uups", initializer: "initialize" }
    );
    await collection.waitForDeployment();

    const Redeemer = await ethers.getContractFactory("BurnClaimRedeemer");
    redeemer = await upgrades.deployProxy(Redeemer, [admin.address, claimSigner.address], {
      kind: "uups",
      initializer: "initialize",
    });
    await redeemer.waitForDeployment();

    await collection.connect(admin).setClaimMinter(await redeemer.getAddress(), true);
    chainId = (await ethers.provider.getNetwork()).chainId;
  });

  async function signVoucher(
    signer: HardhatEthersSigner,
    overrides: Partial<{
      wallet: string;
      collection: string;
      trackIds: bigint[];
      quantities: bigint[];
      claimId: string;
      expiry: bigint;
      chainId: bigint;
    }> = {}
  ) {
    const voucher = {
      wallet: wallet.address,
      collection: await collection.getAddress(),
      trackIds: [1n],
      quantities: [1n],
      claimId: ethers.keccak256(ethers.toUtf8Bytes(`claim-${Math.random()}`)),
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      chainId,
      ...overrides,
    };
    const { domain, types } = await buildDomainAndTypes(chainId, await redeemer.getAddress());
    const signature = await signer.signTypedData(domain, types, voucher);
    return { voucher, signature, domain, types };
  }

  it("initialize rejects a zero-address claimSigner", async () => {
    const Redeemer = await ethers.getContractFactory("BurnClaimRedeemer");
    await expect(
      upgrades.deployProxy(Redeemer, [admin.address, ethers.ZeroAddress], { kind: "uups", initializer: "initialize" })
    ).to.be.reverted;
  });

  it("claim mints to voucher.wallet, permissionless caller (someone else can submit on the wallet's behalf)", async () => {
    const { voucher, signature } = await signVoucher(claimSigner);
    await redeemer.connect(other).claim(voucher, signature); // other submits, wallet still receives
    expect(await collection.ownerOf(1 * 1000 + 1)).to.equal(wallet.address);
  });

  it("mints exactly the trackIds/quantities in the voucher, across multiple tracks", async () => {
    const { voucher, signature } = await signVoucher(claimSigner, {
      trackIds: [2n, 3n],
      quantities: [2n, 1n],
    });
    await redeemer.connect(wallet).claim(voucher, signature);
    expect(await collection.ownerOf(2 * 1000 + 1)).to.equal(wallet.address);
    expect(await collection.ownerOf(2 * 1000 + 2)).to.equal(wallet.address);
    expect(await collection.ownerOf(3 * 1000 + 1)).to.equal(wallet.address);
  });

  it("rejects a voucher signed by anyone other than claimSigner", async () => {
    const { voucher, signature } = await signVoucher(other); // wrong key
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "InvalidSignature"
    );
  });

  it("prevents replay — the same claimId can never be redeemed twice", async () => {
    const { voucher, signature } = await signVoucher(claimSigner);
    await redeemer.connect(wallet).claim(voucher, signature);
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "AlreadyClaimed"
    );
  });

  it("rejects an expired voucher", async () => {
    const { voucher, signature } = await signVoucher(claimSigner, {
      expiry: BigInt(Math.floor(Date.now() / 1000) - 10),
    });
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "VoucherExpired"
    );
  });

  it("rejects a voucher minted for the wrong chainId", async () => {
    const { voucher, signature } = await signVoucher(claimSigner, { chainId: chainId + 1n });
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "WrongChain"
    );
  });

  it("rejects mismatched trackIds/quantities array lengths", async () => {
    const { voucher, signature } = await signVoucher(claimSigner, { trackIds: [1n, 2n], quantities: [1n] });
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "LengthMismatch"
    );
  });

  it("a tampered voucher (different trackIds than what was signed) fails signature verification", async () => {
    const { voucher, signature } = await signVoucher(claimSigner);
    const tampered = { ...voucher, trackIds: [99n] };
    await expect(redeemer.connect(wallet).claim(tampered, signature)).to.be.revertedWithCustomError(
      redeemer,
      "InvalidSignature"
    );
  });

  it("pause blocks claim, unpause restores it — owner-only both ways", async () => {
    await expect(redeemer.connect(other).pause()).to.be.revertedWithCustomError(redeemer, "OwnableUnauthorizedAccount");

    await redeemer.connect(admin).pause();
    const { voucher, signature } = await signVoucher(claimSigner);
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      redeemer,
      "EnforcedPause"
    );

    await expect(redeemer.connect(other).unpause()).to.be.revertedWithCustomError(redeemer, "OwnableUnauthorizedAccount");
    await redeemer.connect(admin).unpause();
    await redeemer.connect(wallet).claim(voucher, signature); // works again
    expect(await collection.ownerOf(1 * 1000 + 1)).to.equal(wallet.address);
  });

  it("setClaimSigner is owner-only and immediately changes which key authorizes future claims", async () => {
    await expect(redeemer.connect(other).setClaimSigner(other.address)).to.be.revertedWithCustomError(
      redeemer,
      "OwnableUnauthorizedAccount"
    );

    await redeemer.connect(admin).setClaimSigner(other.address);
    expect(await redeemer.claimSigner()).to.equal(other.address);

    // a voucher signed by the OLD claimSigner no longer works
    const { voucher: oldVoucher, signature: oldSig } = await signVoucher(claimSigner);
    await expect(redeemer.connect(wallet).claim(oldVoucher, oldSig)).to.be.revertedWithCustomError(
      redeemer,
      "InvalidSignature"
    );

    // a voucher signed by the NEW claimSigner works
    const { voucher: newVoucher, signature: newSig } = await signVoucher(other);
    await redeemer.connect(wallet).claim(newVoucher, newSig);
    expect(await collection.ownerOf(1 * 1000 + 1)).to.equal(wallet.address);
  });

  it("claimDigest() matches ethers' own standard EIP-712 typed-data hash exactly", async () => {
    const { voucher, domain, types } = await signVoucher(claimSigner);
    const onChain = await redeemer.claimDigest(voucher);
    const offChain = ethers.TypedDataEncoder.hash(domain, types, voucher);
    expect(onChain).to.equal(offChain);
  });

  it("fails if the redeemer isn't (or is no longer) allowlisted on the collection", async () => {
    await collection.connect(admin).setClaimMinter(await redeemer.getAddress(), false);
    const { voucher, signature } = await signVoucher(claimSigner);
    await expect(redeemer.connect(wallet).claim(voucher, signature)).to.be.revertedWithCustomError(
      collection,
      "NotClaimMinter"
    );
  });

  describe("UUPS upgrade flow", () => {
    it("_authorizeUpgrade is owner-only", async () => {
      const redeemerAddress = await redeemer.getAddress();
      const Redeemer = await ethers.getContractFactory("BurnClaimRedeemer", other);
      await expect(upgrades.upgradeProxy(redeemerAddress, Redeemer, { kind: "uups" })).to.be.reverted;
    });
  });
});
