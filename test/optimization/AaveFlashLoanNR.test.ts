import { BigNumber } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import {
  computeInterestPrimes,
  getOptimalBorrow,
  computeRevenuePrimes,
  SCalculateBorrow,
} from '../../utils/optimization';
import { expectApproxDelta } from '../../utils/bignumber';

const PRECISION = 4;
let priceAave: number;
let paramsBorrow: SCalculateBorrow;

describe('Off-chain Optimization AaveFlashloan Strat', () => {
  describe('1st set of parameters', () => {
    before('Fix borrow Params', () => {
      const wantDecimal = 6;
      priceAave = 130;
      const priceMultiplier = BigNumber.from(Math.floor(priceAave * 60 * 60 * 24 * 365));
      const rewardDeposit = BigNumber.from('1903258773510960').mul(priceMultiplier);
      const rewardBorrow = BigNumber.from('3806517547021920').mul(priceMultiplier);
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
        strategyAssets: parseUnits('1000000', 27),
        currentBorrow: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.6', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.9', 27),
      };
    });
    describe('testing rates', () => {
      it('1st borrow - rates', async () => {
        const toBorrow = parseUnits('100000', 27);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('2.8394907581318844', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('7131752054577753', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-6338112', 0), parseUnits('1', PRECISION));
      });
      it('2nd borrow - rates', async () => {
        const toBorrow = parseUnits('200000', 27);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('2.8395620724835146', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('7131118285542997', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-6337267', 0), parseUnits('1', PRECISION));
      });
      it('3rd borrow - rates', async () => {
        const toBorrow = parseUnits('79312137', 27);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('2.8940620565909253', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('6655012554459868', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-5713324', 0), parseUnits('1', PRECISION));
      });
    });
    describe('testing revenues', () => {
      it('1st borrow - revenues', async () => {
        const toBorrow = parseUnits('100000', 27);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('2.0451974884293873', 31), parseUnits('1', PRECISION));
        expectApproxDelta(revenuePrimes.revenuePrime, parseUnits('2.7347712665372165', 24), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-1.6707144318562614', 16),
          parseUnits('1', PRECISION),
        );
      });
      it('2nd borrow - revenues', async () => {
        const toBorrow = parseUnits('200000', 27);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('2.0725368481954744', 31), parseUnits('1', PRECISION));
        expectApproxDelta(revenuePrimes.revenuePrime, parseUnits('2.733100753962924', 24), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-1.6703107360771058', 16),
          parseUnits('1', PRECISION),
        );
      });
      it('3rd borrow - revenues', async () => {
        const toBorrow = parseUnits('79312137', 27);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('1.878279888231759', 32), parseUnits('1', PRECISION));
        expectApproxDelta(revenuePrimes.revenuePrime, parseUnits('1.5290286055725022', 24), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-1.3842598981251928', 16),
          parseUnits('1', PRECISION),
        );
      });
    });
    describe('testing NR', () => {
      it('optimal borrow', async () => {
        const optimalBorrow = getOptimalBorrow(paramsBorrow);
        const optimalRevenue = computeRevenuePrimes(optimalBorrow, paramsBorrow);

        expectApproxDelta(optimalBorrow, parseUnits('2.06699448', 8 + 27), parseUnits('1', PRECISION));
        expectApproxDelta(optimalRevenue.revenue, parseUnits('280521.08056477', 27), parseUnits('1', PRECISION));
      });
    });
  });
  describe('2nd set of parameters', () => {
    before('Fix borrow Params', () => {
      //   priceAave = 127;
      const totalStableDebt = BigNumber.from('15381762');
      const totalVariableDebt = BigNumber.from('2021127370');
      paramsBorrow = {
        reserveFactor: parseUnits('0.1', 27),
        totalStableDebt: parseUnits(totalStableDebt.toString(), 27),
        totalVariableDebt: parseUnits(totalVariableDebt.toString(), 27),
        totalDeposits: parseUnits('2800323275', 27),
        stableBorrowRate: parseUnits('0.1079448275', 27),
        rewardDeposit: parseUnits('9053347', 27),
        rewardBorrow: parseUnits('18106694', 27),
        strategyAssets: parseUnits('91697277', 27),
        currentBorrow: BigNumber.from(0),
        slope1: parseUnits('0.04', 27),
        slope2: parseUnits('0.6', 27),
        r0: parseUnits('0', 27),
        uOptimal: parseUnits('0.9', 27),
      };
    });
    describe('testing rates', () => {
      it('1st borrow - rates', async () => {
        const toBorrow = parseUnits('8.63982', 27 + 7);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('3.268463473005402', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('4073759736169357', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-2822412', 0), parseUnits('1', PRECISION));
      });
      it('2nd borrow - rates', async () => {
        const toBorrow = parseUnits('1.64144088', 27 + 8);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('3.299304657508479', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('3862885458712219', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-2606124', 0), parseUnits('1', PRECISION));
      });
      it('3rd borrow - rates', async () => {
        const toBorrow = parseUnits('1.207687', 27 + 9);
        const ratesPrimes = await computeInterestPrimes(toBorrow, paramsBorrow);

        expectApproxDelta(ratesPrimes.interest, parseUnits('3.597458211495118', 25), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime, parseUnits('2113233686631021', 0), parseUnits('1', PRECISION));
        expectApproxDelta(ratesPrimes.interestPrime2nd, parseUnits('-1054505', 0), parseUnits('1', PRECISION));
      });
    });
    describe('testing revenues', () => {
      it('1st borrow - revenues', async () => {
        const toBorrow = parseUnits('8.63982', 27 + 7);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('2.39391356327579', 33), parseUnits('1', PRECISION));
        expectApproxDelta(revenuePrimes.revenuePrime, parseUnits('1.0736952974308082', 24), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-7790801733366465', 0),
          parseUnits('1', PRECISION),
        );
      });
      it('2nd borrow - revenues', async () => {
        const toBorrow = parseUnits('1.64144088', 27 + 8);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('2.4548253218641402', 33), parseUnits('1', PRECISION));
        expectApproxDelta(revenuePrimes.revenuePrime, parseUnits('5.053973812033361', 23), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-6852848062471600', 0),
          parseUnits('1', PRECISION),
        );
      });
      it('3rd borrow - revenues', async () => {
        const toBorrow = parseUnits('1.207687', 27 + 9);
        const revenuePrimes = await computeRevenuePrimes(toBorrow, paramsBorrow);

        expectApproxDelta(revenuePrimes.revenue, parseUnits('6.37463723625496', 32), parseUnits('1', PRECISION));
        expectApproxDelta(
          revenuePrimes.revenuePrime,
          parseUnits('-3.1237114015703524', 24),
          parseUnits('1', PRECISION),
        );
        expectApproxDelta(
          revenuePrimes.revenuePrime2nd,
          parseUnits('-1581521493967301', 0),
          parseUnits('1', PRECISION),
        );
      });
    });
    describe('testing NR', () => {
      it('optimal borrow', async () => {
        const optimalBorrow = getOptimalBorrow(paramsBorrow);
        const optimalRevenue = computeRevenuePrimes(optimalBorrow, paramsBorrow);

        expectApproxDelta(optimalBorrow, parseUnits('2.42665261', 8 + 27), parseUnits('1', PRECISION));
        expectApproxDelta(optimalRevenue.revenue, parseUnits('2474250.42174369', 27), parseUnits('1', PRECISION));
      });
    });
  });
});
