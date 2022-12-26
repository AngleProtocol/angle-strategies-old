# <img src="logo.svg" alt="Angle Strategies" height="40px"> Angle Strategies

[![CI](https://github.com/AngleProtocol/angle-strategies/workflows/CI/badge.svg)](https://github.com/AngleProtocol/angle-strategies/actions?query=workflow%3ACI)
[![Docs](https://img.shields.io/badge/docs-%F0%9F%93%84-blue)](https://docs.angle.money/angle-core-module/lending)
[![Developers](https://img.shields.io/badge/developers-%F0%9F%93%84-pink)](https://developers.angle.money/core-module-contracts/smart-contracts-docs/strategies)

## Documentation

### To Start With

Like yield aggregators, Angle implements yield strategies to provide the best yields to its LPs, and to get revenue for veANGLE holders. This repo contains the strategies implemented on the Angle Protocol.

Documentation to understand Angle Protocol's strategies is available [here](https://docs.angle.money/angle-core-module/lending).

Developers documentation to understand the smart contract architecture is available [here](https://developers.angle.money/core-module-contracts/smart-contracts-docs/adapters).

### Further Information

For a broader overview of the protocol and its different modules, you can also check [this overview page](https://developers.angle.money) of our developers documentation.

Other Angle-related smart contracts can be found in the following repositories:

- [Angle Borrowing module contracts](https://github.com/AngleProtocol/borrow-contracts)
- [Angle Core module contracts](https://github.com/AngleProtocol/angle-core)

Otherwise, for more info about the protocol, check out [this portal](https://linktr.ee/angleprotocol) of resources.

## Remarks

### Cross-module Contracts

Some smart contracts of the protocol are used across the different modules of Angle (like the `agToken` contract) and you'll sometimes see different versions across the different repositories of the protocol.

Here are some cross-module contracts and the repos in which you should look for their correct and latest version:

- [`angle-core`](https://github.com/AngleProtocol/angle-core): All DAO-related contracts (`ANGLE`, `veANGLE`, gauges, surplus distribution, ...), `AngleRouter` contract
- [`borrow-contracts`](https://github.com/AngleProtocol/borrow-contracts): `agToken` contract
- [`angle-strategies`](https://github.com/AngleProtocol/angle-strategies): Yield strategies of the protocol

## Setup

To install all the packages needed to run the tests, run:
`yarn`

### Setup environment

Create a `.env` file from the template file `.env.example`.
If you don't define URI and mnemonics, default mnemonic will be used with a brand new local hardhat node.

### Compilation

```shell
yarn compile
```

### Testing

```shell
yarn test
```

Defaults with `hardhat` network, but another network can be specified with `--network NETWORK_NAME`.

A single test file or a glob pattern can be appended to launch a reduced set of tests:

```shell
yarn test tests/optimizerApr/*
```

### Scripts

`yarn hardhat run PATH_TO_SCRIPT`

Some scripts require to fork mainnet. To do so, you must first ensure that the `ETH_NODE_URI_FORK` in `.env` is pointing to an archival node (note: Alchemy provides this functionnality for free but Infura doesn't).

Then, uncomment `blockNumber` in the `hardhat` network definition inside `hardhat.config.ts` to boost node speed.
Then run:

```shell
FORK=true yarn hardhat run PATH_TO_SCRIPT
```

### Coverage

We try to keep our contract's code coverage above 99%. All contract code additions should be covered by tests (locally and in mainnet-fork) before being merged and deployed on mainnet.

To run code coverage:

```shell
yarn coverage
```

A subgroup of tests can be run by specifying `--testfiles "path/to/tests/*.ts"`.

If coverage runs out of memory, you can export this in your env and retry:

```shell
export NODE_OPTIONS=--max_old_space_size=4096
```

### Troubleshooting

If you have issues running tests or scripts, you can delete `node_modules`, `cache`, and then re-install dependancies with `yarn install --frozen-lockfile`.

## Audits

Angle smart contracts have been audited by [Chainsecurity](https://docs.angle.money/resources/audits#chainsecurity-july-october-2021) and [Sigma Prime](https://docs.angle.money/resources/audits#sigma-prime-july-october-2021).

All Angle Protocol related audits can be found in [this page](https://docs.angle.money/resources/audits) of our docs.

Some strategies in this repo have not been audited, but were forked from other protocols like Yearn.

## Bug Bounty

At Angle, we consider the security of our systems a top priority. But even putting top priority status and maximum effort, there is still possibility that vulnerabilities exist.

We have therefore setup a bug bounty program with the help of Immunefi. The Angle Protocol bug bounty program is focused around our smart contracts with a primary interest in the prevention of:

- Thefts and freezing of principal of any amount
- Thefts and freezing of unclaimed yield of any amount
- Theft of governance funds
- Governance activity disruption

For more details, please refer to the [official page of the bounty on Immunefi](https://immunefi.com/bounty/angleprotocol/).

| Level    |                     |
| :------- | :------------------ |
| Critical | up to USD \$500,000 |
| High     | USD \$20,000        |
| Medium   | USD \$2,500         |

All bug reports must include a Proof of Concept demonstrating how the vulnerability can be exploited to be eligible for a reward. This may be a smart contract itself or a transaction.
