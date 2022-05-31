import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { utils, BigNumber, Contract } from 'ethers';
import {
  AaveFlashloanStrategy,
  ERC20,
  PoolManager,
  IProtocolDataProvider,
  IAaveIncentivesController,
  ILendingPool,
} from '../typechain';
import { SCalculateBorrow } from '../utils/optimization';
import { parseUnits } from 'ethers/lib/utils';

export const BASE_PARAMS = parseUnits('1', 9);
export const BASE_TOKENS = parseUnits('1', 18);
const normalizeToBase27 = (n: BigNumber, base = 6) => n.mul(utils.parseUnits('1', 27)).div(utils.parseUnits('1', base));

async function getAavePoolVariables(
  deployer: SignerWithAddress,
  protocolDataProvider: IProtocolDataProvider,
  lendingPool: ILendingPool,
  incentivesController: IAaveIncentivesController,
  aToken: ERC20,
  debtToken: ERC20,
  tokenAddress: string,
) {
  const { availableLiquidity, totalStableDebt, totalVariableDebt, averageStableBorrowRate } =
    await protocolDataProvider.getReserveData(tokenAddress);
  const reserveFactor = (await protocolDataProvider.getReserveConfigurationData(tokenAddress))
    .reserveFactor as BigNumber;

  const interestRateStrategy = new Contract(
    (await lendingPool.getReserveData(tokenAddress)).interestRateStrategyAddress,
    [
      'function baseVariableBorrowRate() external view returns (uint256)',
      'function variableRateSlope1() external view returns (uint256)',
      'function variableRateSlope2() external view returns (uint256)',
      'function OPTIMAL_UTILIZATION_RATE() external view returns (uint256)',
    ],
    deployer,
  );

  const aTokenEmissions = (await incentivesController.assets(aToken.address)).emissionPerSecond.mul(60 * 60 * 24 * 365); // BASE 18
  const debtTokenEmissions = (await incentivesController.assets(debtToken.address)).emissionPerSecond.mul(
    60 * 60 * 24 * 365,
  ); // BASE 18

  const slope1 = (await interestRateStrategy.variableRateSlope1()) as BigNumber;
  const slope2 = (await interestRateStrategy.variableRateSlope2()) as BigNumber;
  const r0 = (await interestRateStrategy.baseVariableBorrowRate()) as BigNumber;
  const uOptimal = (await interestRateStrategy.OPTIMAL_UTILIZATION_RATE()) as BigNumber;

  return {
    reserveFactor,
    slope1,
    slope2,
    r0,
    uOptimal,
    availableLiquidity,
    totalStableDebt,
    totalVariableDebt,
    averageStableBorrowRate,
    aTokenEmissions,
    debtTokenEmissions,
  };
}

type StrategyParams = {
  // Timestamp of last report made by this strategy
  lastReport: BigNumber;
  // Total amount the strategy is expected to have
  totalStrategyDebt: BigNumber;
  // The share of the total assets in the `PoolManager` contract that the `strategy` can access to.
  debtRatio: BigNumber;
};

export async function getParamsOptim(
  deployer: SignerWithAddress,
  protocolDataProvider: IProtocolDataProvider,
  lendingPool: ILendingPool,
  incentivesController: IAaveIncentivesController,
  aToken: ERC20,
  debtToken: ERC20,
  aavePriceChainlink: Contract,
  strategy: AaveFlashloanStrategy,
  token: ERC20,
  tokenDecimals: number,
  poolManager: PoolManager,
): Promise<SCalculateBorrow> {
  const {
    reserveFactor,
    slope1,
    slope2,
    r0,
    uOptimal,
    availableLiquidity,
    totalStableDebt,
    totalVariableDebt,
    averageStableBorrowRate,
    aTokenEmissions,
    debtTokenEmissions,
  } = await getAavePoolVariables(
    deployer,
    protocolDataProvider,
    lendingPool,
    incentivesController,
    aToken,
    debtToken,
    token.address,
  );

  const { deposits, borrows } = await strategy.getCurrentPosition();
  const strategyParams: StrategyParams = await poolManager.strategies(strategy.address);
  const wantBalance = await token.balanceOf(strategy.address);
  const totalStrategyAssets = wantBalance.add(deposits).sub(borrows);
  const totalStrategyDebt = strategyParams.totalStrategyDebt;
  const gainOrLoss = totalStrategyAssets.sub(totalStrategyDebt);
  const poolManagerTotalAssets = (await poolManager.getTotalAsset()).add(gainOrLoss);
  const targetStrategyDebt = poolManagerTotalAssets.mul(strategyParams.debtRatio).div(BASE_PARAMS);

  const aavePrice = ((await aavePriceChainlink.latestRoundData()).answer as BigNumber).div(100); // BASE 6
  const aavePriceDiscounted = aavePrice.mul(await strategy.discountFactor()).div(10000);

  const paramOptimBorrow: SCalculateBorrow = {
    reserveFactor: reserveFactor.mul(utils.parseUnits('1', 23)),
    totalStableDebt: normalizeToBase27(totalStableDebt, tokenDecimals),
    totalVariableDebt: normalizeToBase27(totalVariableDebt.sub(borrows), tokenDecimals),
    totalDeposits: normalizeToBase27(
      availableLiquidity.add(totalStableDebt).add(totalVariableDebt).add(targetStrategyDebt).sub(deposits),
      tokenDecimals,
    ),
    stableBorrowRate: averageStableBorrowRate,
    rewardDeposit: aTokenEmissions.mul(aavePriceDiscounted).mul(utils.parseUnits('1', 9)).div(utils.parseUnits('1', 6)),
    rewardBorrow: debtTokenEmissions
      .mul(aavePriceDiscounted)
      .mul(utils.parseUnits('1', 9))
      .div(utils.parseUnits('1', 6)),
    strategyAssets: normalizeToBase27(targetStrategyDebt, tokenDecimals),
    currentBorrow: normalizeToBase27(borrows, tokenDecimals),
    slope1,
    slope2,
    r0,
    uOptimal,
  };

  return paramOptimBorrow;
}
