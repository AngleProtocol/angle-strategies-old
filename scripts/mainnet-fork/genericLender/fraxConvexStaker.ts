// This script is to be run after having run `unpauseCollat.ts`
import {
  PoolManager,
  // eslint-disable-next-line camelcase
  PoolManager_Interface,
} from '@angleprotocol/sdk/dist/constants/interfaces';

import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { network, ethers } from 'hardhat';
import { parseUnits } from 'ethers/lib/utils';
import { OptimizerAPRStrategy, OptimizerAPRStrategy__factory } from '../../../typechain';
import { DAY } from '../../../test/contants';

async function main() {
  // =============== Simulation parameters ====================
  const { deployer } = await ethers.getNamedSigners();

  const collateralName = 'FRAX';

  let strategyAddress: string;
  let poolManagerAddress: string;
  let guardian: string;

  if (!network.live) {
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET].Guardian!;
    poolManagerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.Strategies
      ?.GenericOptimisedLender as string;
  } else {
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].Guardian!;
    poolManagerAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.PoolManager as string;
    strategyAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.Strategies?.GenericOptimisedLender as string;
  }

  // const FRAX = '0x853d955aCEf822Db058eb8505911ED77F175b99e';
  // const wantToken = (await ethers.getContractAt(ERC20__factory.abi, FRAX)) as ERC20;

  const strategy = new ethers.Contract(
    strategyAddress,
    OptimizerAPRStrategy__factory.createInterface(),
    deployer,
  ) as OptimizerAPRStrategy;
  const poolManager = new ethers.Contract(poolManagerAddress, PoolManager_Interface, deployer) as PoolManager;

  await network.provider.send('hardhat_setBalance', [deployer.address, parseUnits('1000000', 18).toHexString()]);

  console.log('All contracts loaded');

  //   const tx1 = await (await strategy['harvest()']()).wait();
  //   console.log('tx1: ', tx1.transactionHash);
  //   console.log('1st harvest');

  //   await time.increase(DAY * 7);
  const { timestamp } = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());
  await network.provider.send('evm_setNextBlockTimestamp', [timestamp + 7 * DAY]);
  await network.provider.send('evm_mine');
  console.log('increased time');

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [guardian],
  });
  await network.provider.send('hardhat_setBalance', [guardian, '0x10000000000000000000000000000']);
  const signer = await ethers.getSigner(guardian);
  await poolManager.connect(signer).updateStrategyDebtRatio(strategy.address, parseUnits('0.5', 9));

  console.log('update strategy debt ratio');

  const tx2 = await (await strategy['harvest()']()).wait();
  console.log('tx2: ', tx2.transactionHash);

  console.log('2nd harvest');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
