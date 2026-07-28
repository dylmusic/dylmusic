// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DylCollection} from "../DylCollection.sol";

/// Test-only V2 implementation used solely to prove the real UUPS upgrade
/// path works end-to-end (existing tokens/state survive, storage layout
/// stays compatible). Appends one new variable at the end of storage and
/// one new function — never reorders/removes existing DylCollection state.
contract DylCollectionV2Test is DylCollection {
    string public upgradeMarker;

    function setUpgradeMarker(string calldata marker) external onlyOwner {
        upgradeMarker = marker;
    }
}
