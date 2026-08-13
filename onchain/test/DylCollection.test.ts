import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const NAME = "Dyl";
const SYMBOL = "Dyl";
const PRICE = ethers.parseEther("0.0003");
const BASE_URI = "https://dylmusic.vercel.app/api/metadata/robinhood/";

describe("DylCollection", () => {
  let admin: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let other: HardhatEthersSigner;
  let proxy: any;

  beforeEach(async () => {
    [admin, buyer, other] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("DylCollection");
    proxy = await upgrades.deployProxy(Factory, [NAME, SYMBOL, admin.address, PRICE, BASE_URI], {
      kind: "uups",
      initializer: "initialize",
    });
    await proxy.waitForDeployment();
  });

  it("sets name/symbol/owner/price/baseURI from initialize", async () => {
    expect(await proxy.name()).to.equal(NAME);
    expect(await proxy.symbol()).to.equal(SYMBOL);
    expect(await proxy.owner()).to.equal(admin.address);
    expect(await proxy.mintPriceWei()).to.equal(PRICE);
  });

  it("cannot be initialized twice", async () => {
    await expect(
      proxy.initialize(NAME, SYMBOL, admin.address, PRICE, BASE_URI)
    ).to.be.reverted;
  });

  it("cannot initialize the naked implementation directly", async () => {
    const implAddress = await upgrades.erc1967.getImplementationAddress(await proxy.getAddress());
    const impl = await ethers.getContractAt("DylCollection", implAddress);
    await expect(impl.initialize(NAME, SYMBOL, admin.address, PRICE, BASE_URI)).to.be.reverted;
  });

  describe("adminMint", () => {
    it("is owner-only", async () => {
      await expect(proxy.connect(other).adminMint(1, 1, other.address)).to.be.revertedWithCustomError(
        proxy,
        "OwnableUnauthorizedAccount"
      );
    });

    it("mints exactly editions 1-10 (tokenIds 1001..1010 for trackId 1) to the given address", async () => {
      await proxy.connect(admin).adminMint(1, 10, admin.address);
      for (let i = 0; i < 10; i++) {
        expect(await proxy.ownerOf(1 * 1000 + i + 1)).to.equal(admin.address);
      }
      expect(await proxy.nextEditionIndex(1)).to.equal(10);
    });

    it("hard-caps at edition 10 across multiple calls, cannot exceed even for the admin", async () => {
      await proxy.connect(admin).adminMint(1, 8, admin.address);
      await expect(proxy.connect(admin).adminMint(1, 3, admin.address)).to.be.revertedWithCustomError(
        proxy,
        "AdminAllocationExceeded"
      );
      // exactly the remaining 2 should still succeed
      await proxy.connect(admin).adminMint(1, 2, admin.address);
      expect(await proxy.nextEditionIndex(1)).to.equal(10);
    });

    it("reverts on zero quantity", async () => {
      await expect(proxy.connect(admin).adminMint(1, 0, admin.address)).to.be.revertedWithCustomError(
        proxy,
        "InvalidQuantity"
      );
    });
  });

  describe("public mint", () => {
    it("continues from edition 11 after a 10-edition admin premint, with correct tokenId math", async () => {
      await proxy.connect(admin).adminMint(3, 10, admin.address);
      await proxy.connect(buyer).mint(3, 1, buyer.address, { value: PRICE });
      const expectedTokenId = 3 * 1000 + 10 + 1; // edition index 10 (11th edition), +1 offset
      expect(await proxy.ownerOf(expectedTokenId)).to.equal(buyer.address);
    });

    it("self-initializes a brand-new trackId at edition 0, no setup step required", async () => {
      await proxy.connect(buyer).mint(999, 1, buyer.address, { value: PRICE });
      expect(await proxy.ownerOf(999 * 1000 + 1)).to.equal(buyer.address);
    });

    it("reverts on underpayment", async () => {
      await expect(
        proxy.connect(buyer).mint(1, 1, buyer.address, { value: PRICE - 1n })
      ).to.be.revertedWithCustomError(proxy, "IncorrectPayment");
    });

    it("reverts on overpayment too (exact payment required)", async () => {
      await expect(
        proxy.connect(buyer).mint(1, 1, buyer.address, { value: PRICE + 1n })
      ).to.be.revertedWithCustomError(proxy, "IncorrectPayment");
    });

    it("enforces the 100-edition cap per track", async () => {
      await proxy.connect(admin).adminMint(5, 10, admin.address);
      await proxy.connect(buyer).mint(5, 90, buyer.address, { value: PRICE * 90n });
      expect(await proxy.nextEditionIndex(5)).to.equal(100);
      await expect(
        proxy.connect(buyer).mint(5, 1, buyer.address, { value: PRICE })
      ).to.be.revertedWithCustomError(proxy, "TrackSoldOut");
    });

    it("mints to an arbitrary `to` address, not just msg.sender (required for AlbumBuyer)", async () => {
      await proxy.connect(buyer).mint(7, 1, other.address, { value: PRICE });
      expect(await proxy.ownerOf(7 * 1000 + 1)).to.equal(other.address);
    });
  });

  describe("claimMint / claimMinters (burn-and-mint)", () => {
    it("setClaimMinter is owner-only", async () => {
      await expect(proxy.connect(other).setClaimMinter(other.address, true)).to.be.revertedWithCustomError(
        proxy,
        "OwnableUnauthorizedAccount"
      );
    });

    it("claimMint reverts for anyone not on the claimMinters allowlist", async () => {
      await expect(proxy.connect(other).claimMint(1, 1, other.address)).to.be.revertedWithCustomError(
        proxy,
        "NotClaimMinter"
      );
      // even the admin/owner itself has no special claimMint power — must be explicitly allowlisted
      await expect(proxy.connect(admin).claimMint(1, 1, admin.address)).to.be.revertedWithCustomError(
        proxy,
        "NotClaimMinter"
      );
    });

    it("mints for free once allowlisted, from the SAME public ceiling as paid mint (not the smaller admin-reserved one)", async () => {
      await proxy.connect(admin).setClaimMinter(other.address, true);
      await proxy.connect(admin).adminMint(9, 10, admin.address); // fill editions 1-10 first, matching real ordering

      await proxy.connect(other).claimMint(9, 1, buyer.address);
      expect(await proxy.ownerOf(9 * 1000 + 11)).to.equal(buyer.address); // edition 11 (index 10), +1 offset
      expect(await proxy.nextEditionIndex(9)).to.equal(11);

      // draws down the real public pool the rest of the way — same 100-edition cap as public mint()
      for (let i = 0; i < 89; i++) {
        await proxy.connect(other).claimMint(9, 1, buyer.address);
      }
      expect(await proxy.nextEditionIndex(9)).to.equal(100);
      await expect(proxy.connect(other).claimMint(9, 1, buyer.address)).to.be.revertedWithCustomError(
        proxy,
        "TrackSoldOut"
      );
    });

    it("revoking claimMinters immediately blocks further claims", async () => {
      await proxy.connect(admin).setClaimMinter(other.address, true);
      await proxy.connect(other).claimMint(10, 1, buyer.address);
      await proxy.connect(admin).setClaimMinter(other.address, false);
      await expect(proxy.connect(other).claimMint(10, 1, buyer.address)).to.be.revertedWithCustomError(
        proxy,
        "NotClaimMinter"
      );
    });

    it("reverts on zero quantity", async () => {
      await proxy.connect(admin).setClaimMinter(other.address, true);
      await expect(proxy.connect(other).claimMint(1, 0, buyer.address)).to.be.revertedWithCustomError(
        proxy,
        "InvalidQuantity"
      );
    });
  });

  describe("admin setters", () => {
    it("setMintPrice is owner-only and updates the price", async () => {
      await expect(proxy.connect(other).setMintPrice(1)).to.be.revertedWithCustomError(
        proxy,
        "OwnableUnauthorizedAccount"
      );
      await proxy.connect(admin).setMintPrice(ethers.parseEther("0.0005"));
      expect(await proxy.mintPriceWei()).to.equal(ethers.parseEther("0.0005"));
    });

    it("setMetadataBaseURI is owner-only and updates tokenURI/contractURI output", async () => {
      await proxy.connect(admin).adminMint(1, 1, admin.address);
      await proxy.connect(admin).setMetadataBaseURI("https://example.com/meta/");
      expect(await proxy.tokenURI(1001)).to.equal("https://example.com/meta/1001");
      expect(await proxy.contractURI()).to.equal("https://example.com/meta/collection");
    });

    it("setEditionsPerTrack is owner-only and changes the per-track cap", async () => {
      await expect(proxy.connect(other).setEditionsPerTrack(5)).to.be.revertedWithCustomError(
        proxy,
        "OwnableUnauthorizedAccount"
      );
      await proxy.connect(admin).setEditionsPerTrack(5);
      expect(await proxy.editionsPerTrack()).to.equal(5);

      // a track that already had 4 admin-minted editions can only mint 1 more now
      await proxy.connect(admin).adminMint(50, 4, admin.address);
      await proxy.connect(buyer).mint(50, 1, buyer.address, { value: PRICE });
      expect(await proxy.nextEditionIndex(50)).to.equal(5);
      await expect(
        proxy.connect(buyer).mint(50, 1, buyer.address, { value: PRICE })
      ).to.be.revertedWithCustomError(proxy, "TrackSoldOut");
    });

    it("setRoyalty is owner-only and updates royaltyInfo", async () => {
      await proxy.connect(admin).setRoyalty(other.address, 500);
      const [receiver, amount] = await proxy.royaltyInfo(1, ethers.parseEther("1"));
      expect(receiver).to.equal(other.address);
      expect(amount).to.equal(ethers.parseEther("0.05"));
    });

    it("royaltyInfo defaults to 6.9% to the admin from initialize", async () => {
      const [receiver, amount] = await proxy.royaltyInfo(1, ethers.parseEther("1"));
      expect(receiver).to.equal(admin.address);
      expect(amount).to.equal(ethers.parseEther("0.069"));
    });
  });

  describe("interfaces", () => {
    it("supportsInterface reports ERC-165, ERC-721, and ERC-2981", async () => {
      expect(await proxy.supportsInterface("0x01ffc9a7")).to.equal(true); // ERC165
      expect(await proxy.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await proxy.supportsInterface("0x2a55205a")).to.equal(true); // ERC2981
      expect(await proxy.supportsInterface("0xffffffff")).to.equal(false);
    });
  });

  describe("withdraw", () => {
    it("is owner-only and moves the full balance", async () => {
      await proxy.connect(buyer).mint(1, 1, buyer.address, { value: PRICE });
      await expect(proxy.connect(other).withdraw(other.address)).to.be.revertedWithCustomError(
        proxy,
        "OwnableUnauthorizedAccount"
      );
      const before = await ethers.provider.getBalance(admin.address);
      const tx = await proxy.connect(admin).withdraw(admin.address);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(admin.address);
      expect(after).to.equal(before + PRICE - gasCost);
    });

    it("reverts withdrawing to the zero address instead of silently burning funds", async () => {
      await proxy.connect(buyer).mint(1, 1, buyer.address, { value: PRICE });
      await expect(
        proxy.connect(admin).withdraw(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(proxy, "WithdrawToZeroAddress");
    });
  });

  describe("UUPS upgrade flow", () => {
    it("upgrades V1 -> V2, preserves existing tokens and state, new function works", async () => {
      await proxy.connect(admin).adminMint(2, 10, admin.address);
      await proxy.connect(buyer).mint(2, 1, buyer.address, { value: PRICE });
      const proxyAddress = await proxy.getAddress();

      const V2 = await ethers.getContractFactory("DylCollectionV2Test");
      const upgraded = await upgrades.upgradeProxy(proxyAddress, V2, { kind: "uups" });

      // same proxy address, state survived
      expect(await upgraded.getAddress()).to.equal(proxyAddress);
      expect(await upgraded.ownerOf(2 * 1000 + 11)).to.equal(buyer.address); // edition 11 (index 10) +1 offset
      expect(await upgraded.nextEditionIndex(2)).to.equal(11);
      expect(await upgraded.mintPriceWei()).to.equal(PRICE);
      expect(await upgraded.owner()).to.equal(admin.address);

      // new V2-only behavior works
      await upgraded.connect(admin).setUpgradeMarker("v2-live");
      expect(await upgraded.upgradeMarker()).to.equal("v2-live");
    });

    it("_authorizeUpgrade is owner-only", async () => {
      const proxyAddress = await proxy.getAddress();
      const V2 = await ethers.getContractFactory("DylCollectionV2Test", other);
      await expect(upgrades.upgradeProxy(proxyAddress, V2, { kind: "uups" })).to.be.reverted;
    });
  });
});
