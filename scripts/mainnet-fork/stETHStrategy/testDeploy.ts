// This script is to be run after having run `unpauseCollat.ts`
import {
  PerpetualManagerFront,
  // eslint-disable-next-line camelcase
  Perpetual_Manager_Interface,
  PoolManager,
  // eslint-disable-next-line camelcase
  PoolManager_Interface,
  StableMasterFront,
  // eslint-disable-next-line camelcase
  StableMasterFront_Interface,
  Weth,
  Weth__factory,
} from '@angleprotocol/sdk/dist/constants/interfaces';

import { expect } from '../../../test/test-utils/chai-setup';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { network, ethers, deployments } from 'hardhat';
import { parseUnits } from 'ethers/lib/utils';
import {
  logGeneralInfo,
  logSLP,
  logStETHInfo,
  randomDeposit,
  randomMint,
  randomWithdraw,
  wait,
} from '../../../test/utils-interaction';
import { StETHStrategy, StETHStrategy__factory } from '../../../typechain';

async function main() {
  // =============== Simulation parameters ====================
  const { deployer } = await ethers.getNamedSigners();

  // If we're in mainnet fork, we're using the json.mainnet address
  // eslint-disable-next-line
  let json = (await import('../../../deploy/networks/mainnet.json')) as any;
  if (network.live) {
    json = await import('../../../deploy/networks/' + network.name + '.json');
  }

  await network.provider.send('hardhat_setBalance', [deployer.address, parseUnits('1000000', 18).toHexString()]);

  const wETHAddress = json.WETH;
  const wETH = (await ethers.getContractAt(Weth__factory.abi, wETHAddress)) as Weth;

  // wrap some
  await wETH.connect(deployer).deposit({ value: parseUnits('800000', 18) });

  const stableMasterAddressInt = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.StableMaster;
  const poolManagerAddress = '0x7c2C494D8791654e9F6d5d6f2FCFFc27e79A2Cea';
  const perpetualManagerAddress = '0xb9207130832b4863d01452d7411FaE1408005078';
  const strategyAddress = (await deployments.get('StETHStrategy')).address;

  const stableMasterAddress: string = stableMasterAddressInt !== undefined ? stableMasterAddressInt : '0x';

  const stableMaster = new ethers.Contract(
    stableMasterAddress,
    StableMasterFront_Interface,
    deployer,
  ) as StableMasterFront;
  const perpetualManager = new ethers.Contract(
    perpetualManagerAddress,
    Perpetual_Manager_Interface,
    deployer,
  ) as PerpetualManagerFront;
  const poolManager = new ethers.Contract(poolManagerAddress, PoolManager_Interface, deployer) as PoolManager;
  const strategy = new ethers.Contract(
    strategyAddress,
    StETHStrategy__factory.createInterface(),
    deployer,
  ) as StETHStrategy;

  await randomMint(deployer, stableMaster, poolManager);
  await randomDeposit(deployer, stableMaster, poolManager);
  await wait();

  // not a keeper
  await expect(strategy.connect(deployer)['harvest(uint256)'](0)).to.be.reverted;

  for (let i = 0; i < 20; i++) {
    if (i % 5 === 0) {
      await (await strategy['harvest()']()).wait();
      await logGeneralInfo(stableMaster, poolManager, perpetualManager);
      await logSLP(stableMaster, poolManager);
      await logStETHInfo(stableMaster, poolManager, strategy);
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
