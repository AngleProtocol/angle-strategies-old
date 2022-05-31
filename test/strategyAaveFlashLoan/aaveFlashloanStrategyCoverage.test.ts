import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network } from 'hardhat';
import { utils, Contract, providers } from 'ethers';
import { expect } from '../test-utils/chai-setup';
import { deploy, impersonate, latestTime } from '../test-utils';
import {
  AaveFlashloanStrategy,
  FlashMintLib,
  ERC20,
  ERC20__factory,
  IAaveIncentivesController__factory,
  AaveFlashloanStrategy__factory,
  PoolManager,
  IAaveIncentivesController,
  IProtocolDataProvider__factory,
  IProtocolDataProvider,
} from '../../typechain';
import { findBalancesSlot, setTokenBalanceFor } from '../utils-interaction';
import { parseUnits } from 'ethers/lib/utils';
import { BASE_PARAMS } from '../utils';

describe('AaveFlashloanStrategy - Coverage', () => {
  // ATokens
  let aToken: ERC20, debtToken: ERC20;

  // Tokens
  let wantToken: ERC20, aave: ERC20;
  let decimalsToken: number;

  // Guardians
  let deployer: SignerWithAddress,
    proxyAdmin: SignerWithAddress,
    governor: SignerWithAddress,
    guardian: SignerWithAddress,
    user: SignerWithAddress,
    keeper: SignerWithAddress;

  let poolManager: PoolManager;
  let incentivesController: IAaveIncentivesController;
  let protocolDataProvider: IProtocolDataProvider;
  let flashMintLib: FlashMintLib;
  let strategy: AaveFlashloanStrategy;

  // ReserveInterestRateStrategy for USDC
  const reserveInterestRateStrategy = '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27';
  // ReserveInterestRateStrategy for DAI
  // const reserveInterestRateStrategy = '0xfffE32106A68aA3eD39CcCE673B646423EEaB62a';

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

    const tokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    // const tokenAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

    wantToken = (await ethers.getContractAt(ERC20__factory.abi, tokenAddress)) as ERC20;
    decimalsToken = await wantToken.decimals();
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;
    // stkAave = (await ethers.getContractAt(
    //   IStakedAave__factory.abi,
    //   '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    // )) as IStakedAave;

    [deployer, proxyAdmin, governor, guardian, user, keeper] = await ethers.getSigners();

    poolManager = (await deploy('MockPoolManager', [wantToken.address, 0])) as PoolManager;

    incentivesController = (await ethers.getContractAt(
      [...IAaveIncentivesController__factory.abi, 'function setDistributionEnd(uint256 distributionEnd) external'],
      '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    )) as IAaveIncentivesController;

    protocolDataProvider = (await ethers.getContractAt(
      IProtocolDataProvider__factory.abi,
      '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
    )) as IProtocolDataProvider;

    flashMintLib = (await deploy('FlashMintLib')) as FlashMintLib;

    const strategyImplementation = (await deploy('AaveFlashloanStrategy', [], {
      libraries: {
        FlashMintLib: flashMintLib.address,
      },
    })) as AaveFlashloanStrategy;

    const proxy = await deploy('TransparentUpgradeableProxy', [
      strategyImplementation.address,
      proxyAdmin.address,
      '0x',
    ]);
    strategy = new Contract(proxy.address, AaveFlashloanStrategy__factory.abi, deployer) as AaveFlashloanStrategy;

    await strategy.initialize(poolManager.address, reserveInterestRateStrategy, governor.address, guardian.address, [
      keeper.address,
    ]);

    // (address aToken_, , address debtToken_) = _protocolDataProvider.getReserveTokensAddresses(address(want));
    const getReserveTokensAddresses = await protocolDataProvider.getReserveTokensAddresses(wantToken.address);
    aToken = (await ethers.getContractAt(ERC20__factory.abi, getReserveTokensAddresses.aTokenAddress)) as ERC20;
    debtToken = (await ethers.getContractAt(
      ERC20__factory.abi,
      getReserveTokensAddresses.variableDebtTokenAddress,
    )) as ERC20;
  });

  describe('Strategy Scenario', () => {
    const _startAmount = 100_000_000;

    beforeEach(async () => {
      await (await poolManager.addStrategy(strategy.address, utils.parseUnits('0.75', 9))).wait();

      const balanceSlot = await findBalancesSlot(wantToken.address);
      await setTokenBalanceFor(wantToken, user.address, _startAmount, balanceSlot);

      // sending funds to emission controller
      await network.provider.send('hardhat_setBalance', [
        '0xEE56e2B3D491590B5b31738cC34d5232F378a8D5',
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);

      // sending funds to strategy
      await network.provider.send('hardhat_setBalance', [
        strategy.address,
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);

      await wantToken.connect(user).transfer(poolManager.address, parseUnits(_startAmount.toString(), decimalsToken));
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });
    });

    describe('adjustPosition', () => {
      it('adjustPosition - incentive program finished', async () => {
        const timestamp = await latestTime();
        console.log('test timestamp: ', timestamp);
        await impersonate('0xee56e2b3d491590b5b31738cc34d5232f378a8d5', async acc => {
          await (incentivesController as Contract).connect(acc).setDistributionEnd(timestamp);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
        const { borrows } = await strategy.getCurrentPosition();
        expect(borrows).to.be.equal(ethers.constants.Zero);
      });
      it('adjustPosition - currentCollatRatio > _targetCollatRatio', async () => {
        await impersonate('0xEE56e2B3D491590B5b31738cC34d5232F378a8D5', async acc => {
          await incentivesController
            .connect(acc)
            .configureAssets([aToken.address, debtToken.address], [ethers.constants.Zero, ethers.constants.Zero]);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
        const { borrows } = await strategy.getCurrentPosition();
        expect(borrows).to.be.equal(ethers.constants.Zero);
      });

      it('_liquidatePosition - withdrawCheck - success', async () => {
        await impersonate('0xEE56e2B3D491590B5b31738cC34d5232F378a8D5', async acc => {
          await incentivesController
            .connect(acc)
            .configureAssets([aToken.address, debtToken.address], [ethers.constants.Zero, ethers.constants.Zero]);

          await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
          const { borrows } = await strategy.getCurrentPosition();
          expect(borrows).to.be.equal(ethers.constants.Zero);
        });
      });

      it('onFlashLoan - revert', async () => {
        await expect(
          strategy
            .connect(keeper)
            .onFlashLoan(keeper.address, keeper.address, ethers.constants.Zero, ethers.constants.Zero, '0x'),
        ).to.be.revertedWith('InvalidSender');
      });

      it('cooldownStkAave - too soon', async () => {
        await strategy['harvest()']({ gasLimit: 3e6 });
        await expect((await strategy.boolParams()).cooldownStkAave).to.be.true;

        await network.provider.send('evm_increaseTime', [3600 * 24]);
        await network.provider.send('evm_mine');
        await strategy['harvest()']({ gasLimit: 3e6 });

        await network.provider.send('evm_increaseTime', [3600 * 24 * 5]); // forward 11 days
        await network.provider.send('evm_mine');

        const aaveBalanceBefore = parseFloat(utils.formatUnits(await aave.balanceOf(strategy.address), 18));
        await strategy['harvest()']({ gasLimit: 3e6 });
        const aaveBalanceAfterRedeem = parseFloat(utils.formatUnits(await aave.balanceOf(strategy.address), 18));

        expect(aaveBalanceAfterRedeem).to.be.closeTo(aaveBalanceBefore, 0.1);
      });
      it('estimatedAPR', async () => {
        const estimatedAPR = await strategy.estimatedAPR();
        expect(estimatedAPR).to.be.closeTo(parseUnits('0.054', 18), parseUnits('0.005', 18));
      });
    });

    describe('freeFunds', () => {
      // We should in anycase be able to be at the target debt ratio
      it('Large borrow', async () => {
        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });

        let { borrows } = await strategy.getCurrentPosition();
        expect(borrows).to.gt(ethers.constants.Zero);

        await impersonate(poolManager.address, async acc => {
          const balanceStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
          await network.provider.send('hardhat_setBalance', [acc.address, balanceStorage]);
          const balanceManager = await wantToken.balanceOf(acc.address);
          await wantToken.connect(acc).transfer(user.address, balanceManager);
          expect(balanceManager).to.gt(ethers.constants.Zero);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
        ({ borrows } = await strategy.getCurrentPosition());
        expect(borrows).to.gt(ethers.constants.Zero);
        const balanceManager = await wantToken.balanceOf(poolManager.address);
        const totalAsset = await poolManager.getTotalAsset();
        const debtRatio = await poolManager.debtRatio();
        expect(balanceManager).to.closeTo(
          totalAsset.mul(BASE_PARAMS.sub(debtRatio)).div(BASE_PARAMS),
          parseUnits('100', decimalsToken),
        );
      });

      it('Small borrow', async () => {
        const emissionAToken = (await incentivesController.assets(aToken.address)).emissionPerSecond;
        const emissionDebtToken = (await incentivesController.assets(debtToken.address)).emissionPerSecond;
        const multiplier = parseUnits('0.5985', 4);
        const basePoint = parseUnits('1', 4);

        // reduce the emission to limit leverage
        await impersonate('0xEE56e2B3D491590B5b31738cC34d5232F378a8D5', async acc => {
          await incentivesController
            .connect(acc)
            .configureAssets(
              [aToken.address, debtToken.address],
              [emissionAToken.mul(multiplier).div(basePoint), emissionDebtToken.mul(multiplier).div(basePoint)],
            );
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });

        const { borrows } = await strategy.getCurrentPosition();
        expect(borrows).to.gt(ethers.constants.Zero);

        await impersonate(poolManager.address, async acc => {
          const balanceStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
          await network.provider.send('hardhat_setBalance', [acc.address, balanceStorage]);
          const balanceManager = await wantToken.balanceOf(acc.address);
          await wantToken.connect(acc).transfer(user.address, balanceManager);
          expect(balanceManager).to.gt(ethers.constants.Zero);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
        const { borrows: newBorrows } = await strategy.getCurrentPosition();
        expect(borrows).to.lt(newBorrows);
        const balanceManager = await wantToken.balanceOf(poolManager.address);
        const totalAsset = await poolManager.getTotalAsset();
        const debtRatio = await poolManager.debtRatio();
        expect(balanceManager).to.closeTo(
          totalAsset.mul(BASE_PARAMS.sub(debtRatio)).div(BASE_PARAMS),
          parseUnits('100', decimalsToken),
        );
      });
      it('No borrow', async () => {
        await impersonate('0xEE56e2B3D491590B5b31738cC34d5232F378a8D5', async acc => {
          await incentivesController
            .connect(acc)
            .configureAssets([aToken.address, debtToken.address], [ethers.constants.Zero, ethers.constants.Zero]);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });

        let { borrows } = await strategy.getCurrentPosition();
        expect(borrows).to.equal(ethers.constants.Zero);

        await impersonate(poolManager.address, async acc => {
          const balanceStorage = ethers.utils.hexStripZeros(utils.parseEther('1').toHexString());
          await network.provider.send('hardhat_setBalance', [acc.address, balanceStorage]);

          const balanceManager = await wantToken.balanceOf(acc.address);
          await wantToken.connect(acc).transfer(user.address, balanceManager);
          expect(balanceManager).to.gt(ethers.constants.Zero);
        });

        await strategy.connect(keeper)['harvest(uint256)'](ethers.constants.Zero, { gasLimit: 3e6 });
        ({ borrows } = await strategy.getCurrentPosition());
        expect(borrows).to.equal(ethers.constants.Zero);
        const balanceManager = await wantToken.balanceOf(poolManager.address);
        const totalAsset = await poolManager.getTotalAsset();
        const debtRatio = await poolManager.debtRatio();
        expect(balanceManager).to.closeTo(
          totalAsset.mul(BASE_PARAMS.sub(debtRatio)).div(BASE_PARAMS),
          parseUnits('100', decimalsToken),
        );
      });
    });
  });
});
