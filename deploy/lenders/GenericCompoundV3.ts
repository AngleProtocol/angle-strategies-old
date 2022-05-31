import { network } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { CONTRACTS_ADDRESSES, ChainId } from '@angleprotocol/sdk';
import { BigNumber } from 'ethers';
import {
  ERC20,
  ERC20__factory,
  GenericCompoundUpgradeable,
  GenericCompoundUpgradeable__factory,
  OptimizerAPRStrategy,
  OptimizerAPRStrategy__factory,
} from '../../typechain';
import { parseUnits } from 'ethers/lib/utils';
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

  const lenderImplementationAddress = (await ethers.getContract(`GenericCompoundV3_Implementation`)).address;
  console.log('deployed lender Compound implementation', lenderImplementationAddress);
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

    const token = (await ethers.getContractAt(ERC20__factory.abi, json[collateralName])) as ERC20;
    const tokenDecimal = await token.decimals();
    const cToken = json.Compound[collateralName];

    console.log('token ', token.address);
    console.log('cToken ', cToken);

    const initializeData = GenericCompoundUpgradeable__factory.createInterface().encodeFunctionData('initialize', [
      strategyAddress,
      `Compound Lender ${collateralName}`,
      cToken,
      [governor],
      guardian,
      [keeper],
    ]);

    const proxyLender = await deploy(`GenericCompoundV3_${collateralName}`, {
      contract: 'TransparentUpgradeableProxy',
      from: deployer.address,
      args: [lenderImplementationAddress, proxyAdminAddress, initializeData],
    });

    console.log(
      `Lender GenericCompoundV3_${collateralName} (proxy) successfully deployed at address: `,
      proxyLender.address,
    );
    console.log(`Deploy cost: ${(proxyLender.receipt?.gasUsed as BigNumber)?.toString()} (proxy)`);

    if (!network.live) {
      await network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [governor],
      });
      const governorSigner = await ethers.getSigner(governor);
      await network.provider.send('hardhat_setBalance', [governor, '0x10000000000000000000000000000']);

      const lenderCompound = new ethers.Contract(
        proxyLender.address,
        GenericCompoundUpgradeable__factory.createInterface(),
        deployer,
      ) as GenericCompoundUpgradeable;

      const strategy = new ethers.Contract(
        strategyAddress,
        OptimizerAPRStrategy__factory.createInterface(),
        deployer,
      ) as OptimizerAPRStrategy;

      await impersonate(guardian, async acc => {
        await network.provider.send('hardhat_setBalance', [guardian, '0x10000000000000000000000000000']);
        await await lenderCompound.connect(acc).setDust(parseUnits('1', tokenDecimal + 2));
        console.log('Set dust: success');
        await await strategy.connect(acc).addLender(proxyLender.address);
        console.log('Add lender: success');
      });
    }
  }
};

func.tags = ['genericCompoundV3'];
func.dependencies = ['genericCompoundV3Implementation'];
export default func;
