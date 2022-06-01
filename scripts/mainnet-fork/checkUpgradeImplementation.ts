import { Contract, utils } from 'ethers';
import {
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableProxy,
  AaveFlashloanStrategy,
  AaveFlashloanStrategy__factory,
} from '../../typechain';
import { network, ethers } from 'hardhat';
import { expect } from 'chai';

export async function deploy(
  contractName: string,
  // eslint-disable-next-line
  args: any[] = [],
  // eslint-disable-next-line
  options: Record<string, any> & { libraries?: Record<string, string> } = {},
): Promise<Contract> {
  const factory = await ethers.getContractFactory(contractName, options);
  const contract = await factory.deploy(...args);
  return contract;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  await network.provider.send('hardhat_setBalance', [deployer.address, '0xde0b6b3a7640000']);

  const _governor = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
  const _proxyAdmin = '0x1D941EF0D3Bba4ad67DBfBCeE5262F4CEE53A32b';
  const strategyAddress = '0x1F847FD5E08Fb559A69280A14e7E904e6DBfF81f';

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [_governor],
  });
  const governor = await ethers.getSigner(_governor);
  await network.provider.send('hardhat_setBalance', [governor.address, '0xde0b6b3a7640000']);

  const proxyAdmin = new Contract(_proxyAdmin, ['function upgrade(address proxy, address implementation) public']);

  const strategyImplementationFactory = await ethers.getContractFactory('AaveFlashloanStrategy', {
    libraries: { FlashMintLib: '0x169487a55dE79476125A56B07C36cA8dbF37a373' },
  });
  const proxy = new Contract(
    strategyAddress,
    TransparentUpgradeableProxy__factory.abi,
    deployer,
  ) as TransparentUpgradeableProxy;
  const strategy = new Contract(strategyAddress, AaveFlashloanStrategy__factory.abi, deployer) as AaveFlashloanStrategy;

  const strategyImplementation = await strategyImplementationFactory.connect(deployer).deploy();

  await proxyAdmin.connect(governor).upgrade(proxy.address, strategyImplementation.address);

  expect((await strategy.cooldownSeconds()).toString()).to.equal('864000');
  expect(await strategy.boolParams()).to.include.any.keys([
    'automaticallyComputeCollatRatio',
    'isFlashMintActive',
    'withdrawCheck',
    'cooldownStkAave',
  ]);
  expect(utils.formatEther(await strategy.maxCollatRatio())).to.equal('0.845');
  expect(utils.formatUnits(await strategy.discountFactor(), 4)).to.equal('0.9');
  expect(await strategy.want()).to.equal('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
}

main();
