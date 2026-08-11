// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AlbumBuyer} from "../AlbumBuyer.sol";

/// Test-only V2 implementation used solely to prove AlbumBuyer's own UUPS
/// upgrade path works end-to-end, same reasoning as DylCollectionV2Test.
/// Appends one new variable at the end of storage and one new function —
/// never reorders/removes existing AlbumBuyer state.
contract AlbumBuyerV2Test is AlbumBuyer {
    string public upgradeMarker;

    function setUpgradeMarker(string calldata marker) external onlyOwner {
        upgradeMarker = marker;
    }
}
