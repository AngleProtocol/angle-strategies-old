import { expect } from 'chai';
import { utils, BigNumber, BigNumberish } from 'ethers';

export function mwei(number: BigNumberish): BigNumber {
  return utils.parseUnits(number.toString(), 'mwei');
}

// gweiToBN
export function gwei(number: BigNumberish): BigNumber {
  return utils.parseUnits(number.toString(), 'gwei');
}
function formatGwei(number: BigNumberish): string {
  return utils.formatUnits(number, 'gwei');
}

export function ether(number: BigNumberish): BigNumber {
  return utils.parseUnits(number.toString(), 'ether');
}
function formatEther(number: BigNumberish): string {
  return utils.formatEther(number);
}

function dai(number: BigNumberish): BigNumber {
  return utils.parseUnits(number.toString(), 18);
}
function formatDai(number: BigNumberish): string {
  return utils.formatEther(number);
}

function usdc(number: BigNumberish): BigNumber {
  return utils.parseUnits(number.toString(), 6);
}
function formatUsdc(number: BigNumberish): string {
  return utils.formatUnits(number, 6);
}

function general(number: BigNumberish, decimal: number): BigNumber {
  return utils.parseUnits(number.toString(), decimal);
}
function formatGeneral(number: BigNumberish, decimal: number): string {
  return utils.formatUnits(number, decimal);
}

export const parseAmount = {
  ether,
  dai,
  usdc,
  gwei,
  general,
};

export const formatAmount = {
  ether: formatEther,
  dai: formatDai,
  usdc: formatUsdc,
  gwei: formatGwei,
  general: formatGeneral,
};

export function multByPow(number: number | BigNumber, pow: number | BigNumber): BigNumber {
  return utils.parseUnits(number.toString(), pow);
}

//
export function multBy10e15(number: number | BigNumber): BigNumber {
  return utils.parseUnits(number.toString(), 15);
}

// gweiToBN
export function multBy10e9(number: number): BigNumber {
  return utils.parseUnits(number.toString(), 'gwei');
}

// BNtoEth
export function divBy10e18(bigNumber: BigNumberish): number {
  return parseFloat(utils.formatUnits(bigNumber, 'ether'));
}

// BNtoEth
export function divBy10ePow(bigNumber: BigNumberish, pow: number | BigNumber): number {
  return parseFloat(utils.formatUnits(bigNumber, pow));
}

export async function expectApproxDelta(actual: BigNumber, expected: BigNumber, delta: BigNumber): Promise<void> {
  const margin = expected.div(delta);
  if (actual.isNegative()) {
    await expect(expected.gte(actual.add(margin))).to.be.true;
    await expect(expected.lte(actual.sub(margin))).to.be.true;
  } else {
    await expect(expected.lte(actual.add(margin))).to.be.true;
    await expect(expected.gte(actual.sub(margin))).to.be.true;
  }
}

export function expectApprox(value: BigNumberish, target: BigNumberish, error: number): void {
  expect(value).to.be.lt(
    BigNumber.from(target)
      .mul((100 + error) * 1e10)
      .div(100 * 1e10),
  );
  expect(value).to.be.gt(
    BigNumber.from(target)
      .mul((100 - error) * 1e10)
      .div(100 * 1e10),
  );
}
