const Proxy = artifacts.require("Proxy.sol");
const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function(deployer, network, accounts) {
    // proxy
    await deployer.deploy(Proxy);
    const proxyInstance = await Proxy.deployed();

    // MaiProtocol
    await deployer.deploy(MaiProtocol, Proxy.address);

    // add white list
    await proxyInstance.addAddress(MaiProtocol.address);

    console.log(MaiProtocol.address, "added to whitelist of Proxy");
};
