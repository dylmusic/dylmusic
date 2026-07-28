// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Forces Hardhat to compile ERC1967Proxy so its ABI+bytecode land in
// artifacts/ for export to lib/contracts/ — the frontend deploys this raw
// as the second of two UUPS deploy transactions. Never inherited from
// directly, hence the orphan import.
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
