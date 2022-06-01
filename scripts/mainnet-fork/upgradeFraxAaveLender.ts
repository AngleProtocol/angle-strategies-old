// This script is to be run after having run `unpauseCollat.ts`
import {
  PerpetualManagerFront,
  PerpetualManagerFront__factory,
  PoolManager,
  // eslint-disable-next-line camelcase
  PoolManager_Interface,
  StableMasterFront,
  StableMasterFront__factory,
} from '@angleprotocol/sdk/dist/constants/interfaces';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { network, ethers } from 'hardhat';
import { parseUnits } from 'ethers/lib/utils';
import {
  logGeneralInfo,
  logOptimizerInfo,
  logSLP,
  randomDeposit,
  randomWithdraw,
  wait,
} from '../../test/utils-interaction';
import { OptimizerAPRStrategy, OptimizerAPRStrategy__factory } from '../../typechain';
import { time } from '../../test/test-utils/helpers';
import { DAY } from '../../test/contants';

async function main() {
  // =============== Simulation parameters ====================
  const { deployer } = await ethers.getNamedSigners();
  const collateralName = 'FRAX';

  let strategyAddress: string;
  let stableMasterAddress: string;
  let poolManagerAddress: string;
  let perpetualManagerAddress: string;

  if (!network.live) {
    stableMasterAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.StableMaster as string;
    perpetualManagerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]
      ?.PerpetualManager as string;
    poolManagerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.Strategies
      ?.GenericOptimisedLender as string;
  } else {
    stableMasterAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.StableMaster as string;
    perpetualManagerAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[
      collateralName
    ]?.PerpetualManager as string;
    poolManagerAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.Strategies?.GenericOptimisedLender as string;
  }

  // const newLenderAddress = (await deployments.get(`GenericAave_${stableName}_${collateralName}_Staker`)).address;

  const stableMaster = new ethers.Contract(
    stableMasterAddress,
    StableMasterFront__factory.createInterface(),
    deployer,
  ) as StableMasterFront;
  const perpetualManager = new ethers.Contract(
    perpetualManagerAddress,
    PerpetualManagerFront__factory.createInterface(),
    deployer,
  ) as PerpetualManagerFront;
  const strategy = new ethers.Contract(
    strategyAddress,
    OptimizerAPRStrategy__factory.createInterface(),
    deployer,
  ) as OptimizerAPRStrategy;
  /*
  const oldLender = new ethers.Contract(
    oldLenderAddress,
    GenericAaveNoStaker__factory.createInterface(),
    deployer,
  ) as GenericAaveNoStaker;
  const newLender = new ethers.Contract(
    newLenderAddress,
    GenericAaveFraxStaker__factory.createInterface(),
    deployer,
  ) as GenericAaveFraxStaker;
  */
  const poolManager = new ethers.Contract(poolManagerAddress, PoolManager_Interface, deployer) as PoolManager;

  await network.provider.send('hardhat_setBalance', [deployer.address, parseUnits('1000000', 18).toHexString()]);

  console.log('All contracts loaded');
  //   await randomMint(deployer, stableMaster, poolManager);
  //   await randomDeposit(deployer, stableMaster, poolManager);
  //   await wait();
  await logGeneralInfo(stableMaster, poolManager, perpetualManager);
  await logSLP(stableMaster, poolManager);
  await logOptimizerInfo(stableMaster, poolManager, strategy);

  for (let i = 0; i < 20; i++) {
    if (i % 5 === 0) {
      await time.increase(DAY);
      await (await strategy['harvest()']()).wait();
      console.log('harvest');

      await logGeneralInfo(stableMaster, poolManager, perpetualManager);
      await logSLP(stableMaster, poolManager);
      await logOptimizerInfo(stableMaster, poolManager, strategy);
    }
    const randomValue = Math.random();
    if (randomValue < 0.5) await randomDeposit(deployer, stableMaster, poolManager);
    else await randomWithdraw(deployer, stableMaster, poolManager);
    await wait();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
