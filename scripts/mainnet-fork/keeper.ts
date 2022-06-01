/* eslint-disable camelcase */
import { ethers, network } from 'hardhat';
import { utils, constants, BigNumber } from 'ethers';
import { ILendingPool__factory, ILendingPool, ERC20, ERC20__factory } from '../../typechain';

export const logBN = (amount: BigNumber, { base = 6, pad = 20, sign = false } = {}) => {
  const num = parseFloat(utils.formatUnits(amount, base));
  const formattedNum = new Intl.NumberFormat('fr-FR', {
    style: 'decimal',
    maximumFractionDigits: 4,
    minimumFractionDigits: 4,
    signDisplay: sign ? 'always' : 'never',
  }).format(num);
  return formattedNum.padStart(pad, ' ');
};

async function main() {
  const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

  const wantToken = (await ethers.getContractAt(ERC20__factory.abi, USDC)) as ERC20;
  const aToken = (await ethers.getContractAt(
    ERC20__factory.abi,
    '0xBcca60bB61934080951369a648Fb03DF4F96263C',
  )) as ERC20;

  const lendingPool = (await ethers.getContractAt(
    ILendingPool__factory.abi,
    '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
  )) as ILendingPool;

  await network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: ['0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3'],
  });
  const richUSDCUser = await ethers.getSigner('0x6262998Ced04146fA42253a5C0AF90CA02dfd2A3');
  await wantToken.connect(richUSDCUser).approve(lendingPool.address, constants.MaxUint256);
  await aToken.connect(richUSDCUser).approve(lendingPool.address, constants.MaxUint256);

  // === HELPERS ===
  const randomDeposit = async () => {
    const min = 20_000_000;
    const max = 100_000_000;
    const amount = utils.parseUnits(Math.floor(Math.random() * (max - min + 1) + min).toString(), 6);
    console.log(`user depositing... ${logBN(amount)}`);
    await lendingPool.connect(richUSDCUser).deposit(USDC, amount, richUSDCUser.address, 0);
  };
  const randomWithdraw = async () => {
    const min = 5_000_000;
    const max = 30_000_000;
    let amount = utils.parseUnits(Math.floor(Math.random() * (max - min + 1) + min).toString(), 6);
    const maxAmount = await aToken.balanceOf(richUSDCUser.address);
    if (amount.gt(maxAmount)) {
      amount = maxAmount;
    }
    console.log(`user withdrawing... ${logBN(amount)} (max: ${logBN(maxAmount)})`);
    await lendingPool.connect(richUSDCUser).withdraw(USDC, amount, richUSDCUser.address);
  };

  await randomDeposit();
  await wait();

  for (let i = 0; i < 8; i++) {
    if (Math.random() < 0.7) await randomDeposit();
    else await randomWithdraw();
    await wait();
  }
  console.log('current user deposits: ', logBN(await aToken.balanceOf(richUSDCUser.address)));
}

const wait = (n = 10000) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve('ok');
    }, n);
  });
};

main();
