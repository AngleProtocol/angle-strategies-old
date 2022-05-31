/* eslint-disable camelcase */
import { network } from 'hardhat';
import { utils } from 'ethers';
import { setup } from './setup_tests';

describe('AaveFlashloanStrategy - Random USDC', () => {
  it('scenario random', async () => {
    const { _wantToken, strategy, lendingPool, poolManager, oldStrategy, realGuardian, richUSDCUser, aToken, harvest } =
      await setup(14456160);

    // === SETUP ===
    await (
      await poolManager
        .connect(realGuardian)
        .updateStrategyDebtRatio((await oldStrategy).address, utils.parseUnits('0.2', 9))
    ).wait();
    const strategyDebtRatio = 0.75;
    await (
      await poolManager
        .connect(realGuardian)
        .addStrategy(strategy.address, utils.parseUnits(strategyDebtRatio.toString(), 9))
    ).wait();
    await network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [realGuardian.address] });

    // === HELPERS ===
    const randomDeposit = async () => {
      const min = 20_000_000;
      const max = 100_000_000;
      const amount = utils.parseUnits(Math.floor(Math.random() * (max - min + 1) + min).toString(), 6);
      // console.log(`user depositing... ${logBN(amount)}`);
      await lendingPool.connect(richUSDCUser).deposit(_wantToken, amount, richUSDCUser.address, 0);
    };
    const randomWithdraw = async () => {
      const min = 5_000_000;
      const max = 30_000_000;
      let amount = utils.parseUnits(Math.floor(Math.random() * (max - min + 1) + min).toString(), 6);
      const maxAmount = await aToken.balanceOf(richUSDCUser.address);
      if (amount.gt(maxAmount)) {
        amount = maxAmount;
      }
      // console.log(`user withdrawing... ${logBN(amount)} (max: ${logBN(maxAmount)})`);
      await lendingPool.connect(richUSDCUser).withdraw(_wantToken, amount, richUSDCUser.address);
    };

    // ====== SCRIPTS ======
    await (await oldStrategy.harvest()).wait();
    await harvest();

    await randomDeposit();
    await harvest();

    // console.log('advance 1 day');
    // await advanceTime(24);

    await randomDeposit();
    await harvest();
    // console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));
    await randomWithdraw();
    await harvest();
    // console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));

    await randomDeposit();
    await harvest();
    // console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));

    await randomWithdraw();

    await randomDeposit();
    await harvest();
    // console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));

    for (let i = 0; i < 8; i++) {
      if (Math.random() < 0.7) await randomDeposit();
      else await randomWithdraw();

      // console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));
      await harvest();
    }

    // console.log('done');
  });
});
