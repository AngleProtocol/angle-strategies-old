import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, utils } from 'ethers';
import {
  ERC20,
  ERC20__factory,
  GenericAaveNoStaker,
  GenericAaveNoStaker__factory,
  ILendingPool,
  ILendingPool__factory,
  IStakedAave,
  IStakedAave__factory,
  OptimizerAPRStrategy,
  OptimizerAPRStrategy__factory,
  PoolManager,
} from '../../typechain';
import { gwei } from '../../utils/bignumber';
import { deploy, deployUpgradeable, latestTime, impersonate } from '../test-utils';
import { ethers, network } from 'hardhat';
import { expect } from '../test-utils/chai-setup';
import { BASE_TOKENS } from '../utils';
import { parseUnits, parseEther } from 'ethers/lib/utils';
import { logBN, setTokenBalanceFor } from '../utils-interaction';
import { ZERO_ADDRESS } from '../test-utils/helpers';

async function initStrategy(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  keeper: SignerWithAddress,
  manager: PoolManager,
): Promise<{
  strategy: OptimizerAPRStrategy;
}> {
  const strategy = (await deployUpgradeable(new OptimizerAPRStrategy__factory(guardian))) as OptimizerAPRStrategy;
  await strategy.initialize(manager.address, governor.address, guardian.address, [keeper.address]);
  await manager.connect(governor).addStrategy(strategy.address, gwei('0.8'));
  return { strategy };
}

async function initLenderAave(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  keeper: SignerWithAddress,
  strategy: OptimizerAPRStrategy,
  name: string,
  isIncentivized: boolean,
): Promise<{
  lender: GenericAaveNoStaker;
}> {
  const lender = (await deployUpgradeable(new GenericAaveNoStaker__factory(guardian))) as GenericAaveNoStaker;
  await lender.initialize(strategy.address, name, isIncentivized, [governor.address], guardian.address, [
    keeper.address,
  ]);
  await strategy.connect(governor).addLender(lender.address);
  return { lender };
}

let governor: SignerWithAddress, guardian: SignerWithAddress, user: SignerWithAddress, keeper: SignerWithAddress;
let strategy: OptimizerAPRStrategy;
let token: ERC20;
let tokenDecimal: number;
let FEI: ERC20;
let manager: PoolManager;
let lenderAave: GenericAaveNoStaker;
let aave: ERC20;
let stkAave: IStakedAave;
let lendingPool: ILendingPool;

const guardianRole = ethers.utils.solidityKeccak256(['string'], ['GUARDIAN_ROLE']);
const strategyRole = ethers.utils.solidityKeccak256(['string'], ['STRATEGY_ROLE']);
const keeperRole = ethers.utils.solidityKeccak256(['string'], ['KEEPER_ROLE']);
let guardianError: string;
let strategyError: string;
let keeperError: string;
let oneInch: string;

// Start test block
describe('OptimizerAPR - lenderAave', () => {
  before(async () => {
    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
    // currently FRAX
    token = (await ethers.getContractAt(ERC20__factory.abi, '0x853d955aCEf822Db058eb8505911ED77F175b99e')) as ERC20;
    // USDC = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    // DAI = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    FEI = (await ethers.getContractAt(ERC20__factory.abi, '0x956F47F50A910163D8BF957Cf5846D573E7f87CA')) as ERC20;
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;
    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;
    lendingPool = (await ethers.getContractAt(
      ILendingPool__factory.abi,
      '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    )) as ILendingPool;

    guardianError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${guardianRole}`;
    strategyError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${strategyRole}`;
    keeperError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${keeperRole}`;
    oneInch = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
  });

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            // Changing mainnet fork block breaks some tests
            blockNumber: 14679410,
          },
        },
      ],
    });
    tokenDecimal = await token.decimals();
    manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;
    // managerDAI = (await deploy('PoolManager', [DAI.address, governor.address, guardian.address])) as PoolManager;

    ({ strategy } = await initStrategy(governor, guardian, keeper, manager));
    // ({ strategy: strategyDAI } = await initStrategy(governor, guardian, keeper, managerDAI));

    ({ lender: lenderAave } = await initLenderAave(governor, guardian, keeper, strategy, 'genericAave', true));
    // ({ lender: lenderAaveDAI } = await initLenderAave(governor, guardian, keeper, strategyDAI, 'genericAaveDAI', true));
  });
  describe('Initialization', () => {
    it('success - parameters correctly initialized and allowances granted', async () => {
      expect(await lenderAave.poolManager()).to.be.equal(manager.address);
      expect(await lenderAave.want()).to.be.equal(token.address);
      expect(await lenderAave.wantBase()).to.be.equal(parseUnits('1', await token.decimals()));
      expect(await lenderAave.isIncentivised()).to.be.equal(true);
      expect(await lenderAave.cooldownStkAave()).to.be.equal(true);
      expect(await lenderAave.cooldownSeconds()).to.be.equal(BigNumber.from('864000'));
      expect(await lenderAave.unstakeWindow()).to.be.equal(BigNumber.from('172800'));
      expect(await token.allowance(lenderAave.address, lendingPool.address)).to.be.equal(ethers.constants.MaxUint256);
      expect(await token.allowance(lenderAave.address, strategy.address)).to.be.equal(ethers.constants.MaxUint256);
      expect(await aave.allowance(lenderAave.address, oneInch)).to.be.equal(ethers.constants.MaxUint256);
      expect(await stkAave.allowance(lenderAave.address, oneInch)).to.be.equal(ethers.constants.MaxUint256);
    });
    it('reverts - no incentives on FEI or already initialized', async () => {
      const managerFEI = (await deploy('PoolManager', [
        FEI.address,
        governor.address,
        guardian.address,
      ])) as PoolManager;
      const { strategy: strategyFEI } = await initStrategy(governor, guardian, keeper, managerFEI);

      const lender = (await deployUpgradeable(new GenericAaveNoStaker__factory(guardian))) as GenericAaveNoStaker;
      await expect(
        lender.initialize(strategyFEI.address, 'lender FEI', true, [governor.address], guardian.address, [
          keeper.address,
        ]),
      ).to.be.reverted;
      await expect(
        lenderAave.initialize(strategy.address, 'test', true, [governor.address], guardian.address, [keeper.address]),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
  });

  describe('AccessControl', () => {
    it('success - guardian role - strategy', async () => {
      expect(await strategy.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await strategy.hasRole(guardianRole, governor.address)).to.be.equal(true);
    });
    it('success - keeper role - lender', async () => {
      expect(await lenderAave.hasRole(keeperRole, keeper.address)).to.be.equal(true);
      expect(await lenderAave.hasRole(keeperRole, user.address)).to.be.equal(false);
      expect(await lenderAave.getRoleAdmin(keeperRole)).to.be.equal(guardianRole);
      await expect(lenderAave.connect(user).claimRewards()).to.be.revertedWith(keeperError);
      await expect(lenderAave.connect(user).cooldown()).to.be.revertedWith(keeperError);
      await expect(lenderAave.connect(user).sellRewards(0, '0x')).to.be.revertedWith(keeperError);
    });
    it('success - guardian role - lender', async () => {
      expect(await lenderAave.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await lenderAave.hasRole(guardianRole, user.address)).to.be.equal(false);
      expect(await lenderAave.hasRole(guardianRole, governor.address)).to.be.equal(true);
      expect(await lenderAave.getRoleAdmin(guardianRole)).to.be.equal(strategyRole);
      await expect(lenderAave.connect(user).grantRole(keeperRole, user.address)).to.be.revertedWith(guardianRole);
      await expect(lenderAave.connect(user).revokeRole(keeperRole, keeper.address)).to.be.revertedWith(guardianRole);
      await expect(lenderAave.connect(user).changeAllowance([], [], [])).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).sweep(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).emergencyWithdraw(BASE_TOKENS)).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).toggleIsIncentivised()).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).toggleCooldownStkAave()).to.be.revertedWith(guardianError);
    });
    it('success - strategy role - lender', async () => {
      expect(await lenderAave.hasRole(strategyRole, strategy.address)).to.be.equal(true);
      expect(await lenderAave.hasRole(strategyRole, user.address)).to.be.equal(false);
      expect(await lenderAave.getRoleAdmin(strategyRole)).to.be.equal(guardianRole);
      await expect(lenderAave.connect(user).deposit()).to.be.revertedWith(strategyError);
      await expect(lenderAave.connect(user).withdraw(BASE_TOKENS)).to.be.revertedWith(strategyError);
      await expect(lenderAave.connect(user).withdrawAll()).to.be.revertedWith(strategyError);
    });
  });

  describe('toggle boolean', () => {
    it('cooldownStkAave ', async () => {
      await (await lenderAave.connect(guardian).toggleCooldownStkAave()).wait();
      expect(await lenderAave.cooldownStkAave()).to.be.equal(false);
      await (await lenderAave.connect(guardian).toggleCooldownStkAave()).wait();
      expect(await lenderAave.cooldownStkAave()).to.be.equal(true);
    });
    it('isIncentivised', async () => {
      await (await lenderAave.connect(guardian).toggleIsIncentivised()).wait();
      expect(await lenderAave.isIncentivised()).to.be.equal(false);
      await (await lenderAave.connect(guardian).toggleIsIncentivised()).wait();
      expect(await lenderAave.isIncentivised()).to.be.equal(true);
    });
  });
  describe('View functions', () => {
    it('apr', async () => {
      const apr = await lenderAave.connect(keeper).apr();
      // at mainnet fork time there is 1.193% coming from liquidity rate and 0.050% coming from incentives
      expect(apr).to.be.closeTo(parseUnits('0.0124', 18), parseUnits('0.001', 18));
      expect(await lenderAave.weightedApr()).to.be.equal(0);
    });
    it('apr - when no incentives', async () => {
      const managerFEI = (await deploy('PoolManager', [
        FEI.address,
        governor.address,
        guardian.address,
      ])) as PoolManager;
      const { strategy: strategyFEI } = await initStrategy(governor, guardian, keeper, managerFEI);

      const lender = (await deployUpgradeable(new GenericAaveNoStaker__factory(guardian))) as GenericAaveNoStaker;
      await lender.initialize(strategyFEI.address, 'lender FEI', false, [governor.address], guardian.address, [
        keeper.address,
      ]);
      const apr = await lender.connect(keeper).apr();
      // at mainnet fork time there is 23% coming from liquidity rate and there is therefore no incentive
      expect(apr).to.be.closeTo(parseUnits('0.02334511', 18), parseUnits('0.1', 18));
      expect(await lender.weightedApr()).to.be.equal(0);
    });
    it('aprAfterDeposit', async () => {
      const aprAfterDepositSupposed = await lenderAave
        .connect(keeper)
        .aprAfterDeposit(parseUnits('10000000', tokenDecimal));

      // Do the deposit and see if the values are indeed equals
      await setTokenBalanceFor(token, strategy.address, 10000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const aprReal = await lenderAave.connect(keeper).apr();

      expect(aprAfterDepositSupposed).to.be.closeTo(aprReal, parseUnits('0.001', 18));
    });
  });

  describe('Strategy deposits and withdraw', () => {
    describe('deposit', () => {
      it('success - normal amount', async () => {
        expect(await lenderAave.hasAssets()).to.be.equal(false);
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();
        const balanceToken = await lenderAave.nav();
        const balanceTokenStrat = await token.balanceOf(strategy.address);
        expect(balanceToken).to.be.equal(parseUnits('1000000', tokenDecimal));
        expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
        expect(await lenderAave.hasAssets()).to.be.equal(true);
      });
      it('success - too small dusty amount', async () => {
        expect(await lenderAave.hasAssets()).to.be.equal(false);
        await setTokenBalanceFor(token, strategy.address, 1);
        await (await strategy.connect(keeper)['harvest()']()).wait();
        const balanceToken = await lenderAave.nav();
        const balanceTokenStrat = await token.balanceOf(strategy.address);
        expect(balanceToken).to.be.equal(parseUnits('1', tokenDecimal));
        expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
        expect(await lenderAave.hasAssets()).to.be.equal(false);
      });
      it('success - when allowance has been revoked', async () => {
        await lenderAave.connect(guardian).changeAllowance([token.address], [lendingPool.address], [0]);
        expect(await token.allowance(lenderAave.address, lendingPool.address)).to.be.equal(0);
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();
        expect(await token.allowance(lenderAave.address, lendingPool.address)).to.be.gt(0);
        const balanceToken = await lenderAave.nav();
        const balanceTokenStrat = await token.balanceOf(strategy.address);
        expect(balanceToken).to.be.equal(parseUnits('1000000', tokenDecimal));
        expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
        expect(await lenderAave.hasAssets()).to.be.equal(true);
      });
    });
    describe('withdraw', () => {
      it('success - emergencyWithdraw funds pulled', async () => {
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();
        await (await lenderAave.connect(guardian).emergencyWithdraw(parseUnits('1000000', 18))).wait();
        expect(await token.balanceOf(manager.address)).to.be.equal(parseUnits('1000000', tokenDecimal));
        expect(await lenderAave.hasAssets()).to.be.equal(false);
      });
      it('success - withdraw works fine', async () => {
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();
        await (
          await manager.connect(guardian).updateStrategyDebtRatio(strategy.address, ethers.constants.AddressZero)
        ).wait();
        await (await strategy.connect(keeper)['harvest()']()).wait();
        const balanceToken = await lenderAave.nav();
        const balanceTokenStrat = await token.balanceOf(strategy.address);
        const balanceTokenManager = await token.balanceOf(manager.address);
        expect(balanceToken).to.be.equal(parseUnits('0', tokenDecimal));
        expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
        expect(balanceTokenManager).to.be.closeTo(parseUnits('1000000', tokenDecimal), parseUnits('1', tokenDecimal));
      });
    });
  });

  describe('claimRewards', () => {
    it('success - cooldown triggered', async () => {
      expect(await stkAave.balanceOf(lenderAave.address)).to.equal(0);
      expect(await aave.balanceOf(lenderAave.address)).to.equal(0);

      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // forward 1 year
      await network.provider.send('evm_mine');
      // start coolDown
      await lenderAave.connect(keeper).claimRewards();
      expect(await stkAave.stakersCooldowns(lenderAave.address)).to.be.equal(await latestTime());
      const currentBalanceStkAave = await stkAave.balanceOf(lenderAave.address);
      await network.provider.send('evm_increaseTime', [3600 * 24 * 10]); // forward 10 days after the cooldown finished
      await network.provider.send('evm_mine');

      // will change stkAave into Aave
      await lenderAave.connect(keeper).claimRewards();

      expect(ethers.constants.Zero).to.be.closeTo(
        await stkAave.balanceOf(lenderAave.address),
        parseUnits('0.001', tokenDecimal),
      );
      expect(currentBalanceStkAave).to.be.closeTo(
        await aave.balanceOf(lenderAave.address),
        parseUnits('0.001', tokenDecimal),
      );
      await lenderAave.connect(guardian).sweep(stkAave.address, guardian.address);
      await lenderAave.connect(guardian).sweep(aave.address, guardian.address);
      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // Passing to another time
    });
    it('success - claim too soon with no stkAave', async () => {
      expect(await stkAave.balanceOf(lenderAave.address)).to.equal(0);
      expect(await aave.balanceOf(lenderAave.address)).to.equal(0);

      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // forward 1 year
      await network.provider.send('evm_mine');
      // start coolDown
      await lenderAave.connect(keeper).claimRewards();
      expect(await stkAave.stakersCooldowns(lenderAave.address)).to.be.equal(await latestTime());

      const currentBalanceStkAave = await stkAave.balanceOf(lenderAave.address);

      await network.provider.send('evm_increaseTime', [3600 * 24 * 5]); // forward 5 days before the cooldown finished
      await network.provider.send('evm_mine');

      // will change stkAave into Aave
      await lenderAave.connect(keeper).claimRewards();

      const futureBalanceStkAave = await stkAave.balanceOf(lenderAave.address);

      console.log(`${logBN(currentBalanceStkAave, { base: 18 })} --> ${logBN(futureBalanceStkAave, { base: 18 })}`);

      expect(currentBalanceStkAave.lte(futureBalanceStkAave)).to.be.equal(true);
      expect(ethers.constants.Zero).to.be.closeTo(
        await aave.balanceOf(lenderAave.address),
        parseUnits('0.001', tokenDecimal),
      );
      await lenderAave.connect(guardian).sweep(stkAave.address, guardian.address);
      await lenderAave.connect(guardian).sweep(aave.address, guardian.address);
      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // Passing to another time
    });
    it('success - cooldown triggered but waits too much to claim other rewards so restarts cooldown', async () => {
      expect(await stkAave.balanceOf(lenderAave.address)).to.equal(0);
      expect(await aave.balanceOf(lenderAave.address)).to.equal(0);

      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // forward 1 year
      await network.provider.send('evm_mine');
      // start coolDown
      await lenderAave.connect(keeper).claimRewards();
      expect(await stkAave.stakersCooldowns(lenderAave.address)).to.be.equal(await latestTime());

      const currentBalanceStkAave = await stkAave.balanceOf(lenderAave.address);

      await network.provider.send('evm_increaseTime', [3600 * 24 * 100]); // forward 100 days
      await network.provider.send('evm_mine');

      // will change stkAave into Aave
      await lenderAave.connect(keeper).claimRewards();
      const futureBalanceStkAave = await stkAave.balanceOf(lenderAave.address);
      expect(currentBalanceStkAave.lte(futureBalanceStkAave)).to.be.equal(true);

      expect(ethers.constants.Zero).to.be.closeTo(
        await aave.balanceOf(lenderAave.address),
        parseUnits('0.001', tokenDecimal),
      );
      await lenderAave.connect(guardian).sweep(stkAave.address, guardian.address);
      await lenderAave.connect(guardian).sweep(aave.address, guardian.address);
      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // Passing to another time
    });

    it('success - claim too soon with a positive stkAave balance', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await network.provider.send('evm_increaseTime', [3600 * 24 * 365]); // forward 1 year
      await network.provider.send('evm_mine');
      // start coolDown

      await lenderAave.connect(keeper).claimRewards();
      const cooldownTimestamp = await stkAave.stakersCooldowns(lenderAave.address);
      expect(cooldownTimestamp).to.be.equal(await latestTime());
      const stkAaveHolder = '0x32B61Bb22Cbe4834bc3e73DcE85280037D944a4D';
      const balanceStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
      await impersonate(stkAaveHolder, async acc => {
        await network.provider.send('hardhat_setBalance', [stkAaveHolder, balanceStorage]);
        await (await stkAave.connect(acc).transfer(lenderAave.address, parseEther('1'))).wait();
      });
      // will change stkAave into Aave
      await lenderAave.connect(keeper).claimRewards();
      expect(cooldownTimestamp).to.be.equal(await stkAave.stakersCooldowns(lenderAave.address));
      expect(ethers.constants.Zero).to.be.closeTo(
        await aave.balanceOf(lenderAave.address),
        parseUnits('0.001', tokenDecimal),
      );
    });
  });
});
