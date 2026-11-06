// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BinStepRegistry} from "../src/BinStepRegistry.sol";

/// @notice Deploys the registry that lets users create markets on an existing deployment.
contract DeployRegistry is Script {
    function run() external {
        string memory file = vm.envOr("DEPLOYMENT_FILE", string("./deployments/base-sepolia.json"));
        string memory deployment = vm.readFile(file);
        require(!vm.keyExistsJson(deployment, ".registry"), "this deployment has a registry");

        vm.startBroadcast(vm.envUint("DEPLOYER_KEY"));
        BinStepRegistry registry = new BinStepRegistry(
            IPoolManager(vm.parseJsonAddress(deployment, ".poolManager")),
            vm.parseJsonAddress(deployment, ".hook"),
            vm.parseJsonAddress(deployment, ".usdc")
        );
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(registry)), file, ".registry");
        console2.log("registry", address(registry));
    }
}
