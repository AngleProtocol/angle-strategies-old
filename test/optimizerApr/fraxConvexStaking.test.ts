import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, utils } from 'ethers';
import {
  AggregatorV3Interface,
  AggregatorV3Interface__factory,
  ERC20,
  ERC20__factory,
  GenericAaveFraxConvexStaker,
  GenericAaveFraxConvexStaker__factory,
  IMockFraxUnifiedFarm,
  IMockFraxUnifiedFarm__factory,
  IPoolRegistryFrax,
  IStakedAave,
  IStakedAave__factory,
  MockToken,
  MockToken__factory,
  OptimizerAPRStrategy,
  OptimizerAPRStrategy__factory,
  PoolManager,
} from '../../typechain';
import { gwei } from '../../utils/bignumber';
import { deploy, deployUpgradeable, impersonate } from '../test-utils';
import { ethers, network } from 'hardhat';
import { expect } from '../test-utils/chai-setup';
import { parseUnits, parseEther } from 'ethers/lib/utils';
import { logBN, setTokenBalanceFor } from '../utils-interaction';
import { DAY } from '../contants';
import { latestTime, time, ZERO_ADDRESS } from '../test-utils/helpers';

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
  await manager.connect(governor).addStrategy(strategy.address, gwei('0.99999'));
  return { strategy };
}

async function initLenderAaveFraxStaker(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  keeper: SignerWithAddress,
  strategy: OptimizerAPRStrategy,
  name: string,
  isIncentivized: boolean,
  stakingPeriod: number,
): Promise<{
  lender: GenericAaveFraxConvexStaker;
}> {
  const lender = (await deployUpgradeable(
    new GenericAaveFraxConvexStaker__factory(guardian),
  )) as GenericAaveFraxConvexStaker;
  await lender.initialize(
    strategy.address,
    name,
    isIncentivized,
    [governor.address],
    guardian.address,
    [keeper.address],
    stakingPeriod,
  );
  await strategy.connect(governor).addLender(lender.address);
  return { lender };
}

let governor: SignerWithAddress, guardian: SignerWithAddress, user: SignerWithAddress, keeper: SignerWithAddress;
let strategy: OptimizerAPRStrategy;
let token: ERC20;
let aToken: ERC20;
let nativeRewardToken: MockToken;
let tokenDecimal: number;
let manager: PoolManager;
let lenderAave: GenericAaveFraxConvexStaker;
let stkAave: IStakedAave;
let aFraxStakingContract: IMockFraxUnifiedFarm;
let oracleNativeReward: AggregatorV3Interface;
let oracleStkAave: AggregatorV3Interface;
let oneInch: string;
let amountStorage: string;
const fraxTimelock = '0x8412ebf45bAC1B340BbE8F318b928C466c4E39CA';

const guardianRole = ethers.utils.solidityKeccak256(['string'], ['GUARDIAN_ROLE']);
const keeperRole = ethers.utils.solidityKeccak256(['string'], ['KEEPER_ROLE']);
let guardianError: string;
let keeperError: string;
let stkAaveHolder: string;

// Start test block
describe('OptimizerAPR - lenderAaveFraxConvexStaker', () => {
  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 14786806,
          },
        },
      ],
    });
    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
    stkAaveHolder = '0x32B61Bb22Cbe4834bc3e73DcE85280037D944a4D';

    token = (await ethers.getContractAt(ERC20__factory.abi, '0x853d955aCEf822Db058eb8505911ED77F175b99e')) as ERC20;
    aToken = (await ethers.getContractAt(ERC20__factory.abi, '0xd4937682df3C8aEF4FE912A96A74121C0829E664')) as ERC20;
    // frax = (await ethers.getContractAt(ERC20__factory.abi, '0x853d955aCEf822Db058eb8505911ED77F175b99e')) as ERC20;
    nativeRewardToken = (await ethers.getContractAt(
      MockToken__factory.abi,
      '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0',
    )) as MockToken;

    tokenDecimal = await token.decimals();

    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;

    aFraxStakingContract = (await ethers.getContractAt(
      IMockFraxUnifiedFarm__factory.abi,
      '0x02577b426F223A6B4f2351315A19ecD6F357d65c',
    )) as IMockFraxUnifiedFarm;

    oracleNativeReward = (await ethers.getContractAt(
      AggregatorV3Interface__factory.abi,
      '0x6Ebc52C8C1089be9eB3945C4350B68B8E4C2233f',
    )) as AggregatorV3Interface;

    oracleStkAave = (await ethers.getContractAt(
      AggregatorV3Interface__factory.abi,
      '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
    )) as AggregatorV3Interface;

    // poolRegistry = (await ethers.getContractAt(
    //   IPoolRegistryFrax__factory.abi,
    //   '0x41a5881c17185383e19Df6FA4EC158a6F4851A69',
    // )) as IPoolRegistryFrax;

    guardianError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${guardianRole}`;
    keeperError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${keeperRole}`;

    manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;

    ({ strategy } = await initStrategy(governor, guardian, keeper, manager));

    ({ lender: lenderAave } = await initLenderAaveFraxStaker(
      governor,
      guardian,
      keeper,
      strategy,
      'genericAave',
      true,
      DAY,
    ));
    oneInch = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
    amountStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
  });

  describe('Contructor', () => {
    it('reverts - too small saking period and already initialized', async () => {
      const lender = (await deployUpgradeable(
        new GenericAaveFraxConvexStaker__factory(guardian),
      )) as GenericAaveFraxConvexStaker;
      await expect(
        lender.initialize(strategy.address, 'test', true, [governor.address], guardian.address, [keeper.address], 0),
      ).to.be.revertedWith('TooSmallStakingPeriod()');
      await expect(
        lenderAave.initialize(
          strategy.address,
          'test',
          true,
          [governor.address],
          guardian.address,
          [keeper.address],
          0,
        ),
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
  });

  describe('Parameters', () => {
    it('success - well set', async () => {
      expect(await lenderAave.stakingPeriod()).to.be.equal(BigNumber.from(DAY.toString()));
      expect(await lenderAave.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
      expect(await lenderAave.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      expect(await lenderAave.isIncentivised()).to.be.equal(true);
      expect(await lenderAave.cooldownStkAave()).to.be.equal(true);
      expect(await lenderAave.poolManager()).to.be.equal(manager.address);
      expect(await lenderAave.want()).to.be.equal(token.address);
      expect(await lenderAave.wantBase()).to.be.equal(parseUnits('1', await token.decimals()));
      expect(await stkAave.allowance(lenderAave.address, oneInch)).to.be.equal(ethers.constants.MaxUint256);
    });
  });

  describe('AccessControl', () => {
    it('reverts - guardian only functions', async () => {
      await expect(lenderAave.connect(user).setLockTime(ethers.constants.Zero)).to.be.revertedWith(guardianError);
      await expect(
        lenderAave
          .connect(user)
          .changeAllowance([aToken.address], [aFraxStakingContract.address], [ethers.constants.Zero]),
      ).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).sweep(ZERO_ADDRESS, governor.address)).to.be.revertedWith(guardianError);
    });
  });

  describe('Keeper functions', () => {
    describe('setAavePoolVariables', () => {
      it('success - values well set', async () => {
        await lenderAave.setAavePoolVariables();
        expect(await lenderAave.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
        expect(await lenderAave.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      });
    });
    describe('cooldown', () => {
      it('reverts - when not keeper', async () => {
        await expect(lenderAave.connect(user).cooldown()).to.be.revertedWith(keeperError);
        await expect(lenderAave.connect(keeper).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');
      });
      it('success - cooldown activated', async () => {
        await impersonate(stkAaveHolder, async acc => {
          await network.provider.send('hardhat_setBalance', [stkAaveHolder, amountStorage]);
          await (await stkAave.connect(acc).transfer(lenderAave.address, parseEther('1'))).wait();
        });
        await lenderAave.connect(keeper).cooldown();
        expect(await stkAave.stakersCooldowns(lenderAave.address)).to.be.equal(await latestTime());
      });
    });
  });

  describe('Governance functions', () => {
    describe('setLockTime', () => {
      it('reverts - too small staking period', async () => {
        await expect(lenderAave.connect(guardian).setLockTime(ethers.constants.Zero)).to.be.revertedWith(
          'TooSmallStakingPeriod',
        );
      });
      it('success - staking period updated', async () => {
        await lenderAave.connect(guardian).setLockTime(parseUnits((2 * DAY).toString(), 0));
        expect(await lenderAave.stakingPeriod()).to.be.equal(parseUnits((2 * DAY).toString(), 0));
      });
    });
    describe('setProxyBoost', () => {
      it('success - proxy boost set', async () => {
        const veFXSMultiplierConvex = await aFraxStakingContract.veFXSMultiplier(await lenderAave.vault());
        expect(veFXSMultiplierConvex).to.be.equal(parseUnits('2', 18));
      });
    });
    describe('sweep', () => {
      it('reverts - protected token', async () => {
        await expect(lenderAave.connect(guardian).sweep(token.address, guardian.address)).to.be.revertedWith(
          'ProtectedToken',
        );
      });
      it('success - balance correctly swept', async () => {
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();

        // let days pass to have a non negligible gain
        await time.increase(DAY * 7);
        // Accumulating stkAave and FXS
        await (await lenderAave.connect(user).claimRewardsExternal()).wait();
        const balanceBefore = await nativeRewardToken.balanceOf(lenderAave.address);
        expect(balanceBefore).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await stkAave.balanceOf(lenderAave.address)).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await nativeRewardToken.balanceOf(guardian.address)).to.be.equal(0);
        expect(await stkAave.balanceOf(guardian.address)).to.be.equal(0);
        await lenderAave.connect(guardian).sweep(nativeRewardToken.address, guardian.address);
        await lenderAave.connect(guardian).sweep(stkAave.address, guardian.address);
        expect(await nativeRewardToken.balanceOf(guardian.address)).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await stkAave.balanceOf(guardian.address)).to.be.gte(parseUnits('0', tokenDecimal));
      });
    });
  });

  describe('View functions', () => {
    it('apr - no funds', async () => {
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const apr = await lenderAave.connect(keeper).apr();
      // at mainnet fork time there is 1.84% coming from liquidity rate, 0.02% coming from incentives
      // and 0% as no funds deposited yet on the strat
      expect(apr).to.be.closeTo(parseUnits('0.0186', 18), parseUnits('0.001', 18));
      const weightedAPR = await lenderAave.weightedApr();
      const nav = await lenderAave.nav();
      expect(nav).to.be.equal(0);
      expect(weightedAPR).to.be.equal(0);
    });
    it('earned', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await time.increase(DAY);

      const returnEarned = await lenderAave.earned();
      const tokenAddress = returnEarned[0];
      const totalEarned = returnEarned[1];

      expect(tokenAddress.length).to.be.equal(2);
      expect(totalEarned.length).to.be.equal(2);

      expect(tokenAddress[0]).to.be.equal(nativeRewardToken.address);
      expect(tokenAddress[1]).to.be.equal(stkAave.address);

      expect(totalEarned[0]).to.be.gt(parseUnits('0', 18));
      expect(totalEarned[1]).to.be.gt(parseUnits('0', 18));
    });
    it('apr - convex boost', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const apr = await lenderAave.connect(keeper).apr();
      // at mainnet fork time there is 1.84% coming from liquidity rate, 0.02% coming from incentives
      // and 15.6% (computed by hand because apr displyed on Frax front is wrong)
      expect(apr).to.be.closeTo(parseUnits('0.173', 18), parseUnits('0.005', 18));
      const weightedAPR = await lenderAave.weightedApr();
      const nav = await lenderAave.nav();
      expect(weightedAPR).to.be.equal(nav.mul(apr));
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

  describe('Parameters', () => {
    it('success - well set', async () => {
      expect(await lenderAave.stakingPeriod()).to.be.equal(BigNumber.from(DAY.toString()));
      expect(await lenderAave.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
      expect(await lenderAave.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      expect(await lenderAave.isIncentivised()).to.be.equal(true);
      expect(await lenderAave.cooldownStkAave()).to.be.equal(true);
      expect(await lenderAave.poolManager()).to.be.equal(manager.address);
      expect(await lenderAave.want()).to.be.equal(token.address);
      expect(await lenderAave.wantBase()).to.be.equal(parseUnits('1', await token.decimals()));
      expect(await stkAave.allowance(lenderAave.address, oneInch)).to.be.equal(ethers.constants.MaxUint256);
    });
  });

  describe('AccessControl', () => {
    it('reverts - guardian only functions', async () => {
      await expect(lenderAave.connect(user).setLockTime(ethers.constants.Zero)).to.be.revertedWith(guardianError);
      await expect(
        lenderAave
          .connect(user)
          .changeAllowance([aToken.address], [aFraxStakingContract.address], [ethers.constants.Zero]),
      ).to.be.revertedWith(guardianError);
      await expect(lenderAave.connect(user).sweep(ZERO_ADDRESS, governor.address)).to.be.revertedWith(guardianError);
    });
  });

  describe('Keeper functions', () => {
    describe('setAavePoolVariables', () => {
      it('success - values well set', async () => {
        await lenderAave.setAavePoolVariables();
        expect(await lenderAave.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
        expect(await lenderAave.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      });
    });
    describe('cooldown', () => {
      it('reverts - when not keeper', async () => {
        await expect(lenderAave.connect(user).cooldown()).to.be.revertedWith(keeperError);
        await expect(lenderAave.connect(keeper).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');
      });
      it('success - cooldown activated', async () => {
        await impersonate(stkAaveHolder, async acc => {
          await network.provider.send('hardhat_setBalance', [stkAaveHolder, amountStorage]);
          await (await stkAave.connect(acc).transfer(lenderAave.address, parseEther('1'))).wait();
        });
        await lenderAave.connect(keeper).cooldown();
        expect(await stkAave.stakersCooldowns(lenderAave.address)).to.be.equal(await latestTime());
      });
    });
  });

  describe('Governance functions', () => {
    describe('setLockTime', () => {
      it('reverts - too small staking period', async () => {
        await expect(lenderAave.connect(guardian).setLockTime(ethers.constants.Zero)).to.be.revertedWith(
          'TooSmallStakingPeriod',
        );
      });
      it('success - staking period updated', async () => {
        await lenderAave.connect(guardian).setLockTime(parseUnits((2 * DAY).toString(), 0));
        expect(await lenderAave.stakingPeriod()).to.be.equal(parseUnits((2 * DAY).toString(), 0));
      });
    });
    describe('setProxyBoost', () => {
      it('success - proxy boost set', async () => {
        const veFXSMultiplierConvex = await aFraxStakingContract.veFXSMultiplier(await lenderAave.vault());
        expect(veFXSMultiplierConvex).to.be.equal(parseUnits('2', 18));
      });
    });
    describe('sweep', () => {
      it('reverts - protected token', async () => {
        await expect(lenderAave.connect(guardian).sweep(token.address, guardian.address)).to.be.revertedWith(
          'ProtectedToken',
        );
      });
      it('success - balance correctly swept', async () => {
        await setTokenBalanceFor(token, strategy.address, 1000000);
        await (await strategy.connect(keeper)['harvest()']()).wait();

        // let days pass to have a non negligible gain
        await time.increase(DAY * 7);
        // Accumulating stkAave and FXS
        await (await lenderAave.connect(user).claimRewardsExternal()).wait();
        const balanceBefore = await nativeRewardToken.balanceOf(lenderAave.address);
        expect(balanceBefore).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await stkAave.balanceOf(lenderAave.address)).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await nativeRewardToken.balanceOf(guardian.address)).to.be.equal(0);
        expect(await stkAave.balanceOf(guardian.address)).to.be.equal(0);
        await lenderAave.connect(guardian).sweep(nativeRewardToken.address, guardian.address);
        await lenderAave.connect(guardian).sweep(stkAave.address, guardian.address);
        expect(await nativeRewardToken.balanceOf(guardian.address)).to.be.gte(parseUnits('0', tokenDecimal));
        expect(await stkAave.balanceOf(guardian.address)).to.be.gte(parseUnits('0', tokenDecimal));
      });
    });
  });

  describe('View functions', () => {
    it('apr - no funds', async () => {
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const apr = await lenderAave.connect(keeper).apr();
      // at mainnet fork time there is 1.84% coming from liquidity rate, 0.02% coming from incentives
      // and 0% as no funds deposited yet on the strat
      expect(apr).to.be.closeTo(parseUnits('0.0186', 18), parseUnits('0.001', 18));
      const weightedAPR = await lenderAave.weightedApr();
      const nav = await lenderAave.nav();
      expect(nav).to.be.equal(0);
      expect(weightedAPR).to.be.equal(0);
    });
    it('earned', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await time.increase(DAY);

      const returnEarned = await lenderAave.earned();
      const tokenAddress = returnEarned[0];
      const totalEarned = returnEarned[1];

      expect(tokenAddress.length).to.be.equal(2);
      expect(totalEarned.length).to.be.equal(2);

      expect(tokenAddress[0]).to.be.equal(nativeRewardToken.address);
      expect(tokenAddress[1]).to.be.equal(stkAave.address);

      expect(totalEarned[0]).to.be.gt(parseUnits('0', 18));
      expect(totalEarned[1]).to.be.gt(parseUnits('0', 18));
    });
    it('apr - convex boost', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const apr = await lenderAave.connect(keeper).apr();
      // at mainnet fork time there is 1.84% coming from liquidity rate, 0.02% coming from incentives
      // and 15.6% (computed by hand because apr displyed on Frax front is wrong)
      expect(apr).to.be.closeTo(parseUnits('0.173', 18), parseUnits('0.005', 18));
      const weightedAPR = await lenderAave.weightedApr();
      const nav = await lenderAave.nav();
      expect(weightedAPR).to.be.equal(nav.mul(apr));
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

  describe('Strategy deposits', () => {
    it('success - no previous lock', async () => {
      expect(await lenderAave.kekId()).to.be.equal(ethers.constants.HashZero);
      // expect(await lenderAave.lastAaveLiquidityIndex()).to.be.equal(ethers.constants.Zero);
      expect(await lenderAave.lastCreatedStake()).to.be.equal(ethers.constants.Zero);

      await setTokenBalanceFor(token, strategy.address, 1000000);

      const timestamp = await latestTime();
      await (await strategy.connect(keeper)['harvest()']()).wait();
      expect(await lenderAave.kekId()).to.not.eq('');
      expect(await lenderAave.lastCreatedStake()).to.be.gte(timestamp);

      const underlyingBalance = await lenderAave.underlyingBalanceStored();
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      expect(balanceToken).to.be.equal(parseUnits('1000000', tokenDecimal));
      expect(underlyingBalance).to.be.closeTo(parseUnits('1000000', tokenDecimal), parseUnits('10', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
    });
    it('success - very small amount deposited and hence considering that strategy has no assets', async () => {
      expect(await lenderAave.kekId()).to.be.equal(ethers.constants.HashZero);
      // expect(await lenderAave.lastAaveLiquidityIndex()).to.be.equal(ethers.constants.Zero);
      expect(await lenderAave.lastCreatedStake()).to.be.equal(ethers.constants.Zero);

      await setTokenBalanceFor(token, strategy.address, 1);

      const timestamp = await latestTime();
      await (await strategy.connect(keeper)['harvest()']()).wait();
      expect(await lenderAave.kekId()).to.not.eq('');
      expect(await lenderAave.lastCreatedStake()).to.be.gte(timestamp);

      const underlyingBalance = await lenderAave.underlyingBalanceStored();
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      expect(balanceToken).to.be.equal(parseUnits('1', tokenDecimal));
      expect(underlyingBalance).to.be.closeTo(parseUnits('1', tokenDecimal), parseUnits('10', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
      expect(await lenderAave.hasAssets()).to.be.equal(false);
    });
    it('success - with previous lock', async () => {
      // going through the poolManager to not have to withdraw funds (because it would think we made a huge profit)
      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const kekId = await lenderAave.kekId();
      const stakerCreated = await lenderAave.lastCreatedStake();
      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();
      expect(kekIdAfter).to.be.equal(kekId);
      expect(stakerCreatedAfter).to.be.equal(stakerCreated);

      const underlyingBalance = await lenderAave.underlyingBalanceStored();
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      expect(balanceToken).to.be.closeTo(parseUnits('2000000', tokenDecimal), parseUnits('1000', tokenDecimal));
      expect(underlyingBalance).to.be.closeTo(parseUnits('2000000', tokenDecimal), parseUnits('1000', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
    });
    it('success - with previous lock and time elapsed ', async () => {
      // going through the poolManager to not have to withdraw funds (because it would think we made a huge profit)
      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      await time.increase(DAY / 2);
      const kekId = await lenderAave.kekId();
      const stakerCreated = await lenderAave.lastCreatedStake();
      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();
      expect(kekIdAfter).to.be.equal(kekId);
      expect(stakerCreatedAfter).to.be.equal(stakerCreated);

      const underlyingBalance = await lenderAave.underlyingBalanceStored();
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      expect(balanceToken).to.be.closeTo(parseUnits('2000000', tokenDecimal), parseUnits('1000', tokenDecimal));
      expect(underlyingBalance).to.be.closeTo(parseUnits('2000000', tokenDecimal), parseUnits('1000', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
    });
  });

  describe('Strategy withdraws', () => {
    it('withdraw - reverts - too soon', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await expect(strategy.connect(keeper)['harvest()']()).to.be.reverted;
    });
    it('emergencyWithdraw - reverts - nothing to remove', async () => {
      await expect(lenderAave.connect(guardian).emergencyWithdraw(parseUnits('1000000', 18))).to.be.reverted;
    });
    it('emergencyWithdraw - success', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      await time.increase(DAY);
      await (await lenderAave.connect(guardian).emergencyWithdraw(parseUnits('1000000', 18))).wait();
      expect(await token.balanceOf(manager.address)).to.be.equal(parseUnits('1000000', tokenDecimal));
    });
    it('withdrawAll - success', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      await time.increase(DAY);
      const { lender: lenderAaveBis } = await initLenderAaveFraxStaker(
        governor,
        guardian,
        keeper,
        strategy,
        'genericAave',
        true,
        DAY,
      );
      await (
        await strategy.connect(guardian).manualAllocation([
          { lender: lenderAave.address, share: parseUnits('0', 0) },
          { lender: lenderAaveBis.address, share: parseUnits('1000', 0) },
        ])
      ).wait();

      const balanceTokenStrat = await token.balanceOf(strategy.address);
      expect(await lenderAaveBis.underlyingBalanceStored()).to.be.closeTo(
        parseUnits('1000000', tokenDecimal),
        parseUnits('1000', tokenDecimal),
      );
      expect(await lenderAaveBis.nav()).to.be.closeTo(
        parseUnits('1000000', tokenDecimal),
        parseUnits('1000', tokenDecimal),
      );
      expect(await lenderAave.underlyingBalanceStored()).to.be.equal(parseUnits('0', tokenDecimal));
      expect(await lenderAave.nav()).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
    });
    it('withdraw - success - restake', async () => {
      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      // let days pass to have a non negligible gain
      await time.increase(DAY * 7);

      const kekIdBefore = await lenderAave.kekId();
      const stakerCreatedBefore = await lenderAave.lastCreatedStake();

      // to let some surplus on the poolManager
      await manager.connect(guardian).updateStrategyDebtRatio(strategy.address, parseUnits('0.5', 9));
      await (await strategy.connect(keeper)['harvest()']()).wait();
      // currently rate is at 1.84% so for 7 days we roughly divide by 52 --> 0.035% over the period
      const earnings = parseUnits('1000350', tokenDecimal);

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();

      expect(kekIdAfter).to.not.equal(kekIdBefore);
      expect(kekIdAfter).to.not.equal('');
      expect(stakerCreatedAfter).to.be.gte(stakerCreatedBefore);

      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      const balanceTokenManager = await token.balanceOf(manager.address);
      expect(balanceToken).to.be.closeTo(earnings.div(BigNumber.from('2')), parseUnits('100', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenManager).to.be.closeTo(earnings.div(BigNumber.from('2')), parseUnits('100', tokenDecimal));
    });
    it('withdraw - success - no new locker', async () => {
      // change lock period
      await impersonate(fraxTimelock, async acc => {
        await network.provider.send('hardhat_setBalance', [fraxTimelock, amountStorage]);
        await (
          await aFraxStakingContract
            .connect(acc)
            .setMiscVariables([
              parseUnits('1', 18),
              ethers.constants.Zero,
              ethers.constants.Zero,
              ethers.constants.Zero,
              parseUnits('100000000', 0),
              parseUnits('1', 0),
            ])
        ).wait();
      });
      // await lenderAave.setMinLockTime();
      await lenderAave.connect(guardian).setLockTime(parseUnits('1', 0));

      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      // change debtRatio
      await manager.connect(guardian).updateStrategyDebtRatio(strategy.address, parseUnits('0', 9));
      const kekIdBefore = await lenderAave.kekId();

      await time.increase(1);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();

      expect(kekIdAfter).to.not.equal(kekIdBefore);
      expect(kekIdAfter).to.be.equal(ethers.constants.HashZero);
      expect(stakerCreatedAfter).to.be.equal(ethers.constants.Zero);

      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      const balanceTokenManager = await token.balanceOf(manager.address);
      expect(balanceToken).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenManager).to.be.closeTo(parseUnits('1000000', tokenDecimal), parseUnits('1', tokenDecimal));
    });
    it('withdraw - success - no liquidity left', async () => {
      // change lock period

      await impersonate(fraxTimelock, async acc => {
        await network.provider.send('hardhat_setBalance', [fraxTimelock, amountStorage]);
        await (
          await aFraxStakingContract
            .connect(acc)
            .setMiscVariables([
              parseUnits('1', 18),
              ethers.constants.Zero,
              ethers.constants.Zero,
              ethers.constants.Zero,
              parseUnits('100000000', 0),
              parseUnits('1', 0),
            ])
        ).wait();
      });
      // await lenderAave.setMinLockTime();
      await lenderAave.connect(guardian).setLockTime(parseUnits('1', 0));

      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      // change debtRatio
      await manager.connect(guardian).updateStrategyDebtRatio(strategy.address, parseUnits('0', 9));
      const kekIdBefore = await lenderAave.kekId();
      const stakerCreatedBefore = await lenderAave.lastCreatedStake();

      // remove liquidity from Aave
      await impersonate(aToken.address, async acc => {
        await network.provider.send('hardhat_setBalance', [aToken.address, amountStorage]);
        const liquidityAave = await token.balanceOf(aToken.address);
        await (await token.connect(acc).transfer(keeper.address, liquidityAave)).wait();
      });

      await time.increase(1);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();

      expect(kekIdAfter).to.be.equal(kekIdBefore);
      expect(stakerCreatedAfter).to.be.equal(stakerCreatedBefore);

      const stakingBalance = (await aFraxStakingContract.lockedStakes(await lenderAave.vault(), 0)).liquidity;
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      const balanceTokenManager = await token.balanceOf(manager.address);
      expect(stakingBalance).to.be.closeTo(parseUnits('999990', tokenDecimal), parseUnits('0.01', tokenDecimal));
      expect(balanceToken).to.be.closeTo(parseUnits('999990', tokenDecimal), parseUnits('0.1', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenManager).to.be.equal(parseUnits('10', tokenDecimal));
    });
    it('withdraw - success - few liquidity left', async () => {
      // change lock period
      await impersonate(fraxTimelock, async acc => {
        await network.provider.send('hardhat_setBalance', [fraxTimelock, amountStorage]);
        await (
          await aFraxStakingContract
            .connect(acc)
            .setMiscVariables([
              parseUnits('1', 18),
              ethers.constants.Zero,
              ethers.constants.Zero,
              ethers.constants.Zero,
              parseUnits('100000000', 0),
              parseUnits('1', 0),
            ])
        ).wait();
      });
      // await lenderAave.setMinLockTime();
      await lenderAave.connect(guardian).setLockTime(parseUnits('1', 0));

      await setTokenBalanceFor(token, manager.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      // change debtRatio
      await manager.connect(guardian).updateStrategyDebtRatio(strategy.address, parseUnits('0', 9));
      const kekIdBefore = await lenderAave.kekId();
      const stakerCreatedBefore = await lenderAave.lastCreatedStake();

      // remove liquidity from Aave
      await impersonate(aToken.address, async acc => {
        await network.provider.send('hardhat_setBalance', [aToken.address, amountStorage]);
        const liquidityAave = await token.balanceOf(aToken.address);
        await (
          await token.connect(acc).transfer(keeper.address, liquidityAave.sub(parseUnits('1', tokenDecimal)))
        ).wait();
      });

      await time.increase(1);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const kekIdAfter = await lenderAave.kekId();
      const stakerCreatedAfter = await lenderAave.lastCreatedStake();

      expect(kekIdAfter).to.not.equal(kekIdBefore);
      expect(stakerCreatedAfter).to.be.gt(stakerCreatedBefore);

      const stakingBalance = (await aFraxStakingContract.lockedStakes(await lenderAave.vault(), 1)).liquidity;
      const balanceToken = await lenderAave.nav();
      const balanceTokenStrat = await token.balanceOf(strategy.address);
      const balanceTokenManager = await token.balanceOf(manager.address);
      expect(stakingBalance).to.be.closeTo(parseUnits('999989', tokenDecimal), parseUnits('1', tokenDecimal));
      expect(balanceToken).to.be.closeTo(parseUnits('999989', tokenDecimal), parseUnits('1', tokenDecimal));
      expect(balanceTokenStrat).to.be.equal(parseUnits('0', tokenDecimal));
      expect(balanceTokenManager).to.be.closeTo(parseUnits('11', tokenDecimal), parseUnits('1', tokenDecimal));
    });
  });

  describe('Handle rewards', () => {
    it('claimRewardsExternal - success - FXS+stkAave reward', async () => {
      await setTokenBalanceFor(token, strategy.address, 1000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      // let days pass to have a non negligible gain
      await time.increase(DAY * 7);

      await (await lenderAave.connect(user).claimRewardsExternal()).wait();

      expect(await nativeRewardToken.balanceOf(lenderAave.address)).to.be.gte(parseUnits('0', tokenDecimal));
      expect(await stkAave.balanceOf(lenderAave.address)).to.be.gte(parseUnits('0', tokenDecimal));
    });
    it('claimRewardsExternal - success - verify apr', async () => {
      const investAmount = 1000000;
      await setTokenBalanceFor(token, strategy.address, investAmount);
      await (await strategy.connect(keeper)['harvest()']()).wait();

      const aprSupposed = await lenderAave.connect(keeper).apr();

      // let days pass to have a non negligible gain
      await time.increase(DAY * 7);

      await (await lenderAave.connect(user).claimRewardsExternal()).wait();

      let rewardNative = await nativeRewardToken.balanceOf(lenderAave.address);
      let rewardStkAave = await stkAave.balanceOf(lenderAave.address);
      rewardNative = rewardNative.mul((await oracleNativeReward.latestRoundData()).answer).div(parseUnits('1', 8));
      rewardStkAave = rewardStkAave.mul((await oracleStkAave.latestRoundData()).answer).div(parseUnits('1', 8));
      const interestToken = (await lenderAave.nav()).sub(parseUnits(investAmount.toString(), tokenDecimal));
      // console.log(`FXS reward in USD:\t${logBN(rewardNative)}`);
      // console.log(`stkAave reward in USD:\t${logBN(rewardStkAave)}`);
      // console.log(`interest in USD:\t${logBN(interestToken)}`);

      // console.log(
      //   `FXS apr:\t${logBN(
      //     parseUnits('52', 18)
      //       .mul(rewardNative.mul(parseUnits('0.95', 4)))
      //       .div(parseUnits(investAmount.toString(), 22)),
      //   )}`,
      // );
      // console.log(
      //   `stkAave apr:\t${logBN(
      //     parseUnits('52', 18)
      //       .mul(rewardStkAave.mul(parseUnits('0.95', 4)))
      //       .div(parseUnits(investAmount.toString(), 22)),
      //   )}`,
      // );
      // console.log(`interest apr:\t${logBN(parseUnits('52', 18).mul(interestToken).div(parseUnits(investAmount.toString(), 18)))}`);

      // we roughly multiply by 52 weeks and don't take into account compounding
      const impliedApr = parseUnits('52', 18)
        .mul(rewardNative.add(rewardStkAave).add(interestToken))
        .div(parseUnits(investAmount.toString(), 18));

      console.log(`supposed apr --> implied apr:\t${logBN(aprSupposed)} --> ${logBN(impliedApr)}`);

      expect(impliedApr).to.be.closeTo(aprSupposed, parseUnits('0.005', 18));
    });
  });
});
