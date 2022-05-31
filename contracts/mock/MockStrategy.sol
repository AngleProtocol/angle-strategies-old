// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "../interfaces/IPoolManager.sol";

contract MockStrategy {
    address public poolManager;

    address public want;

    constructor(address _poolManager, address _want) {
        poolManager = _poolManager;
        want = _want;
    }

    function report(
        uint256 gain,
        uint256 loss,
        uint256 debtPayment
    ) external {
        IPoolManager(poolManager).report(gain, loss, debtPayment);
    }

    function withdraw(uint256 amount) external pure returns (uint256, uint256) {
        return (amount, 1);
    }

    function creditAvailable() external view returns (uint256 credit) {
        credit = IPoolManager(poolManager).creditAvailable();
    }
}
