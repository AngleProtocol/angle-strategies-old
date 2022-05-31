// This script is to be run after having run `unpauseCollat.ts`
import {
  PerpetualManagerFront,
  // eslint-disable-next-line camelcase
  Perpetual_Manager_Interface,
  PoolManager,
  // eslint-disable-next-line camelcase
  PoolManager_Interface,
  SanToken,
  SanToken__factory,
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
  logBN,
  logGeneralInfo,
  logSLP,
  logStETHInfo,
  // randomBurn,
  randomDeposit,
  randomMint,
  // randomWithdraw,
  wait,
} from '../../../test/utils-interaction';
import {
  IStableSwapPool,
  IStableSwapPool__factory,
  ISteth,
  ISteth__factory,
  StETHStrategy,
  StETHStrategy__factory,
} from '../../../typechain';

async function main() {
  // =============== Simulation parameters ====================
  const { deployer, user: richStETH } = await ethers.getNamedSigners();

  // If we're in mainnet fork, we're using the json.mainnet address
  // eslint-disable-next-line
  const json = (await import('../../../deploy/networks/mainnet.json')) as any;

  const governance = CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig! as string;

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [governance],
  });
  const govSigner = await ethers.getSigner(governance);
  await network.provider.send('hardhat_setBalance', [governance, '0x10000000000000000000000000000']);
  await network.provider.send('hardhat_setBalance', [deployer.address, parseUnits('1000000', 18).toHexString()]);
  await network.provider.send('hardhat_setBalance', [richStETH.address, parseUnits('1000000', 18).toHexString()]);

  const wETHAddress = json.WETH;
  const stETHAddress = json.STETH;
  const curvePoolAddress = json.Curve.StableSwapStETHnETH;

  const wETH = (await ethers.getContractAt(Weth__factory.abi, wETHAddress)) as Weth;
  // const wETHERC20 = (await ethers.getContractAt(ERC20__factory.abi, wETHAddress)) as ERC20;

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
  const stETH = new ethers.Contract(stETHAddress, ISteth__factory.createInterface(), deployer) as ISteth;
  const curvePool = new ethers.Contract(
    curvePoolAddress,
    IStableSwapPool__factory.createInterface(),
    deployer,
  ) as IStableSwapPool;

  // stETH sumbit and make the curve pool imbalance to make expensive to swap stETH for ETH
  await stETH.connect(richStETH).submit(richStETH.address, { value: parseUnits('800000', 18) });
  const WETHID = 0;
  const STETHID = 1;
  await stETH.connect(richStETH).approve(curvePoolAddress, ethers.constants.MaxUint256);
  console.log(`
   balance STETH:\t${logBN(await stETH.balanceOf(richStETH.address), { base: 18 })}
   balance curve stETH:\t${logBN(await stETH.balanceOf(curvePool.address), { base: 18 })}
   balance ETH:\t${logBN(await ethers.provider.getBalance(richStETH.address), { base: 18 })}
   balance curve ETH:\t${logBN(await ethers.provider.getBalance(curvePool.address), { base: 18 })}
  `);

  const supposedAmount = await curvePool.connect(richStETH).get_dy(STETHID, WETHID, parseUnits('100000', 18));
  console.log(`
     suppose ETH:\t${logBN(supposedAmount, { base: 18 })}
    `);
  await curvePool.connect(richStETH).exchange(STETHID, WETHID, parseUnits('100000', 18), ethers.constants.Zero);

  await randomMint(deployer, stableMaster, poolManager);
  await randomDeposit(deployer, stableMaster, poolManager);
  await strategy.connect(deployer)['harvest()']();
  await logGeneralInfo(stableMaster, poolManager, perpetualManager);
  await logSLP(stableMaster, poolManager);
  await logStETHInfo(stableMaster, poolManager, strategy);

  await wait();

  // empty the reserve of the poolManager to make him withdraw on Curve
  const sanTokenAddress = (await stableMaster.collateralMap(poolManager.address)).sanToken;
  const sanToken = (await ethers.getContractAt(SanToken__factory.abi, sanTokenAddress)) as SanToken;
  await sanToken.connect(deployer).approve(stableMaster.address, ethers.constants.MaxUint256);
  await stableMaster
    .connect(deployer)
    .withdraw(
      (await wETH.balanceOf(poolManager.address)).mul(parseUnits('9', 0)).div(parseUnits('10', 0)),
      deployer.address,
      deployer.address,
      poolManager.address,
    );

  await logGeneralInfo(stableMaster, poolManager, perpetualManager);
  await logSLP(stableMaster, poolManager);
  await logStETHInfo(stableMaster, poolManager, strategy);
  // update to a really small slippage so tht the tx should revert
  await strategy.connect(govSigner).updateSlippageProtectionOut(parseUnits('1', 1));

  // will revert
  await expect(strategy.connect(deployer)['harvest()']()).to.be.reverted;
  // but this one won't
  await strategy.connect(govSigner).updateSlippageProtectionOut(parseUnits('3000', 1));
  await strategy.connect(deployer)['harvest()']();

  await logGeneralInfo(stableMaster, poolManager, perpetualManager);
  await logSLP(stableMaster, poolManager);
  await logStETHInfo(stableMaster, poolManager, strategy);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
