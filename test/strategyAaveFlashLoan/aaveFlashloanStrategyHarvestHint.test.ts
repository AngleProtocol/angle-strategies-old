import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers, network } from 'hardhat';
import { utils, BigNumber, Contract } from 'ethers';
import { expect } from '../test-utils/chai-setup';
import { deploy, impersonate } from '../test-utils';
import {
  AaveFlashloanStrategy,
  FlashMintLib,
  ERC20,
  ERC20__factory,
  IAaveIncentivesController__factory,
  AaveFlashloanStrategy__factory,
  PoolManager,
  IProtocolDataProvider,
  IAaveIncentivesController,
  ILendingPool,
  IProtocolDataProvider__factory,
  ILendingPool__factory,
} from '../../typechain';
import { getOptimalBorrow, getConstrainedBorrow } from '../../utils/optimization';
import { parseUnits } from 'ethers/lib/utils';
import { expectApproxDelta } from '../../utils/bignumber';
import { getParamsOptim } from '../utils';

const PRECISION = 3;
const toOriginalBase = (n: BigNumber, base = 6) => n.mul(utils.parseUnits('1', base)).div(utils.parseUnits('1', 27));

describe('AaveFlashloanStrategy - Harvest Hint', () => {
  // ATokens
  let aToken: ERC20, debtToken: ERC20;
  let aDAIToken: ERC20, debtDAIToken: ERC20;

  // Tokens
  let wantToken: ERC20, dai: ERC20;
  let wantDecimals: number;
  let daiDecimals: number;

  // Guardians
  let deployer: SignerWithAddress,
    proxyAdmin: SignerWithAddress,
    governor: SignerWithAddress,
    guardian: SignerWithAddress,
    user: SignerWithAddress,
    keeper: SignerWithAddress;

  let poolManager: PoolManager;
  let poolManagerDAI: PoolManager;
  let protocolDataProvider: IProtocolDataProvider;
  let incentivesController: IAaveIncentivesController;
  let lendingPool: ILendingPool;
  let flashMintLib: FlashMintLib;
  let aavePriceChainlink: Contract;

  let strategy: AaveFlashloanStrategy;
  let maxCollatRatio: BigNumber;

  let keeperError: string;

  // ReserveInterestRateStrategy for USDC
  const reserveInterestRateStrategyUSDC = '0x8Cae0596bC1eD42dc3F04c4506cfe442b3E74e27';
  // ReserveInterestRateStrategy for DAI
  const reserveInterestRateStrategyDAI = '0xfffE32106A68aA3eD39CcCE673B646423EEaB62a';

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
    wantDecimals = await wantToken.decimals();
    daiDecimals = await dai.decimals();
    /*
    aave = (await ethers.getContractAt(ERC20__factory.abi, '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9')) as ERC20;
    stkAave = (await ethers.getContractAt(
      IStakedAave__factory.abi,
      '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
    )) as IStakedAave;
    */

    [deployer, proxyAdmin, governor, guardian, user, keeper] = await ethers.getSigners();

    aavePriceChainlink = await new Contract(
      '0x547a514d5e3769680Ce22B2361c10Ea13619e8a9',
      [
        'function latestRoundData() external view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
      ],
      deployer,
    );

    poolManager = (await deploy('MockPoolManager', [wantToken.address, 0])) as PoolManager;
    poolManagerDAI = (await deploy('MockPoolManager', [dai.address, 0])) as PoolManager;

    protocolDataProvider = (await ethers.getContractAt(
      IProtocolDataProvider__factory.abi,
      '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d',
    )) as IProtocolDataProvider;

    incentivesController = (await ethers.getContractAt(
      IAaveIncentivesController__factory.abi,
      '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5',
    )) as IAaveIncentivesController;

    lendingPool = (await ethers.getContractAt(
      ILendingPool__factory.abi,
      '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
    )) as ILendingPool;

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

    aToken = (await ethers.getContractAt(ERC20__factory.abi, '0xBcca60bB61934080951369a648Fb03DF4F96263C')) as ERC20;
    debtToken = (await ethers.getContractAt(ERC20__factory.abi, '0x619beb58998eD2278e08620f97007e1116D5D25b')) as ERC20;

    aDAIToken = (await ethers.getContractAt(ERC20__factory.abi, '0x028171bCA77440897B824Ca71D1c56caC55b68A3')) as ERC20;
    debtDAIToken = (await ethers.getContractAt(
      ERC20__factory.abi,
      '0x6C3c78838c761c6Ac7bE9F59fe808ea2A6E4379d',
    )) as ERC20;

    keeperError = `AccessControl: account ${user.address.toLowerCase()} is missing role ${ethers.utils.solidityKeccak256(
      ['string'],
      ['KEEPER_ROLE'],
    )}`;
  });

  describe('Strategy - USDC', () => {
    const _startAmountUSDC = utils.parseUnits((111_000_000).toString(), 6);

    beforeEach(async () => {
      await strategy.initialize(
        poolManager.address,
        reserveInterestRateStrategyUSDC,
        governor.address,
        guardian.address,
        [keeper.address],
      );

      maxCollatRatio = await strategy.maxCollatRatio();

      await (await poolManager.addStrategy(strategy.address, utils.parseUnits('0.95', 9))).wait();

      await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
        await wantToken.connect(acc).transfer(user.address, _startAmountUSDC);
      });

      await wantToken.connect(user).transfer(poolManager.address, _startAmountUSDC);
    });

    it('harvest with hint - revert - wrong caller ', async () => {
      expect(await strategy.estimatedTotalAssets()).to.equal(0);

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), wantDecimals);

      await expect(strategy.connect(user)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 })).to.be.revertedWith(
        keeperError,
      );
    });

    it('harvest with hint - success', async () => {
      expect(await strategy.estimatedTotalAssets()).to.equal(0);

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), wantDecimals);
      const constrainedBorrow = getConstrainedBorrow(
        guessedBorrowed,
        toOriginalBase(paramOptimBorrow.strategyAssets, wantDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });
      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });

    it('harvest with hint - success - deposit between the 2 optims', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      const paramOptimBorrow1st = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed1st = toOriginalBase(getOptimalBorrow(paramOptimBorrow1st), wantDecimals);

      await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
        await wantToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await aToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await lendingPool
          .connect(acc)
          .deposit(wantToken.address, utils.parseUnits('300000000', wantDecimals), acc.address, 0);
      });

      const paramOptimBorrow2nd = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed2nd = toOriginalBase(getOptimalBorrow(paramOptimBorrow2nd), wantDecimals);
      const constrainedBorrow2nd = getConstrainedBorrow(
        guessedBorrowed2nd,
        toOriginalBase(paramOptimBorrow2nd.strategyAssets, wantDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed1st, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow2nd, parseUnits('1', PRECISION));
    });

    it('harvest with hint - success - withdraw between the 2 optims', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      const paramOptimBorrow1st = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed1st = toOriginalBase(getOptimalBorrow(paramOptimBorrow1st), wantDecimals);

      await network.provider.send('hardhat_setBalance', [
        '0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296',
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);

      await impersonate('0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296', async acc => {
        await wantToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await aToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await lendingPool
          .connect(acc)
          .withdraw(wantToken.address, utils.parseUnits('200000000', wantDecimals), acc.address);
      });

      const paramOptimBorrow2nd = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed2nd = toOriginalBase(getOptimalBorrow(paramOptimBorrow2nd), wantDecimals);
      const constrainedBorrow2nd = getConstrainedBorrow(
        guessedBorrowed2nd,
        toOriginalBase(paramOptimBorrow2nd.strategyAssets, wantDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed1st, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow2nd, parseUnits('1', PRECISION));
    });
    it('harvest - success - large deposit on PoolManager', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      await impersonate('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3', async acc => {
        await wantToken.connect(acc).transfer(poolManager.address, _startAmountUSDC);
      });

      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), wantDecimals);

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      // const { borrows } = await strategy.getCurrentPosition();

      // no equality because the minRation is not achieved so staying with the same borrow
      // if we remove the harvest after the deposit, then the maxLiquidity in the flashLoan is reached
      // and again we don't have the same borrow than the guessed one
      // expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });

    it('harvest - success - large withdraw on PoolManager', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      await impersonate(poolManager.address, async acc => {
        // withdraw half the liquidity
        await (await poolManager.updateStrategyDebtRatio(strategy.address, utils.parseUnits('0.5', 9))).wait();
        await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });
        const balanceManager = await wantToken.balanceOf(acc.address);
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
        ]);
        await wantToken.connect(acc).transfer(user.address, balanceManager);
        await (await poolManager.updateStrategyDebtRatio(strategy.address, utils.parseUnits('0.95', 9))).wait();
      });

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aToken,
        debtToken,
        aavePriceChainlink,
        strategy,
        wantToken,
        wantDecimals,
        poolManager,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), wantDecimals);
      const constrainedBorrow = getConstrainedBorrow(
        guessedBorrowed,
        toOriginalBase(paramOptimBorrow.strategyAssets, wantDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });
  });
  describe('Strategy - DAI', () => {
    const _startAmountDAI = utils.parseUnits((300_000_000).toString(), 18);

    beforeEach(async () => {
      await strategy.initialize(
        poolManagerDAI.address,
        reserveInterestRateStrategyDAI,
        governor.address,
        guardian.address,
        [keeper.address],
      );
      maxCollatRatio = await strategy.maxCollatRatio();

      await (await poolManagerDAI.addStrategy(strategy.address, utils.parseUnits('0.75', 9))).wait();

      await network.provider.send('hardhat_setBalance', [
        '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);
      // Curve pool
      await impersonate('0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', async acc => {
        await dai.connect(acc).transfer(user.address, _startAmountDAI);
      });

      await dai.connect(user).transfer(poolManagerDAI.address, _startAmountDAI);
    });

    it('harvest with hint - success', async () => {
      expect(await strategy.estimatedTotalAssets()).to.equal(0);

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), daiDecimals);
      const constrainedBorrow = getConstrainedBorrow(
        guessedBorrowed,
        toOriginalBase(paramOptimBorrow.strategyAssets, daiDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });
      // await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });

    it('harvest with hint - success - deposit between the 2 optims', async () => {
      // harvest to acknowledge the strategy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      const paramOptimBorrow1st = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed1st = toOriginalBase(getOptimalBorrow(paramOptimBorrow1st), daiDecimals);

      await impersonate('0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', async acc => {
        await dai.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await aToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await lendingPool.connect(acc).deposit(dai.address, utils.parseUnits('200000000', daiDecimals), acc.address, 0);
      });

      const paramOptimBorrow2nd = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed2nd = toOriginalBase(getOptimalBorrow(paramOptimBorrow2nd), daiDecimals);
      const constrainedBorrow2nd = getConstrainedBorrow(
        guessedBorrowed2nd,
        toOriginalBase(paramOptimBorrow2nd.strategyAssets, daiDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed1st, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow2nd, parseUnits('1', PRECISION));
    });

    it('harvest with hint - success - withdraw between the 2 optims', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      const paramOptimBorrow1st = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed1st = toOriginalBase(getOptimalBorrow(paramOptimBorrow1st), daiDecimals);

      await network.provider.send('hardhat_setBalance', [
        '0xa13C0c8eB109F5A13c6c90FC26AFb23bEB3Fb04a',
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);

      await impersonate('0xa13C0c8eB109F5A13c6c90FC26AFb23bEB3Fb04a', async acc => {
        await dai.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await aToken.connect(acc).approve(lendingPool.address, ethers.constants.MaxUint256);
        await lendingPool.connect(acc).withdraw(dai.address, utils.parseUnits('100000000', daiDecimals), acc.address);
      });

      const paramOptimBorrow2nd = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed2nd = toOriginalBase(getOptimalBorrow(paramOptimBorrow2nd), daiDecimals);
      const constrainedBorrow2nd = getConstrainedBorrow(
        guessedBorrowed2nd,
        toOriginalBase(paramOptimBorrow2nd.strategyAssets, daiDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed1st, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow2nd, parseUnits('1', PRECISION));
    });
    it('harvest - success - large deposit on PoolManager', async () => {
      // harvest to acknowledge the strategy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      await impersonate('0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7', async acc => {
        await dai.connect(acc).transfer(poolManagerDAI.address, _startAmountDAI);
      });

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), daiDecimals);
      const constrainedBorrow = getConstrainedBorrow(
        guessedBorrowed,
        toOriginalBase(paramOptimBorrow.strategyAssets, daiDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });

    it('harvest - success - large withdraw on PoolManager', async () => {
      // harvest to acknowledge the straegy owned assets
      await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });

      await network.provider.send('hardhat_setBalance', [
        '0xa13C0c8eB109F5A13c6c90FC26AFb23bEB3Fb04a',
        ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
      ]);

      await impersonate(poolManagerDAI.address, async acc => {
        // withdraw half the liquidity
        await (await poolManagerDAI.updateStrategyDebtRatio(strategy.address, utils.parseUnits('0.5', 9))).wait();
        await strategy.connect(keeper)['harvest()']({ gasLimit: 3e6 });
        const balanceManager = await dai.balanceOf(acc.address);
        await network.provider.send('hardhat_setBalance', [
          acc.address,
          ethers.utils.hexStripZeros(utils.parseEther('100').toHexString()),
        ]);
        await dai.connect(acc).transfer(user.address, balanceManager);
        await (await poolManagerDAI.updateStrategyDebtRatio(strategy.address, utils.parseUnits('0.95', 9))).wait();
      });

      const paramOptimBorrow = await getParamsOptim(
        deployer,
        protocolDataProvider,
        lendingPool,
        incentivesController,
        aDAIToken,
        debtDAIToken,
        aavePriceChainlink,
        strategy,
        dai,
        daiDecimals,
        poolManagerDAI,
      );

      const guessedBorrowed = toOriginalBase(getOptimalBorrow(paramOptimBorrow), daiDecimals);
      const constrainedBorrow = getConstrainedBorrow(
        guessedBorrowed,
        toOriginalBase(paramOptimBorrow.strategyAssets, daiDecimals),
        maxCollatRatio,
      );

      await strategy.connect(keeper)['harvest(uint256)'](guessedBorrowed, { gasLimit: 3e6 });

      const { borrows } = await strategy.getCurrentPosition();

      expectApproxDelta(borrows, constrainedBorrow, parseUnits('1', PRECISION));
    });
  });
});
