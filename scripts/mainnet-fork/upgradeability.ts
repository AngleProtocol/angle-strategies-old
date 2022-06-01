import { UpgradeableContract } from '@openzeppelin/upgrades-core';
import { artifacts } from 'hardhat';

const testUpgradeability = async (name: string, file: string) => {
  const buildInfo = await artifacts.getBuildInfo(`${file}:${name}`);
  // eslint-disable-next-line
  const baseContract = new UpgradeableContract(name, buildInfo?.input as any, buildInfo?.output as any);
  console.log(name);
  console.log(baseContract.getErrorReport().explain());
  console.log('');
};

const testStorage = async (name: string, file: string, nameUpgrade: string, fileUpgrade: string) => {
  const buildInfo = await artifacts.getBuildInfo(`${file}:${name}`);
  // eslint-disable-next-line
  const baseContract = new UpgradeableContract(name, buildInfo?.input as any, buildInfo?.output as any);

  const upgradeBuildInfo = await artifacts.getBuildInfo(`${fileUpgrade}:${nameUpgrade}`);
  const upgradeContract = new UpgradeableContract(
    nameUpgrade,
    // eslint-disable-next-line
    upgradeBuildInfo?.input as any,
    // eslint-disable-next-line
    upgradeBuildInfo?.output as any,
  );
  console.log('Upgrade Testing');
  console.log(baseContract.getStorageUpgradeReport(upgradeContract).explain());
  console.log('');
};

async function main() {
  // Uncomment to check all valid build names
  // console.log((await artifacts.getAllFullyQualifiedNames()));

  testUpgradeability('GenericCompoundUpgradeableOld', 'contracts/deprecated/GenericCompoundUpgradeableOld.sol');
  testUpgradeability(
    'GenericCompoundUpgradeable',
    'contracts/strategies/OptimizerAPR/genericLender/GenericCompoundUpgradeable.sol',
  );
  testStorage(
    'GenericCompoundUpgradeableOld',
    'contracts/deprecated/GenericCompoundUpgradeableOld.sol',
    'GenericCompoundUpgradeable',
    'contracts/strategies/OptimizerAPR/genericLender/GenericCompoundUpgradeable.sol',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
