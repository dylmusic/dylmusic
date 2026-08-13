// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
// ECDSA.sol is genuinely dependency-free (verified: zero imports) — safe.
// Deliberately NOT using OZ's EIP712Upgradeable here: it transitively pulls
// in Strings.sol -> Bytes.sol, which uses the `mcopy` opcode unconditionally
// (Cancun/EIP-1153+ only) in this OZ version, and Robinhood Chain's exact
// EVM hardfork support isn't confirmed — confirmed by a real local compile
// failure ("Function mcopy not found") when EIP712Upgradeable was imported.
// The actual EIP-712 domain/typed-data hashing this contract needs is a
// handful of keccak256 calls (see _domainSeparatorV4/_hashTypedDataV4
// below) — hand-rolled to the exact same spec OZ's own EIP712Upgradeable
// implements internally, with zero extra opcode requirements beyond what
// DylCollection/AlbumBuyer already deploy with today.
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IDylCollectionClaim {
    function claimMint(uint256 trackId, uint256 quantity, address to) external;
}

/// Redeems a server-signed voucher for a real, free "burn old assets, claim
/// a random mint" edition — the on-chain half of dylmusic's burn-and-mint
/// system (see CLAUDE.md / lib/burnCredits.ts for the reward table, and
/// lib/burnLedgerStore.ts for how a voucher gets earned).
///
/// The trust model, deliberately: burning happens on a totally different
/// chain (Ethereum/Solana/Tezos) than this claim (Robinhood Chain today,
/// more EVM chains later) — there's no bridge/cross-chain read available,
/// so a burn can't be verified from inside this contract directly. Instead
/// the backend independently re-derives the real burn from the origin
/// chain's own indexer (never trusts a client-submitted claim), then signs
/// an EIP-712 voucher authorizing exactly this wallet to mint exactly these
/// editions. This contract's only job is verifying that signature and
/// preventing any voucher from being redeemed twice — it never decides
/// eligibility itself.
///
/// UUPS-upgradeable, same pattern as AlbumBuyer.sol/DylCollection.sol — one
/// proxy per EVM chain, admin wallet holds upgrade authority. Holds no
/// funds (claims are always free, non-payable) so an upgrade never has
/// anything at risk to migrate.
contract BurnClaimRedeemer is OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    struct ClaimVoucher {
        address wallet;
        address collection;
        uint256[] trackIds;
        uint256[] quantities;
        bytes32 claimId;
        uint256 expiry;
        uint256 chainId;
    }

    bytes32 private constant CLAIM_VOUCHER_TYPEHASH = keccak256(
        "ClaimVoucher(address wallet,address collection,uint256[] trackIds,uint256[] quantities,bytes32 claimId,uint256 expiry,uint256 chainId)"
    );

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    /// The backend's dedicated signing key — deliberately NOT the admin/
    /// deploy wallet. Its only power is authorizing claimMint calls, so a
    /// leak of this key alone can never touch price, withdrawals, or the
    /// upgrade path. Owner-rotatable in case it ever needs to change.
    address public claimSigner;

    /// Replay protection — every voucher's claimId can be redeemed exactly
    /// once, checked-and-set before any external call.
    mapping(bytes32 => bool) public claimed;

    // Plain storage-based reentrancy guard, not OZ's transient-storage
    // variant (the only one this OZ version ships — the old storage-backed
    // ReentrancyGuardUpgradeable was removed) — deliberately, since TSTORE/
    // TLOAD also need EIP-1153 (Cancun+), same reasoning as the EIP712
    // note above. A manual guard has zero opcode requirements beyond what
    // DylCollection/AlbumBuyer already deploy with.
    uint256 private _reentrancyStatus;

    event ClaimSignerUpdated(address indexed newSigner);
    event Claimed(address indexed wallet, bytes32 indexed claimId, uint256[] trackIds, uint256[] quantities);

    error LengthMismatch();
    error WrongChain();
    error VoucherExpired();
    error AlreadyClaimed();
    error InvalidSignature();
    error ZeroAddress();
    error Reentrant();

    modifier nonReentrant() {
        if (_reentrancyStatus == 2) revert Reentrant();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin_, address claimSigner_) public initializer {
        __Ownable_init(admin_);
        __Pausable_init();
        // UUPSUpgradeable (OZ v5) is stateless — no init call needed.
        _reentrancyStatus = 1;
        if (claimSigner_ == address(0)) revert ZeroAddress();
        claimSigner = claimSigner_;
        emit ClaimSignerUpdated(claimSigner_);
    }

    function setClaimSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        claimSigner = newSigner;
        emit ClaimSignerUpdated(newSigner);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// Fixed, deploy-time domain name/version — recomputed per call rather
    /// than cached, exactly like OZ's own upgradeable EIP712 implementation
    /// (cheaper than a cold SLOAD, and avoids adding storage this contract
    /// doesn't otherwise need).
    function _domainSeparatorV4() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("DylBurnClaimRedeemer")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _hashTypedDataV4(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparatorV4(), structHash));
    }

    function hashVoucher(ClaimVoucher calldata v) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CLAIM_VOUCHER_TYPEHASH,
                v.wallet,
                v.collection,
                keccak256(abi.encodePacked(v.trackIds)),
                keccak256(abi.encodePacked(v.quantities)),
                v.claimId,
                v.expiry,
                v.chainId
            )
        );
    }

    /// The real digest a wallet/backend should produce via eth_signTypedData
    /// for a given voucher — exposed so the off-chain signer and this
    /// contract can never silently drift on the exact encoding.
    function claimDigest(ClaimVoucher calldata v) external view returns (bytes32) {
        return _hashTypedDataV4(hashVoucher(v));
    }

    /// Permissionless caller (anyone can submit — same trust model as
    /// AlbumBuyer.batchMint's explicit `to` param), but the mint always
    /// lands on `voucher.wallet` regardless of who calls this, and only a
    /// genuinely claimSigner-signed voucher for THIS wallet/chain can ever
    /// succeed.
    function claim(ClaimVoucher calldata v, bytes calldata signature) external nonReentrant whenNotPaused {
        if (v.trackIds.length != v.quantities.length) revert LengthMismatch();
        if (v.chainId != block.chainid) revert WrongChain();
        if (block.timestamp > v.expiry) revert VoucherExpired();
        if (claimed[v.claimId]) revert AlreadyClaimed();

        bytes32 digest = _hashTypedDataV4(hashVoucher(v));
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != claimSigner) revert InvalidSignature();

        // Checks-effects-interactions: mark claimed BEFORE any external call.
        claimed[v.claimId] = true;

        IDylCollectionClaim c = IDylCollectionClaim(v.collection);
        for (uint256 i = 0; i < v.trackIds.length; i++) {
            c.claimMint(v.trackIds[i], v.quantities[i], v.wallet);
        }

        emit Claimed(v.wallet, v.claimId, v.trackIds, v.quantities);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
