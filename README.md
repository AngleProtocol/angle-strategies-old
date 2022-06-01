# strategies

Yield aggregator repository - Angle implements strategies provide the best yields on ETH mainnet to LP

Strategies implemented on Angle Protocol

## Documentation

Documentation to understand Angle Protocol's strategies is available [here](https://docs.angle.money/angle-core-module/lending).

Developers documentation to understand the smart contract architecture is available [here](https://developers.angle.money/core-module-contracts/smart-contracts-docs/adapters).

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

## Responsible Disclosure

At Angle, we consider the security of our systems a top priority. But even putting top priority status and maximum effort, there is still possibility that vulnerabilities can exist.

In case you discover a vulnerability, we would like to know about it immediately so we can take steps to address it as quickly as possible.

If you discover a vulnerability, please do the following:

- E-mail your findings to contact@angle.money;
- Do not take advantage of the vulnerability or problem you have discovered;
- Do not reveal the problem to others until it has been resolved;
- Do not use attacks on physical security, social engineering, distributed denial of service, spam or applications of third parties; and
- Do provide sufficient information to reproduce the problem, so we will be able to resolve it as quickly as possible. Complex vulnerabilities may require further explanation so we might ask you for additional information.

We will promise the following:

- We will respond to your report within 3 business days with our evaluation of the report and an expected resolution date;
- If you have followed the instructions above, we will not take any legal action against you in regard to the report;
- We will handle your report with strict confidentiality, and not pass on your personal details to third parties without your permission;
- If you so wish we will keep you informed of the progress towards resolving the problem;
- In the public information concerning the problem reported, we will give your name as the discoverer of the problem (unless you desire otherwise); and
- As a token of our gratitude for your assistance, we offer a reward for every report of a security problem that was not yet known to us. The amount of the reward will be determined based on the severity of the leak, the quality of the report and any additional assistance you provide.
