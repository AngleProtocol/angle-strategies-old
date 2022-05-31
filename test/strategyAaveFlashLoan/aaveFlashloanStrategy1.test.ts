import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import hre, { ethers, network } from 'hardhat';
import { utils, constants, BigNumber, Contract, Signer } from 'ethers';
import { expect } from '../test-utils/chai-setup';
import { deploy, impersonate } from '../test-utils';
import { expectApprox } from '../../utils/bignumber';
import {
  AaveFlashloanStrategy,
  FlashMintLib,
  ERC20,
  ERC20__factory,
  // IAaveIncentivesController__factory,
  IStakedAave,
  IStakedAave__factory,
  AaveFlashloanStrategy__factory,
  PoolManager,
  IProtocolDataProvider,
  // IAaveIncentivesController,
  ILendingPool,
  IProtocolDataProvider__factory,
  ILendingPool__factory,
} from '../../typechain';
import { parseUnits, parseEther } from 'ethers/lib/utils';
import { latestTime, increaseTime } from '../test-utils/helpers';

describe('AaveFlashloanStrategy - Main test file', () => {
  // ATokens
  let aToken: ERC20, debtToken: ERC20;

  // Tokens
  let wantToken: ERC20, dai: ERC20, aave: ERC20, stkAave: IStakedAave;

  // Guardians
  let deployer: SignerWithAddress,
    proxyAdmin: SignerWithAddress,
    governor: SignerWithAddress,
    guardian: SignerWithAddress,
    user: SignerWithAddress,
    keeper: SignerWithAddress;

  let poolManager: PoolManager;
  let protocolDataProvider: IProtocolDataProvider;
  // let incentivesController: IAaveIncentivesController;
  let lendingPool: ILendingPool;
  let flashMintLib: FlashMintLib;
  let stkAaveHolder: string;

  let strategy: AaveFlashloanStrategy;
  const impersonatedSigners: { [key: string]: Signer } = {};

  // ReserveInterestRateStrategy for USDC
  const reserveInterestRateStrategyUSDC = '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27';
  // ReserveInterestRateStrategy for DAI
  // const reserveInterestRateStrategyDAI = '0xfffE32106A68aA3eD39CcCE673B646423EEaB62a';

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            blockNumber: 14519530,
          },
        },
      ],
    });

    wantToken = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    dai = (await ethers.getContractAt(ERC20__factory.abi, '0x6B175474E89094C44Da98b954EedeAC495271d0F')) as ERC20;
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;
    stkAaveHolder = '0x32B61Bb22Cbe4834bc3e73DcE85280037D944a4D';
    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;

    [deployer, proxyAdmin, governor, guardian, user, keeper] = await ethers.getSigners();

    poolManager = (await deploy('MockPoolManager', [wantToken.address, 0])) as PoolManager;

    protocolDataProvider = (await ethers.getContractAt(
      IProtocolDataProvider__factory.abi,
      '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
    )) as IProtocolDataProvider;

    /*
    incentivesController = (await ethers.getContractAt(
      IAaveIncentivesController__factory.abi,
      '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    )) as IAaveIncentivesController;
    */

    lendingPool = (await ethers.getContractAt(
      ILendingPool__factory.abi,
      '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    )) as ILendingPool;

    flashMintLib = (await deploy('FlashMintLib')) as FlashMintLib;

    const strategyImplementation = (await deploy('AaveFlashloanStrategy', [], {
      libraries: { FlashMintLib: flashMintLib.address },
    })) as AaveFlashloanStrategy;

    const proxy = await deploy('TransparentUpgradeableProxy', [
      strategyImplementation.address,
      proxyAdmin.address,
      '0x',
    ]);
    strategy = new Contract(proxy.address, AaveFlashloanStrategy__factory.abi, deployer) as AaveFlashloanStrategy;

    await strategy.initialize(
      poolManager.address,
      reserveInterestRateStrategyUSDC,
      governor.address,
      guardian.address,
      [keeper.address],
    );

    aToken = (await ethers.getContractAt(ERC20__factory.abi, '0xBcca60bB61934080951369a648Fb03DF4F96263C')) as ERC20;
    debtToken = (await ethers.getContractAt(ERC20__factory.abi, '0x619beb58998eD2278e08620f97007e1116D5D25b')) as ERC20;
  });

  describe('Constructor', () => {
    it('success - contract well initialized', async () => {
      expect(
        strategy.initialize(poolManager.address, reserveInterestRateStrategyUSDC, governor.address, guardian.address, [
          keeper.address,
        ]),
      ).to.revertedWith('Initializable: contract is already initialized');

      expect(strategy.connect(proxyAdmin).boolParams()).to.revertedWith(
        'TransparentUpgradeableProxy: admin cannot fallback to proxy target',
      );
      // Parameters
      const isActive1 = (await strategy.connect(deployer).boolParams()).isFlashMintActive;
      const isActive2 = (await strategy.connect(user).boolParams()).isFlashMintActive;
      expect(isActive1).to.be.equal(true);
      expect(isActive1).to.equal(isActive2);

      expect(await strategy.maxIterations()).to.equal(6);
      expect((await strategy.boolParams()).isFlashMintActive).to.be.equal(true);
      expect(await strategy.discountFactor()).to.equal(9000);
      expect(await strategy.minWant()).to.equal(100);
      expect(await strategy.minRatio()).to.equal(utils.parseEther('0.005'));
      expect((await strategy.boolParams()).automaticallyComputeCollatRatio).to.be.equal(true);
      expect((await strategy.boolParams()).withdrawCheck).to.be.equal(false);
      expect((await strategy.boolParams()).cooldownStkAave).to.be.equal(true);
      expect(await strategy.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
      expect(await strategy.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());

      // Collateral Ratios
      const { ltv, liquidationThreshold } = await protocolDataProvider.getReserveConfigurationData(wantToken.address);
      const _DEFAULT_COLLAT_TARGET_MARGIN = utils.parseUnits('0.02', 4);
      const _DEFAULT_COLLAT_MAX_MARGIN = utils.parseUnits('0.005', 4);

      expect(await strategy.maxBorrowCollatRatio()).to.equal(ltv.sub(_DEFAULT_COLLAT_MAX_MARGIN).mul(1e14));
      expect(await strategy.targetCollatRatio()).to.equal(
        liquidationThreshold.sub(_DEFAULT_COLLAT_TARGET_MARGIN).mul(1e14),
      );
      expect(await strategy.maxCollatRatio()).to.equal(liquidationThreshold.sub(_DEFAULT_COLLAT_MAX_MARGIN).mul(1e14));

      // Base strategy parameters
      expect(await strategy.want()).to.be.equal(wantToken.address);
      expect(await strategy.poolManager()).to.be.equal(poolManager.address);
      expect(await strategy.wantBase()).to.be.equal(parseUnits('1', 6));
      expect(await strategy.debtThreshold()).to.be.equal(parseUnits('100', 18));
      expect(await strategy.emergencyExit()).to.be.equal(false);
      expect(await strategy.isActive()).to.be.equal(false);
      expect(await strategy.estimatedTotalAssets()).to.be.equal(0);
    });

    it('success - approvals correctly granted', async () => {
      const token = await poolManager.token();
      const want = await strategy.want();
      expect(want).to.equal(token);
      const wantContract = (await ethers.getContractAt(ERC20__factory.abi, want)) as ERC20;
      expect(await wantContract.allowance(strategy.address, lendingPool.address)).to.equal(constants.MaxUint256);
      expect(await aToken.allowance(strategy.address, lendingPool.address)).to.equal(constants.MaxUint256);

      // PoolManager
      expect(await wantContract.allowance(strategy.address, poolManager.address)).to.equal(constants.MaxUint256);
      expect(await dai.allowance(strategy.address, lendingPool.address)).to.equal(constants.MaxUint256);
      expect(await dai.allowance(strategy.address, await flashMintLib.LENDER())).to.equal(constants.MaxUint256);

      expect(await aave.allowance(strategy.address, '0x1111111254fb6c44bAC0beD2854e76F90643097d')).to.equal(
        constants.MaxUint256,
      );
      expect(await stkAave.allowance(strategy.address, '0x1111111254fb6c44bAC0beD2854e76F90643097d')).to.equal(
        constants.MaxUint256,
      );
    });
  });

  describe('Access Control', () => {
    it('success - roles well initialized', async () => {
      // Roles
      const GUARDIAN_ROLE = await strategy.GUARDIAN_ROLE();
      const POOLMANAGER_ROLE = await strategy.POOLMANAGER_ROLE();
      const KEEPER_ROLE = await strategy.KEEPER_ROLE();
      expect(await strategy.hasRole(GUARDIAN_ROLE, guardian.address)).to.be.equal(true);
      expect(await strategy.hasRole(GUARDIAN_ROLE, governor.address)).to.be.equal(true);
      expect(await strategy.hasRole(GUARDIAN_ROLE, strategy.address)).to.be.equal(false);
      expect(await strategy.hasRole(GUARDIAN_ROLE, poolManager.address)).to.be.equal(false);
      expect(await strategy.hasRole(POOLMANAGER_ROLE, poolManager.address)).to.be.equal(true);
      expect(await strategy.hasRole(KEEPER_ROLE, keeper.address)).to.be.equal(true);
      expect(await strategy.getRoleAdmin(KEEPER_ROLE)).to.be.equal(GUARDIAN_ROLE);
      expect(await strategy.getRoleAdmin(GUARDIAN_ROLE)).to.be.equal(POOLMANAGER_ROLE);
      expect(await strategy.getRoleAdmin(POOLMANAGER_ROLE)).to.be.equal(POOLMANAGER_ROLE);
    });
    it('success - restricted functions revert with correct error messages', async () => {
      const revertMessageGuardian = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await strategy.GUARDIAN_ROLE()}`;
      const revertMessageKeeper = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await strategy.KEEPER_ROLE()}`;
      const revertMessagePoolManager = `AccessControl: account ${user.address.toLowerCase()} is missing role ${await strategy.POOLMANAGER_ROLE()}`;

      // Guardian
      await expect(
        strategy
          .connect(user)
          .setCollateralTargets(
            utils.parseUnits('0.8', 18),
            utils.parseUnits('0.7', 18),
            utils.parseUnits('0.6', 18),
            utils.parseUnits('0.8', 18),
          ),
      ).to.be.revertedWith(revertMessageGuardian);
      await expect(
        strategy.connect(user).setBoolParams({
          isFlashMintActive: false,
          automaticallyComputeCollatRatio: false,
          withdrawCheck: false,
          cooldownStkAave: false,
        }),
      ).to.be.revertedWith(revertMessageGuardian);
      await expect(strategy.connect(user).setMinsAndMaxs(1000, utils.parseUnits('0.7', 18), 20)).to.be.revertedWith(
        revertMessageGuardian,
      );
      await expect(strategy.connect(user).setDiscountFactor(12000)).to.revertedWith(revertMessageGuardian);
      await expect(strategy.connect(user).setDebtThreshold(0)).to.be.revertedWith(revertMessageGuardian);
      await expect(strategy.connect(user).sweep(user.address, user.address)).to.be.revertedWith(revertMessageGuardian);

      // PoolManager
      await expect(strategy.connect(user).addGuardian(user.address)).to.be.revertedWith(revertMessagePoolManager);
      await expect(strategy.connect(user).revokeGuardian(user.address)).to.be.revertedWith(revertMessagePoolManager);
      await expect(strategy.connect(user).withdraw(0)).to.be.revertedWith(revertMessagePoolManager);
      await expect(strategy.connect(user).setEmergencyExit()).to.be.revertedWith(revertMessagePoolManager);

      // Keeper
      await expect(strategy.connect(user)['harvest(uint256)'](0, { gasLimit: 3e6 })).to.be.revertedWith(
        revertMessageKeeper,
      );
      await expect(strategy.connect(user).claimRewards()).to.be.revertedWith(revertMessageKeeper);
      await expect(strategy.connect(user).cooldown()).to.be.revertedWith(revertMessageKeeper);
      await expect(strategy.connect(user).sellRewards(0, '0x')).to.be.revertedWith(revertMessageKeeper);
    });
  });
  describe('Setters', () => {
    describe('setCollateralTargets', () => {
      it('reverts - invalid parameters', async () => {
        await expect(
          strategy
            .connect(guardian)
            .setCollateralTargets(
              utils.parseUnits('0.75', 18),
              utils.parseUnits('0.8', 18),
              utils.parseUnits('0.6', 18),
              utils.parseUnits('0.8', 18),
            ),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(
          strategy
            .connect(guardian)
            .setCollateralTargets(
              utils.parseUnits('1', 18),
              utils.parseUnits('0.8', 18),
              utils.parseUnits('0.6', 18),
              utils.parseUnits('0.7', 18),
            ),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(
          strategy
            .connect(guardian)
            .setCollateralTargets(
              utils.parseUnits('0.81', 18),
              utils.parseUnits('0.79', 18),
              utils.parseUnits('0.6', 18),
              utils.parseUnits('0.7', 18),
            ),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(
          strategy
            .connect(guardian)
            .setCollateralTargets(
              utils.parseUnits('0.75', 18),
              utils.parseUnits('0.8', 18),
              utils.parseUnits('0.9', 18),
              utils.parseUnits('0.7', 18),
            ),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(
          strategy
            .connect(guardian)
            .setCollateralTargets(
              utils.parseUnits('0.75', 18),
              utils.parseUnits('0.8', 18),
              utils.parseUnits('0.6', 18),
              utils.parseUnits('0.9', 18),
            ),
        ).to.be.revertedWith('InvalidSetOfParameters');
      });
      it('success - parameters correctly set', async () => {
        await strategy
          .connect(guardian)
          .setCollateralTargets(
            utils.parseUnits('0.75', 18),
            utils.parseUnits('0.8', 18),
            utils.parseUnits('0.6', 18),
            utils.parseUnits('0.7', 18),
          );

        expect(await strategy.targetCollatRatio()).to.equal(utils.parseUnits('0.75', 18));
        expect(await strategy.maxCollatRatio()).to.equal(utils.parseUnits('0.8', 18));
        expect(await strategy.maxBorrowCollatRatio()).to.equal(utils.parseUnits('0.6', 18));
        expect(await strategy.daiBorrowCollatRatio()).to.equal(utils.parseUnits('0.7', 18));
      });
    });
    describe('setBoolParams', () => {
      it('success', async () => {
        expect((await strategy.boolParams()).isFlashMintActive).to.be.equal(true);
        expect((await strategy.boolParams()).automaticallyComputeCollatRatio).to.be.equal(true);
        expect((await strategy.boolParams()).withdrawCheck).to.be.equal(false);
        expect((await strategy.boolParams()).cooldownStkAave).to.be.equal(true);

        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: false,
          automaticallyComputeCollatRatio: false,
          withdrawCheck: false,
          cooldownStkAave: false,
        });

        expect((await strategy.boolParams()).isFlashMintActive).to.be.equal(false);
        expect((await strategy.boolParams()).automaticallyComputeCollatRatio).to.be.equal(false);
        expect((await strategy.boolParams()).withdrawCheck).to.be.equal(false);
        expect((await strategy.boolParams()).cooldownStkAave).to.be.equal(false);
        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: false,
          automaticallyComputeCollatRatio: true,
          withdrawCheck: false,
          cooldownStkAave: true,
        });

        expect((await strategy.boolParams()).isFlashMintActive).to.be.equal(false);
        expect((await strategy.boolParams()).automaticallyComputeCollatRatio).to.be.equal(true);
        expect((await strategy.boolParams()).withdrawCheck).to.be.equal(false);
        expect((await strategy.boolParams()).cooldownStkAave).to.be.equal(true);
      });
    });
    describe('setMinsAndMaxs', () => {
      it('reverts - invalid parameters', async () => {
        await expect(
          strategy.connect(guardian).setMinsAndMaxs(1000, utils.parseUnits('0.7', 18), 20),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(
          strategy.connect(guardian).setMinsAndMaxs(1000, utils.parseUnits('0.7', 18), 0),
        ).to.be.revertedWith('InvalidSetOfParameters');
        await expect(strategy.connect(guardian).setMinsAndMaxs(1000, utils.parseUnits('10', 18), 5)).to.be.revertedWith(
          'InvalidSetOfParameters',
        );
      });
      it('success - parameters updated', async () => {
        expect(await strategy.minWant()).to.equal(100);
        expect(await strategy.minRatio()).to.equal(utils.parseUnits('0.005', 18));
        expect(await strategy.maxIterations()).to.equal(6);

        await strategy.connect(guardian).setMinsAndMaxs(1000, utils.parseUnits('0.6', 18), 15);

        expect(await strategy.minWant()).to.equal(1000);
        expect(await strategy.minRatio()).to.equal(utils.parseUnits('0.6', 18));
        expect(await strategy.maxIterations()).to.equal(15);
      });
    });
    describe('setAavePoolVariables', () => {
      it('success - variables correctly set', async () => {
        await strategy.setAavePoolVariables();
        expect(await strategy.cooldownSeconds()).to.be.equal(await stkAave.COOLDOWN_SECONDS());
        expect(await strategy.unstakeWindow()).to.be.equal(await stkAave.UNSTAKE_WINDOW());
      });
    });
    describe('setDiscountFactor', () => {
      it('reverts - too high parameter value', async () => {
        await expect(strategy.connect(guardian).setDiscountFactor(12000)).to.revertedWith('TooHighParameterValue');
      });
      it('success - parameter updated', async () => {
        expect(await strategy.discountFactor()).to.equal(9000);

        await strategy.connect(guardian).setDiscountFactor(2000);
        expect(await strategy.discountFactor()).to.equal(2000);
        await strategy.connect(guardian).setDiscountFactor(10000);
        expect(await strategy.discountFactor()).to.equal(10000);
      });
    });
    describe('addGuardian', () => {
      it('success - guardian added', async () => {
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), user.address)).to.be.equal(false);
        await impersonate(poolManager.address, async acc => {
          await network.provider.send('hardhat_setBalance', [
            poolManager.address,
            ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
          ]);
          await strategy.connect(acc).addGuardian(user.address);
        });
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), user.address)).to.be.equal(true);
      });
    });
    describe('revokeGuardian', () => {
      it('success - guardian revoke', async () => {
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), guardian.address)).to.be.equal(true);
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), user.address)).to.be.equal(false);
        await impersonate(poolManager.address, async acc => {
          await network.provider.send('hardhat_setBalance', [
            poolManager.address,
            ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
          ]);
          await strategy.connect(acc).addGuardian(user.address);
          await strategy.connect(acc).revokeGuardian(guardian.address);
          await strategy.connect(acc).revokeGuardian(user.address);
        });
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), guardian.address)).to.be.equal(false);
        expect(await strategy.hasRole(await strategy.GUARDIAN_ROLE(), user.address)).to.be.equal(false);
      });
    });
  });

  describe('Strategy Actions', () => {
    const _startAmountUSDC = utils.parseUnits((2_000_000).toString(), 6);
    let _guessedBorrowed = utils.parseUnits((0).toString(), 6);

    beforeEach(async () => {
      await (await poolManager.addStrategy(strategy.address, utils.parseUnits('0.75', 9))).wait();

      await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
        await wantToken.connect(acc).transfer(user.address, _startAmountUSDC);
      });

      await wantToken.connect(user).transfer(poolManager.address, _startAmountUSDC);
    });

    describe('estimatedTotalAssets', () => {
      it('success - assets correctly estimated', async () => {
        expect(await strategy.estimatedTotalAssets()).to.equal(0);
        await strategy['harvest()']({ gasLimit: 3e6 });

        const { deposits, borrows } = await strategy.getCurrentPosition();
        _guessedBorrowed = borrows;
        const totalAssets = (await wantToken.balanceOf(strategy.address)).add(deposits).sub(borrows);
        const debtRatio = (await poolManager.strategies(strategy.address)).debtRatio;

        expect(debtRatio).to.equal(utils.parseUnits('0.75', 9));
        expect(totalAssets).to.be.closeTo(_startAmountUSDC.mul(debtRatio).div(utils.parseUnits('1', 9)), 10);
        expect(await strategy.estimatedTotalAssets()).to.equal(totalAssets);
      });

      it('success - check harvest with guessedBorrows', async () => {
        expect(await strategy.estimatedTotalAssets()).to.equal(0);
        await strategy.connect(keeper)['harvest(uint256)'](_guessedBorrowed, { gasLimit: 3e6 });

        const { deposits, borrows } = await strategy.getCurrentPosition();
        expectApprox(borrows, _guessedBorrowed, 0.1);
        const totalAssets = (await wantToken.balanceOf(strategy.address)).add(deposits).sub(borrows);
        const debtRatio = (await poolManager.strategies(strategy.address)).debtRatio;

        expect(debtRatio).to.equal(utils.parseUnits('0.75', 9));
        expect(totalAssets).to.be.closeTo(_startAmountUSDC.mul(debtRatio).div(utils.parseUnits('1', 9)), 10);
        expect(await strategy.estimatedTotalAssets()).to.equal(totalAssets);
      });

      it('success - balanceExcludingRewards < minWant', async () => {
        await impersonate(strategy.address, async acc => {
          await network.provider.send('hardhat_setBalance', [
            strategy.address,
            ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
          ]);

          const balance = await wantToken.balanceOf(acc.address);
          await wantToken.connect(acc).transfer(user.address, balance);
        });

        expect(await strategy.estimatedTotalAssets()).to.equal(0);
      });
    });

    describe('cooldown', () => {
      it('reverts - when no stkAave balance', async () => {
        await expect(strategy.connect(keeper).cooldown()).to.be.revertedWith('INVALID_BALANCE_ON_COOLDOWN');
      });
      it('success - cooldown activated', async () => {
        const amountStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
        await impersonate(stkAaveHolder, async acc => {
          await network.provider.send('hardhat_setBalance', [stkAaveHolder, amountStorage]);
          await (await stkAave.connect(acc).transfer(strategy.address, parseEther('1'))).wait();
        });
        await strategy.connect(keeper).cooldown();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
      });
    });
    describe('claimRewards', () => {
      it('success - when nothing to claim', async () => {
        const stkAaveBalance = await stkAave.balanceOf(strategy.address);
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(stkAaveBalance);
      });
      it('success - when stkAave balance is not null and check cooldown has not been created', async () => {
        const impersonatedAddresses = [stkAaveHolder];

        for (const address of impersonatedAddresses) {
          await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [address],
          });
          await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
          impersonatedSigners[address] = await ethers.getSigner(address);
        }
        await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(strategy.address, parseEther('1'));
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        // stkAave balance remains unchanged but cooldown must be triggered
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(parseEther('1'));
      });
      it('success - when stkAave balance is not null check cooldown has been created but we are in the meantime', async () => {
        const impersonatedAddresses = [stkAaveHolder];

        for (const address of impersonatedAddresses) {
          await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [address],
          });
          await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
          impersonatedSigners[address] = await ethers.getSigner(address);
        }
        await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(strategy.address, parseEther('1'));
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        await strategy.connect(keeper).claimRewards();
        // stkAave balance remains unchanged but cooldown must be triggered
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(parseEther('1'));
      });
      it('success - cooldown status is 1', async () => {
        const impersonatedAddresses = [stkAaveHolder];

        for (const address of impersonatedAddresses) {
          await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [address],
          });
          await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
          impersonatedSigners[address] = await ethers.getSigner(address);
        }
        await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(strategy.address, parseEther('1'));
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        await increaseTime(24 * 10 * 3600 + 10);
        await strategy.connect(keeper).claimRewards();
        // Rewards have been claimed and redeemed
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(parseEther('0'));
        // Rewards have been gained: it's 0.001 in 10 days so: we get
        expectApprox(await aave.balanceOf(strategy.address), parseEther('1.00191'), 0.1);
      });
      it('success - cooldown status should be 1 but unstake window was overriden', async () => {
        const impersonatedAddresses = [stkAaveHolder];

        for (const address of impersonatedAddresses) {
          await hre.network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [address],
          });
          await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
          impersonatedSigners[address] = await ethers.getSigner(address);
        }
        await stkAave.connect(impersonatedSigners[stkAaveHolder]).transfer(strategy.address, parseEther('1'));
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        await strategy.connect(keeper).claimRewards();
        await increaseTime(24 * 30 * 3600 + 10);
        await strategy.connect(keeper).claimRewards();
        // Rewards have not been claimed because we went over the unstake window
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(parseEther('1'));
        // Cooldown reset
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        // Rewards have been gained: it's 0.001 in 10 days so: we get
      });
      it('success - when rewards to claim because real money invested', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        await increaseTime(24 * 365 * 3600);
        // This operation should just claim and trigger the cooldown
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        // Gained Approx 86 stkAave in the meantime
        expectApprox(await stkAave.balanceOf(strategy.address), parseEther('86.682886399'), 0.1);
      });
      it('success - when rewards to claim because real money invested and then changed to Aave', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        await increaseTime(24 * 365 * 3600);
        // This operation should just claim and trigger the cooldown
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.stakersCooldowns(strategy.address)).to.be.equal(await latestTime());
        // Nothing much should happen here
        await strategy.connect(keeper).claimRewards();
        // 1 stkAave is 100 USDC approx and yield on stkAave is 0.1%
        expectApprox(await stkAave.balanceOf(strategy.address), parseEther('86.682886399'), 0.1);
        await increaseTime(24 * 10 * 3600 + 10);
        await strategy.connect(keeper).claimRewards();
        expect(await stkAave.balanceOf(strategy.address)).to.be.equal(0);
        // Made some gains in the meantime
        expectApprox(await aave.balanceOf(strategy.address), parseEther('86.847909'), 0.1);
      });
    });

    describe('sellRewards', () => {
      it('success - rewards correctly sold', async () => {
        expect(await stkAave.balanceOf(strategy.address)).to.equal(0);
        expect(await aave.balanceOf(strategy.address)).to.equal(0);

        await network.provider.send('evm_increaseTime', [3600 * 24 * 1]); // forward 1 day
        await network.provider.send('evm_mine');

        expect(await stkAave.stakersCooldowns(strategy.address)).to.equal(0);
        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);

        await strategy.connect(keeper).claimRewards();
        await strategy['harvest()']({ gasLimit: 3e6 });
        await network.provider.send('evm_increaseTime', [3600 * 24 * 1]); // forward 1 day
        await network.provider.send('evm_mine');
        await strategy['harvest()']({ gasLimit: 3e6 });

        await strategy.connect(keeper).claimRewards();
        await expect(strategy.connect(keeper).sellRewards(0, '0x')).to.be.reverted;

        // Obtained and works for this block: to swap 0.01 stkAave
        const payload =
          '0xe449022e000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000' +
          '0000000000000001165faa24c0e7600000000000000000000000000000000000000000000000000000000000000600000000000000000' +
          '0000000000000000000000000000000000000000000000010000000000000000000000001a76f6b9b3d9c532e0b56990944a31a705933fbdcfee7c08';

        const aaveBefore = await aave.balanceOf(strategy.address);
        const stkAaveBefore = await stkAave.balanceOf(strategy.address);

        await strategy.connect(keeper).sellRewards(0, payload);

        const aaveAfter = await aave.balanceOf(strategy.address);
        const stkAaveAfter = await stkAave.balanceOf(strategy.address);

        expect(aaveBefore).to.equal(0);
        expect(stkAaveAfter).to.be.equal(stkAaveBefore.sub(parseUnits('1', 16)));
        expect(aaveAfter).to.be.gt(0);
        // Checking if we can sweep
        expect(await aave.balanceOf(guardian.address)).to.be.equal(0);
        await strategy.connect(guardian).sweep(aave.address, guardian.address);
        expect(await aave.balanceOf(guardian.address)).to.be.gt(0);
        expect(await aave.balanceOf(strategy.address)).to.be.equal(0);
      });
      it('reverts - because of slippage protection', async () => {
        await network.provider.send('evm_increaseTime', [3600 * 24 * 1]); // forward 1 day
        await network.provider.send('evm_mine');
        await strategy.connect(keeper).claimRewards();
        await strategy['harvest()']({ gasLimit: 3e6 });
        await network.provider.send('evm_increaseTime', [3600 * 24 * 1]); // forward 1 day
        await network.provider.send('evm_mine');
        await strategy['harvest()']({ gasLimit: 3e6 });
        await strategy.connect(keeper).claimRewards();

        // Obtained and works for this block: to swap 0.01 stkAave
        const payload =
          '0xe449022e000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000' +
          '0000000000000001165faa24c0e7600000000000000000000000000000000000000000000000000000000000000600000000000000000' +
          '0000000000000000000000000000000000000000000000010000000000000000000000001a76f6b9b3d9c532e0b56990944a31a705933fbdcfee7c08';

        await expect(strategy.connect(keeper).sellRewards(parseEther('10'), payload)).to.be.revertedWith(
          'TooSmallAmountOut',
        );
      });
      it('reverts - on a valid token but for which no allowance has been given', async () => {
        // To swap USDC to agEUR
        await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
          await wantToken.connect(acc).transfer(strategy.address, _startAmountUSDC);
        });
        // Swaps USDC to agEUR
        const payload =
          '0xe449022e00000000000000000000000000000000000000000000000000000000000f424000000000000000000000' +
          '00000000000000000000000000000bf8f77c58644fb300000000000000000000000000000000000000000000000000' +
          '00000000000060000000000000000000000000000000000000000000000000000000000000000180000000000000000' +
          '00000007ed3f364668cd2b9449a8660974a26a092c64849cfee7c08';

        await expect(strategy.connect(keeper).sellRewards(0, payload)).to.be.reverted;
      });
    });

    describe('_prepareReturn', () => {
      it('success - results expected', async () => {
        const balance = (await wantToken.balanceOf(strategy.address))
          .add(await wantToken.balanceOf(poolManager.address))
          .mul((await poolManager.strategies(strategy.address)).debtRatio)
          .div(BigNumber.from(1e9));

        await strategy['harvest()']({ gasLimit: 3e6 });

        const targetCollatRatio = await strategy.targetCollatRatio();
        const expectedBorrows = balance.mul(targetCollatRatio).div(utils.parseEther('1').sub(targetCollatRatio));
        const expectedDeposits = expectedBorrows.mul(utils.parseEther('1')).div(targetCollatRatio);

        const deposits = await aToken.balanceOf(strategy.address);
        const borrows = await debtToken.balanceOf(strategy.address);

        expect(deposits).to.be.closeTo(expectedDeposits, 5);
        expect(borrows).to.be.closeTo(expectedBorrows, 5);
        expect(await strategy.isActive()).to.be.equal(true);
      });

      it('success - other scenario', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        const debtRatio = (await poolManager.strategies(strategy.address)).debtRatio;
        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
          _startAmountUSDC.mul(debtRatio).div(utils.parseUnits('1', 9)),
          10,
        );

        const newDebtRatio = utils.parseUnits('0.5', 9);
        await poolManager.updateStrategyDebtRatio(strategy.address, newDebtRatio);
        await strategy['harvest()']({ gasLimit: 3e6 });
        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(
          _startAmountUSDC.mul(newDebtRatio).div(utils.parseUnits('1', 9)),
          50000,
        );
      });

      it('success - last scenario', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });

        // fake profit for strategy
        await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
          await wantToken.connect(acc).transfer(strategy.address, _startAmountUSDC);
        });

        await strategy['harvest()']({ gasLimit: 3e6 });

        const balance = (await poolManager.strategies(strategy.address)).totalStrategyDebt;

        const targetCollatRatio = await strategy.targetCollatRatio();
        const expectedBorrows = balance.mul(targetCollatRatio).div(utils.parseEther('1').sub(targetCollatRatio));
        const expectedDeposits = expectedBorrows.mul(utils.parseEther('1')).div(targetCollatRatio);

        const deposits = await aToken.balanceOf(strategy.address);
        const borrows = await debtToken.balanceOf(strategy.address);

        expect(deposits).to.be.closeTo(expectedDeposits, 10);
        expect(borrows).to.be.closeTo(expectedBorrows, 10);
      });
    });
    describe('manualDeleverage', () => {
      it('success - changing leverage', async () => {
        const _amount = 10_000;
        const amount = utils.parseUnits(_amount.toString(), 6);
        await strategy.connect(guardian).manualDeleverage(0);

        await strategy['harvest()']({ gasLimit: 3e6 });

        const aBefore = await aToken.balanceOf(strategy.address);
        const debtBefore = await debtToken.balanceOf(strategy.address);

        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);
        await strategy.connect(guardian).manualDeleverage(amount);

        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);
        expect(_amount).to.be.closeTo(aBefore.sub(await aToken.balanceOf(strategy.address)).div(1e6), 2);
        expect(_amount).to.be.closeTo(debtBefore.sub(await debtToken.balanceOf(strategy.address)).div(1e6), 2);
      });
    });
    describe('manualReleaseWant', () => {
      it('success - want sold', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        await strategy.connect(guardian).manualReleaseWant(0);

        const _amount = 10_000;
        const amount = utils.parseUnits(_amount.toString(), 6);

        const aBefore = await aToken.balanceOf(strategy.address);
        const debtBefore = await debtToken.balanceOf(strategy.address);
        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);

        await strategy.connect(guardian).manualReleaseWant(amount);

        expect(await wantToken.balanceOf(strategy.address)).to.equal(amount);
        expect(_amount).to.be.closeTo(aBefore.sub(await aToken.balanceOf(strategy.address)).div(1e6), 2);
        expect((await debtToken.balanceOf(strategy.address)).div(1e6)).to.equal(debtBefore.div(1e6));
      });
    });
    describe('_adjustPosition - _leverDownTo', () => {
      it('success - position adjusted', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });

        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: (await strategy.boolParams()).isFlashMintActive,
          automaticallyComputeCollatRatio: false,
          withdrawCheck: (await strategy.boolParams()).withdrawCheck,
          cooldownStkAave: (await strategy.boolParams()).cooldownStkAave,
        });
        const newCollatRatio = utils.parseUnits('0.7', 18);
        await strategy
          .connect(guardian)
          .setCollateralTargets(
            newCollatRatio,
            await strategy.maxCollatRatio(),
            await strategy.maxBorrowCollatRatio(),
            await strategy.daiBorrowCollatRatio(),
          );

        expect(await strategy.targetCollatRatio()).to.equal(newCollatRatio);

        await strategy['harvest()']({ gasLimit: 3e6 });

        const borrow = (await poolManager.strategies(strategy.address)).totalStrategyDebt
          .mul(newCollatRatio)
          .div(utils.parseEther('1').sub(newCollatRatio));

        expect(borrow).to.be.closeTo(await debtToken.balanceOf(strategy.address), 5);
        expect(await aToken.balanceOf(strategy.address)).to.be.closeTo(
          borrow.mul(utils.parseEther('1')).div(newCollatRatio),
          5,
        );
        expect(0).to.be.closeTo(await wantToken.balanceOf(strategy.address), 5);
      });
    });
    describe('_leverMax', () => {
      it('success - when flash mint is active', async () => {
        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: false,
          automaticallyComputeCollatRatio: (await strategy.boolParams()).automaticallyComputeCollatRatio,
          withdrawCheck: (await strategy.boolParams()).withdrawCheck,
          cooldownStkAave: (await strategy.boolParams()).cooldownStkAave,
        });
        await strategy['harvest()']({ gasLimit: 3e6 });

        const targetCollatRatioBefore = await strategy.targetCollatRatio();
        const aTokenBefore = await aToken.balanceOf(strategy.address);
        const debtTokenBefore = await debtToken.balanceOf(strategy.address);

        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: true,
          automaticallyComputeCollatRatio: (await strategy.boolParams()).automaticallyComputeCollatRatio,
          withdrawCheck: (await strategy.boolParams()).withdrawCheck,
          cooldownStkAave: (await strategy.boolParams()).cooldownStkAave,
        });
        await strategy['harvest()']({ gasLimit: 3e6 });

        expect(targetCollatRatioBefore).to.equal(await strategy.targetCollatRatio());
        expect(aTokenBefore).to.be.lte(await aToken.balanceOf(strategy.address));
        expect(debtTokenBefore).to.be.lte(await debtToken.balanceOf(strategy.address));
        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);
      });
      it('success - flashloan more than maxLiquidity', async () => {
        const balanceStorage = ethers.utils.hexStripZeros(
          utils.solidityKeccak256(['uint256', 'uint256'], [strategy.address, 9]),
        );
        const amountTx = utils.hexZeroPad(utils.parseUnits('900000000', 6).toHexString(), 32);

        await network.provider.send('hardhat_setStorageAt', [
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          balanceStorage,
          amountTx,
        ]);

        await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
          await wantToken.connect(acc).approve(lendingPool.address, constants.MaxUint256);
          await aToken.connect(acc).approve(lendingPool.address, constants.MaxUint256);
          // await lendingPool.connect(acc).deposit(wantToken.address, utils.parseUnits('120000000', 6), acc.address, 0);
        });
        await poolManager.updateStrategyDebtRatio(strategy.address, utils.parseUnits('1', 9));

        await strategy['harvest()']({ gasLimit: 3e6 });

        // // expect(parseFloat(utils.formatUnits(await strategy.estimatedTotalAssets(), 6))).to.be.closeTo(301_500_000, 100);

        await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
          await lendingPool.connect(acc).deposit(wantToken.address, utils.parseUnits('200000000', 6), acc.address, 0);
        });

        await strategy['harvest()']({ gasLimit: 3e6 });
        console.log(
          utils.formatUnits(await aToken.balanceOf(strategy.address), 6),
          utils.formatUnits(await debtToken.balanceOf(strategy.address), 6),
          utils.formatUnits(
            (await aToken.balanceOf(strategy.address)).sub(await debtToken.balanceOf(strategy.address)),
            6,
          ),
        );
      });
    });
    describe('_leverDownTo', () => {
      it('success - when isFlashMintActive false', async () => {
        await strategy.connect(guardian).setBoolParams({
          isFlashMintActive: false,
          automaticallyComputeCollatRatio: false,
          withdrawCheck: (await strategy.boolParams()).withdrawCheck,
          cooldownStkAave: (await strategy.boolParams()).cooldownStkAave,
        });

        await strategy['harvest()']({ gasLimit: 3e6 });
        const newCollatRatio = utils.parseUnits('0.7', 18);
        await strategy
          .connect(guardian)
          .setCollateralTargets(
            newCollatRatio,
            await strategy.maxCollatRatio(),
            await strategy.maxBorrowCollatRatio(),
            await strategy.daiBorrowCollatRatio(),
          );
        await strategy['harvest()']({ gasLimit: 3e6 });

        expect(await strategy.targetCollatRatio()).to.equal(newCollatRatio);

        expect((await aToken.balanceOf(strategy.address)).mul(newCollatRatio).div(utils.parseEther('1'))).to.be.closeTo(
          await debtToken.balanceOf(strategy.address),
          5,
        );
        expect(96).to.be.closeTo(await wantToken.balanceOf(strategy.address), 5);
      });
    });
    describe('emergencyExit', () => {
      it('success - funds exited', async () => {
        await impersonate(poolManager.address, async acc => {
          await network.provider.send('hardhat_setBalance', [
            poolManager.address,
            ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
          ]);
          await strategy.connect(acc).setEmergencyExit();
        });

        expect(await strategy.estimatedTotalAssets()).to.equal(0);
        await strategy['harvest()']({ gasLimit: 3e6 });
        expect(await strategy.estimatedTotalAssets()).to.be.closeTo(utils.parseUnits('1500000', 6), 10);
      });
    });
    describe('cooldownStkAave', () => {
      it('success - cooldown triggered', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        await expect((await strategy.boolParams()).cooldownStkAave).to.be.equal(true);

        await network.provider.send('evm_increaseTime', [3600 * 24]);
        await network.provider.send('evm_mine');
        await strategy['harvest()']({ gasLimit: 3e6 });

        await network.provider.send('evm_increaseTime', [3600 * 24 * 10.5]); // forward 11 days
        await network.provider.send('evm_mine');

        const stkAaveBalanceBefore = parseFloat(utils.formatUnits(await stkAave.balanceOf(strategy.address), 18));
        await strategy['harvest()']({ gasLimit: 3e6 });
        const aaveBalanceAfterRedeem = parseFloat(utils.formatUnits(await aave.balanceOf(strategy.address), 18));

        expect(stkAaveBalanceBefore).to.be.closeTo(aaveBalanceAfterRedeem, 0.1);
      });
    });
    describe('estimatedApr', () => {
      it('success - apr correctly estimated', async () => {
        expect(await strategy.estimatedAPR()).to.equal(0);

        await strategy['harvest()']({ gasLimit: 3e6 });
        expect(parseFloat(utils.formatUnits(await aToken.balanceOf(strategy.address), 6))).to.be.closeTo(9677419, 1000);

        expect(await wantToken.balanceOf(strategy.address)).to.equal(0);
        expect(parseFloat(utils.formatUnits(await strategy.estimatedAPR(), 18))).to.be.closeTo(0.067, 0.001);
      });
    });
  });
});
