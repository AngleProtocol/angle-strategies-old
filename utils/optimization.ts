import { BigNumber, ethers } from 'ethers';
import { formatUnits, parseUnits } from 'ethers/lib/utils';

export type SCalculateBorrow = {
  reserveFactor: BigNumber;
  totalStableDebt: BigNumber;
  totalVariableDebt: BigNumber;
  totalDeposits: BigNumber;
  stableBorrowRate: BigNumber;
  rewardDeposit: BigNumber;
  rewardBorrow: BigNumber;
  strategyAssets: BigNumber;
  currentBorrow: BigNumber;
  slope1: BigNumber;
  slope2: BigNumber;
  r0: BigNumber;
  uOptimal: BigNumber;
};

type Utilisation = {
  utilisation: BigNumber;
  utilisationPrime: BigNumber;
  utilisationPrime2nd: BigNumber;
};

type Interest = {
  interest: BigNumber;
  interestPrime: BigNumber;
  interestPrime2nd: BigNumber;
};

type Revenues = {
  revenue: BigNumber;
  revenuePrime: BigNumber;
  revenuePrime2nd: BigNumber;
};

const _BASE_RAY = parseUnits('1', 27);

export function computeUtilizationPrimes(borrow: BigNumber, parameters: SCalculateBorrow): Utilisation {
  let returnUtilisation: Utilisation = {} as Utilisation;

  returnUtilisation.utilisation = parameters.totalStableDebt
    .add(parameters.totalVariableDebt)
    .add(borrow)
    .mul(_BASE_RAY)
    .div(parameters.totalDeposits.add(borrow));

  returnUtilisation.utilisationPrime = parameters.totalDeposits
    .sub(parameters.totalStableDebt)
    .sub(parameters.totalVariableDebt)
    .mul(_BASE_RAY)
    .div(parameters.totalDeposits.add(borrow))
    .mul(_BASE_RAY)
    .div(parameters.totalDeposits.add(borrow));

  returnUtilisation.utilisationPrime2nd = BigNumber.from(-2)
    .mul(returnUtilisation.utilisationPrime)
    .mul(_BASE_RAY)
    .div(parameters.totalDeposits.add(borrow));

  return returnUtilisation;
}

/// @notice Computes the value of the interest rate, its first and second order derivatives
/// @dev The returned value is in `_BASE_RAY`
export function computeInterestPrimes(borrow: BigNumber, parameters: SCalculateBorrow): Interest {
  let returnInterest: Interest = {} as Interest;
  const utilizationPrimes = computeUtilizationPrimes(borrow, parameters);
  if (utilizationPrimes.utilisation.lt(parameters.uOptimal)) {
    returnInterest.interest = parameters.r0.add(
      parameters.slope1.mul(utilizationPrimes.utilisation).div(parameters.uOptimal),
    );
    returnInterest.interestPrime = parameters.slope1.mul(utilizationPrimes.utilisationPrime).div(parameters.uOptimal);
    returnInterest.interestPrime2nd = parameters.slope1
      .mul(utilizationPrimes.utilisationPrime2nd)
      .div(parameters.uOptimal);
  } else {
    returnInterest.interest = parameters.r0
      .add(parameters.slope1)
      .add(
        parameters.slope2
          .mul(utilizationPrimes.utilisation.sub(parameters.uOptimal))
          .div(_BASE_RAY.sub(parameters.uOptimal)),
      );
    returnInterest.interestPrime = parameters.slope2
      .mul(utilizationPrimes.utilisationPrime)
      .div(_BASE_RAY.sub(parameters.uOptimal));
    returnInterest.interestPrime2nd = parameters.slope2
      .mul(utilizationPrimes.utilisationPrime2nd)
      .div(_BASE_RAY.sub(parameters.uOptimal));
  }

  return returnInterest;
}

/// @notice Computes the value of the interest rate, its first and second order derivatives
/// @dev The returned value is in `_BASE_RAY`
export function computeRevenuePrimes(borrow: BigNumber, parameters: SCalculateBorrow): Revenues {
  let returnRevenues: Revenues = {} as Revenues;

  const OneMinusReserveFactor = _BASE_RAY.sub(parameters.reserveFactor);

  const interestRatesPrimes = computeInterestPrimes(borrow, parameters);
  const newStrategyAssets = borrow.add(parameters.strategyAssets);
  const newTotalDeposits = borrow.add(parameters.totalDeposits);
  const newTotalVariableDebt = borrow.add(parameters.totalVariableDebt);

  const proportionStrat = newStrategyAssets.mul(OneMinusReserveFactor).div(newTotalDeposits);
  const poolYearlyRevenue = parameters.totalStableDebt
    .mul(parameters.stableBorrowRate)
    .add(newTotalVariableDebt.mul(interestRatesPrimes.interest))
    .div(_BASE_RAY);

  // 0 order derivate
  const depositRevenue = proportionStrat.mul(poolYearlyRevenue).div(_BASE_RAY);
  const borrowCost = borrow.mul(interestRatesPrimes.interest).div(_BASE_RAY);
  const rewardsBorrow = borrow.mul(parameters.rewardBorrow).div(newTotalVariableDebt);
  const rewardsDeposit = newStrategyAssets.mul(parameters.rewardDeposit).div(newTotalDeposits);
  const rewards = rewardsDeposit.add(rewardsBorrow);

  returnRevenues.revenue = depositRevenue.add(rewards).sub(borrowCost);

  // 1st order derivate
  const proportionStratPrime = parameters.totalDeposits
    .sub(parameters.strategyAssets)
    .mul(OneMinusReserveFactor)
    .div(newTotalDeposits)
    .mul(_BASE_RAY)
    .div(newTotalDeposits);
  const poolYearlyRevenuePrime = interestRatesPrimes.interest.add(
    newTotalVariableDebt.mul(interestRatesPrimes.interestPrime).div(_BASE_RAY),
  );
  const borrowCostPrime = interestRatesPrimes.interest.add(
    borrow.mul(interestRatesPrimes.interestPrime).div(_BASE_RAY),
  );
  const rewardBorrowPrime = parameters.totalVariableDebt
    .mul(parameters.rewardBorrow)
    .div(newTotalVariableDebt)
    .mul(_BASE_RAY)
    .div(newTotalVariableDebt);
  const rewardDepositPrime = parameters.totalDeposits
    .sub(parameters.strategyAssets)
    .mul(parameters.rewardDeposit)
    .div(newTotalDeposits)
    .mul(_BASE_RAY)
    .div(newTotalDeposits);

  returnRevenues.revenuePrime = proportionStratPrime
    .mul(poolYearlyRevenue)
    .add(proportionStrat.mul(poolYearlyRevenuePrime))
    .div(_BASE_RAY)
    .add(rewardDepositPrime)
    .add(rewardBorrowPrime)
    .sub(borrowCostPrime);

  // 2nd order derivate
  const proportionStratPrime2nd = BigNumber.from(-2).mul(proportionStratPrime).mul(_BASE_RAY).div(newTotalDeposits);
  const poolYearlyRevenuePrime2nd = BigNumber.from(2)
    .mul(interestRatesPrimes.interestPrime)
    .add(newTotalVariableDebt.mul(interestRatesPrimes.interestPrime2nd).div(_BASE_RAY));

  const borrowCostPrime2nd = BigNumber.from(2)
    .mul(interestRatesPrimes.interestPrime)
    .add(borrow.mul(interestRatesPrimes.interestPrime2nd).div(_BASE_RAY));
  const rewardBorrowPrime2nd = BigNumber.from(-2).mul(rewardBorrowPrime).mul(_BASE_RAY).div(newTotalVariableDebt);
  const rewardDepositPrime2nd = BigNumber.from(-2).mul(rewardDepositPrime).mul(_BASE_RAY).div(newTotalDeposits);

  returnRevenues.revenuePrime2nd = proportionStratPrime2nd
    .mul(poolYearlyRevenue)
    .add(proportionStrat.mul(poolYearlyRevenuePrime2nd))
    .add(BigNumber.from(2).mul(proportionStratPrime).mul(poolYearlyRevenuePrime))
    .div(_BASE_RAY)
    .add(rewardDepositPrime2nd)
    .add(rewardBorrowPrime2nd)
    .sub(borrowCostPrime2nd);

  return returnRevenues;
}

/// @notice Performs a newton Raphson approximation to get the zero point of the derivative of the
/// revenue function of the protocol depending on the amount borrowed
export function getOptimalBorrow(parameters: SCalculateBorrow): BigNumber {
  const revenuesOnlyDeposit = computeRevenuePrimes(ethers.constants.Zero, parameters);
  const revenuesWithSmallBorrow = computeRevenuePrimes(_BASE_RAY, parameters);

  if (revenuesWithSmallBorrow.revenue.lte(revenuesOnlyDeposit.revenue)) {
    return ethers.constants.Zero;
  }

  let count = 0;
  let borrowInit: BigNumber = BigNumber.from(0);
  let revenueGrad: Revenues;
  let borrow = parameters.currentBorrow;
  const tolerance = BigNumber.from(10 ** 2).div(BigNumber.from(5));
  // Tolerance is 1% in this method: indeed we're stopping: `_abs(borrowInit - borrow)/ borrowInit < 10**(-2)`
  while (count < 10 && (count == 0 || borrowInit.sub(borrow).abs().mul(tolerance).gt(borrowInit))) {
    revenueGrad = computeRevenuePrimes(borrow, parameters);
    borrowInit = borrow;
    borrow = borrowInit.sub(revenueGrad.revenuePrime.mul(_BASE_RAY).div(revenueGrad.revenuePrime2nd));
    count += 1;
  }

  const supposedOptimalRevenue = computeRevenuePrimes(borrow, parameters);

  if (supposedOptimalRevenue.revenue.lte(revenuesOnlyDeposit.revenue)) {
    borrow = ethers.constants.Zero;
  }

  return borrow;
}

/// @notice Computes the position collateral ratio from deposits and borrows
export function getCollatRatio(deposits: BigNumber, borrows: BigNumber): BigNumber {
  let currentCollatRatio = ethers.constants.MaxUint256;
  if (deposits.gt(BigNumber.from(0))) {
    currentCollatRatio = borrows.mul(parseUnits('1', 18)).div(deposits);
  }
  return currentCollatRatio;
}

function getBorrowFromSupply(supply: BigNumber, collatRatio: BigNumber): BigNumber {
  return supply.mul(collatRatio).div(parseUnits('1', 18).sub(collatRatio));
}

/// @notice Performs a newton Raphson approximation to get the zero point of the derivative of the
/// revenue function of the protocol depending on the amount borrowed
export function getConstrainedBorrow(
  optimalBorrow: BigNumber,
  strategyAssets: BigNumber,
  maxCollatRatio: BigNumber,
): BigNumber {
  const collatRatio = getCollatRatio(strategyAssets.add(optimalBorrow), optimalBorrow);
  if (collatRatio.gt(maxCollatRatio)) {
    optimalBorrow = getBorrowFromSupply(strategyAssets, maxCollatRatio);
  }

  return optimalBorrow;
}
