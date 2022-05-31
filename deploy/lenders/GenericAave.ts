import { network } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { BigNumber } from 'ethers';
import { GenericAaveNoStaker__factory, OptimizerAPRStrategy, OptimizerAPRStrategy__factory } from '../../typechain';
import { impersonate } from '../../test/test-utils';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer, keeper: fakeKeeper } = await ethers.getNamedSigners();
  const collats = ['USDC', 'DAI'];

  let guardian: string;
  let governor: string;
  let strategyAddress, proxyAdminAddress: string;
  let keeper: string;

  // if fork we suppose that we are in mainnet
  // eslint-disable-next-line
  let json = (await import('../networks/mainnet.json')) as any;
  if (!network.live) {
    guardian = CONTRACTS_ADDRESSES[ChainId.MAINNET].Guardian as string;
    governor = CONTRACTS_ADDRESSES[ChainId.MAINNET].GovernanceMultiSig as string;
    proxyAdminAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].ProxyAdmin as string;
    keeper = '0xcC617C6f9725eACC993ac626C7efC6B96476916E';
  } else {
    guardian = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].Guardian!;
    governor = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].GovernanceMultiSig as string;
    proxyAdminAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].ProxyAdmin as string;
    keeper = fakeKeeper.address;
  }

  const lenderImplementationAddress = (await ethers.getContract(`GenericAaveNoStaker_Implementation`)).address;
  console.log('deployed lender Aave implementation', lenderImplementationAddress);
  console.log('');

  for (const collat in collats) {
    const collateralName = collats[collat];
    console.log('');
    console.log('Handling collat: ', collateralName);
    if (!network.live) {
      strategyAddress = CONTRACTS_ADDRESSES[ChainId.MAINNET].agEUR?.collaterals?.[collateralName]?.Strategies
        ?.GenericOptimisedLender as string;
    } else {
      strategyAddress = CONTRACTS_ADDRESSES[network.config.chainId as ChainId].agEUR?.collaterals?.[collateralName]
        ?.Strategies?.GenericOptimisedLender as string;
    }

    const initializeData = GenericAaveNoStaker__factory.createInterface().encodeFunctionData('initialize', [
      strategyAddress,
      `Aave Lender ${collateralName}`,
      true,
      [governor],
      guardian,
      [keeper],
    ]);

    const proxyLender = await deploy(`GenericAaveNoStaker_${collateralName}`, {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      args: [lenderImplementationAddress, proxyAdminAddress, initializeData],
    });

    console.log(
      `Lender GenericAaveNoStaker_${collateralName} (proxy) successfully deployed at address: `,
      proxyLender.address,
    );
    console.log(`Deploy cost: ${(proxyLender.receipt?.gasUsed as BigNumber)?.toString()} (proxy)`);

    if (!network.live) {
      const strategy = new ethers.Contract(
        strategyAddress,
        OptimizerAPRStrategy__factory.createInterface(),
        deployer,
      ) as OptimizerAPRStrategy;

      await impersonate(guardian, async acc => {
        await network.provider.send('hardhat_setBalance', [guardian, '0x10000000000000000000000000000']);
        await await strategy.connect(acc).addLender(proxyLender.address);
        console.log('Add lender: success');
      });
    }
  }
};

func.tags = ['genericAave'];
func.dependencies = ['genericAaveImplementation'];
export default func;
