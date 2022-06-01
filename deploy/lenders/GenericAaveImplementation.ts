import { DeployFunction } from 'hardhat-deploy/types';
import { BigNumber } from 'ethers';

const func: DeployFunction = async ({ deployments, ethers }) => {
  const { deploy } = deployments;
  const { deployer } = await ethers.getNamedSigners();

  const lenderImplementation = await deploy(`GenericAaveNoStaker_Implementation`, {
    contract: 'GenericAaveNoStaker',
    from: deployer.address,
    args: [],
  });
  console.log('success: deployed lender implementation', lenderImplementation.address);
  console.log(`Deploy cost: ${(lenderImplementation?.receipt?.gasUsed as BigNumber)?.toString()} (implem)`);
  console.log('');
};

func.tags = ['genericAaveImplementation'];
export default func;
