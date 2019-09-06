const assert = require('assert');
const BigNumber = require('bignumber.js');
const { getWeb3, getContracts, getMarketContract } = require('./utils');
const { generateOrderData, isValidSignature, getOrderHash } = require('../sdk/sdk');
const { fromRpcSig } = require('ethereumjs-util');

const bases = new BigNumber('100000');
const weis = new BigNumber('1000000000000000000');

const toBase = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(bases));
    }
    return sum.toFixed();
}

const fromBase = x => {
    return new BigNumber(x).div(bases).toString();
}

const toWei = (...xs) => {
    let sum = new BigNumber(0);
    for (var x of xs) {
        sum = sum.plus(new BigNumber(x).times(weis));
    }
    return sum.toFixed();
};

const fromWei = x => {
    return new BigNumber(x).div(weis).toString();
};

const infinity = '999999999999999999999999999999999999999999';

contract('Match', async accounts => {
    let exchange, proxy;
    let mpx, collateral, long, short;

    const relayer = accounts[9];
    const admin = accounts[0];

    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    beforeEach(async () => {
        const contracts = await getContracts();
        exchange = contracts.exchange;
        proxy = contracts.proxy;

        const mpxContract = await getMarketContract({
            cap: 8500e10,
            floor: 7500e10,
            multiplier: 1000,
            feeRate: 300,
        });
        mpx = mpxContract.mpx;
        collateral = mpxContract.collateral;
        long = mpxContract.long;
        short = mpxContract.short;
    });

    const getOrderSignature = async (order) => {
        const orderHash = getOrderHash(order);
        const newWeb3 = getWeb3();

        // This depends on the client, ganache-cli/testrpc auto prefix the message header to message
        // So we have to set the method ID to 0 even through we use web3.eth.sign
        const signature = fromRpcSig(await newWeb3.eth.sign(orderHash, order.trader));
        signature.config = `0x${signature.v.toString(16)}00` + '0'.repeat(60);
        const isValid = isValidSignature(order.trader, signature, orderHash);

        assert.equal(true, isValid);
        order.signature = signature;
        order.orderHash = orderHash;
    };

    const buildOrder = async (orderParam) => {
        const order = {
            trader: orderParam.trader,
            relayer: orderParam.relayer,
            marketContract: orderParam.marketContract,
            amount: orderParam.amount,
            price: orderParam.price,
            gasAmount: orderParam.gasAmount,
            data: generateOrderData(
                orderParam.version,
                orderParam.side === 'sell',
                orderParam.type === 'market',
                orderParam.expiredAtSeconds,
                orderParam.asMakerFeeRate,
                orderParam.asTakerFeeRate,
                orderParam.makerRebateRate || '0',
                Math.round(10000000),
                false,
            ),
        };

        await getOrderSignature(order);

        return order;
    };

    const buildMpxOrder = async (config) => {
        const orderParam = {
            trader: config.trader,
            relayer,
            marketContract: mpx._address,
            version: 2,
            side: config.side,
            type: 'limit',
            expiredAtSeconds: 3500000000,
            asMakerFeeRate: config.makerFeeRate || '0',
            asTakerFeeRate: config.takerFeeRate || '0',
            amount: config.amount,
            price: config.price,
            gasAmount: config.gasAmount || toWei(0.1),
        };
        return await buildOrder(orderParam);
    }

    const getNormalizedBalance = async (contract, user) => {
        const decimals = await contract.methods.decimals().call();
        const balance = await contract.methods.balanceOf(user).call();
        return new BigNumber(balance).div(Math.pow(10, decimals)).toString();
    }

    const withBalanceWatcher = async (contracts, users, callback) => {
        console.log("BEGIN");
        console.log("---------------------------------------------------------------");
        let initialBalance = {};
        for (let i = 0; i < Object.keys(users).length; i++) {
            const userKey = Object.keys(users)[i];
            const userAddress = users[userKey];
            initialBalance[userKey] = {}
            console.log("   $", userKey);
            for (let j = 0; j < Object.keys(contracts).length; j++) {
                const contractKey = Object.keys(contracts)[j];
                const contract = contracts[contractKey];
                initialBalance[userKey][contractKey] = await getNormalizedBalance(contract, userAddress);
                console.log("       -", contractKey, "[I]", initialBalance[userKey][contractKey]);
            }
        }
        console.log("TRANSACTION BEGIN");
        console.log("---------------------------------------------------------------");
        await callback();
        console.log("TRANSACTION END");
        console.log("---------------------------------------------------------------");

        console.log("SUMMARY");
        console.log("---------------------------------------------------------------");
        for (let i = 0; i < Object.keys(users).length; i++) {
            const userKey = Object.keys(users)[i];
            const userAddress = users[userKey];
            console.log("   $", userKey);
            for (let j = 0; j < Object.keys(contracts).length; j++) {
                const contractKey = Object.keys(contracts)[j];
                const contract = contracts[contractKey];
                const remaining = await getNormalizedBalance(contract, userAddress);
                const diff = remaining - initialBalance[userKey][contractKey];
                console.log("       -", contractKey,
                    "[R]", remaining,
                    "[D]", diff > 0 ? "+" + diff : diff);
            }
        }
    }


    /*
    matchConfigs    - initialBalances   { token: user: amount }
                    - taker             object
                    - makers            []
                    - orderAsset        {}
                    - filledAmounts     []
                    - expectedBalances    {}
                    - users
                    - tokens
                    - admin
                    - gasLimit
    */

    const matchTest = async (matchConfigs, beforeMatching = undefined, afterMatching = undefined) => {
        const gasLimit = matchConfigs.gasLimit || 8000000;
        const admin = matchConfigs.admin;
        const users = matchConfigs.users || {};
        const tokens = matchConfigs.tokens || {};
        const orderAsset = matchConfigs.orderAsset || {
            marketContract: mpx._address,
            relayer: relayer,
        };

        const call = async (method) => {
            return await method.call();
        }
        const send = async (user, method) => {
            return await method.send({ from: user, gasLimit: gasLimit });
        }

        // initialBalances
        const initialBalances = matchConfigs.initialBalances;
        if (initialBalances !== undefined) {
            for (let i = 0; i < Object.keys(initialBalances).length; i++) {
                const userName = Object.keys(initialBalances)[i];
                for (let j = 0; j < Object.keys(tokens).length; j++) {
                    const tokenName = Object.keys(tokens)[j];

                    const user = users[userName];
                    const token = tokens[tokenName];
                    const amount = initialBalances[userName][tokenName] || 0;
                    if (amount > 0) {
                        await send(admin, token.methods.mint(user, amount));
                    }
                    await send(user, token.methods.approve(proxy._address, infinity));
                }
            }
        }

        // build orders
        const takerOrder = await buildMpxOrder(matchConfigs.takerOrder);
        let makerOrders = [];
        for (let i = 0; i < matchConfigs.makerOrders.length; i++) {
            const makerOrder = await buildMpxOrder(matchConfigs.makerOrders[i]);
            makerOrders.push(makerOrder);
        }

        // prepare
        await send(admin, proxy.methods.approveMarketContractPool(mpx._address));

        if (beforeMatching !== undefined) {
            beforeMatching();
        }
        // matching
        await send(relayer, exchange.methods.matchOrders(
            takerOrder,
            makerOrders,
            matchConfigs.filledAmounts,
            orderAsset
        ));
        if (afterMatching !== undefined) {
            afterMatching();
        }

        // expect balances
        const expectedBalances = matchConfigs.expectedBalances;
        if (expectedBalances !== undefined) {
            for (let i = 0; i < Object.keys(expectedBalances).length; i++) {
                const userName = Object.keys(expectedBalances)[i];

                for (let j = 0; j < Object.keys(expectedBalances[userName]).length; j++) {
                    const tokenName = Object.keys(expectedBalances[userName])[j];

                    const user = users[userName];
                    const token = tokens[tokenName];
                    const expect = expectedBalances[userName][tokenName];
                    const actural = await call(token.methods.balanceOf(user));
                    assert.equal(expect, actural);
                }
            }
        }
    }

    it('tc', async () => {
        const testConfig = {
            initialBalances: {
                u1: {
                    collateral: toWei(10000),
                    long: toBase(0.8)
                },
                u2: {
                    collateral: toWei(10000),
                    long: toBase(0.6),
                    short: toBase(1.8),
                },
                u3: {

                },
                relayer: { },
            },
            takerOrder: {
                trader: u2,
                side: "buy",
                position: "short",
                baseAmount: toBase(0.4),
                quoteAmount: toWei(200),
                takerFeeRate: 250,
                gasAmount: toWei(0.1),
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    position: "long",
                    baseAmount: toBase(1),
                    quoteAmount: toWei(500),
                    makerFeeRate: 250,
                    gasAmount: toWei(0.1),
                },
            ],
            filledAmounts: [
                toBase(0.4),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(10000 - 200 - 8 - 0.1),
                    long: toBase(1.2),
                },
                u2: {
                    collateral: toWei(10000 - 200 - 8 - 0.1),
                    short: toBase(2.2),
                },
                relayer: {
                    collateral: toWei(8, 8, 0.1, 0.1, -9.6),
                }
            },
            orderAsset: {
                marketContractAddress: mpx._address,
                relayer: relayer,
            },
            users: { admin: admin, u1: u1, u2: u2, u3: u3, relayer: relayer },
            tokens: { collateral: collateral, long: long, short: short },
            admin: admin,
            gasLimit: 8000000,
        }
        await matchTest(testConfig);

        const testConfig2 = {
            takerOrder: {
                trader: u2,
                side: "sell",
                position: "long",
                baseAmount: toBase(0.6),
                quoteAmount: toWei(300),
                takerFeeRate: 250,
                gasAmount: toWei(0.1),
            },
            makerOrders: [
                {
                    trader: u1,
                    side: "buy",
                    position: "long",
                    baseAmount: toBase(1),
                    quoteAmount: toWei(500),
                    makerFeeRate: 250,
                    gasAmount: toWei(0.1),
                },
            ],
            filledAmounts: [
                toBase(0.6),
            ],
            expectedBalances: {
                u1: {
                    collateral: toWei(10000 - 200 - 8 - 0.1 - 300 - 12),
                    long: toBase(1.8),
                },
                u2: {
                    collateral: toWei(10000 - 200 - 8 - 0.1 + 300 - 12 - 0.1),
                    short: toBase(2.2),
                    long: 0,
                },
                relayer: {
                    collateral: toWei(8, 8, 0.1, 0.1, -9.6, 12, 12, 0.1),
                }
            },
            orderAsset: {
                marketContractAddress: mpx._address,
                relayer: relayer,
            },
            users: { admin: admin, u1: u1, u2: u2, u3: u3, relayer: relayer },
            tokens: { collateral: collateral, long: long, short: short },
            admin: admin,
            gasLimit: 8000000,
        }
        await matchTest(testConfig2);
    });
});