import { DeployFunction } from 'hardhat-deploy/types';
import { BigNumber } from 'ethers';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  const lenderImplementation = await deploy(`GenericCompoundV3_Implementation`, {
    contract: 'GenericCompoundUpgradeable',
    from: deployer.address,
    args: [],
  });
  console.log('success: deployed lender implementation', lenderImplementation.address);
  console.log(`Deploy cost: ${(lenderImplementation?.receipt?.gasUsed as BigNumber)?.toString()} (implem)`);
  console.log('');
};

func.tags = ['genericCompoundV3Implementation'];
export default func;
