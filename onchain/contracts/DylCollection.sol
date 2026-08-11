// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721AQueryableUpgradeable, ERC721AUpgradeable, IERC721AUpgradeable} from "erc721a-upgradeable/contracts/extensions/ERC721AQueryableUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC2981Upgradeable} from "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";

/// One upgradable ERC721A collection per EVM chain, holding every Dyl track
/// ever released as real, unique tokenIds partitioned into fixed per-track
/// ranges — never one contract per track/album (see dylmusic/CLAUDE.md,
/// "CONTRACT REQUIREMENT"). New albums mint into this SAME deployed
/// contract forever via a new trackId, never a new deployment.
contract DylCollection is ERC721AQueryableUpgradeable, OwnableUpgradeable, ERC2981Upgradeable, UUPSUpgradeable {
    // Left as a true constant on purpose, not admin-settable — changing it
    // after any track has minted would collide new tokenIds with an
    // existing track's already-minted range (see _tokenId below), and it's
    // mirrored byte-for-byte off-chain in lib/tokenIdScheme.ts and the
    // Solana admin scripts (lib/solanaAdmin.ts, onchain-solana/scripts) for
    // the SAME numbering across every chain — a mutable value here with no
    // matching update path on those other two would silently desync them.
    uint256 public constant TOKEN_ID_STRIDE = 1000;

    // Left as a true constant, same reasoning as ADMIN_RESERVED_EDITIONS
    // below would need if made mutable — the site's own admin panel
    // (lib/editionPricing.ts) hardcodes a 10-step $10-$100 price ladder for
    // exactly ADMIN_RESERVED_EDITIONS editions, and Solana's own admin
    // scripts mirror this same "10" independently — an on-chain-only
    // setter here would silently desync from both without also rebuilding
    // that ladder and updating the Solana side to match.
    uint256 public constant ADMIN_RESERVED_EDITIONS = 10;

    // Admin-settable (unlike the two constants above) — this cap has no
    // cross-chain/off-chain mirror to keep in sync (Solana's own per-track
    // edition count is already set independently, per-track, via its own
    // --editions CLI flag), so it's safe to let the admin tune it per-chain
    // with a single tx instead of a full contract upgrade.
    uint256 public editionsPerTrack;

    uint256 public mintPriceWei;
    string public metadataBaseURI;

    // trackId => next 0-based edition index to mint. An unseen trackId reads
    // as 0 — this IS the "self-initializing" behavior a new album needs, no
    // separate "register a track" step.
    mapping(uint256 => uint256) public nextEditionIndex;

    event MintPriceUpdated(uint256 newPriceWei);
    event MetadataBaseURIUpdated(string newBaseURI);
    event EditionsPerTrackUpdated(uint256 newEditionsPerTrack);
    event TrackMinted(uint256 indexed trackId, address indexed to, uint256 firstEdition, uint256 lastEdition);

    error InvalidQuantity();
    error TrackSoldOut();
    error AdminAllocationExceeded();
    error IncorrectPayment();
    error WithdrawFailed();
    error WithdrawToZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address admin_,
        uint256 initialMintPriceWei_,
        string memory initialMetadataBaseURI_
    ) public initializer initializerERC721A {
        __ERC721A_init(name_, symbol_);
        __Ownable_init(admin_);
        // UUPSUpgradeable (OZ v5) is stateless — IERC1822Proxiable + auth
        // logic only, no Initializable inheritance, so there's no
        // __UUPSUpgradeable_init() to call at all.
        __ERC2981_init();
        _setDefaultRoyalty(admin_, 690); // 6.9%, admin-changeable via setRoyalty
        mintPriceWei = initialMintPriceWei_;
        metadataBaseURI = initialMetadataBaseURI_;
        editionsPerTrack = 100; // admin-changeable via setEditionsPerTrack
    }

    // Disables ERC721A's normal sequential/consecutive minting entirely —
    // every token is a deliberate "spot" mint at a precomputed tokenId. The
    // fixed trackId*1000+edition scheme this collection requires is
    // fundamentally incompatible with ERC721A's normal batch-mint (which can
    // only mint the next N consecutive ids from wherever its own internal
    // counter sits, never an arbitrary starting id).
    function _startTokenId() internal pure override returns (uint256) {
        return 0;
    }

    function _sequentialUpTo() internal pure override returns (uint256) {
        return 0;
    }

    // _mintSpot requires tokenId > _sequentialUpTo() (i.e. > 0), so tokenId 0
    // itself can never be spot-minted. The +1 here keeps trackId=0/edition=0
    // (tokenId 0) permanently out of range instead of silently colliding with
    // that floor — robust regardless of which trackId numbering the app
    // actually uses (today lib/albums.ts starts real tracks at index 1, but
    // this contract doesn't rely on that convention holding forever).
    function _tokenId(uint256 trackId, uint256 editionIndex0Based) internal pure returns (uint256) {
        return trackId * TOKEN_ID_STRIDE + editionIndex0Based + 1;
    }

    /// Public, payable mint. `to` is a normal recipient param (not always
    /// msg.sender) specifically so AlbumBuyer can mint straight to the real
    /// buyer across multiple tracks in one wallet action.
    function mint(uint256 trackId, uint256 quantity, address to) external payable {
        if (quantity == 0) revert InvalidQuantity();
        if (msg.value != mintPriceWei * quantity) revert IncorrectPayment();
        _doMint(trackId, quantity, to, editionsPerTrack);
    }

    /// Owner-only. Mints editions #1-10 (0-based indices 0-9) to an
    /// arbitrary address (normally the admin wallet). Hard-capped at
    /// ADMIN_RESERVED_EDITIONS regardless of what public mint has already
    /// done for this track — cannot bypass payment for edition 11+.
    /// Ordering (call this before public mint opens for a track), not a
    /// separate reservation system, is what guarantees these land as
    /// exactly editions 1-10.
    function adminMint(uint256 trackId, uint256 quantity, address to) external onlyOwner {
        if (quantity == 0) revert InvalidQuantity();
        _doMint(trackId, quantity, to, ADMIN_RESERVED_EDITIONS);
    }

    function _doMint(uint256 trackId, uint256 quantity, address to, uint256 ceiling) private {
        uint256 start = nextEditionIndex[trackId];
        uint256 end = start + quantity;
        if (end > ceiling) {
            if (ceiling == ADMIN_RESERVED_EDITIONS) revert AdminAllocationExceeded();
            revert TrackSoldOut();
        }
        nextEditionIndex[trackId] = end;
        for (uint256 i = start; i < end; i++) {
            _mintSpot(to, _tokenId(trackId, i));
        }
        emit TrackMinted(trackId, to, start + 1, end); // 1-based edition numbers in the event
    }

    function setMintPrice(uint256 newPriceWei) external onlyOwner {
        mintPriceWei = newPriceWei;
        emit MintPriceUpdated(newPriceWei);
    }

    function setMetadataBaseURI(string calldata newBaseURI) external onlyOwner {
        metadataBaseURI = newBaseURI;
        emit MetadataBaseURIUpdated(newBaseURI);
    }

    function setEditionsPerTrack(uint256 newEditionsPerTrack) external onlyOwner {
        editionsPerTrack = newEditionsPerTrack;
        emit EditionsPerTrackUpdated(newEditionsPerTrack);
    }

    function setRoyalty(address receiver, uint96 feeNumeratorBps) external onlyOwner {
        _setDefaultRoyalty(receiver, feeNumeratorBps);
    }

    // ERC721A's own tokenURI() already does `_baseURI() + _toString(tokenId)`
    // with an existence check — overriding _baseURI() is enough, no need to
    // reimplement tokenURI() itself.
    function _baseURI() internal view override returns (string memory) {
        return metadataBaseURI;
    }

    function contractURI() external view returns (string memory) {
        return string(abi.encodePacked(metadataBaseURI, "collection"));
    }

    // A call with value to address(0) succeeds trivially on EVM (no code,
    // no revert) rather than reverting — withdraw(address(0)) would
    // otherwise silently burn the entire balance forever instead of failing
    // loudly. Guard it explicitly.
    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert WithdrawToZeroAddress();
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ERC721AUpgradeable and ERC2981Upgradeable are two INDEPENDENT
    // interface-detection trees: ERC721AUpgradeable implements
    // IERC721AUpgradeable directly with no OZ ERC165Upgradeable in its
    // inheritance chain at all, while ERC2981Upgradeable separately inherits
    // OZ's own ERC165Upgradeable. A single `super.supportsInterface` chain
    // can't reach both — call each parent implementation by name and OR the
    // results instead.
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721AUpgradeable, IERC721AUpgradeable, ERC2981Upgradeable) returns (bool) {
        return ERC721AUpgradeable.supportsInterface(interfaceId) || ERC2981Upgradeable.supportsInterface(interfaceId);
    }
}
