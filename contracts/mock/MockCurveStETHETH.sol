// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Contract we have to fix flash attacks
contract MockCurveStETHETH {
    using SafeERC20 for IERC20;

    address public stETH;
    uint256 public dy;

    constructor(address _stETH) {
        stETH = _stETH;
        dy = 10**18;
    }

    receive() external payable {}

    function exchange(
        int128 from,
        int128 to,
        uint256 _from_amount,
        uint256
    ) external payable {
        if (from == 0 && to == 1) {
            IERC20(stETH).transfer(msg.sender, (msg.value * dy) / 10**18);
        } else {
            IERC20(stETH).transferFrom(msg.sender, address(this), _from_amount);
            (bool sent, ) = msg.sender.call{ value: (_from_amount * 10**18) / dy }("");
            require(sent, "Failed to send Ether");
        }
    }

    function setDy(uint256 _dy) external {
        dy = _dy;
    }

    function get_dy(
        int128,
        int128,
        uint256 _from_amount
    ) external view returns (uint256) {
        return (_from_amount * dy) / 10**18;
    }
}
