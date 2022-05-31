// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "../external/AccessControlAngleUpgradeable.sol";

import "../interfaces/IPoolManager.sol";
import "../interfaces/IStrategy.sol";

struct SLPData {
    // Last timestamp at which the `sanRate` has been updated for SLPs
    uint256 lastBlockUpdated;
    // Fees accumulated from previous blocks and to be distributed to SLPs
    uint256 lockedInterests;
    // Max interests used to update the `sanRate` in a single block
    // Should be in collateral token base
    uint256 maxInterestsDistributed;
    // Amount of fees left aside for SLPs and that will be distributed
    // when the protocol is collateralized back again
    uint256 feesAside;
    // Part of the fees normally going to SLPs that is left aside
    // before the protocol is collateralized back again (depends on collateral ratio)
    // Updated by keepers and scaled by `BASE_PARAMS`
    uint64 slippageFee;
    // Portion of the fees from users minting and burning
    // that goes to SLPs (the rest goes to surplus)
    uint64 feesForSLPs;
    // Slippage factor that's applied to SLPs exiting (depends on collateral ratio)
    // If `slippage = BASE_PARAMS`, SLPs can get nothing, if `slippage = 0` they get their full claim
    // Updated by keepers and scaled by `BASE_PARAMS`
    uint64 slippage;
    // Portion of the interests from lending
    // that goes to SLPs (the rest goes to surplus)
    uint64 interestsForSLPs;
}

struct MintBurnData {
    // Values of the thresholds to compute the minting fees
    // depending on HA hedge (scaled by `BASE_PARAMS`)
    uint64[] xFeeMint;
    // Values of the fees at thresholds (scaled by `BASE_PARAMS`)
    uint64[] yFeeMint;
    // Values of the thresholds to compute the burning fees
    // depending on HA hedge (scaled by `BASE_PARAMS`)
    uint64[] xFeeBurn;
    // Values of the fees at thresholds (scaled by `BASE_PARAMS`)
    uint64[] yFeeBurn;
    // Max proportion of collateral from users that can be covered by HAs
    // It is exactly the same as the parameter of the same name in `PerpetualManager`, whenever one is updated
    // the other changes accordingly
    uint64 targetHAHedge;
    // Minting fees correction set by the `FeeManager` contract: they are going to be multiplied
    // to the value of the fees computed using the hedge curve
    // Scaled by `BASE_PARAMS`
    uint64 bonusMalusMint;
    // Burning fees correction set by the `FeeManager` contract: they are going to be multiplied
    // to the value of the fees computed using the hedge curve
    // Scaled by `BASE_PARAMS`
    uint64 bonusMalusBurn;
    // Parameter used to limit the number of stablecoins that can be issued using the concerned collateral
    uint256 capOnStableMinted;
}

interface IOracle {
    function read() external view returns (uint256);

    function readAll() external view returns (uint256 lowerRate, uint256 upperRate);

    function readLower() external view returns (uint256);

    function readUpper() external view returns (uint256);

    function readQuote(uint256 baseAmount) external view returns (uint256);

    function readQuoteLower(uint256 baseAmount) external view returns (uint256);

    function inBase() external view returns (uint256);
}

interface ISanToken is IERC20 {
    function mint(address account, uint256 amount) external;

    function burnFrom(
        uint256 amount,
        address burner,
        address sender
    ) external;

    function burnSelf(uint256 amount, address burner) external;

    function stableMaster() external view returns (address);

    function poolManager() external view returns (address);
}

interface IStableMaster {
    function agToken() external view returns (address);

    function signalLoss(uint256 loss) external;

    function accumulateInterest(uint256 gain) external;

    function collateralMap(IPoolManager poolManager)
        external
        view
        returns (
            IERC20 token,
            ISanToken sanToken,
            address perpetualManager,
            IOracle oracle,
            uint256 stocksUsers,
            uint256 sanRate,
            uint256 collatBase,
            SLPData memory slpData,
            MintBurnData memory feeData
        );
}

/// @title PoolManager
/// @author Angle Core Team
/// @notice The `PoolManager` contract corresponds to a collateral pool of the protocol for a stablecoin,
/// it manages a single ERC20 token. It is responsible for interacting with the strategies enabling the protocol
/// to get yield on its collateral
/// @dev This file contains the functions that are callable by governance or by other contracts of the protocol
/// @dev References to this contract are called `PoolManager`
contract PoolManager is IPoolManagerFunctions, AccessControlAngleUpgradeable {
    using SafeERC20 for IERC20;

    uint256 constant BASE_PARAMS = 10**9;
    uint256 constant BASE_TOKENS = 10**18;

    /// @notice Interface for the underlying token accepted by this contract
    IERC20 public token;

    /// @notice Reference to the `StableMaster` contract corresponding to this `PoolManager`
    IStableMaster public stableMaster;

    // ============================= Yield Farming =================================

    /// @notice Funds currently given to strategies
    uint256 public totalDebt;

    /// @notice Proportion of the funds managed dedicated to strategies
    /// Has to be between 0 and `BASE_PARAMS`
    uint256 public debtRatio;

    /// The struct `StrategyParams` is defined in the interface `IPoolManager`
    /// @notice Mapping between the address of a strategy contract and its corresponding details
    mapping(address => StrategyParams) public strategies;

    /// @notice List of the current strategies
    address[] public strategyList;

    /// @notice Address of the surplus distributor allowed to distribute rewards
    address public surplusConverter;

    /// @notice Share of the interests going to surplus and share going to SLPs
    uint64 public interestsForSurplus;

    /// @notice Interests accumulated by the protocol and to be distributed through ANGLE or veANGLE
    /// token holders
    uint256 public interestsAccumulated;

    /// @notice Debt that must be paid by admins after a loss on a strategy
    uint256 public adminDebt;

    event FeesDistributed(uint256 amountDistributed);

    event Recovered(address indexed token, address indexed to, uint256 amount);

    event StrategyAdded(address indexed strategy, uint256 debtRatio);

    event InterestsForSurplusUpdated(uint64 _interestsForSurplus);

    event SurplusConverterUpdated(address indexed newSurplusConverter, address indexed oldSurplusConverter);

    event StrategyRevoked(address indexed strategy);

    event StrategyReported(
        address indexed strategy,
        uint256 gain,
        uint256 loss,
        uint256 debtPayment,
        uint256 totalDebt
    );

    // Roles need to be defined here because there are some internal access control functions
    // in the `PoolManagerInternal` file

    /// @notice Role for `StableMaster` only
    bytes32 public constant STABLEMASTER_ROLE = keccak256("STABLEMASTER_ROLE");
    /// @notice Role for governors only
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    /// @notice Role for guardians and governors
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice Role for `Strategy` only
    bytes32 public constant STRATEGY_ROLE = keccak256("STRATEGY_ROLE");

    constructor(
        address _token,
        address governor,
        address guardian
    ) {
        token = IERC20(_token);
        _setupRole(GUARDIAN_ROLE, guardian);
        _setupRole(GUARDIAN_ROLE, governor);
        _setupRole(GOVERNOR_ROLE, governor);
        _setRoleAdmin(GOVERNOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(GUARDIAN_ROLE, GOVERNOR_ROLE);
    }

    // ============================= Yield Farming =================================

    /// @notice Internal version of `updateStrategyDebtRatio`
    /// @dev Updates the debt ratio for a strategy
    function _updateStrategyDebtRatio(address strategy, uint256 _debtRatio) internal {
        StrategyParams storage params = strategies[strategy];
        require(params.lastReport != 0, "78");
        debtRatio = debtRatio + _debtRatio - params.debtRatio;
        require(debtRatio <= BASE_PARAMS, "76");
        params.debtRatio = _debtRatio;
        emit StrategyAdded(strategy, debtRatio);
    }

    // ============================ Utils ==========================================

    /// @notice Returns this `PoolManager`'s reserve of collateral (not including what has been lent)
    function _getBalance() internal view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Returns the amount of assets owned by this `PoolManager`
    /// @dev This sums the current balance of the contract to what has been given to strategies
    /// @dev This amount can be manipulated by flash loans
    function _getTotalAsset() internal view returns (uint256) {
        return _getBalance() + totalDebt;
    }

    // ============================= Yield Farming =================================

    /// @notice Provides an estimated Annual Percentage Rate for SLPs based on lending to other protocols
    /// @dev This function is an estimation and is made for external use only
    /// @dev This does not take into account transaction fees which accrue to SLPs too
    /// @dev This can be manipulated by a flash loan attack (SLP deposit/ withdraw) via `_getTotalAsset`
    /// when entering you should make sure this hasn't be called by a flash loan and look
    /// at a mean of past APR.
    function estimatedAPR() external view returns (uint256 apr) {
        apr = 0;
        (, ISanToken sanTokenForAPR, , , , uint256 sanRate, , SLPData memory slpData, ) = stableMaster.collateralMap(
            IPoolManager(address(this))
        );
        uint256 supply = sanTokenForAPR.totalSupply();

        // `sanRate` should never be equal to 0
        if (supply == 0) return type(uint256).max;

        for (uint256 i = 0; i < strategyList.length; i++) {
            apr =
                apr +
                (strategies[strategyList[i]].debtRatio * IStrategy(strategyList[i]).estimatedAPR()) /
                BASE_PARAMS;
        }
        apr = (apr * slpData.interestsForSLPs * _getTotalAsset()) / sanRate / supply;
    }

    /// @notice Tells a strategy how much it can borrow from this `PoolManager`
    /// @return Amount of token a strategy has access to as a credit line
    /// @dev Since this function is a view function, there is no need to have an access control logic
    /// even though it will just be relevant for a strategy
    /// @dev Manipulating `_getTotalAsset` with a flashloan will only
    /// result in tokens being transferred at the cost of the caller
    function creditAvailable() external view override returns (uint256) {
        StrategyParams storage params = strategies[msg.sender];

        uint256 target = (_getTotalAsset() * params.debtRatio) / BASE_PARAMS;

        if (target < params.totalStrategyDebt) return 0;

        return Math.min(target - params.totalStrategyDebt, _getBalance());
    }

    /// @notice Tells a strategy how much it owes to this `PoolManager`
    /// @return Amount of token a strategy has to reimburse
    /// @dev Manipulating `_getTotalAsset` with a flashloan will only
    /// result in tokens being transferred at the cost of the caller
    function debtOutstanding() external view override returns (uint256) {
        StrategyParams storage params = strategies[msg.sender];

        uint256 target = (_getTotalAsset() * params.debtRatio) / BASE_PARAMS;

        if (target > params.totalStrategyDebt) return 0;

        return (params.totalStrategyDebt - target);
    }

    /// @notice Reports the gains or loss made by a strategy
    /// @param gain Amount strategy has realized as a gain on its investment since its
    /// last report, and is free to be given back to `PoolManager` as earnings
    /// @param loss Amount strategy has realized as a loss on its investment since its
    /// last report, and should be accounted for on the `PoolManager`'s balance sheet.
    /// The loss will reduce the `debtRatio`. The next time the strategy will harvest,
    /// it will pay back the debt in an attempt to adjust to the new debt limit.
    /// @param debtPayment Amount strategy has made available to cover outstanding debt
    /// @dev This is the main contact point where the strategy interacts with the `PoolManager`
    /// @dev The strategy reports back what it has free, then the `PoolManager` contract "decides"
    /// whether to take some back or give it more. Note that the most it can
    /// take is `gain + _debtPayment`, and the most it can give is all of the
    /// remaining reserves. Anything outside of those bounds is abnormal behavior.
    function report(
        uint256 gain,
        uint256 loss,
        uint256 debtPayment
    ) external override onlyRole(STRATEGY_ROLE) {
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

        if (target > params.totalStrategyDebt) {
            // If the strategy has some credit left, tokens can be transferred to this strategy
            uint256 available = Math.min(target - params.totalStrategyDebt, _getBalance());
            params.totalStrategyDebt = params.totalStrategyDebt + available;
            totalDebt = totalDebt + available;
            if (available > 0) {
                token.safeTransfer(msg.sender, available);
            }
        } else {
            uint256 available = Math.min(params.totalStrategyDebt - target, debtPayment + gain);
            params.totalStrategyDebt = params.totalStrategyDebt - available;
            totalDebt = totalDebt - available;
            if (available > 0) {
                token.safeTransferFrom(msg.sender, address(this), available);
            }
        }
        emit StrategyReported(msg.sender, gain, loss, debtPayment, params.totalStrategyDebt);

        // Handle gains before losses
        if (gain > 0) {
            uint256 gainForSurplus = (gain * interestsForSurplus) / BASE_PARAMS;
            uint256 adminDebtPre = adminDebt;
            // Depending on the current admin debt distribute the necessary gain from the strategies
            if (adminDebtPre == 0) interestsAccumulated += gainForSurplus;
            else if (adminDebtPre <= gainForSurplus) {
                interestsAccumulated += gainForSurplus - adminDebtPre;
                adminDebt = 0;
            } else adminDebt -= gainForSurplus;
            // stableMaster.accumulateInterest(gain - gainForSurplus);
            emit FeesDistributed(gain);
        }

        // Handle eventual losses
        if (loss > 0) {
            uint256 lossForSurplus = (loss * interestsForSurplus) / BASE_PARAMS;
            uint256 interestsAccumulatedPreLoss = interestsAccumulated;
            // If the loss can not be entirely soaked by the interests to be distributed then
            // the protocol keeps track of the debt
            if (lossForSurplus > interestsAccumulatedPreLoss) {
                interestsAccumulated = 0;
                adminDebt += lossForSurplus - interestsAccumulatedPreLoss;
            } else interestsAccumulated -= lossForSurplus;
            // The rest is incurred to SLPs
            // stableMaster.signalLoss(loss - lossForSurplus);
        }
    }

    // =========================== Governor Functions ==============================

    /// @notice Allows to recover any ERC20 token, including the token handled by this contract, and to send it
    /// to a contract
    /// @param tokenAddress Address of the token to recover
    /// @param to Address of the contract to send collateral to
    /// @param amountToRecover Amount of collateral to transfer
    /// @dev As this function can be used to transfer funds to another contract, it has to be a `GOVERNOR` function
    /// @dev In case the concerned token is the specific token handled by this contract, this function checks that the
    /// amount entered is not too big and approximates the surplus of the protocol
    /// @dev To esimate the amount of user claims on the concerned collateral, this function uses the `stocksUsers` for
    /// this collateral, but this is just an approximation as users can claim the collateral of their choice provided
    /// that they own a stablecoin
    /// @dev The sanity check excludes the HA claims: to get a sense of it, this function would need to compute the cash out
    /// amount of all the perpetuals, and this cannot be done on-chain in a cheap manner
    /// @dev Overall, even though there is a sanity check, this function relies on the fact that governance is not corrupted
    /// in this protocol and will not try to withdraw too much funds
    function recoverERC20(
        address tokenAddress,
        address to,
        uint256 amountToRecover
    ) external onlyRole(GOVERNOR_ROLE) {
        if (tokenAddress == address(token)) {
            // Fetching info from the `StableMaster`
            (
                ,
                ISanToken sanToken,
                ,
                IOracle oracle,
                uint256 stocksUsers,
                uint256 sanRate,
                uint256 collatBase,
                ,

            ) = stableMaster.collateralMap(IPoolManager(address(this)));

            // Checking if there are enough reserves for the amount to withdraw
            require(
                _getTotalAsset() >=
                    amountToRecover +
                        (sanToken.totalSupply() * sanRate) /
                        BASE_TOKENS +
                        (stocksUsers * collatBase) /
                        oracle.readUpper() +
                        interestsAccumulated,
                "66"
            );

            token.safeTransfer(to, amountToRecover);
        } else {
            IERC20(tokenAddress).safeTransfer(to, amountToRecover);
        }
        emit Recovered(tokenAddress, to, amountToRecover);
    }

    /// @notice Adds a strategy to the `PoolManager`
    /// @param strategy The address of the strategy to add
    /// @param _debtRatio The share of the total assets that the strategy has access to
    /// @dev Multiple checks are made. For instance, the contract must not already belong to the `PoolManager`
    /// and the underlying token of the strategy has to be consistent with the `PoolManager` contracts
    /// @dev This function is a `governor` function and not a `guardian` one because a `guardian` could add a strategy
    /// enabling the withdraw of the funds of the protocol
    /// @dev The `_debtRatio` should be expressed in `BASE_PARAMS`
    function addStrategy(address strategy, uint256 _debtRatio) external onlyRole(GOVERNOR_ROLE) {
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

    // =========================== Guardian Functions ==============================

    /// @notice Changes the guardian address and echoes it to other contracts that interact with this `PoolManager`
    /// @param _guardian New guardian address
    /// @param guardian Old guardian address to revoke
    function setGuardian(address _guardian, address guardian) external onlyRole(GUARDIAN_ROLE) {
        // Granting the new role
        // Access control for this contract
        _grantRole(GUARDIAN_ROLE, _guardian);
        // Propagating the new role in other contract
        uint256 strategyListLength = strategyList.length;
        for (uint256 i = 0; i < strategyListLength; i++) {
            IStrategy(strategyList[i]).addGuardian(_guardian);
        }
        for (uint256 i = 0; i < strategyListLength; i++) {
            IStrategy(strategyList[i]).revokeGuardian(guardian);
        }
        _revokeRole(GUARDIAN_ROLE, guardian);
    }

    /// @notice Modifies the funds a strategy has access to
    /// @param strategy The address of the Strategy
    /// @param _debtRatio The share of the total assets that the strategy has access to
    /// @dev The update has to be such that the `debtRatio` does not exceeds the 100% threshold
    /// as this `PoolManager` cannot lend collateral that it doesn't not own.
    /// @dev `_debtRatio` is stored as a uint256 but as any parameter of the protocol, it should be expressed
    /// in `BASE_PARAMS`
    function updateStrategyDebtRatio(address strategy, uint256 _debtRatio) external onlyRole(GUARDIAN_ROLE) {
        _updateStrategyDebtRatio(strategy, _debtRatio);
    }

    /// @notice Triggers an emergency exit for a strategy and then harvests it to fetch all the funds
    /// @param strategy The address of the `Strategy`
    function setStrategyEmergencyExit(address strategy) external onlyRole(GUARDIAN_ROLE) {
        _updateStrategyDebtRatio(strategy, 0);
        IStrategy(strategy).setEmergencyExit();
        IStrategy(strategy).harvest();
    }

    /// @notice Revokes a strategy
    /// @param strategy The address of the strategy to revoke
    /// @dev This should only be called after the following happened in order: the `strategy.debtRatio` has been set to 0,
    /// `harvest` has been called enough times to recover all capital gain/losses.
    function revokeStrategy(address strategy) external onlyRole(GUARDIAN_ROLE) {
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

    /// @notice Withdraws a given amount from a strategy
    /// @param strategy The address of the strategy
    /// @param amount The amount to withdraw
    /// @dev This function tries to recover `amount` from the strategy, but it may not go through
    /// as we may not be able to withdraw from the lending protocol the full amount
    /// @dev In this last case we only update the parameters by setting the loss as the gap between
    /// what has been asked and what has been returned.
    function withdrawFromStrategy(IStrategy strategy, uint256 amount) external onlyRole(GUARDIAN_ROLE) {
        StrategyParams storage params = strategies[address(strategy)];
        require(params.lastReport != 0, "78");

        uint256 loss;
        (amount, loss) = strategy.withdraw(amount);

        // Handling eventual losses
        params.totalStrategyDebt = params.totalStrategyDebt - loss - amount;
        totalDebt = totalDebt - loss - amount;

        emit StrategyReported(address(strategy), 0, loss, amount - loss, params.totalStrategyDebt);

        // Handle eventual losses
        // With the strategy we are using in current tests, it is going to be impossible to have
        // a positive loss by calling strategy.withdraw, this function indeed calls _liquidatePosition
        // which output value is always zero
        // if (loss > 0) stableMaster.signalLoss(loss);
    }

    // =================== Surplus Distributor Function ============================

    /// @notice Allows to push interests revenue accumulated by the protocol to the `surplusConverter` to do buybacks
    ///  or another form of redistribution to ANGLE or veANGLE token holders
    /// @dev This function is permissionless and anyone can transfer the `interestsAccumulated` by the protocol
    /// to the `surplusConverter`
    function pushSurplus() external {
        // If the `surplusConverter` has not been initialized, surplus should not be distributed
        // Storing the `surplusConverter` in an intermediate variable to avoid multiple reads in
        // storage
        address surplusConverterMem = surplusConverter;
        require(surplusConverterMem != address(0), "0");
        uint256 amount = interestsAccumulated;
        interestsAccumulated = 0;
        // Storing the `token` in memory to avoid duplicate reads in storage
        IERC20 tokenMem = token;
        tokenMem.safeTransfer(surplusConverterMem, amount);
        emit Recovered(address(tokenMem), surplusConverterMem, amount);
    }

    // ======================== Getters - View Functions ===========================

    /// @notice Gets the current balance of this `PoolManager` contract
    /// @return The amount of the underlying collateral that the contract currently owns
    /// @dev This balance does not take into account what has been lent to strategies
    function getBalance() external view override returns (uint256) {
        return _getBalance();
    }

    /// @notice Gets the total amount of collateral that is controlled by this `PoolManager` contract
    /// @return The amount of collateral owned by this contract plus the amount that has been lent to strategies
    /// @dev This is the value that is used to compute the debt ratio for a given strategy
    function getTotalAsset() external view override returns (uint256) {
        return _getTotalAsset();
    }
}
