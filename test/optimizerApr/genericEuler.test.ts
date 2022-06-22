import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, utils } from 'ethers';
import {
  ERC20,
  ERC20__factory,
  GenericEuler,
  GenericEuler__factory,
  IEuler,
  IEulerEToken,
  IEulerEToken__factory,
  IEulerMarkets,
  IEulerMarkets__factory,
  IEuler__factory,
  IGovernance,
  IGovernance__factory,
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
import { findBalancesSlot, logBN, setTokenBalanceFor } from '../utils-interaction';
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

async function initLenderEuler(
  governor: SignerWithAddress,
  guardian: SignerWithAddress,
  keeper: SignerWithAddress,
  strategy: OptimizerAPRStrategy,
  name: string,
): Promise<{
  lender: GenericEuler;
}> {
  const lender = (await deployUpgradeable(new GenericEuler__factory(guardian))) as GenericEuler;
  await lender.initialize(strategy.address, name, [governor.address], guardian.address, [keeper.address]);
  await strategy.connect(governor).addLender(lender.address);
  return { lender };
}

let governor: SignerWithAddress, guardian: SignerWithAddress, user: SignerWithAddress, keeper: SignerWithAddress;
let strategy: OptimizerAPRStrategy;
let token: ERC20;
let tokenDecimal: number;
let balanceSlot: number;
let manager: PoolManager;
let lenderEuler: GenericEuler;
let eToken: IEulerEToken;
let euler: IEuler;
// let eulerMarkets: IEulerMarkets;
let governance: IGovernance;

const guardianRole = ethers.utils.solidityKeccak256(['string'], ['GUARDIAN_ROLE']);
const strategyRole = ethers.utils.solidityKeccak256(['string'], ['STRATEGY_ROLE']);
const keeperRole = ethers.utils.solidityKeccak256(['string'], ['KEEPER_ROLE']);
let guardianError: string;
let strategyError: string;
let keeperError: string;

// Start test block
describe('OptimizerAPR - lenderEuler', () => {
  before(async () => {
    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());
    // currently USDC
    token = (await ethers.getContractAt(ERC20__factory.abi, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')) as ERC20;
    eToken = (await ethers.getContractAt(
      IEulerEToken__factory.abi,
      '0xEb91861f8A4e1C12333F42DCE8fB0Ecdc28dA716',
    )) as IEulerEToken;

    euler = (await ethers.getContractAt(IEuler__factory.abi, '0x27182842E098f60e3D576794A5bFFb0777E025d3')) as IEuler;
    // eulerMarkets = (await ethers.getContractAt(
    //   IEulerMarkets__factory.abi,
    //   '0x3520d5a913427E6F0D6A83E07ccD4A4da316e4d3',
    // )) as IEulerMarkets;
    governance = (await ethers.getContractAt(
      IGovernance__factory.abi,
      '0xAF68CFba29D0e15490236A5631cA9497e035CD39',
    )) as IGovernance;

    guardianError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${guardianRole}`;
    strategyError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${strategyRole}`;
    keeperError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${keeperRole}`;
  });

  beforeEach(async () => {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ETH_NODE_URI_FORK,
            // Changing mainnet fork block breaks some tests
            blockNumber: 14967667,
          },
        },
      ],
    });
    tokenDecimal = await token.decimals();
    balanceSlot = await findBalancesSlot(token.address);

    ({ governor, guardian, user, keeper } = await ethers.getNamedSigners());

    manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;
    ({ strategy } = await initStrategy(governor, guardian, keeper, manager));
    ({ lender: lenderEuler } = await initLenderEuler(governor, guardian, keeper, strategy, 'genericEuler'));
    await lenderEuler.connect(governor).grantRole(strategyRole, keeper.address);
  });

  describe('Init', () => {
    it('Constructor - wrong want token', async () => {
      const wrongEToken = (await ethers.getContractAt(
        IEulerEToken__factory.abi,
        '0xe025E3ca2bE02316033184551D4d3Aa22024D9DC',
      )) as IEulerEToken;
      manager = (await deploy('PoolManager', [token.address, governor.address, guardian.address])) as PoolManager;
      ({ strategy } = await initStrategy(governor, guardian, keeper, manager));
      const lender = (await deployUpgradeable(new GenericEuler__factory(guardian))) as GenericEuler;
      await lender.initialize(strategy.address, 'wrong lender', [governor.address], guardian.address, [keeper.address]);
      expect(await lender.eToken()).to.not.equal(wrongEToken.address);
    });
    it('Parameters', async () => {
      expect(await lenderEuler.eToken()).to.be.equal(eToken.address);
      expect(await lenderEuler.reserveFee()).to.be.equal(BigNumber.from('920000000'));
      expect(await lenderEuler.lenderName()).to.be.equal('genericEuler');
      expect(await lenderEuler.poolManager()).to.be.equal(manager.address);
      expect(await lenderEuler.strategy()).to.be.equal(strategy.address);
      expect(await lenderEuler.want()).to.be.equal(token.address);
    });
  });
  describe('Access Control', () => {
    it('reverts - strategy functions when called by non strategy', async () => {
      await expect(lenderEuler.connect(user).deposit()).to.be.revertedWith(strategyError);
      await expect(lenderEuler.connect(user).withdraw(parseUnits('1', 0))).to.be.revertedWith(strategyError);
      await expect(lenderEuler.connect(user).withdrawAll()).to.be.revertedWith(strategyError);
    });
    it('reverts - guardian functions when called by non guardian nonGuardian', async () => {
      await expect(lenderEuler.connect(user).emergencyWithdraw(parseUnits('1', 0))).to.be.revertedWith(guardianError);
      await expect(lenderEuler.connect(user).sweep(token.address, user.address)).to.be.revertedWith(guardianError);
    });
    it('success - guardian role - strategy', async () => {
      expect(await strategy.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await strategy.hasRole(guardianRole, governor.address)).to.be.equal(true);
    });
    it('success - keeper role - lender', async () => {
      expect(await lenderEuler.hasRole(keeperRole, keeper.address)).to.be.equal(true);
      expect(await lenderEuler.hasRole(keeperRole, user.address)).to.be.equal(false);
      expect(await lenderEuler.getRoleAdmin(keeperRole)).to.be.equal(guardianRole);
      await expect(lenderEuler.connect(user).sellRewards(0, '0x')).to.be.revertedWith(keeperError);
    });
    it('success - guardian role - lender', async () => {
      expect(await lenderEuler.hasRole(guardianRole, guardian.address)).to.be.equal(true);
      expect(await lenderEuler.hasRole(guardianRole, user.address)).to.be.equal(false);
      expect(await lenderEuler.hasRole(guardianRole, governor.address)).to.be.equal(true);
      expect(await lenderEuler.getRoleAdmin(guardianRole)).to.be.equal(strategyRole);
      await expect(lenderEuler.connect(user).grantRole(keeperRole, user.address)).to.be.revertedWith(guardianRole);
      await expect(lenderEuler.connect(user).revokeRole(keeperRole, keeper.address)).to.be.revertedWith(guardianRole);
      await expect(lenderEuler.connect(user).changeAllowance([], [], [])).to.be.revertedWith(guardianError);
      await expect(lenderEuler.connect(user).sweep(ZERO_ADDRESS, ZERO_ADDRESS)).to.be.revertedWith(guardianError);
      await expect(lenderEuler.connect(user).emergencyWithdraw(BASE_TOKENS)).to.be.revertedWith(guardianError);
    });
    it('success - strategy role - lender', async () => {
      expect(await lenderEuler.hasRole(strategyRole, strategy.address)).to.be.equal(true);
      expect(await lenderEuler.hasRole(strategyRole, user.address)).to.be.equal(false);
      expect(await lenderEuler.getRoleAdmin(strategyRole)).to.be.equal(guardianRole);
      await expect(lenderEuler.connect(user).deposit()).to.be.revertedWith(strategyError);
      await expect(lenderEuler.connect(user).withdraw(BASE_TOKENS)).to.be.revertedWith(strategyError);
      await expect(lenderEuler.connect(user).withdrawAll()).to.be.revertedWith(strategyError);
    });
  });

  describe('setEulerPoolVariables', () => {
    it('success', async () => {
      // change parameters so that we can acknowledge a change in params
      const governorAdmin = await governance.getGovernorAdmin();
      await impersonate(governorAdmin, async acc => {
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
        ]);
        await governance.connect(acc).setReserveFee(token.address, BigNumber.from('120000000'));
      });
      await lenderEuler.connect(governor).setEulerPoolVariables();
      expect(await lenderEuler.reserveFee()).to.be.equal(BigNumber.from('120000000'));
    });
  });

  describe('sweep', () => {
    it('reverts - protected token', async () => {
      await expect(lenderEuler.connect(governor).sweep(eToken.address, user.address)).to.be.revertedWith(
        'ProtectedToken',
      );
      await expect(lenderEuler.connect(governor).sweep(token.address, user.address)).to.be.revertedWith(
        'ProtectedToken',
      );
    });
  });

  describe('deposit', () => {
    it('revert', async () => {
      const amount = 100000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(governor).changeAllowance([token.address], [euler.address], [ethers.constants.Zero]);
      await expect(lenderEuler.connect(keeper).deposit()).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance',
      );
    });
    it('success', async () => {
      const amount = 100000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      expect(await token.balanceOf(lenderEuler.address)).to.be.equal(ethers.constants.Zero);
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        parseUnits(amount.toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });
  });

  describe('withdraw', () => {
    it('success - total', async () => {
      const amount = 2000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await lenderEuler.connect(keeper).withdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits(amount.toString(), tokenDecimal));
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        ethers.constants.Zero,
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - partial amount', async () => {
      const amount = 2000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await lenderEuler.connect(keeper).withdraw(parseUnits((amount / 10).toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits((amount / 10).toString(), tokenDecimal));
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        parseUnits(((9 * amount) / 10).toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - without interaction with Euler', async () => {
      const amount = 100000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).withdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits(amount.toString(), tokenDecimal));
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        ethers.constants.Zero,
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - with both Euler withdrawal and balance', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).withdraw(parseUnits((amount * 2).toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(parseUnits((amount * 2).toString(), tokenDecimal));
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        ethers.constants.Zero,
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - inexistent liquidity', async () => {
      const amount = 100000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();

      // remove liquidity from Compound
      await impersonate(euler.address, async acc => {
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
        ]);
        const liquidityEuler = await token.balanceOf(euler.address);
        await (await token.connect(acc).transfer(user.address, liquidityEuler)).wait();
      });

      // need to check back balanceOFUnderlying as the hack is taken into account by Euler
      const afterHackBalance = await eToken.balanceOfUnderlying(lenderEuler.address);
      await time.increase(1);

      await lenderEuler.connect(keeper).withdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.equal(ethers.constants.Zero);
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        afterHackBalance,
        parseUnits('0.01', tokenDecimal),
      );
    });

    it('success - toWithdraw > liquidity', async () => {
      const amount = 10;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();

      expect(await token.balanceOf(strategy.address)).to.be.equal(ethers.constants.Zero);
      expect(await token.balanceOf(lenderEuler.address)).to.be.equal(ethers.constants.Zero);

      // remove liquidity from Compound
      await impersonate(euler.address, async acc => {
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('1').toHexString()),
        ]);
        const liquidityEuler = await token.balanceOf(euler.address);
        await (
          await token
            .connect(acc)
            .transfer(user.address, liquidityEuler.sub(parseUnits((amount / 2).toString(), tokenDecimal)))
        ).wait();
      });
      // need to check back balanceOFUnderlying as the hack is taken into account by Euler
      const afterHackBalance = await eToken.balanceOfUnderlying(lenderEuler.address);
      await time.increase(1);
      await lenderEuler.connect(keeper).withdraw(parseUnits(amount.toString()));

      let withdrawnAmount = parseUnits((amount / 2).toString(), tokenDecimal);
      let balanceEuler = afterHackBalance.sub(withdrawnAmount);
      if (withdrawnAmount.gt(afterHackBalance)) {
        withdrawnAmount = afterHackBalance;
        balanceEuler = ethers.constants.Zero;
      }

      expect(await token.balanceOf(strategy.address)).to.be.closeTo(withdrawnAmount, parseUnits('0.01', tokenDecimal));
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.closeTo(
        balanceEuler,
        parseUnits('0.01', tokenDecimal),
      );
    });
    it('success - toWithdraw << 1', async () => {
      const amount = 0.00001;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await lenderEuler.connect(keeper).withdraw(parseUnits(amount.toString()));
      expect(await token.balanceOf(strategy.address)).to.be.closeTo(
        parseUnits(amount.toString(), tokenDecimal),
        parseUnits('0.000001', tokenDecimal),
      );
      expect(await eToken.balanceOfUnderlying(lenderEuler.address)).to.be.equal(ethers.constants.Zero);
    });
  });

  describe('emergencyWithdraw', () => {
    it('success', async () => {
      const amount = 1000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await lenderEuler.connect(governor).emergencyWithdraw(parseUnits(amount.toString(), tokenDecimal));
      expect(await token.balanceOf(manager.address)).to.be.equal(parseUnits(amount.toString(), tokenDecimal));
    });
  });

  describe('withdrawAll', () => {
    it('success - balances updated', async () => {
      const amount = 1000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).withdrawAll();
      expect(await lenderEuler.nav()).to.be.closeTo(ethers.constants.Zero, parseUnits('0.01', tokenDecimal));
      expect(await token.balanceOf(strategy.address)).to.be.closeTo(
        parseUnits((amount * 2).toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });
  });

  describe('underlyingBalanceStored', () => {
    it('success - without eToken', async () => {
      expect(await lenderEuler.underlyingBalanceStored()).to.be.equal(ethers.constants.Zero);
    });
    it('success - with eToken', async () => {
      const amount = 50000000;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      expect(await lenderEuler.underlyingBalanceStored()).to.be.closeTo(
        parseUnits(amount.toString(), tokenDecimal),
        parseUnits('0.01', tokenDecimal),
      );
    });
  });

  describe('View functions', () => {
    it('apr', async () => {
      const apr = await lenderEuler.connect(keeper).apr();
      expect(apr).to.be.closeTo(parseUnits('0.0172', 18), parseUnits('0.001', 18));
      const weightedAPR = await lenderEuler.weightedApr();
      const nav = await lenderEuler.nav();
      expect(nav).to.be.equal(0);
      expect(weightedAPR).to.be.equal(0);
    });
    it('apr - totalSupply = 0', async () => {
      // at fork there is no supply for the DPI
      const tokenDPI = (await ethers.getContractAt(
        ERC20__factory.abi,
        '0x1494CA1F11D487c2bBe4543E90080AeBa4BA3C2b',
      )) as ERC20;

      const managerDPI = (await deploy('PoolManager', [
        tokenDPI.address,
        governor.address,
        guardian.address,
      ])) as PoolManager;
      const { strategy: strategyDPI } = await initStrategy(governor, guardian, keeper, managerDPI);
      const { lender: lenderEulerDPI } = await initLenderEuler(governor, guardian, keeper, strategyDPI, 'genericEuler');
      await lenderEulerDPI.connect(governor).grantRole(strategyRole, keeper.address);

      const apr = await lenderEulerDPI.connect(keeper).apr();
      expect(apr).to.be.eq(parseUnits('0.0', 18));
    });
    it('aprAfterDeposit', async () => {
      const amount = 100000000;
      const aprAfterDepositSupposed = await lenderEuler
        .connect(keeper)
        .aprAfterDeposit(parseUnits(amount.toString(), tokenDecimal));
      console.log('aprAfterDepositSupposed: ', logBN(aprAfterDepositSupposed));
      // Do the deposit and see if the values are indeed equals
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      const aprReal = await lenderEuler.connect(keeper).apr();
      expect(aprAfterDepositSupposed).to.be.closeTo(aprReal, parseUnits('0.0001', 18));
    });
  });

  describe('hasAssets', () => {
    it('success - without assets', async () => {
      expect(await lenderEuler.hasAssets()).to.be.equal(false);
    });

    it('success - too few assets', async () => {
      const amount = 1;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      await setTokenBalanceFor(token, lenderEuler.address, amount * 5, balanceSlot);
      expect(await lenderEuler.hasAssets()).to.be.equal(false);
    });

    it('success - with assets', async () => {
      const amount = 100;
      await setTokenBalanceFor(token, lenderEuler.address, amount, balanceSlot);
      await lenderEuler.connect(keeper).deposit();
      expect(await lenderEuler.hasAssets()).to.be.equal(true);
    });
  });
});
