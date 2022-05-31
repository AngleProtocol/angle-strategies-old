// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "../interfaces/IPoolManager.sol";
import "../interfaces/IStrategy.sol";

contract MockPoolManager is AccessControl {
    using SafeERC20 for IERC20;

    uint256 public constant BASE_TOKENS = 10**18;
    uint256 public constant BASE_PARAMS = 10**9;

    bytes32 public constant STRATEGY_ROLE = keccak256("STRATEGY_ROLE");

    mapping(address => StrategyParams) public strategies;
    address[] public strategyList;

    IERC20 public token;
    uint256 public creditAvailable;
    uint256 public totalDebt;
    uint256 public debtRatio;

    event StrategyReported(
        address indexed strategy,
        uint256 gain,
        uint256 loss,
        uint256 debtPayment,
        uint256 totalDebt
    );
    event StrategyAdded(address indexed strategy, uint256 debtRatio);
    event StrategyRevoked(address indexed strategy);

    constructor(address _token, uint256 _creditAvailable) {
        token = IERC20(_token);
        creditAvailable = _creditAvailable;
    }

    function debtOutstanding() external view returns (uint256) {
        StrategyParams storage params = strategies[msg.sender];

        uint256 target = (_getTotalAsset() * params.debtRatio) / BASE_PARAMS;

        // console.log("debtOutstanding: totalStrategyDebt %s / target: %s / debtRatio: %s", params.totalStrategyDebt, target, params.debtRatio);

        if (target > params.totalStrategyDebt) return 0;

        return (params.totalStrategyDebt - target);
    }

    function report(
        uint256 gain,
        uint256 loss,
        uint256 debtPayment
    ) external {
        require(token.balanceOf(msg.sender) >= gain + debtPayment, "72");

        StrategyParams storage params = strategies[msg.sender];
        // Updating parameters in the `perpetualManager`
        // This needs to be done now because it has implications in `_getTotalAsset()`
        params.totalStrategyDebt = params.totalStrategyDebt + gain - loss;
        totalDebt = totalDebt + gain - loss;
        params.lastReport = block.timestamp;

        // Warning: `_getTotalAsset` could be manipulated by flashloan attacks.
        // It may allow external users to transfer funds into strategy or remove funds
        // from the strategy. Yet, as it does not impact the profit or loss and as attackers
        // have no interest in making such txs to have a direct profit, we let it as is.
        // The only issue is if the strategy is compromised; in this case governance
        // should revoke the strategy
        uint256 target = ((_getTotalAsset()) * params.debtRatio) / BASE_PARAMS;
        // console.log("PoolManager - report");
        // console.log("_getTotalAsset %s / target %s", _getTotalAsset(), target);
        if (target > params.totalStrategyDebt) {
            // If the strategy has some credit left, tokens can be transferred to this strategy
            uint256 available = Math.min(target - params.totalStrategyDebt, _getBalance());
            // console.log("available1 %s", available);
            params.totalStrategyDebt = params.totalStrategyDebt + available;
            totalDebt = totalDebt + available;
            if (available > 0) {
                token.safeTransfer(msg.sender, available);
            }
        } else {
            uint256 available = Math.min(params.totalStrategyDebt - target, debtPayment + gain);
            // console.log("available2 %s", available);
            params.totalStrategyDebt = params.totalStrategyDebt - available;
            totalDebt = totalDebt - available;
            if (available > 0) {
                token.safeTransferFrom(msg.sender, address(this), available);
            }
        }
        emit StrategyReported(msg.sender, gain, loss, debtPayment, params.totalStrategyDebt);
    }

    function _getBalance() internal view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function getTotalAsset() external view returns (uint256) {
        return _getTotalAsset();
    }

    function _getTotalAsset() internal view returns (uint256) {
        return _getBalance() + totalDebt;
    }

    function addStrategy(address strategy, uint256 _debtRatio) external {
        StrategyParams storage params = strategies[strategy];

        require(params.lastReport == 0, "73");
        require(address(this) == IStrategy(strategy).poolManager(), "74");
        // Using current code, this condition should always be verified as in the constructor
        // of the strategy the `want()` is set to the token of this `PoolManager`
        require(address(token) == IStrategy(strategy).want(), "75");
        require(debtRatio + _debtRatio <= BASE_PARAMS, "76");

        // Add strategy to approved strategies
        params.lastReport = 1;
        params.totalStrategyDebt = 0;
        params.debtRatio = _debtRatio;

        _grantRole(STRATEGY_ROLE, strategy);

        // Update global parameters
        debtRatio += _debtRatio;
        emit StrategyAdded(strategy, debtRatio);

        strategyList.push(strategy);
    }

    function revokeStrategy(address strategy) external {
        StrategyParams storage params = strategies[strategy];

        require(params.debtRatio == 0, "77");
        require(params.totalStrategyDebt == 0, "77");
        uint256 strategyListLength = strategyList.length;
        require(params.lastReport != 0 && strategyListLength >= 1, "78");
        // It has already been checked whether the strategy was a valid strategy
        for (uint256 i = 0; i < strategyListLength - 1; i++) {
            if (strategyList[i] == strategy) {
                strategyList[i] = strategyList[strategyListLength - 1];
                break;
            }
        }

        strategyList.pop();

        // Update global parameters
        debtRatio -= params.debtRatio;
        delete strategies[strategy];

        _revokeRole(STRATEGY_ROLE, strategy);

        emit StrategyRevoked(strategy);
    }

    function updateStrategyDebtRatio(address strategy, uint256 _debtRatio) external {
        StrategyParams storage params = strategies[strategy];
        require(params.lastReport != 0, "78");
        debtRatio = debtRatio + _debtRatio - params.debtRatio;
        require(debtRatio <= BASE_PARAMS, "76");
        params.debtRatio = _debtRatio;
    }
}
