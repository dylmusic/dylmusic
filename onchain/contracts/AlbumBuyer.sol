// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDylCollectionMint {
    function mint(uint256 trackId, uint256 quantity, address to) external payable;
    function mintPriceWei() external view returns (uint256);
}

/// Lightweight, stateless, permissionless multicall-style forwarder for
/// "buy the whole album in one signature" — a genuinely separate primitive
/// from ERC721A's own mint(quantity), which can only batch consecutive ids
/// within ONE track's range, never across the ~19 non-sequential per-track
/// ranges an album spans. Deliberately NOT upgradeable: it holds no state
/// or funds between calls, so there's nothing to preserve across an
/// "upgrade" — if a bug is ever found, deploy a new one and repoint the
/// frontend, cheap and safe, without touching the main collection's own
/// upgrade authority at all.
contract AlbumBuyer {
    error LengthMismatch();
    error RefundFailed();

    /// Mints `quantities[i]` editions of `trackIds[i]` for each i, straight
    /// to `to` (the real buyer, not this contract), in one transaction.
    /// Uses plain high-level external calls on purpose — NOT a low-level
    /// .call() with a swallowed return the way Multicall3's
    /// aggregate3/tryAggregate support partial failure — so a revert in any
    /// single track's mint bubbles up automatically and reverts the whole
    /// album purchase atomically, with zero extra code.
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
}
