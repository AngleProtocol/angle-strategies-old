import { network } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, ChainId, Interfaces } from '@angleprotocol/sdk';
import { BigNumber, Contract } from 'ethers';
import { PoolManager, StETHStrategy__factory } from '../typechain';
import { parseUnits } from 'ethers/lib/utils';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();
  const collats = ['WETH'];

  let guardian: string;
  let governor: string;
  let proxyAdmin: string;

  // if fork we suppose that we are in mainnet
  // eslint-disable-next-line
  let json = (await import('./networks/mainnet.json')) as any;
  if (!network.live) {
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET].Guardian!;
    governor = CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig! as string;
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin! as string;
  } else {
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].Guardian!;
    governor = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].GovernanceMultiSig! as string;
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin! as string;
    json = await import('./networks/' + network.name + '.json');
  }

  let strategyImplementation = await deployments.getOrNull('StETHStrategy_Implementation');

  if (!strategyImplementation) {
    strategyImplementation = await deploy('StETHStrategy_Implementation', {
      contract: 'StETHStrategy',
      from: deployer.address,
      args: [],
    });
    console.log('success: deployed strategy implementation', strategyImplementation.address);
  } else {
    console.log('strategy implementation already deployed: ', strategyImplementation.address);
  }

  for (const collat in collats) {
    let poolManager: PoolManager;
    // if fork we suppose that we are in mainnet
    if (!network.live) {
      // in this specific case the poolManager is not already deploy we need to hardcode the address
      // const poolManagerAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR.collaterals![collat].PoolManager as string;
      const poolManagerAddress = '0x7c2C494D8791654e9F6d5d6f2FCFFc27e79A2Cea';
      poolManager = new Contract(poolManagerAddress, Interfaces.PoolManager_Interface) as PoolManager;
    } else {
      poolManager = new Contract(
        CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR.collaterals![collats[collat]]
          .PoolManager as string,
        Interfaces.PoolManager_Interface,
      ) as PoolManager;
    }
    console.log(`collat: ${collats[collat]}, poolManager: ${poolManager.address}`);

    const curvePool = json.Curve.StableSwapStETHnETH;
    const wETH = json.WETH;
    const stETH = json.STETH;
    console.log(`Needed addresses \n: Curve pool:${curvePool} \n wETH:${wETH} \n stETH:${stETH} \n`);

    const initializeData = StETHStrategy__factory.createInterface().encodeFunctionData('initialize', [
      poolManager.address,
      governor,
      guardian,
      [],
      curvePool,
      wETH,
      stETH,
      parseUnits('3.9', 16),
    ]);

    const proxyStrategy = await deploy('StETHStrategy', {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      args: [strategyImplementation.address, proxyAdmin, initializeData],
    });

    console.log('Implementation deployed at address: ', strategyImplementation.address);
    console.log('Strategy StETH (proxy) successfully deployed at address: ', proxyStrategy.address);
    console.log(
      `Deploy cost: ${(strategyImplementation.receipt?.gasUsed as BigNumber)?.toString()} (implem) + ${(
        proxyStrategy.receipt?.gasUsed as BigNumber
      )?.toString()} (proxy)`,
    );
  }
};

func.tags = ['collat_strategyStETH'];
// func.dependencies = ['collat'];
export default func;
