import { DeployFunction } from 'hardhat-deploy/types';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const [deployer] = await ethers.getSigners();

  // const governor = CONTRACTS_ADDRESSES[1].GovernanceMultiSig as string;
  // const guardian = CONTRACTS_ADDRESSES[1].Guardian as string;
  // const proxyAdmin = '0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b';
  const flashMintLib = '0x169487a55dE79476125A56B07C36cA8dbF37a373'; // (await deployments.getOrNull('FlashMintLib')).address

  // const collats: { [key: string]: { interestRateStrategyAddress: string } } = {
  //   DAI: {
  //     interestRateStrategyAddress: '0xfffE32106A68aA3eD39CcCE673B646423EEaB62a',
  //   },
  //   // USDC: {
  //   //   interestRateStrategyAddress: '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27',
  //   // },
  // };

  // const keeper = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';

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
};

func.tags = ['aave_flashloan_strategy_upgrade'];
export default func;
