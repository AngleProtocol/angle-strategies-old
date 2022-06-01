import { ethers, network } from 'hardhat';
import { Contract, ContractFactory, Wallet } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { TransparentUpgradeableProxy__factory } from '../../typechain';

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

export async function latestTime(): Promise<number> {
  const { timestamp } = await ethers.provider.getBlock(await ethers.provider.getBlockNumber());

  return timestamp as number;
}

export const randomAddress = () => Wallet.createRandom().address;

export async function impersonate(
  address: string,
  cb?: (_account: SignerWithAddress) => Promise<void>,
  stopImpersonating = true,
): Promise<SignerWithAddress> {
  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });

  const account = await ethers.getSigner(address);
  if (cb) {
    await cb(account);
  }

  if (stopImpersonating) {
    await network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [address],
    });
  }
  return account;
}

// eslint-disable-next-line
export async function deployUpgradeable(factory: ContractFactory, ...args: any[]): Promise<Contract> {
  const { deployer, proxyAdmin, user } = await ethers.getNamedSigners();

  const Implementation = args.length === 0 ? await factory.deploy() : await factory.deploy(args[0], args[1]);
  const Proxy = await new TransparentUpgradeableProxy__factory(deployer).deploy(
    Implementation.address,
    proxyAdmin.address,
    '0x',
  );

  return new Contract(Proxy.address, factory.interface, user);
}
