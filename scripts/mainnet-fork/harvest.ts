// This script is to be run after having run `unpauseCollat.ts`
import {
  PoolManager,
  // eslint-disable-next-line camelcase
  PoolManager_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { network, ethers } from 'hardhat';
import { parseUnits } from 'ethers/lib/utils';
import { ERC20, ERC20__factory, OptimizerAPRStrategy, OptimizerAPRStrategy__factory } from '../../typechain';
import { logBN } from '../../test/utils-interaction';

async function main() {
  // =============== Simulation parameters ====================
  const { deployer } = await ethers.getNamedSigners();

  const collateralName = 'USDC';

  let strategyAddress: string;
  let poolManagerAddress: string;

  if (!network.live) {
    poolManagerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.Strategies
      ?.GenericOptimisedLender as string;
  } else {
    poolManagerAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.Strategies?.GenericOptimisedLender as string;
  }

  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const wantToken = (await ethers.getContractAt(ERC20__factory.abi, USDC)) as ERC20;

  const strategy = new ethers.Contract(
    strategyAddress,
    OptimizerAPRStrategy__factory.createInterface(),
    deployer,
  ) as OptimizerAPRStrategy;
  const poolManager = new ethers.Contract(poolManagerAddress, PoolManager_Interface, deployer) as PoolManager;

  await network.provider.send('hardhat_setBalance', [deployer.address, parseUnits('1000000', 18).toHexString()]);

  console.log('All contracts loaded');

  console.log(`
  Balance before:
   \t${logBN(await wantToken.balanceOf(poolManager.address), { base: 6 })}
  `);

  await (await strategy['harvest()']()).wait();
  console.log('harvest');

  console.log(`
  Balance After:
   \t${logBN(await wantToken.balanceOf(poolManager.address), { base: 6 })}
  `);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
