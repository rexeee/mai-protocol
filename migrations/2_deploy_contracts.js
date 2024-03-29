const Proxy = artifacts.require("Proxy.sol");
const MaiProtocol = artifacts.require("MaiProtocol.sol");

module.exports = async function (deployer, network, accounts) {
    // proxy
    await deployer.deploy(Proxy);

    console.log('   ------------------------------------------------------------')
    console.log('   > Proxy      :  ', Proxy.address)
    console.log('   -------------------------------------------------------------')
};
