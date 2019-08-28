const MathLib = artifacts.require("lib/MathLib.sol");
const SafeMath = artifacts.require("lib/SafeMath.sol");
const TestToken = artifacts.require("helper/TestToken.sol");

const Proxy = artifacts.require("Proxy.sol");
const HybridExchange = artifacts.require("HybridExchange.sol");

module.exports = function(deployer, network, accounts) {
    // lib 
    return deployer.deploy(MathLib).then(function() {
        return deployer.deploy(SafeMath).then(function() {
            return deployer
                .link(SafeMath, [Proxy, HybridExchange])
                .then(function() {
                    return deployer
                        .deploy(Proxy)
                        .then(function(proxyInstance) {
                            console.log(
                                "Proxy deployed at", 
                                Proxy.address
                            );
                            return deployer
                                .deploy(HybridExchange, Proxy.address)
                                .then(function() {
                                    return proxyInstance
                                        .addAddress(HybridExchange.address)
                                        .then(function() {
                                            console.log(
                                                "Proxy whitelist initialized with", 
                                                HybridExchange.address
                                            );
                                        })
                                });
                        });
                });
        });
    });

    deployer.deploy(Migrations);
};
