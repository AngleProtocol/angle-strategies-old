import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { utils } from 'ethers';
import {
  CErc20I,
  CErc20I__factory,
  ERC20,
  ERC20__factory,
  GenericCompoundUpgradeable,
  GenericCompoundUpgradeable__factory,
  IComptroller,
  IComptroller__factory,
  OptimizerAPRStrategy,
  OptimizerAPRStrategy__factory,
  PoolManager,
} from '../../typechain';
import { gwei } from '../../utils/bignumber';
import { deploy, deployUpgradeable, impersonate } from '../test-utils';
import { ethers, network } from 'hardhat';
import { expect } from '../test-utils/chai-setup';
import { BASE_TOKENS } from '../utils';
import { parseUnits } from 'ethers/lib/utils';
import { findBalancesSlot, setTokenBalanceFor } from '../utils-interaction';
import { time, ZERO_ADDRESS } from '../test-utils/helpers';

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

async function initLenderCompound(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  keeper: SignerWithAddress,
  strategy: OptimizerAPRStrategy,
  name: string,
  cToken: string,
): Promise<{
  lender: GenericCompoundUpgradeable;
}> {
  const lender = (await deployUpgradeable(
    new GenericCompoundUpgradeable__factory(guardian),
  )) as GenericCompoundUpgradeable;
  await lender.initialize(strategy.address, name, cToken, [governor.address], guardian.address, [keeper.address]);
  await strategy.connect(governor).addLender(lender.address);
  return { lender };
}

let governor: SignerWithAddress, guardian: SignerWithAddress, user: SignerWithAddress, keeper: SignerWithAddress;
let strategy: OptimizerAPRStrategy;
let token: ERC20;
let tokenDecimal: number;
let balanceSlot: number;
let comp: ERC20;
let manager: PoolManager;
let lenderCompound: GenericCompoundUpgradeable;
let comptroller: IComptroller;
let cToken: CErc20I;

const guardianRole = ethers.utils.solidityKeccak256(['string'], ['GUARDIAN_ROLE']);
const strategyRole = ethers.utils.solidityKeccak256(['string'], ['STRATEGY_ROLE']);
const keeperRole = ethers.utils.solidityKeccak256(['string'], ['KEEPER_ROLE']);
let guardianError: string;
let strategyError: string;
let keeperError: string;

// Start test block
describe('OptimizerAPR - lenderCompound', () => {
  before(async () => {
    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
    // currently USDC
    token = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    cToken = (await ethers.getContractAt(
      CErc20I__factory.abi,
      '0x39AA39c021dfbaE8faC545936693aC917d5E7563',
    )) as CErc20I;
    comp = (await ethers.getContractAt(ERC20__factory.abi, '0xc00e94Cb662C3520282E6f5717214004A7f26888')) as ERC20;
    comptroller = (await ethers.getContractAt(
      [
        ...IComptroller__factory.abi,
        'function _setCompSpeeds(CToken[] memory cTokens, uint[] memory supplySpeeds, uint[] memory borrowSpeeds) external',
      ],
      '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B',
    )) as IComptroller;
    // ANGLE = (await deploy('MockToken', ['ANGLE', 'ANGLE', 18])) as MockToken;

    // oracleReward = (await ethers.getContractAt(
    //   AggregatorV3Interface__factory.abi,
    //   '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
    // )) as AggregatorV3Interface;

    guardianError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${guardianRole}`;
    strategyError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${strategyRole}`;
    keeperError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${keeperRole}`;
    // oneInch = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
  });

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            // Changing mainnet fork block breaks some tests
            blockNumber: 14805940,
          },
        },
      ],
    });
    tokenDecimal = await token.decimals();
    balanceSlot = await findBalancesSlot(token.address);

    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());

    manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;
    ({ strategy } = await initStrategy(governor, guardian, keeper, manager));
    ({ lender: lenderCompound } = await initLenderCompound(
      governor,
      guardian,
      keeper,
      strategy,
      'genericCompoundV3',
      cToken.address,
    ));
    await lenderCompound.connect(governor).grantRole(strategyRole, keeper.address);
  });

  describe('Init', () => {
    it('Constructor', async () => {
      const wrongCToken = (await ethers.getContractAt(
        CErc20I__factory.abi,
        '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643',
      )) as CErc20I;
      manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;
      ({ strategy } = await initStrategy(governor, guardian, keeper, manager));
      const lender = (await deployUpgradeable(
        new GenericCompoundUpgradeable__factory(guardian),
      )) as GenericCompoundUpgradeable;
      await expect(
        lender.initialize(strategy.address, 'wrong lender', wrongCToken.address, [governor.address], guardian.address, [
          keeper.address,
        ]),
      ).to.be.revertedWith('WrongCToken');
    });
    it('Parameters', async () => {
      expect(await lenderCompound.comp()).to.be.equal(comp.address);
      expect(await lenderCompound.comptroller()).to.be.equal(comptroller.address);
      expect(await lenderCompound.cToken()).to.be.equal(cToken.address);
      expect(await lenderCompound.lenderName()).to.be.equal('genericCompoundV3');
      expect(await lenderCompound.poolManager()).to.be.equal(manager.address);
      expect(await lenderCompound.strategy()).to.be.equal(strategy.address);
      expect(await lenderCompound.want()).to.be.equal(token.address);
    });
  });
  describe('Access Control', () => {
    it('deposit - reverts nonStrategy', async () => {
      await expect(lenderCompound.connect(user).deposit()).to.be.revertedWith(strategyError);
    });
    it('withdraw - reverts nonStrategy', async () => {
      await expect(lenderCompound.connect(user).withdraw(parseUnits('1', 0))).to.be.revertedWith(strategyError);
    });
    it('withdrawAll - reverts nonStrategy', async () => {
      await expect(lenderCompound.connect(user).withdrawAll()).to.be.revertedWith(strategyError);
    });
    it('emergencyWithdraw - reverts nonGuardian', async () => {
      await expect(lenderCompound.connect(user).emergencyWithdraw(parseUnits('1', 0))).to.be.revertedWith(
        guardianError,
      );
    });
    it('sweep - reverts nonGuardian', async () => {
      await expect(lenderCompound.connect(user).sweep(comp.address, user.address)).to.be.revertedWith(guardianError);
    });
    it('success - guardian role - strategy', async () => {
      expect(await strategy.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await strategy.hasRole(guardianRole, governor.address)).to.be.equal(true);
    });
    it('success - keeper role - lender', async () => {
      expect(await lenderCompound.hasRole(keeperRole, keeper.address)).to.be.equal(true);
      expect(await lenderCompound.hasRole(keeperRole, user.address)).to.be.equal(false);
      expect(await lenderCompound.getRoleAdmin(keeperRole)).to.be.equal(guardianRole);
      await expect(lenderCompound.connect(user).sellRewards(0, '0x')).to.be.revertedWith(keeperError);
    });
    it('success - guardian role - lender', async () => {
      expect(await lenderCompound.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await lenderCompound.hasRole(guardianRole, user.address)).to.be.equal(false);
      expect(await lenderCompound.hasRole(guardianRole, governor.address)).to.be.equal(true);
      expect(await lenderCompound.getRoleAdmin(guardianRole)).to.be.equal(strategyRole);
      await expect(lenderCompound.connect(user).grantRole(keeperRole, user.address)).to.be.revertedWith(guardianRole);
      await expect(lenderCompound.connect(user).revokeRole(keeperRole, keeper.address)).to.be.revertedWith(
        guardianRole,
      );
      await expect(lenderCompound.connect(user).changeAllowance([], [], [])).to.be.revertedWith(guardianError);
      await expect(lenderCompound.connect(user).sweep(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(guardianError);
      await expect(lenderCompound.connect(user).emergencyWithdraw(BASE_TOKENS)).to.be.revertedWith(guardianError);
    });
    it('success - strategy role - lender', async () => {
      expect(await lenderCompound.hasRole(strategyRole, strategy.address)).to.be.equal(true);
      expect(await lenderCompound.hasRole(strategyRole, user.address)).to.be.equal(false);
      expect(await lenderCompound.getRoleAdmin(strategyRole)).to.be.equal(guardianRole);
      await expect(lenderCompound.connect(user).deposit()).to.be.revertedWith(strategyError);
      await expect(lenderCompound.connect(user).withdraw(BASE_TOKENS)).to.be.revertedWith(strategyError);
      await expect(lenderCompound.connect(user).withdrawAll()).to.be.revertedWith(strategyError);
    });
  });

  describe('sweep', () => {
    it('reverts - protected token', async () => {
      await expect(lenderCompound.connect(governor).sweep(cToken.address, user.address)).to.be.revertedWith(
        'ProtectedToken',
      );
    });
  });

  describe('deposit', () => {
    it('revert', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound
        .connect(governor)
        .changeAllowance([token.address], [cToken.address], [ethers.constants.Zero]);
      await expect(lenderCompound.connect(keeper).deposit()).to.be.revertedWith('FailedToMint()');
    });
    it('success', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      expect(await token.balanceOf(lenderCompound.address)).to.be.equal(ethers.constants.Zero);
      expect(await cToken.balanceOf(lenderCompound.address)).to.be.gt(ethers.constants.Zero);
    });
  });

  describe('withdraw', () => {
    it('success - more than total', async () => {
      const amount = 2;
      await setTokenBalanceFor(token, lenderCompound.address, amount / 2, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await lenderCompound.connect(keeper).withdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits((amount / 2).toString(), tokenDecimal));
      expect(await cToken.balanceOf(lenderCompound.address)).to.be.closeTo(
        ethers.constants.Zero,
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - without interaction with compound', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).withdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits(amount.toString(), tokenDecimal));
    });

    it('success - with withdrawal', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).withdraw(parseUnits((amount * 2).toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits((amount * 2).toString(), tokenDecimal));
    });

    it('success - inexistent liquidity', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();

      // remove liquidity from Compound
      await impersonate(cToken.address, async acc => {
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
        ]);
        const liquidityAave = await token.balanceOf(cToken.address);
        await (await token.connect(acc).transfer(user.address, liquidityAave)).wait();
      });
      await time.increase(1);

      await lenderCompound.connect(keeper).withdraw(parseUnits(amount.toString()));
      expect(await token.balanceOf(strategy.address)).to.be.equal(ethers.constants.Zero);
    });

    it('success - toWithdraw > Liquidity', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();

      expect(await token.balanceOf(strategy.address)).to.be.equal(ethers.constants.Zero);
      expect(await token.balanceOf(lenderCompound.address)).to.be.equal(ethers.constants.Zero);

      // remove liquidity from Compound
      await impersonate(cToken.address, async acc => {
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
        ]);
        const liquidityAave = await token.balanceOf(cToken.address);
        await (await token.connect(acc).transfer(user.address, liquidityAave.sub(parseUnits('2', 1)))).wait();
      });
      await time.increase(1);
      await lenderCompound.connect(keeper).withdraw(parseUnits(amount.toString()));
      expect(await token.balanceOf(strategy.address)).to.be.lte(parseUnits('2', 1));
      expect(await token.balanceOf(strategy.address)).to.be.gt(ethers.constants.Zero);
    });
    it('success - toWithdraw < dust', async () => {
      await lenderCompound.connect(governor).setDust(parseUnits('1.1', tokenDecimal));
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await lenderCompound.connect(keeper).withdraw(parseUnits(amount.toString()));
      expect(await token.balanceOf(strategy.address)).to.be.equal(ethers.constants.Zero);
    });
  });

  describe('emergencyWithdraw', () => {
    it('success', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await lenderCompound.connect(governor).emergencyWithdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(manager.address)).to.be.equal(parseUnits(amount.toString(), tokenDecimal));
    });
  });

  describe('withdrawAll', () => {
    it('success - balances updated', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).withdrawAll();
      expect(await lenderCompound.nav()).to.be.closeTo(ethers.constants.Zero, parseUnits('0.01', tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.closeTo(
        parseUnits((amount * 2).toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });
  });

  describe('recoverETH', () => {
    it('revert - non payable receiver', async () => {
      await governor.sendTransaction({
        value: utils.parseEther('1'),
        to: lenderCompound.address,
      });
      await expect(
        lenderCompound.connect(governor).recoverETH(strategy.address, utils.parseEther('1')),
      ).to.be.revertedWith('FailedToRecoverETH');
    });
    it('success', async () => {
      await governor.sendTransaction({
        value: utils.parseEther('1'),
        to: lenderCompound.address,
      });
      const prevBalance = await ethers.provider.getBalance(user.address);
      await lenderCompound.connect(governor).recoverETH(user.address, utils.parseEther('1'));
      expect(await ethers.provider.getBalance(user.address)).to.be.gt(prevBalance.add(utils.parseEther('0.95')));
    });
  });

  describe('underlyingBalanceStored', () => {
    it('success - without cToken', async () => {
      expect(await lenderCompound.underlyingBalanceStored()).to.be.equal(ethers.constants.Zero);
    });
    it('success - with cToken', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      expect(await lenderCompound.underlyingBalanceStored()).to.be.closeTo(
        parseUnits(amount.toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });
  });

  describe('View functions', () => {
    it('apr', async () => {
      const apr = await lenderCompound.connect(keeper).apr();
      // at mainnet fork time there is 0.84% coming from liquidity rate, 0.49% coming from COMP incentives (multiply by 19/20 for discount)
      expect(apr).to.be.closeTo(parseUnits('0.0129', 18), parseUnits('0.001', 18));
      const weightedAPR = await lenderCompound.weightedApr();
      const nav = await lenderCompound.nav();
      expect(nav).to.be.equal(0);
      expect(weightedAPR).to.be.equal(0);
    });
    // it('apr - no supply speed', async () => {
    //   await (comptroller as Contract)._setCompSpeeds(
    //     [cToken.address],
    //     [ethers.constants.Zero],
    //     [ethers.constants.Zero],
    //   );
    //   const apr = await lenderCompound.connect(keeper).apr();
    //   // at mainnet fork time there is 0.84% coming from liquidity rate, 0% coming from COMP incentives
    //   expect(apr).to.be.closeTo(parseUnits('0.0084', 18), parseUnits('0.001', 18));
    //   const weightedAPR = await lenderCompound.weightedApr();
    //   const nav = await lenderCompound.nav();
    //   expect(nav).to.be.equal(0);
    //   expect(weightedAPR).to.be.equal(0);
    // });
    it('aprAfterDeposit', async () => {
      const aprAfterDepositSupposed = await lenderCompound
        .connect(keeper)
        .aprAfterDeposit(parseUnits('10000000', tokenDecimal));
      // Do the deposit and see if the values are indeed equals
      await setTokenBalanceFor(token, strategy.address, 10000000);
      await (await strategy.connect(keeper)['harvest()']()).wait();
      const aprReal = await lenderCompound.connect(keeper).apr();
      expect(aprAfterDepositSupposed).to.be.closeTo(aprReal, parseUnits('0.001', 18));
    });
  });

  describe('hasAssets', () => {
    it('success - without assets', async () => {
      expect(await lenderCompound.hasAssets()).to.be.equal(false);
    });

    it('success - too few assets', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderCompound.address, amount * 5, balanceSlot);
      expect(await lenderCompound.hasAssets()).to.be.equal(false);
    });

    it('success - with assets', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderCompound.address, amount * 6, balanceSlot);
      await lenderCompound.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderCompound.address, amount * 5, balanceSlot);
      expect(await lenderCompound.hasAssets()).to.be.equal(true);
    });
  });
});
