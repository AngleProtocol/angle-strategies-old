// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.12;

import "./ComputeProfitability.sol";

/// @title ComputeProfitabilityTest
/// @author Angle Core Team
/// @notice Wrapper contract to ComputeProfitability for testing purpose
contract ComputeProfitabilityTest {
    /// @notice external version of _calculateInterestPrimes
    function calculateInterestPrimes(int256 borrow, ComputeProfitability.SCalculateBorrow memory parameters)
        external
        pure
        returns (
            int256,
            int256,
            int256
        )
    {
        return ComputeProfitability._calculateInterestPrimes(borrow, parameters);
    }

    /// @notice External version of _revenuePrimes
    function revenuePrimes(
        int256 borrow,
        ComputeProfitability.SCalculateBorrow memory parameters,
        bool onlyRevenue
    )
        external
        pure
        returns (
            int256,
            int256,
            int256
        )
    {
        return ComputeProfitability._revenuePrimes(borrow, parameters, onlyRevenue);
    }

    /// @notice Computes the optimal borrow amount of the strategy depending on Aave protocol parameters
    /// to maximize folding revenues
    function computeProfitability(ComputeProfitability.SCalculateBorrow memory parameters)
        external
        pure
        returns (int256)
    {
        return ComputeProfitability.computeProfitability(parameters);
    }
}
