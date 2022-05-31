// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "./MockToken.sol";

contract MockWETH is MockToken {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {}

    /// @notice stablecoin constructor
    /// @param name_ the stablecoin name (example 'agEUR')
    /// @param symbol_ the stablecoin symbol ('agEUR')
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimal_
    ) MockToken(name_, symbol_, decimal_) {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public {
        _burn(msg.sender, wad);
        (bool sent, ) = msg.sender.call{ value: wad }("");
        require(sent, "Failed to send Ether");
        emit Withdrawal(msg.sender, wad);
    }
}
