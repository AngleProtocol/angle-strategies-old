import { BigNumber, Contract } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import { expectApproxDelta } from '../../utils/bignumber';
import { deploy } from '../test-utils';

const PRECISION = 3;
let computeProfitabilityContract: Contract;
let priceAave: number;
let paramsBorrow: SCalculateBorrow;

export type SCalculateBorrow = {
  reserveFactor: BigNumber;
  totalStableDebt: BigNumber;
  totalVariableDebt: BigNumber;
  totalDeposits: BigNumber;
  stableBorrowRate: BigNumber;
  rewardDeposit: BigNumber;
  rewardBorrow: BigNumber;
  strategyAssets: BigNumber;
  guessedBorrowAssets: BigNumber;
  slope1: BigNumber;
  slope2: BigNumber;
  r0: BigNumber;
  uOptimal: BigNumber;
};

describe('AaveFlashLoanStrategy - ComputeProfitability', () => {
  before(async () => {
    computeProfitabilityContract = await deploy('ComputeProfitabilityTest', []);
  });

  describe('1st set of params', () => {
    before('Fix borrow Params', () => {
      priceAave = 130;
      const priceMultiplier = BigNumber.from(Math.floor(priceAave * 60 * 60 * 24 * 365));
      const rewardDeposit = BigNumber.from('1903258773510960').mul(priceMultiplier);
      const rewardBorrow = BigNumber.from('3806517547021920').mul(priceMultiplier);
      const totalStableDebt = parseUnits('11958029.754937', 27);
      const totalVariableDebt = parseUnits('1425711403.399322', 27);
      const totalLiquidity = parseUnits('812664505.140562', 27);
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: totalStableDebt,
        totalVariableDebt: totalVariableDebt,
        totalDeposits: totalLiquidity.add(totalStableDebt).add(totalVariableDebt),
        stableBorrowRate: BigNumber.from('108870068051917638359824820'),
        rewardDeposit: parseUnits(rewardDeposit.toString(), 27 - 18),
        rewardBorrow: parseUnits(rewardBorrow.toString(), 27 - 18),
        strategyAssets: parseUnits('1000000', 27),
        guessedBorrowAssets: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.6', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.9', 27),
      };
    });
    it('1st case - rates and revenues', async () => {
      const toBorrow = parseUnits('100000', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('2.8394907581318844', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('7131752054577753', 0), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-6338112', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('2.0451974884293873', 31), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('2.7347712665372165', 24), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-1.6707144318562614', 16), parseUnits('1', PRECISION));
    });
    it('2nd case - rates and revenues', async () => {
      const toBorrow = parseUnits('200000', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('2.8395620724835146', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('7131118285542997', 0), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-6337267', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('2.0725368481954744', 31), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('2.733100753962924', 24), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-1.6703107360771058', 16), parseUnits('1', PRECISION));
    });
    it('3rd case - rates and revenues', async () => {
      const toBorrow = parseUnits('79312137', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('2.8940620565909253', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('6655012554459868', 0), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-5713324', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('1.878279888231759', 32), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('1.5290286055725022', 24), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-1.3842598981251928', 16), parseUnits('1', PRECISION));
    });
    it('1st case - optimal borrow', async () => {
      const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
      const optimalRevenue = await computeProfitabilityContract.revenuePrimes(optimalBorrow, paramsBorrow, false);

      expectApproxDelta(optimalBorrow, parseUnits('2.06699448', 8 + 27), parseUnits('1', PRECISION));
      expectApproxDelta(optimalRevenue[0], parseUnits('280521.08056477', 27), parseUnits('1', PRECISION));
    });
    it('2nd case - optimal borrow', async () => {
      const wantDecimal = 6;
      priceAave = 130;
      const priceMultiplier = BigNumber.from(Math.floor(priceAave * 60 * 60 * 24 * 365));
      const rewardDeposit = BigNumber.from('2903258773510960').mul(priceMultiplier);
      const rewardBorrow = BigNumber.from('2806517547021920').mul(priceMultiplier);
      const totalStableDebt = BigNumber.from('11958029754937');
      const totalVariableDebt = BigNumber.from('1425711403399322');
      const totalLiquidity = BigNumber.from('812664505140562');
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: parseUnits(totalStableDebt.toString(), 27 - wantDecimal),
        totalVariableDebt: parseUnits(totalVariableDebt.toString(), 27 - wantDecimal),
        totalDeposits: parseUnits(
          totalLiquidity.add(totalStableDebt).add(totalVariableDebt).toString(),
          27 - wantDecimal,
        ),
        stableBorrowRate: BigNumber.from('108870068051917638359824820'),
        rewardDeposit: parseUnits(rewardDeposit.toString(), 27 - 18),
        rewardBorrow: parseUnits(rewardBorrow.toString(), 27 - 18),
        strategyAssets: parseUnits('27000000', 27),
        guessedBorrowAssets: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.6', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.9', 27),
      };

      const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
      const optimalRevenue = await computeProfitabilityContract.revenuePrimes(optimalBorrow, paramsBorrow, false);

      expectApproxDelta(optimalBorrow, parseUnits('1.50829743', 8 + 27), parseUnits('1', PRECISION));
      expectApproxDelta(optimalRevenue[0], parseUnits('723965.6979702', 27), parseUnits('1', PRECISION));
    });
  });
  describe('2nd set of params', () => {
    before('Fix borrow Params', () => {
      const wantDecimal = 6;
      const rewardDeposit = parseUnits('9053347', 18);
      const rewardBorrow = parseUnits('18106694', 18);
      const totalStableDebt = parseUnits('15381762', wantDecimal);
      const totalVariableDebt = parseUnits('1799913656', wantDecimal);
      const totalDeposit = parseUnits('2392449717', wantDecimal);
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: parseUnits(totalStableDebt.toString(), 27 - wantDecimal),
        totalVariableDebt: parseUnits(totalVariableDebt.toString(), 27 - wantDecimal),
        totalDeposits: parseUnits(totalDeposit.toString(), 27 - wantDecimal),
        stableBorrowRate: parseUnits('0.107944827543602992468882415', 27),
        rewardDeposit: parseUnits(rewardDeposit.toString(), 27 - 18),
        rewardBorrow: parseUnits(rewardBorrow.toString(), 27 - 18),
        strategyAssets: parseUnits('150000000', 27),
        guessedBorrowAssets: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.6', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.9', 27),
      };
    });
    it('1st case - rates and revenues', async () => {
      const toBorrow = parseUnits('401745004.222658', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('3.5264231632878637', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('3285459220805058', 0), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-2351632', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('5.0172901802399794', 33), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('7.907202168065384', 23), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-6048800243962871', 0), parseUnits('1', PRECISION));
    });
    it('2nd case - rates and revenues', async () => {
      const toBorrow = parseUnits('546955416.227038', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('3.571774600882717', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('2968865481307993', 0), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-2020045', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('5.072790209050693', 33), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('2.3202297737652187', 21), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-4863956636219375', 0), parseUnits('1', PRECISION));
    });
    // it('1st case - optimal borrow', async () => {
    //   const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
    //   const optimalRevenue = await computeProfitabilityContract.revenuePrimes(optimalBorrow, paramsBorrow, false);

    //   console.log(formatUnits(optimalBorrow, 27));
    //   console.log(formatUnits(optimalRevenue[0], 27));

    //   expectApproxDelta(optimalBorrow, parseUnits('5.47432606', 8 + 27), parseUnits('1', PRECISION));
    //   expectApproxDelta(optimalRevenue[0], parseUnits('5072790.76258324', 27), parseUnits('1', PRECISION));
    // });
  });
  describe('3rd set of params', () => {
    before('Fix borrow Params', () => {
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: parseUnits('4263987222194363292848749000000000', 0),
        totalVariableDebt: parseUnits('646690969829887462403782194000000000', 0),
        totalDeposits: parseUnits('1359477786670823181510789562000000000', 0),
        stableBorrowRate: parseUnits('0.106996694657283846636419001', 27),
        rewardDeposit: parseUnits('4093810436323486802876428224000000', 0),
        rewardBorrow: parseUnits('8187620872646992632797004480000000', 0),
        strategyAssets: parseUnits('225000000000000000000000000000000000', 0),
        guessedBorrowAssets: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.75', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.8', 27),
      };
    });
    it('1st case - rates and revenues', async () => {
      const toBorrow = parseUnits('146040080.006735150526347076', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('2.646913248201241', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('1.562974975547457', 16), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-20763286', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('3.407109901209886', 33), parseUnits('1', PRECISION));
      // imprecision?
      // expectApproxDelta(revenuePrimes[1], parseUnits('9.183598673190296', 16), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-2.674356767119264', 16), parseUnits('1', PRECISION));
    });
    it('2nd case - rates and revenues', async () => {
      const toBorrow = parseUnits('195483425.155534074063132233', 27);
      const ratesPrimes = await computeProfitabilityContract.calculateInterestPrimes(toBorrow, paramsBorrow);
      const revenuePrimes = await computeProfitabilityContract.revenuePrimes(toBorrow, paramsBorrow, false);

      expectApproxDelta(ratesPrimes[0], parseUnits('2.7217347160965717', 25), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[1], parseUnits('1.465158915664748', 16), parseUnits('1', PRECISION));
      expectApproxDelta(ratesPrimes[2], parseUnits('-18844957', 0), parseUnits('1', PRECISION));

      expectApproxDelta(revenuePrimes[0], parseUnits('3.376537036166642', 33), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[1], parseUnits('-1.1963127836826229', 24), parseUnits('1', PRECISION));
      expectApproxDelta(revenuePrimes[2], parseUnits('-2.1839209865233984', 16), parseUnits('1', PRECISION));
    });
    it('1st case - optimal borrow', async () => {
      const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
      const optimalRevenue = await computeProfitabilityContract.revenuePrimes(optimalBorrow, paramsBorrow, false);

      expectApproxDelta(optimalBorrow, parseUnits('1.46039745', 8 + 27), parseUnits('1', PRECISION));
      expectApproxDelta(optimalRevenue[0], parseUnits('3407109.90120835', 27), parseUnits('1', PRECISION));
    });
  });
  describe('4th set of params - no borrow and high utilization', () => {
    beforeEach('Fix borrow Params', () => {
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: parseUnits('4263987222194363292848749000000000', 0),
        totalVariableDebt: parseUnits('646690969829887462403782194000000000', 0),
        totalDeposits: parseUnits('676690969829887462403782194000000000', 0),
        stableBorrowRate: parseUnits('0.106996694657283846636419001', 27),
        rewardDeposit: parseUnits('4093810436323486802876428224000000', 0),
        rewardBorrow: parseUnits('8187620872646992632797004480000000', 0),
        strategyAssets: parseUnits('225000000000000000000000000000000000', 0),
        guessedBorrowAssets: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.75', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.8', 27),
      };
    });
    it('no borrow', async () => {
      paramsBorrow.rewardBorrow = parseUnits('0', 27);
      paramsBorrow.rewardDeposit = parseUnits('0', 27);
      const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
      expectApproxDelta(optimalBorrow, parseUnits('0', 27), parseUnits('1', PRECISION));
    });
    it('high utilisation', async () => {
      const optimalBorrow = await computeProfitabilityContract.computeProfitability(paramsBorrow);
      expectApproxDelta(optimalBorrow, parseUnits('0', 27), parseUnits('1', PRECISION));
    });
  });
});
