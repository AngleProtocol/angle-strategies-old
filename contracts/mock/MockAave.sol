// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

import { IPriceOracle, IOptionalERC20, DataTypes, IStakedAave, IReserveInterestRateStrategy } from "../interfaces/external/aave/IAave.sol";
import { IAToken } from "../interfaces/external/aave/IAaveToken.sol";
import { IAToken } from "../interfaces/external/aave/IAaveToken.sol";
import { IProtocolDataProvider } from "../interfaces/external/aave/IProtocolDataProvider.sol";
import { ILendingPool, ILendingPoolAddressesProvider } from "../interfaces/external/aave/ILendingPool.sol";
import { IAaveIncentivesController } from "../interfaces/external/aave/IAaveIncentivesController.sol";
import { IVariableDebtToken } from "../interfaces/external/aave/IAaveToken.sol";

abstract contract MockAave is
    IAaveIncentivesController,
    ILendingPoolAddressesProvider,
    IReserveInterestRateStrategy,
    IStakedAave
{
    using SafeERC20 for IERC20;

    uint256 public constant BASE = 10**27;

    uint256 public distributionEnd = type(uint256).max;
    uint256 public emissionsPerSecond = 10;
    uint256 public unstakeWindow = type(uint256).max;
    uint256 public stakersCooldownsValue = 0;
    uint256 public rewardsBalance = 0;

    function getRewardsBalance(address[] calldata, address) external view override returns (uint256) {
        return rewardsBalance;
    }

    function setRewardsBalance(uint256 _rewardsBalance) external {
        rewardsBalance = _rewardsBalance;
    }

    function claimRewards(
        address[] calldata,
        uint256,
        address
    ) external pure override returns (uint256) {
        return uint256(0);
    }

    function getDistributionEnd() external view override returns (uint256) {
        return distributionEnd;
    }

    function setDistributionEnd(uint256 _distributionEnd) external {
        distributionEnd = _distributionEnd;
    }

    function getAssetData(address)
        external
        view
        override
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        return (0, emissionsPerSecond, 0);
    }

    function setEmissionsPerSecond(uint256 _emissionsPerSecond) external {
        emissionsPerSecond = _emissionsPerSecond;
    }

    function getLendingPool() external view override returns (address) {
        return address(this);
    }

    function calculateInterestRates(
        address,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    )
        external
        pure
        override
        returns (
            uint256 liquidityRate,
            uint256 stableBorrowRate,
            uint256 variableBorrowRate
        )
    {
        return (0.04 ether, 0.04 ether, 0.04 ether);
    }

    function stake(address to, uint256 amount) external override {}

    function redeem(address to, uint256 amount) external override {}

    function cooldown() external override {}

    function claimRewards(address to, uint256 amount) external override {}

    function getTotalRewardsBalance(address) external view override returns (uint256) {}

    function COOLDOWN_SECONDS() external pure override returns (uint256) {
        return 0;
    }

    function stakersCooldowns(address) external view override returns (uint256) {
        return stakersCooldownsValue;
    }

    function UNSTAKE_WINDOW() external view override returns (uint256) {
        return unstakeWindow;
    }

    function setUnstakeWindowAndStakers(uint256 _unstakeWindow, uint256 _stakersCooldownsValue) external {
        unstakeWindow = _unstakeWindow;
        stakersCooldownsValue = _stakersCooldownsValue;
    }

    function getPriceOracle() external view override returns (address) {
        return address(this);
    }

    function getAssetsPrices(address[] calldata) external pure returns (uint256[] memory) {
        uint256[] memory _ret = new uint256[](2);
        _ret[0] = uint256(392936527437060);
        _ret[1] = uint256(394087347138603);
        return _ret;
    }
}

contract MockMKRLender {
    mapping(address => uint256) public maxFlashLoan;
    uint256 public compilerMuter;

    constructor(address _token, uint256 _maxFlashLoan) {
        maxFlashLoan[_token] = _maxFlashLoan;
    }

    function flashFee(address, uint256) external view returns (uint256) {
        compilerMuter;
        return 0;
    }

    function flashLoan(
        IERC3156FlashBorrower,
        address,
        uint256,
        bytes calldata
    ) external returns (bool) {
        compilerMuter = 0;
        return true;
    }
}

contract MockAToken is ERC20 {
    event Minting(address indexed _to, address indexed _minter, uint256 _amount);
    event Burning(address indexed _from, address indexed _burner, uint256 _amount);

    /// @notice constructor
    /// @param name_ of the token lent
    /// @param symbol_ of the token lent
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 decimals
    ) ERC20(name_, symbol_) {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
        emit Minting(account, msg.sender, amount);
    }

    function burn(address account, uint256 amount) public {
        _burn(account, amount);
        emit Burning(account, msg.sender, amount);
    }

    function getIncentivesController() external view returns (IAaveIncentivesController) {
        return IAaveIncentivesController(address(this));
    }
}

abstract contract MockLendingPool is ILendingPool {
    using SafeERC20 for IERC20;

    uint256 public constant BASE = 10**27;

    MockAToken public immutable aToken;
    MockAToken public immutable debtToken;
    uint128 public currentLiquidityRate = 0;
    uint256 public compilerMuter;

    constructor(address _aToken, address _debtToken) {
        aToken = MockAToken(_aToken);
        debtToken = MockAToken(_debtToken);
    }

    mapping(address => uint256) public reserveNormalizedIncomes; // Mapping between an underlying asset and its reserveNoramlized income

    function deployNewUnderlying(address underlying) external {
        reserveNormalizedIncomes[underlying] = BASE;
    }

    function getReserveNormalizedIncome(address asset) external view override returns (uint256) {
        return reserveNormalizedIncomes[asset] / BASE;
    }

    function changeReserveNormalizedIncome(uint256 newIncome, address asset) external {
        reserveNormalizedIncomes[asset] = newIncome * BASE;
    }

    function setCurrentLiquidityRate(uint128 _liquidityRate) external {
        currentLiquidityRate = _liquidityRate;
    }

    function getReserveData(address) external view override returns (DataTypes.ReserveData memory) {
        return
            DataTypes.ReserveData(
                DataTypes.ReserveConfigurationMap(uint256(0)),
                uint128(0),
                uint128(0),
                currentLiquidityRate,
                uint128(0),
                uint128(0),
                uint40(0),
                address(this),
                address(this),
                address(this),
                address(this),
                uint8(0)
            );
    }

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16
    ) external override {
        IERC20 underlying = IERC20(asset);
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        // With Aave the amount of cToken is exactly what has been given
        uint256 reserveNormalizedIncome_ = reserveNormalizedIncomes[asset];
        aToken.mint(onBehalfOf, (amount * BASE) / reserveNormalizedIncome_); // Here we don't exactly respect what Aave is doing
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external override returns (uint256) {
        uint256 reserveNormalizedIncome_ = reserveNormalizedIncomes[asset];
        uint256 amountcToken = (amount * BASE) / reserveNormalizedIncome_;
        aToken.burn(msg.sender, amountcToken);
        uint256 amountToken = (amountcToken * reserveNormalizedIncome_) / BASE;
        IERC20(asset).safeTransfer(to, amountToken);
        return (amountToken);
    }

    function borrow(
        address asset,
        uint256 amount,
        uint256 interestRateMode,
        uint16 referralCode,
        address onBehalfOf
    ) external override {}

    function repay(
        address,
        uint256,
        uint256,
        address
    ) external override returns (uint256) {
        compilerMuter = 0;
        return 0;
    }
}

contract MockProtocolDataProvider {
    uint256 public availableLiquidityStorage = 0;

    address public immutable aToken;
    address public immutable debtToken;
    MockAave public immutable mockAave;

    constructor(
        address _aToken,
        address _debtToken,
        address _mockAave
    ) {
        aToken = _aToken;
        debtToken = _debtToken;
        mockAave = MockAave(_mockAave);
    }

    function getReserveTokensAddresses(address)
        external
        view
        returns (
            address aTokenAddress,
            address stableDebtTokenAddress,
            address variableDebtTokenAddress
        )
    {
        aTokenAddress = aToken;
        stableDebtTokenAddress = debtToken;
        variableDebtTokenAddress = debtToken;
    }

    function ADDRESSES_PROVIDER() external view returns (ILendingPoolAddressesProvider) {
        return ILendingPoolAddressesProvider(mockAave);
    }

    function getReserveConfigurationData(address)
        external
        pure
        returns (
            uint256 decimals,
            uint256 ltv,
            uint256 liquidationThreshold,
            uint256 liquidationBonus,
            uint256 reserveFactor,
            bool usageAsCollateralEnabled,
            bool borrowingEnabled,
            bool stableBorrowRateEnabled,
            bool isActive,
            bool isFrozen
        )
    {
        // https://etherscan.io/address/0x057835ad21a177dbdd3090bb1cae03eacf78fc6d#readContract
        return (uint256(6), uint256(8250), uint256(8500), uint256(10400), uint256(1000), true, true, true, true, false);
    }

    function setAvailableLiquidity(uint256 _availableLiquidity) external {
        availableLiquidityStorage = _availableLiquidity;
    }

    function getReserveData(address)
        external
        view
        returns (
            uint256 availableLiquidity,
            uint256 totalStableDebt,
            uint256 totalVariableDebt,
            uint256 liquidityRate,
            uint256 variableBorrowRate,
            uint256 stableBorrowRate,
            uint256 averageStableBorrowRate,
            uint256 liquidityIndex,
            uint256 variableBorrowIndex,
            uint40 lastUpdateTimestamp
        )
    {
        availableLiquidity = availableLiquidityStorage;
        return (
            availableLiquidity,
            uint256(0),
            uint256(0),
            uint256(0),
            uint256(0),
            uint256(0),
            uint256(0),
            uint256(0),
            uint256(0),
            uint40(0)
        );
    }
}
