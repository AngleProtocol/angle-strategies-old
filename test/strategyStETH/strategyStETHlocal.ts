import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import {
  MockCurveStETHETH,
  MockStETH,
  MockWETH,
  PoolManager,
  StETHStrategy,
  StETHStrategy__factory,
} from '../../typechain';
import { gwei, ether } from '../../utils/bignumber';
import { deploy, deployUpgradeable } from '../test-utils';
import hre, { ethers } from 'hardhat';
import { expect } from '../test-utils/chai-setup';
import { BASE_PARAMS, BASE_TOKENS } from '../utils';
import { parseUnits } from 'ethers/lib/utils';

async function initWETH(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  collatBase = BigNumber.from('18'),
): Promise<{
  wETH: MockWETH;
  managerETH: PoolManager;
  stETH: MockStETH;
  curve: MockCurveStETHETH;
  strategy: StETHStrategy;
}> {
  const wETH = (await deploy('MockWETH', ['WETH', 'WETH', collatBase])) as MockWETH;
  const managerETH = (await deploy('PoolManager', [wETH.address, governor.address, guardian.address])) as PoolManager;
  const stETH = (await deploy('MockStETH', ['stETH', 'stETH', collatBase])) as MockStETH;
  const curve = (await deploy('MockCurveStETHETH', [stETH.address])) as MockCurveStETHETH;

  const strategy = (await deployUpgradeable(new StETHStrategy__factory(guardian))) as StETHStrategy;
  await strategy.initialize(
    managerETH.address,
    governor.address,
    guardian.address,
    [keeper.address],
    curve.address,
    wETH.address,
    stETH.address,
    parseUnits('3', 9),
  );

  await managerETH.connect(governor).addStrategy(strategy.address, gwei('0.8'));

  return { wETH, managerETH, stETH, curve, strategy };
}

let governor: SignerWithAddress, guardian: SignerWithAddress, user: SignerWithAddress, keeper: SignerWithAddress;
let strategy: StETHStrategy;
let managerETH: PoolManager;
let curve: MockCurveStETHETH;
let stETH: MockStETH;
let wETH: MockWETH;
const guardianRole = ethers.utils.solidityKeccak256(['string'], ['GUARDIAN_ROLE']);
const managerRole = ethers.utils.solidityKeccak256(['string'], ['POOLMANAGER_ROLE']);
let guardianError: string;
let managerError: string;

// Start test block
describe('StrategyStETH', () => {
  before(async () => {
    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
    ({ wETH, managerETH, stETH, curve, strategy } = await initWETH(governor, guardian));
    guardianError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${guardianRole}`;
    managerError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${managerRole}`;
  });

  describe('Initialization', () => {
    describe('Parameters', () => {
      it('poolManager', async () => {
        expect(await strategy.poolManager()).to.be.equal(managerETH.address);
      });
      it('want', async () => {
        expect(await strategy.want()).to.be.equal(wETH.address);
      });
      it('stETH', async () => {
        expect(await strategy.stETH()).to.be.equal(stETH.address);
      });
      it('wETH', async () => {
        expect(await strategy.weth()).to.be.equal(wETH.address);
      });
      it('stableSwapSTETH', async () => {
        expect(await strategy.stableSwapSTETH()).to.be.equal(curve.address);
      });
      it('apr', async () => {
        expect(await strategy.apr()).to.be.equal(parseUnits('3', 9));
      });
      it('SECONDSPERYEAR', async () => {
        expect(await strategy.SECONDSPERYEAR()).to.be.equal(BigNumber.from('31556952'));
      });
      it('DENOMINATOR', async () => {
        expect(await strategy.DENOMINATOR()).to.be.equal(BigNumber.from('10000'));
      });
      it('debtThreshold', async () => {
        expect(await strategy.debtThreshold()).to.be.equal(BASE_TOKENS.mul(BigNumber.from('100')));
      });
      it('maxSingleTrade', async () => {
        expect(await strategy.maxSingleTrade()).to.be.equal(parseUnits('10000', 18));
      });
      it('slippageProtectionOut', async () => {
        expect(await strategy.slippageProtectionOut()).to.be.equal(parseUnits('30', 0));
      });
      it('emergencyExit', async () => {
        expect(await strategy.emergencyExit()).to.be.equal(false);
      });
      it('allowance - wETH', async () => {
        expect(await wETH.allowance(strategy.address, managerETH.address)).to.be.equal(
          BigNumber.from(2).pow(BigNumber.from(256)).sub(BigNumber.from(1)),
        );
      });
      it('allowance - stETH', async () => {
        expect(await stETH.allowance(strategy.address, curve.address)).to.be.equal(
          BigNumber.from(2).pow(BigNumber.from(256)).sub(BigNumber.from(1)),
        );
      });
    });

    describe('constructor', () => {
      it('reverts - zero guardian address', async () => {
        const strategy = (await deployUpgradeable(new StETHStrategy__factory(guardian))) as StETHStrategy;
        await expect(
          strategy.initialize(
            managerETH.address,
            governor.address,
            ethers.constants.AddressZero,
            [],
            curve.address,
            wETH.address,
            stETH.address,
            parseUnits('3', 9),
          ),
        ).to.be.revertedWith('ZeroAddress');
      });
      it('reverts - zero governor address', async () => {
        const strategy = (await deployUpgradeable(new StETHStrategy__factory(guardian))) as StETHStrategy;
        await expect(
          strategy.initialize(
            managerETH.address,
            ethers.constants.AddressZero,
            guardian.address,
            [],
            curve.address,
            wETH.address,
            stETH.address,
            parseUnits('3', 9),
          ),
        ).to.be.revertedWith('ZeroAddress');
      });
      it('reverts - zero keeper address', async () => {
        const strategy = (await deployUpgradeable(new StETHStrategy__factory(guardian))) as StETHStrategy;
        await expect(
          strategy.initialize(
            managerETH.address,
            governor.address,
            guardian.address,
            [ethers.constants.AddressZero],
            curve.address,
            wETH.address,
            stETH.address,
            parseUnits('3', 9),
          ),
        ).to.be.revertedWith('ZeroAddress');
      });
      it('reverts - want != weth', async () => {
        const strategy = (await deployUpgradeable(new StETHStrategy__factory(guardian))) as StETHStrategy;
        await expect(
          strategy.initialize(
            managerETH.address,
            governor.address,
            guardian.address,
            [],
            curve.address,
            stETH.address,
            stETH.address,
            parseUnits('3', 9),
          ),
        ).to.be.revertedWith('20');
      });
    });

    describe('AccessControl', () => {
      it('guardian role', async () => {
        expect(await strategy.hasRole(guardianRole, guardian.address)).to.be.equal(true);
        expect(await strategy.hasRole(guardianRole, governor.address)).to.be.equal(true);
      });
      it('manager role', async () => {
        expect(await strategy.hasRole(managerRole, managerETH.address)).to.be.equal(true);
      });
      it('withdraw - reverts nonManager', async () => {
        await expect(strategy.connect(user).withdraw(BASE_TOKENS)).to.be.revertedWith(managerError);
      });
      it('addGuardian - reverts nonManager', async () => {
        await expect(strategy.connect(user).addGuardian(wETH.address)).to.be.revertedWith(managerError);
      });
      it('revokeGuardian - reverts nonManager', async () => {
        await expect(strategy.connect(user).revokeGuardian(wETH.address)).to.be.revertedWith(managerError);
      });
      it('setEmergencyExit - reverts nonManager', async () => {
        await expect(strategy.connect(user).setEmergencyExit()).to.be.revertedWith(managerError);
      });
      it('setDebtThreshold - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).setDebtThreshold(BASE_TOKENS)).to.be.revertedWith(guardianError);
      });
      it('sweep - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).sweep(wETH.address, user.address)).to.be.revertedWith(guardianError);
      });
      it('updateReferral - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).updateReferral(wETH.address)).to.be.revertedWith(guardianError);
      });
      it('updateMaxSingleTrade - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).updateMaxSingleTrade(BigNumber.from('0'))).to.be.revertedWith(
          guardianError,
        );
      });
      it('setApr - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).setApr(BigNumber.from('0'))).to.be.revertedWith(guardianError);
      });
      it('updateSlippageProtectionOut - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).updateSlippageProtectionOut(BigNumber.from('0'))).to.be.revertedWith(
          guardianError,
        );
      });
      it('invest - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).invest(BigNumber.from('0'))).to.be.revertedWith(guardianError);
      });
      it('rescueStuckEth - reverts nonGuardian', async () => {
        await expect(strategy.connect(user).rescueStuckEth()).to.be.revertedWith(guardianError);
      });
    });
  });

  describe('debtRatio', () => {
    it('success - set correctly for strategy', async () => {
      const debtRatio = (await managerETH.strategies(strategy.address)).debtRatio;
      expect(debtRatio).to.be.equal(BASE_PARAMS.mul(BigNumber.from('8')).div(BigNumber.from('10')));
    });
    it('success - set correctly for manager', async () => {
      expect(await managerETH.debtRatio()).to.be.equal(BASE_PARAMS.mul(BigNumber.from('8')).div(BigNumber.from('10')));
    });
  });

  describe('setGuardian - when there is a strategy', () => {
    it('success - adding a new guardian', async () => {
      await managerETH.connect(guardian).setGuardian(keeper.address, guardian.address);
      expect(await managerETH.hasRole(guardianRole, keeper.address)).to.be.equal(true);
      expect(await managerETH.hasRole(guardianRole, guardian.address)).to.be.equal(false);
      expect(await strategy.hasRole(guardianRole, keeper.address)).to.be.equal(true);
      expect(await strategy.hasRole(guardianRole, guardian.address)).to.be.equal(false);
    });
    it('success - resetting guardian', async () => {
      await managerETH.connect(governor).setGuardian(guardian.address, keeper.address);
      expect(await managerETH.hasRole(guardianRole, keeper.address)).to.be.equal(false);
      expect(await managerETH.hasRole(guardianRole, guardian.address)).to.be.equal(true);
    });
  });

  describe('estimatedAPR', () => {
    it('success - returns 0 when no asset', async () => {
      expect(await strategy.estimatedAPR()).to.be.equal(parseUnits('3', 9));
    });
  });

  describe('initializing contracts', () => {
    it('success - send ETH and wETH to curve', async () => {
      await governor.sendTransaction({
        to: curve.address,
        value: ethers.utils.parseEther('10'),
      });
      await governor.sendTransaction({
        to: wETH.address,
        value: ethers.utils.parseEther('10'),
      });
      await stETH.mint(curve.address, BASE_TOKENS.mul(BigNumber.from('10')));
    });
  });
  describe('harvest', () => {
    it('init - minting on poolManager', async () => {
      await wETH.mint(managerETH.address, ether('10'));
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(BASE_TOKENS.mul(BigNumber.from('10')));
    });

    it('success - lent assets updated', async () => {
      const balance = await hre.ethers.provider.getBalance(curve.address);
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      // Still 10 total assets
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      // But 8 lent from manager to strategy
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('2'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('8'));
      // These 8 are then given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('8'));
      expect(await strategy.wantBalance()).to.be.equal(ether('0'));
      expect(await strategy.stethBalance()).to.be.equal(ether('8'));
      expect(await managerETH.totalDebt()).to.be.equal(ether('8'));
      expect((await managerETH.strategies(strategy.address)).totalStrategyDebt).to.be.equal(ether('8'));
      expect(await hre.ethers.provider.getBalance(curve.address)).to.be.equal(balance.add(ether('8')));
    });

    it('setting - creation of debt for the strategy', async () => {
      await managerETH
        .connect(governor)
        .updateStrategyDebtRatio(strategy.address, BASE_PARAMS.mul(BigNumber.from('5')).div(BigNumber.from('10')));
      expect((await managerETH.strategies(strategy.address)).debtRatio).to.be.equal(
        BASE_PARAMS.mul(BigNumber.from('5')).div(BigNumber.from('10')),
      );
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
    });
    it('success - manager debt ratio check', async () => {
      expect(await managerETH.debtRatio()).to.be.equal(BASE_PARAMS.mul(BigNumber.from('5')).div(BigNumber.from('10')));
    });

    it('updateStrategyDebtRatio reverts', async () => {
      await expect(
        managerETH
          .connect(governor)
          .updateStrategyDebtRatio(keeper.address, BASE_PARAMS.mul(BigNumber.from('5')).div(BigNumber.from('10'))),
      ).to.be.revertedWith('78');
      await expect(
        managerETH
          .connect(governor)
          .updateStrategyDebtRatio(strategy.address, BASE_PARAMS.mul(BigNumber.from('11')).div(BigNumber.from('10'))),
      ).to.be.revertedWith('76');
    });
    it('success - harvesting with debt', async () => {
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      // 3 have been withdrawn from strat
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('5'));

      // Still 10 total assets
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('5'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('5'));
    });
    it('success - resetting everything', async () => {
      await managerETH
        .connect(governor)
        .updateStrategyDebtRatio(strategy.address, BASE_PARAMS.mul(BigNumber.from('0')).div(BigNumber.from('10')));
      expect((await managerETH.strategies(strategy.address)).debtRatio).to.be.equal(
        BASE_PARAMS.mul(BigNumber.from('0')).div(BigNumber.from('10')),
      );
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      expect(await managerETH.debtRatio()).to.be.equal(BASE_PARAMS.mul(BigNumber.from('0')).div(BigNumber.from('10')));
      await (await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 })).wait();
      // 3 have been withdrawn from strat
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('10'));

      // Still 10 total assets
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('0'));
    });
    it('success - increasing back again debt ratios and setting dy', async () => {
      await managerETH
        .connect(governor)
        .updateStrategyDebtRatio(strategy.address, BASE_PARAMS.mul(BigNumber.from('8')).div(BigNumber.from('10')));
      // In this situation, we should use the Lido way
      await curve.setDy(BASE_TOKENS.mul(BigNumber.from('9')).div(BigNumber.from('10')));
    });
    it('success - harvest using the Lido circuit', async () => {
      const balance = await hre.ethers.provider.getBalance(curve.address);
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      // Still 10 total assets
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      // But 8 lent from manager to strategy
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('2'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('8'));
      // These 8 are then given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('8'));
      expect(await managerETH.totalDebt()).to.be.equal(ether('8'));
      expect((await managerETH.strategies(strategy.address)).totalStrategyDebt).to.be.equal(ether('8'));
      // The amount of ETH on Curve should not have changed in this situation
      expect(await hre.ethers.provider.getBalance(curve.address)).to.be.equal(balance);
      // Setting reward back to normal
      await curve.setDy(BASE_TOKENS);
    });
    it('success - recording a gain', async () => {
      // Minting two stETH meaning there is an increase
      await stETH.mint(strategy.address, ether('2'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('10'));
    });
    it('success - harvesting after a gain', async () => {
      // There is 12 in total assets now, 0.8 * 12 should go to the strategy, the rest to the poolManager
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('12'));
      // But 8 lent from manager to strategy
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('2.4'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('9.6'));
      // These 8 are then given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('9.6'));
      expect(await managerETH.totalDebt()).to.be.equal(ether('9.6'));
      expect((await managerETH.strategies(strategy.address)).totalStrategyDebt).to.be.equal(ether('9.6'));
    });
    it('success - recording a loss', async () => {
      await stETH.burn(strategy.address, ether('2'));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      expect(await managerETH.debtRatio()).to.be.equal(BASE_PARAMS.mul(BigNumber.from('8')).div(BigNumber.from('10')));
      // Still 10 total assets
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('8'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('8'));
    });
  });
  describe('withdraw', () => {
    it('reverts - invalid strategy', async () => {
      await expect(managerETH.connect(governor).withdrawFromStrategy(governor.address, ether('1'))).to.be.revertedWith(
        '78',
      );
    });
    it('success - wantBal < _amountNeeded', async () => {
      await managerETH.connect(governor).withdrawFromStrategy(strategy.address, ether('1'));
      // 1 have been withdrawn from strat
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('3'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('7'));
      // Still 10 total assets
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      // 4 are given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
    });
    it('success - wantBal >= amountNeeded', async () => {
      await wETH.mint(strategy.address, ether('1'));
      await managerETH.connect(governor).withdrawFromStrategy(strategy.address, ether('1'));
      // 1 have been withdrawn from strat
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('4'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('7'));
      // Still 10 total assets
      // total debt is not updated after withdrawing
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10'));
      // 4 are given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
    });
    it('success - with a loss', async () => {
      await curve.setDy(BASE_TOKENS.mul(BigNumber.from('11')).div(BigNumber.from('10')));
      // In this case you loose a portion and cannot withdraw everything
      await managerETH.connect(governor).withdrawFromStrategy(strategy.address, ether('1'));

      // 1 have been withdrawn from strat
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(
        ether('4').add(ether('1').mul(BigNumber.from('10')).div(BigNumber.from('11'))),
      );
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('6'));
      // Still 10 total assets

      expect(await managerETH.getTotalAsset()).to.be.equal(ether('9').add(ether('10').div(BigNumber.from('11'))));
      // 4 are given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      await curve.setDy(BASE_TOKENS);
    });
  });
  describe('liquidateAllPositions', () => {
    it('success - setEmergencyExit', async () => {
      await managerETH.connect(governor).setStrategyEmergencyExit(strategy.address);
      expect(await strategy.emergencyExit()).to.be.equal(true);
    });
    it('success - harvest', async () => {
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      // This harvest makes us find about the wETH that had been left aside
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('10').add(ether('10').div(BigNumber.from('11'))));
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('0'));
    });
  });

  describe('updateReferral', () => {
    it('success', async () => {
      await strategy.connect(governor).updateReferral(user.address);
    });
  });
  describe('updateMaxSingleTrade', () => {
    it('success', async () => {
      await strategy.connect(governor).updateMaxSingleTrade(BASE_TOKENS.mul(BigNumber.from('100')));
      expect(await strategy.maxSingleTrade()).to.be.equal(BASE_TOKENS.mul(BigNumber.from('100')));
    });
  });
  describe('setApr', () => {
    it('success', async () => {
      await strategy.connect(governor).setApr(BASE_TOKENS.mul(BigNumber.from('9')).div(BigNumber.from('100')));
      expect(await strategy.apr()).to.be.equal(BASE_TOKENS.mul(BigNumber.from('9')).div(BigNumber.from('100')));
    });
  });
  describe('updateSlippageProtectionOut', () => {
    it('success', async () => {
      await strategy.connect(governor).updateSlippageProtectionOut(BigNumber.from('51'));
      expect(await strategy.slippageProtectionOut()).to.be.equal(BigNumber.from('51'));
    });
  });
  describe('invest', () => {
    it('reverts - wantBalance <= amount', async () => {
      await expect(strategy.connect(guardian).invest(BASE_TOKENS.mul(BigNumber.from('100')))).to.be.revertedWith('');
    });

    it('success', async () => {
      // First minting wETH to have a non
      await curve.setDy(BASE_TOKENS);
      await wETH.mint(strategy.address, BASE_TOKENS.mul(BigNumber.from('1')));
      const stETHBalance = await strategy.stethBalance();
      await strategy.connect(guardian).invest(BASE_TOKENS.mul(BigNumber.from('1')));
      expect(await strategy.stethBalance()).to.be.equal(stETHBalance.add(BASE_TOKENS.mul(BigNumber.from('1'))));
    });
  });
  describe('rescueStuckEth', () => {
    it('success - eth converted', async () => {
      await governor.sendTransaction({
        to: strategy.address,
        value: ethers.utils.parseEther('10'),
      });
      await strategy.connect(guardian).rescueStuckEth();
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(BASE_TOKENS.mul(BigNumber.from('10')));
    });
  });
  describe('sweep', () => {
    it('reverts - wETH', async () => {
      await expect(strategy.connect(guardian).sweep(wETH.address, governor.address)).to.be.revertedWith('InvalidToken');
    });
    it('reverts - stETH', async () => {
      await expect(strategy.connect(guardian).sweep(stETH.address, governor.address)).to.be.revertedWith(
        'InvalidToken',
      );
    });
  });
  describe('harvest - other cases', () => {
    it('init', async () => {
      ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
      ({ wETH, managerETH, stETH, curve, strategy } = await initWETH(governor, guardian));
      await governor.sendTransaction({
        to: curve.address,
        value: ethers.utils.parseEther('10'),
      });
      await governor.sendTransaction({
        to: wETH.address,
        value: ethers.utils.parseEther('10'),
      });
      await stETH.mint(curve.address, BASE_TOKENS.mul(BigNumber.from('10')));
      await wETH.mint(managerETH.address, ether('10'));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
    });
    it('success - withdraw < withdrawn', async () => {
      // In this situation we should have a profit inferior to the loss
      // This will result in a loss if we increase the dy
      await curve.setDy(BASE_TOKENS.mul(BigNumber.from('20')).div(BigNumber.from('10')));
      await wETH.burn(managerETH.address, ether('2'));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      // Has lost 2, then to bring it back to 0.64 => has lost 0.8 when withdrawing
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('7.2'));
      // But 8 lent from manager to strategy
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('0.8'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('6.4'));
      // These 8 are then given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('6.4'));
      expect(await strategy.wantBalance()).to.be.equal(ether('0'));
      expect(await strategy.stethBalance()).to.be.equal(ether('6.4'));
      expect(await managerETH.totalDebt()).to.be.equal(ether('6.4'));
      expect((await managerETH.strategies(strategy.address)).totalStrategyDebt).to.be.equal(ether('6.4'));
      await curve.setDy(BASE_TOKENS);
    });
    it('success - wantBal < toWithdraw', async () => {
      await stETH.mint(strategy.address, ether('2'));
      await strategy.connect(guardian).updateMaxSingleTrade(BigNumber.from('0'));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      expect(await managerETH.getTotalAsset()).to.be.equal(ether('7.2'));
      // But 8 lent from manager to strategy
      expect(await wETH.balanceOf(managerETH.address)).to.be.equal(ether('0.8'));
      expect(await strategy.estimatedTotalAssets()).to.be.equal(ether('8.4'));
      // These 8 are then given to the lender
      expect(await wETH.balanceOf(strategy.address)).to.be.equal(ether('0'));
      expect(await stETH.balanceOf(strategy.address)).to.be.equal(ether('8.4'));
      expect(await strategy.wantBalance()).to.be.equal(ether('0'));
      expect(await strategy.stethBalance()).to.be.equal(ether('8.4'));
      expect(await managerETH.totalDebt()).to.be.equal(ether('6.4'));
      expect((await managerETH.strategies(strategy.address)).totalStrategyDebt).to.be.equal(ether('6.4'));
    });
    it('success - harvestTrigger with a big debt threshold', async () => {
      await strategy.connect(guardian).setDebtThreshold(ether('1'));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      await stETH.burn(strategy.address, ether('8.4'));
    });
    it('success - strategyExit with too much freed', async () => {
      await managerETH.connect(governor).setStrategyEmergencyExit(strategy.address);
      expect(await strategy.emergencyExit()).to.be.equal(true);
      const assets = await managerETH.getTotalAsset();
      await wETH.mint(strategy.address, BASE_TOKENS.mul(BigNumber.from('100')));
      await (await strategy['harvest()']({ gasLimit: 3e6 })).wait();
      expect(await managerETH.getTotalAsset()).to.be.equal(assets.add(BASE_TOKENS.mul(BigNumber.from('100'))));
    });
  });
});
