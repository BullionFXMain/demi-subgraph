import { ethers } from "hardhat";
import * as path from "path";

import * as Util from "./utils/utils";
import { waitForSubgraphToBeSynced } from "./utils/utils";

// Typechain Factories
import { NoticeBoard__factory } from "../typechain/factories/NoticeBoard__factory";
import { EmissionsERC20Factory__factory } from "../typechain/factories/EmissionsERC20Factory__factory";
import { VerifyFactory__factory } from "../typechain/factories/VerifyFactory__factory";
import { CombineTierFactory__factory } from "../typechain/factories/CombineTierFactory__factory";
import { VerifyTierFactory__factory } from "../typechain/factories/VerifyTierFactory__factory";
import { SaleFactory__factory } from "../typechain/factories/SaleFactory__factory";
import { RedeemableERC20ClaimEscrow__factory } from "../typechain/factories/RedeemableERC20ClaimEscrow__factory";
import { RedeemableERC20Factory__factory } from "../typechain/factories/RedeemableERC20Factory__factory";
import { AllStandardOpsStateBuilder__factory } from "../typechain/factories/AllStandardOpsStateBuilder__factory";
import { StakeFactory__factory } from "../typechain/factories/StakeFactory__factory";
import { OrderBookStateBuilder__factory } from "../typechain/factories/OrderBookStateBuilder__factory";
import { OrderBook__factory } from "../typechain/factories/OrderBook__factory";

// Types
import type { ApolloFetch } from "apollo-fetch";
import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import type { NoticeBoard } from "../typechain/NoticeBoard";
import type { EmissionsERC20Factory } from "../typechain/EmissionsERC20Factory";
import type { RedeemableERC20Factory } from "../typechain/RedeemableERC20Factory";
import type { CombineTierFactory } from "../typechain/CombineTierFactory";
import type { VerifyTierFactory } from "../typechain/VerifyTierFactory";
import type { VerifyFactory } from "../typechain/VerifyFactory";
import type { SaleFactory } from "../typechain/SaleFactory";
import type { RedeemableERC20ClaimEscrow } from "../typechain/RedeemableERC20ClaimEscrow";
import type { StakeFactory } from "../typechain/StakeFactory";
import type { OrderBook } from "../typechain/OrderBook";
import { Contract } from "ethers";

const subgraphName = "beehive-innovation/rain-protocol-test";

// Export Factories
export let subgraph: ApolloFetch,
  noticeBoard: NoticeBoard,
  emissionsERC20Factory: EmissionsERC20Factory,
  redeemableERC20Factory: RedeemableERC20Factory,
  verifyFactory: VerifyFactory,
  verifyTierFactory: VerifyTierFactory,
  combineTierFactory: CombineTierFactory,
  saleFactory: SaleFactory,
  redeemableERC20ClaimEscrow: RedeemableERC20ClaimEscrow,
  stakeFactory: StakeFactory,
  orderBook: OrderBook,
  vmStateBuilder: Contract;

// Export signers
export let deployer: SignerWithAddress,
  creator: SignerWithAddress,
  signer1: SignerWithAddress,
  signer2: SignerWithAddress,
  signer3: SignerWithAddress,
  signer4: SignerWithAddress,
  recipient: SignerWithAddress,
  feeRecipient: SignerWithAddress,
  admin: SignerWithAddress;

before("Deployment contracts and subgraph", async function () {
  const signers = await ethers.getSigners();

  // Signers (to avoid fetch again)
  deployer = signers[0]; // deployer is NOT creator
  creator = signers[1];
  signer3 = signers[2];
  signer4 = signers[3];
  signer1 = signers[4];
  signer2 = signers[5];
  recipient = signers[6];
  feeRecipient = signers[7];
  admin = signers[9];

  // Depoying AllStandardOpsStateBuilder
  vmStateBuilder = await new AllStandardOpsStateBuilder__factory(
    deployer
  ).deploy();

  // Deploying NoticeBoard contract
  noticeBoard = await new NoticeBoard__factory(deployer).deploy();

  // Deploying EmissionsERC20Factory contract
  emissionsERC20Factory = await new EmissionsERC20Factory__factory(
    deployer
  ).deploy(vmStateBuilder.address);

  // Deploying RedeemableERC20Factory contract
  redeemableERC20Factory = await new RedeemableERC20Factory__factory(
    deployer
  ).deploy();

  // Deploying VerifyFactory contract
  verifyFactory = await new VerifyFactory__factory(deployer).deploy();

  // Deploying Tiers Factories
  // - CombineTierFactory
  combineTierFactory = await new CombineTierFactory__factory(deployer).deploy(
    vmStateBuilder.address
  );

  verifyTierFactory = await new VerifyTierFactory__factory(deployer).deploy();

  // Deploying SaleFactory contract
  saleFactory = await new SaleFactory__factory(deployer).deploy({
    maximumSaleTimeout: 10000,
    maximumCooldownDuration: 1000,
    redeemableERC20Factory: redeemableERC20Factory.address,
    vmStateBuilder: vmStateBuilder.address,
  });

  // Deploying RedeemableERC20ClaimEscrow contract
  redeemableERC20ClaimEscrow = await new RedeemableERC20ClaimEscrow__factory(
    deployer
  ).deploy();

  // Deploying StakeFactory contract
  stakeFactory = await new StakeFactory__factory(deployer).deploy();

  // Deploying OrderBookStateBuilder contract
  const orderBookStateBuilder = await new OrderBookStateBuilder__factory(
    deployer
  ).deploy();

  // Deploying OrderBookcontract
  orderBook = await new OrderBook__factory(deployer).deploy(
    orderBookStateBuilder.address
  );

  // Saving data in JSON
  const pathExampleConfig = path.resolve(__dirname, "../config/example.json");
  const config = JSON.parse(Util.fetchFile(pathExampleConfig));

  config.network = "localhost";

  // Saving addresses and individuals blocks to index
  config.NoticeBoard = noticeBoard.address;
  config.NoticeBoardBlock = noticeBoard.deployTransaction.blockNumber;

  config.EmissionsERC20Factory = emissionsERC20Factory.address;
  config.EmissionsERC20FactoryBlock =
    emissionsERC20Factory.deployTransaction.blockNumber;

  config.VerifyFactory = verifyFactory.address;
  config.VerifyFactoryBlock = verifyFactory.deployTransaction.blockNumber;

  config.CombineTierFactory = combineTierFactory.address;
  config.CombineTierFactoryBlock =
    combineTierFactory.deployTransaction.blockNumber;

  config.VerifyTierFactory = verifyTierFactory.address;
  config.VerifyTierFactoryBlock =
    verifyTierFactory.deployTransaction.blockNumber;

  config.SaleFactory = saleFactory.address;
  config.SaleFactoryBlock = saleFactory.deployTransaction.blockNumber;

  config.RedeemableERC20ClaimEscrow = redeemableERC20ClaimEscrow.address;
  config.RedeemableERC20ClaimEscrowBlock =
    redeemableERC20ClaimEscrow.deployTransaction.blockNumber;

  config.StakeFactory = stakeFactory.address;
  config.StakeFactoryBlock = stakeFactory.deployTransaction.blockNumber;

  config.OrderBook = orderBook.address;
  config.OrderBookBlock = orderBook.deployTransaction.blockNumber;

  // Write address and block to configuration contracts file
  const pathConfigLocal = path.resolve(__dirname, "../config/localhost.json");
  Util.writeFile(pathConfigLocal, JSON.stringify(config, null, 2));

  // Setting all to localhost to test locally
  const configPath = "config/localhost.json";
  const endpoint = "http://localhost:8020/";
  const ipfsEndpoint = "http://localhost:5001";
  const versionLabel = "test-v2.0.0";

  Util.exec(
    `npm run deploy-subgraph -- --config ${configPath} --subgraphName ${subgraphName} --endpoint ${endpoint} --ipfsEndpoint ${ipfsEndpoint} --versionLabel ${versionLabel}`
  );

  subgraph = Util.fetchSubgraph(subgraphName);

  // Wait for sync
  await waitForSubgraphToBeSynced(1000);
});

// TODO: Rewrite Redeemable Test
