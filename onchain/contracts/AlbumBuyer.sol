// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IDylCollectionMint {
    function mint(uint256 trackId, uint256 quantity, address to) external payable;
    function mintPriceWei() external view returns (uint256);
}

/// Multicall-style forwarder for "buy the whole album in one signature" — a
/// genuinely separate primitive from ERC721A's own mint(quantity), which can
/// only batch consecutive ids within ONE track's range, never across the
/// ~19 non-sequential per-track ranges an album spans.
///
/// UUPS-upgradeable per Dylan's 2026-08-11 standing direction ("make
/// everything as changeable and upgradeable as possible") — one proxy per
/// EVM chain, same pattern as DylCollection, admin wallet holds upgrade
/// authority. Holds no funds/state between calls (batchMint refunds any
/// dust in the same transaction), so an upgrade never has anything at risk
/// to migrate — this is purely so a logic bug/change never needs a fresh
/// deployment + frontend repoint the way the old non-upgradeable version
/// would have required.
contract AlbumBuyer is OwnableUpgradeable, UUPSUpgradeable {
    error LengthMismatch();
    error RefundFailed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin_) public initializer {
        __Ownable_init(admin_);
        // UUPSUpgradeable (OZ v5) is stateless — no __UUPSUpgradeable_init() call.
    }

    /// Mints `quantities[i]` editions of `trackIds[i]` for each i, straight
    /// to `to` (the real buyer, not this contract), in one transaction.
    /// Uses plain high-level external calls on purpose — NOT a low-level
    /// .call() with a swallowed return the way Multicall3's
    /// aggregate3/tryAggregate support partial failure — so a revert in any
    /// single track's mint bubbles up automatically and reverts the whole
    /// album purchase atomically, with zero extra code. Permissionless by
    /// design, same as before — batchMint itself is not owner-gated, only
    /// the contract's own upgrade path is.
    function batchMint(
        address collection,
        uint256[] calldata trackIds,
        uint256[] calldata quantities,
        address to
    ) external payable {
        if (trackIds.length != quantities.length) revert LengthMismatch();
        IDylCollectionMint c = IDylCollectionMint(collection);
        uint256 price = c.mintPriceWei(); // read once, live, at call time — never trust a caller-supplied price
        for (uint256 i = 0; i < trackIds.length; i++) {
            c.mint{value: price * quantities[i]}(trackIds[i], quantities[i], to);
        }
        uint256 remaining = address(this).balance;
        if (remaining > 0) {
            (bool ok, ) = msg.sender.call{value: remaining}("");
            if (!ok) revert RefundFailed();
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
