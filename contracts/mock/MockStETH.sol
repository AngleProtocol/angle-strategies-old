// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "./MockToken.sol";

contract MockStETH is MockToken {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    /// @notice stablecoin constructor
    /// @param name_ the stablecoin name (example 'agEUR')
    /// @param symbol_ the stablecoin symbol ('agEUR')
    /// @dev To account for the fact that the balance increases we can simply mint stETH to the concerned address
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimal_
    ) MockToken(name_, symbol_, decimal_) {}

    receive() external payable {}

    function submit(address) external payable returns (uint256) {
        _mint(msg.sender, msg.value);
        return msg.value;
    }
}
