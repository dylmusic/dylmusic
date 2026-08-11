import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const PRICE = ethers.parseEther("0.0003");

describe("AlbumBuyer", () => {
  let admin: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let collection: any;
  let albumBuyer: any;

  beforeEach(async () => {
    [admin, buyer, other] = await ethers.getSigners();
    const Collection = await ethers.getContractFactory("DylCollection");
    collection = await upgrades.deployProxy(
      Collection,
      ["Dyl", "DYL", admin.address, PRICE, "https://dylmusic.vercel.app/api/metadata/robinhood/"],
      { kind: "uups", initializer: "initialize" }
    );
    await collection.waitForDeployment();

    const AlbumBuyer = await ethers.getContractFactory("AlbumBuyer");
    albumBuyer = await upgrades.deployProxy(AlbumBuyer, [admin.address], { kind: "uups", initializer: "initialize" });
    await albumBuyer.waitForDeployment();
  });

  it("mints across multiple non-sequential track ranges to the real buyer in one tx", async () => {
    const trackIds = [1, 2, 3];
    const quantities = [1, 2, 1];
    const totalValue = PRICE * 4n;

    await albumBuyer
      .connect(buyer)
      .batchMint(await collection.getAddress(), trackIds, quantities, buyer.address, { value: totalValue });

    expect(await collection.ownerOf(1 * 1000 + 1)).to.equal(buyer.address);
    expect(await collection.ownerOf(2 * 1000 + 1)).to.equal(buyer.address);
    expect(await collection.ownerOf(2 * 1000 + 2)).to.equal(buyer.address);
    expect(await collection.ownerOf(3 * 1000 + 1)).to.equal(buyer.address);
    // the wrapper itself should own nothing
    expect(await collection.balanceOf(await albumBuyer.getAddress())).to.equal(0);
  });

  it("splits value correctly per track (verified via emitted TrackMinted events)", async () => {
    const trackIds = [10, 11];
    const quantities = [3, 1];
    const tx = await albumBuyer
      .connect(buyer)
      .batchMint(await collection.getAddress(), trackIds, quantities, buyer.address, { value: PRICE * 4n });
    const receipt = await tx.wait();
    const events = receipt!.logs
      .map((l: any) => {
        try {
          return collection.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter((e: any) => e && e.name === "TrackMinted");
    expect(events.length).to.equal(2);
    expect(events[0]!.args.trackId).to.equal(10n);
    expect(events[0]!.args.firstEdition).to.equal(1n);
    expect(events[0]!.args.lastEdition).to.equal(3n);
    expect(events[1]!.args.trackId).to.equal(11n);
    expect(events[1]!.args.firstEdition).to.equal(1n);
    expect(events[1]!.args.lastEdition).to.equal(1n);
  });

  it("refunds any excess ETH sent beyond the real cost", async () => {
    const before = await ethers.provider.getBalance(buyer.address);
    const tx = await albumBuyer
      .connect(buyer)
      .batchMint(await collection.getAddress(), [1], [1], buyer.address, { value: PRICE * 5n });
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(buyer.address);
    // spent exactly PRICE*1 + gas, the other PRICE*4 refunded
    expect(before - after).to.equal(PRICE + gasCost);
  });

  it("reverts the ENTIRE purchase atomically if any single track's mint would fail", async () => {
    // pre-fill track 20 to 99 editions, leaving only 1 slot — request 2 in the batch
    await collection.connect(admin).adminMint(20, 10, admin.address);
    await collection.connect(buyer).mint(20, 89, buyer.address, { value: PRICE * 89n });
    expect(await collection.nextEditionIndex(20)).to.equal(99);

    const trackIds = [21, 20]; // track 21 would succeed alone, track 20 will fail (only 1 slot left, asking for 2)
    const quantities = [1, 2];
    await expect(
      albumBuyer
        .connect(buyer)
        .batchMint(await collection.getAddress(), trackIds, quantities, buyer.address, { value: PRICE * 3n })
    ).to.be.reverted;

    // track 21 must NOT have partially minted despite coming first in the loop
    expect(await collection.nextEditionIndex(21)).to.equal(0);
  });

  it("reverts on mismatched array lengths", async () => {
    await expect(
      albumBuyer.connect(buyer).batchMint(await collection.getAddress(), [1, 2], [1], buyer.address, {
        value: PRICE * 2n,
      })
    ).to.be.revertedWithCustomError(albumBuyer, "LengthMismatch");
  });

  describe("UUPS upgrade flow", () => {
    it("upgrades V1 -> V2, preserves owner, new function works", async () => {
      const albumBuyerAddress = await albumBuyer.getAddress();

      const V2 = await ethers.getContractFactory("AlbumBuyerV2Test");
      const upgraded = await upgrades.upgradeProxy(albumBuyerAddress, V2, { kind: "uups" });

      // same proxy address, state (owner) survived
      expect(await upgraded.getAddress()).to.equal(albumBuyerAddress);
      expect(await upgraded.owner()).to.equal(admin.address);

      // existing batchMint behavior still works post-upgrade
      await upgraded
        .connect(buyer)
        .batchMint(await collection.getAddress(), [5], [1], buyer.address, { value: PRICE });
      expect(await collection.ownerOf(5 * 1000 + 1)).to.equal(buyer.address);

      // new V2-only behavior works
      await upgraded.connect(admin).setUpgradeMarker("v2-live");
      expect(await upgraded.upgradeMarker()).to.equal("v2-live");
    });

    it("_authorizeUpgrade is owner-only", async () => {
      const albumBuyerAddress = await albumBuyer.getAddress();
      const V2 = await ethers.getContractFactory("AlbumBuyerV2Test", other);
      await expect(upgrades.upgradeProxy(albumBuyerAddress, V2, { kind: "uups" })).to.be.reverted;
    });
  });
});
