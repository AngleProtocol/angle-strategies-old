import { ethers, network } from 'hardhat';
import { utils, constants, Contract, BigNumber } from 'ethers';
import { deploy } from '../test-utils';
import {
  AaveFlashloanStrategy,
  ERC20,
  ERC20__factory,
  PoolManager__factory,
  ILendingPool__factory,
  ILendingPool,
  FlashMintLib,
  AaveFlashloanStrategy__factory,
  PoolManager,
  IAaveIncentivesController__factory,
  IAaveIncentivesController,
  IProtocolDataProvider__factory,
  IProtocolDataProvider,
} from '../../typechain';
import { CONTRACTS_ADDRESSES, ALL_TOKENS } from '@angleprotocol/sdk';

export const logBN = (amount: BigNumber, { base = 6, pad = 20, sign = false } = {}) => {
  const num = parseFloat(utils.formatUnits(amount, base));
  const formattedNum = new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
    signDisplay: sign ? 'always' : 'never',
  }).format(num);
  return formattedNum.padStart(pad, ' ');
};

export const advanceTime = async (hours: number) => {
  await network.provider.send('evm_increaseTime', [3600 * hours]); // forward X hours
  await network.provider.send('evm_mine');
};

export function assert(assertion: boolean, message = 'Assertion failed') {
  if (!assertion) throw new Error(message);
}
export function assertAlmostEq(bn1: BigNumber, bn2: BigNumber, percentage = 10) {
  const addedPercentage = percentage * 100;

  const base = bn1.sub(bn2).lt(0) ? bn1 : bn2;
  const other = base === bn1 ? bn2 : bn1;

  const plus10 = base.mul(BigNumber.from(10000).add(BigNumber.from(addedPercentage))).div(BigNumber.from(10000));
  const minus10 = base.mul(BigNumber.from(10000).sub(BigNumber.from(addedPercentage))).div(BigNumber.from(10000));
  assert(other.lt(plus10));
  assert(other.gt(minus10));
}

export async function setup(startBlocknumber?: number, collat = 'USDC') {
  if (startBlocknumber) {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: startBlocknumber,
          },
        },
      ],
    });
  }

  const { deployer, proxyAdmin, governor, guardian, keeper } = await ethers.getNamedSigners();

  // === TOKENS ===
  const _wantToken = Object.values(ALL_TOKENS[1][1]).find(_tok => _tok.symbol === collat)?.address as string;

  const stkAave = (await ethers.getContractAt(
    ERC20__factory.abi,
    '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
  )) as ERC20;
  const wantToken = (await ethers.getContractAt(ERC20__factory.abi, _wantToken)) as ERC20;
  const wantTokenBase = await wantToken.decimals();

  // === CONTRACTS ===

  // const poolManager = (await deploy('MockPoolManager', [wantToken.address, 0])) as MockPoolManager;
  const poolManager = (await ethers.getContractAt(
    PoolManager__factory.abi,
    CONTRACTS_ADDRESSES[1].agEUR.collaterals?.[collat].PoolManager as string,
  )) as PoolManager;

  const lendingPool = (await ethers.getContractAt(
    ILendingPool__factory.abi,
    '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
  )) as ILendingPool;

  const protocolDataProvider = (await ethers.getContractAt(
    IProtocolDataProvider__factory.abi,
    '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
  )) as IProtocolDataProvider;

  const incentivesController = (await ethers.getContractAt(
    IAaveIncentivesController__factory.abi,
    '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
  )) as IAaveIncentivesController;

  const flashMintLib = (await deploy('FlashMintLib')) as FlashMintLib;

  const oldStrategy = await ethers.getContractAt(
    ['function harvest() external', 'function estimatedTotalAssets() external view returns(uint)'],
    CONTRACTS_ADDRESSES[1].agEUR.collaterals?.[collat].Strategies?.GenericOptimisedLender as string,
  );

  // === INIT STRATEGY ===

  const strategyImplementation = (await deploy('AaveFlashloanStrategy', [], {
    libraries: { FlashMintLib: flashMintLib.address },
  })) as AaveFlashloanStrategy;
  const proxy = await deploy('TransparentUpgradeableProxy', [strategyImplementation.address, proxyAdmin.address, '0x']);
  const strategy = new Contract(proxy.address, AaveFlashloanStrategy__factory.abi, deployer) as AaveFlashloanStrategy;

  // ReserveInterestRateStrategy for USDC
  const reserveInterestRateStrategyUSDC = '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27';
  await strategy.initialize(poolManager.address, reserveInterestRateStrategyUSDC, governor.address, guardian.address, [
    keeper.address,
  ]);

  // === AAVE TOKENS ===
  const aaveTokens = await protocolDataProvider.getReserveTokensAddresses(_wantToken);
  const aToken = (await ethers.getContractAt(ERC20__factory.abi, aaveTokens.aTokenAddress)) as ERC20;
  const debtToken = (await ethers.getContractAt(ERC20__factory.abi, aaveTokens.variableDebtTokenAddress)) as ERC20;

  // === SIGNERS ===
  const realGuardian = await ethers.getSigner('0xdc4e6dfe07efca50a197df15d9200883ef4eb1c8');
  await network.provider.send('hardhat_setBalance', [
    realGuardian.address,
    ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
  ]);
  await network.provider.request({ method: 'hardhat_impersonateAccount', params: [realGuardian.address] });

  // 0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3: crypto.com account ($1.5b USDC)
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: ['0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3'],
  });
  const richUSDCUser = await ethers.getSigner('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3');
  await wantToken.connect(richUSDCUser).approve(lendingPool.address, constants.MaxUint256);
  await aToken.connect(richUSDCUser).approve(lendingPool.address, constants.MaxUint256);

  const logBalances = async () =>
    console.log(`
  Balance USDC:     ${logBN(await wantToken.balanceOf(strategy.address), { base: wantTokenBase })}
  Balance stkAave:  ${logBN(await stkAave.balanceOf(strategy.address), { base: 18 })}
  Rewards:          ${logBN(
    await incentivesController.getRewardsBalance([aToken.address, debtToken.address], strategy.address),
    { base: 18 },
  )}
  `);

  const logPosition = async () =>
    console.log(`
  Position:
   deposits:  ${logBN(await aToken.balanceOf(strategy.address), { base: wantTokenBase })}
   borrows:   ${logBN(await debtToken.balanceOf(strategy.address), { base: wantTokenBase })}
   target cr: ${logBN(await strategy.targetCollatRatio(), { base: 18 })}
  `);

  const logAssets = async () =>
    console.log(`
  Assets:
    PM:           ${logBN(await poolManager.getTotalAsset(), { base: wantTokenBase })}
    old strategy: ${logBN(await oldStrategy.estimatedTotalAssets(), { base: wantTokenBase })}
    strategy:     ${logBN(await strategy.estimatedTotalAssets(), { base: wantTokenBase })}
  `);

  const logRates = async () => {
    const rates = await protocolDataProvider.getReserveData(wantToken.address);
    console.log(`
    Rates:
      deposit: ${utils.formatUnits(rates.liquidityRate, 25).slice(0, 6)}%
      borrow: ${utils.formatUnits(rates.variableBorrowRate, 25).slice(0, 6)}%
    `);
  };

  const aavePriceChainlink = await new Contract(
    '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
    [
      'function latestRoundData() external view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
    ],
    deployer,
  ).latestRoundData();
  const aavePrice = (aavePriceChainlink.answer as BigNumber).div(100);
  // const aavePrice = utils.parseUnits('157', 6); // Can be used to update the price manually

  const harvest = async () => {
    /*
    const aTokenBefore = await aToken.balanceOf(strategy.address);
    const debtTokenBefore = await debtToken.balanceOf(strategy.address);
    const crBefore = await strategy.targetCollatRatio();
    const ratesBefore = await protocolDataProvider.getReserveData(wantToken.address);
    */

    console.log('harvesting...');

    await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
    // console.log('gasUsed', receipt.gasUsed.toString());

    const aTokenAfter = await aToken.balanceOf(strategy.address);
    const debtTokenAfter = await debtToken.balanceOf(strategy.address);
    // const crAfter = await strategy.targetCollatRatio();
    const ratesAfter = await protocolDataProvider.getReserveData(wantToken.address);

    const aTokenEmissions = (await incentivesController.assets(aToken.address)).emissionPerSecond.mul(
      60 * 60 * 24 * 365,
    );
    const debtTokenEmissions = (await incentivesController.assets(debtToken.address)).emissionPerSecond.mul(
      60 * 60 * 24 * 365,
    );

    // const aEmissions = aTokenAfter
    //   .mul(aTokenEmissions)
    //   .mul(aavePrice)
    //   .mul(1e9)
    //   .div(await aToken.totalSupply())
    //   .div(aTokenAfter); // BASE 27
    // const debtEmissions = debtTokenAfter
    //   .mul(debtTokenEmissions)
    //   .mul(aavePrice)
    //   .mul(1e9)
    //   .div(await debtToken.totalSupply())
    //   .div(debtTokenAfter); // BASE 27

    // let finalRate = ratesAfter.liquidityRate
    //   .mul(aTokenAfter)
    //   .add(ratesAfter.variableBorrowRate.mul(debtTokenAfter))
    //   .div(aTokenAfter.add(debtTokenAfter));
    // console.log(`finalRate1 ${utils.formatUnits(finalRate, 25).slice(0, 6)}%`);
    // finalRate = finalRate.add(aEmissions).add(debtEmissions);

    const aEmissions = aTokenAfter
      .mul(aTokenEmissions)
      .mul(aavePrice)
      .mul(1e3)
      .div(await aToken.totalSupply()); // BASE 27
    const debtEmissions = debtTokenAfter
      .mul(debtTokenEmissions)
      .mul(aavePrice)
      .mul(1e3)
      .div(await debtToken.totalSupply()); // BASE 27

    const interests = ratesAfter.liquidityRate
      .mul(aTokenAfter)
      .sub(ratesAfter.variableBorrowRate.mul(debtTokenAfter))
      .div(1e6);
    const totalUSD = aEmissions.add(debtEmissions).add(interests);
    const strategyDebt = (await poolManager.strategies(strategy.address)).totalStrategyDebt;
    const finalRate = totalUSD.div(strategyDebt); // BASE 21

    // console.log(`
    // ==========================
    // deposits: ${logBN(aTokenBefore)} -> ${logBN(aTokenAfter)} (${logBN(aTokenAfter.sub(aTokenBefore), { sign: true })})
    // rate: ${utils.formatUnits(ratesBefore.liquidityRate, 25).slice(0, 6)}% -> ${utils
    //   .formatUnits(ratesAfter.liquidityRate, 25)
    //   .slice(0, 6)}%

    // borrows: ${logBN(debtTokenBefore)} -> ${logBN(debtTokenAfter)} (${logBN(debtTokenAfter.sub(debtTokenBefore), {
    //   sign: true,
    // })})
    // rate: ${utils.formatUnits(ratesBefore.variableBorrowRate, 25).slice(0, 6)}% -> ${utils
    //   .formatUnits(ratesAfter.variableBorrowRate, 25)
    //   .slice(0, 6)}%

    // cr: ${logBN(crBefore, { base: 18 })} -> ${logBN(crAfter, { base: 18 })}

    // finalRate: ${utils.formatUnits(finalRate, 19).slice(0, 6)}% (aRewards: ${utils
    //   .formatUnits(aEmissions.div(aTokenAfter), 19)
    //   .slice(0, 6)}% / debtRewards: ${
    //   debtTokenAfter.eq(0) ? '0' : utils.formatUnits(debtEmissions.div(debtTokenAfter), 19).slice(0, 6)
    // }%)
    // ==========================
    // `);
  };

  return {
    _wantToken,
    strategy,
    lendingPool,
    protocolDataProvider,
    stkAave,
    poolManager,
    incentivesController,
    oldStrategy,
    realGuardian,
    richUSDCUser,
    aToken,
    debtToken,
    wantToken,
    aavePrice,
    logAssets,
    logBalances,
    logPosition,
    logRates,
    harvest,
  };
}
