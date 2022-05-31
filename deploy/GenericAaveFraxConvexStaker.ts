import hre, { network } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { GenericAaveFraxStaker__factory, OptimizerAPRStrategy, OptimizerAPRStrategy__factory } from '../typechain';
import { DAY } from '../test/contants';
import { BigNumber } from 'ethers';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer, keeper: fakeKeeper } = await ethers.getNamedSigners();

  const stableName = 'EUR';
  const collateralName = 'FRAX';

  let strategyAddress: string;
  let oldLenderAddress: string;
  let guardian: string;
  let governor: string;
  let keeper: string;
  let proxyAdmin: string;

  // If fork we suppose that we are in mainnet
  if (!network.live) {
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET].Guardian!;
    governor = CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig! as string;
    proxyAdmin = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin! as string;
    strategyAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.Strategies
      ?.GenericOptimisedLender as string;
    oldLenderAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.GenericAave as string;
    keeper = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';
  } else {
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].Guardian!;
    governor = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].GovernanceMultiSig! as string;
    proxyAdmin = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin! as string;
    strategyAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.Strategies?.GenericOptimisedLender as string;
    oldLenderAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
      ?.GenericAave as string;
    keeper = fakeKeeper.address;
  }

  const strategy = new ethers.Contract(
    strategyAddress,
    OptimizerAPRStrategy__factory.createInterface(),
    deployer,
  ) as OptimizerAPRStrategy;

  let lenderImplementation = await deployments.getOrNull(
    `GenericAave_${stableName}_${collateralName}_Convex_Staker_Implementation`,
  );
  if (!lenderImplementation) {
    lenderImplementation = await deploy(`GenericAave_${stableName}_${collateralName}_Convex_Staker_Implementation`, {
      contract: 'GenericAaveFraxConvexStaker',
      from: deployer.address,
      args: [],
    });
    console.log('success: deployed strategy implementation', lenderImplementation.address);
  } else {
    console.log('strategy implementation already deployed: ', lenderImplementation.address);
  }

  const initializeData = GenericAaveFraxStaker__factory.createInterface().encodeFunctionData('initialize', [
    strategy.address,
    'FRAXStaker',
    true,
    [governor],
    guardian,
    [keeper],
    DAY,
  ]);

  const proxyLender = await deploy(`GenericAave_${stableName}_${collateralName}_Convex_Staker`, {
    contract: 'TransparentUpgradeableProxy',
    from: deployer.address,
    args: [lenderImplementation.address, proxyAdmin, initializeData],
  });

  console.log('Implementation deployed at address: ', lenderImplementation.address);
  console.log('Aave Lender with FRAX staking (proxy) successfully deployed at address: ', proxyLender.address);
  console.log(
    `Deploy cost: ${(lenderImplementation.receipt?.gasUsed as BigNumber)?.toString()} (implem) + ${(
      proxyLender.receipt?.gasUsed as BigNumber
    )?.toString()} (proxy)`,
  );

  // The lender still needs to be plugged to the strategy
  if (!network.live) {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [governor],
    });
    await hre.network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);
    const signer = await ethers.getSigner(governor);

    await (await strategy.connect(signer).addLender(proxyLender.address)).wait();
    const tx = await (await strategy.connect(signer).forceRemoveLender(oldLenderAddress)).wait();
    console.log('remove lender tx: ', tx.transactionHash);
  }
};

func.tags = ['lenderConvexAFraxStaking'];
export default func;
