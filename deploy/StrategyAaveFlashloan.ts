import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, Interfaces } from '@angleprotocol/sdk';
import { BigNumber, Contract } from 'ethers';
import { AaveFlashloanStrategy__factory, PoolManager } from '../typechain';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  const governor = CONTRACTS_ADDRESSES[1].GovernanceMultiSig as string;
  const guardian = CONTRACTS_ADDRESSES[1].Guardian as string;
  const proxyAdmin = '0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b';
  const flashMintLib = '0x169487a55dE79476125A56B07C36cA8dbF37a373'; // (await deployments.getOrNull('FlashMintLib')).address

  const collats: { [key: string]: { interestRateStrategyAddress: string } } = {
    DAI: {
      interestRateStrategyAddress: '0xfffE32106A68aA3eD39CcCE673B646423EEaB62a',
    },
    // USDC: {
    //   interestRateStrategyAddress: '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27',
    // },
  };

  const keeper = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';

  let strategyImplementation = await deployments.getOrNull('AaveFlashloanStrategy_NewImplementation');

  if (!strategyImplementation) {
    strategyImplementation = await deploy('AaveFlashloanStrategy_NewImplementation', {
      contract: 'AaveFlashloanStrategy',
      from: deployer.address,
      args: [],
      libraries: { FlashMintLib: flashMintLib },
    });
    console.log('success: deployed strategy implementation', strategyImplementation.address);
  } else {
    console.log('strategy implementation already deployed: ', strategyImplementation.address);
  }

  for (const collat in collats) {
    const poolManager = new Contract(
      CONTRACTS_ADDRESSES[1].agEUR.collaterals![collat].PoolManager as string,
      Interfaces.PoolManager_Interface,
    ) as PoolManager;

    console.log(`collat: ${collat}, poolManager: ${poolManager.address}`);

    const initializeData = AaveFlashloanStrategy__factory.createInterface().encodeFunctionData('initialize', [
      poolManager.address,
      collats[collat].interestRateStrategyAddress,
      governor,
      guardian,
      [keeper],
    ]);

    const proxy = await deploy(`AaveFlashloanStrategy_${collat}`, {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      args: [strategyImplementation.address, proxyAdmin, initializeData],
    });

    console.log('Implementation deployed at address: ', strategyImplementation.address);
    console.log(`Strategy AaveFlashloanStrategy_${collat} (proxy) successfully deployed at address: `, proxy.address);
    console.log(
      `Deploy cost: ${(strategyImplementation.receipt?.gasUsed as BigNumber)?.toString()} (implem) + ${(
        proxy.receipt?.gasUsed as BigNumber
      )?.toString()} (proxy)`,
    );
  }
};

func.tags = ['aave_flashloan_strategy'];
export default func;
