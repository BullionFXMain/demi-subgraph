import { expect } from "chai";
import { ethers } from "hardhat";
import { concat } from "ethers/lib/utils";
import * as Util from "./utils/utils";
import {
  op,
  getTxTimeblock,
  getImplementation,
  getEventArgs,
  waitForSubgraphToBeSynced,
  zeroAddress,
  Tier,
  AllStandardOps as Opcode,
} from "./utils/utils";

// Typechain Factories
import { ReserveTokenTest__factory } from "../typechain/factories/ReserveTokenTest__factory";
import { Verify__factory } from "../typechain/factories/Verify__factory";
import { CombineTier__factory } from "../typechain/factories/CombineTier__factory";
import { RedeemableERC20__factory } from "../typechain/factories/RedeemableERC20__factory";

// Types
import type { FetchResult } from "apollo-fetch";
import type { ContractTransaction, BigNumber } from "ethers";

import type { Verify } from "../typechain/Verify";
import type { RedeemableERC20 } from "../typechain/RedeemableERC20";

import type { VerifyTier } from "../typechain/VerifyTier";
import type { CombineTier, InitializeEvent } from "../typechain/CombineTier";
import type { Sale } from "../typechain/Sale";

import {
  // Subgraph
  subgraph,
  // Signers
  deployer,
  creator,
  signer1,
  signer2,
  admin,
  recipient,
  // Contracts factories
  verifyFactory,
  verifyTierFactory,
  combineTierFactory,
  noticeBoard,
  saleFactory,
  vmStateBuilder,
  redeemableERC20Factory,
} from "./1_initQueries.test";

let transaction: ContractTransaction;

/**
 * Deploy a sale with prederminated values and setup to the env to avoid code repetition
 *
 * @param tier - tier contract
 */
const deploySale = async (
  tier: VerifyTier | CombineTier
): Promise<{
  sale: Sale;
  redeemableERC20: RedeemableERC20;
}> => {
  const saleReserve = await new ReserveTokenTest__factory(deployer).deploy();

  const startBlock = await ethers.provider.getBlockNumber();
  const saleTimeout = 30;

  const minimumRaise = ethers.BigNumber.from("50000").mul(Util.RESERVE_ONE);
  const totalTokenSupply = ethers.BigNumber.from("2000").mul(Util.ONE);
  const redeemableERC20Config = {
    name: "Token",
    symbol: "TKN",
    distributor: Util.zeroAddress,
    initialSupply: totalTokenSupply,
  };
  const basePrice = ethers.BigNumber.from("75").mul(Util.RESERVE_ONE);
  const maxUnits = ethers.BigNumber.from(3);
  const constants = [
    basePrice,
    startBlock - 1,
    startBlock + saleTimeout - 1,
    maxUnits,
  ];
  const vBasePrice = op(Opcode.CONSTANT, 0);
  const vStart = op(Opcode.CONSTANT, 1);
  const vEnd = op(Opcode.CONSTANT, 2);
  const vMaxUnits = op(Opcode.CONSTANT, 3);
  const sources = [
    Util.betweenBlockNumbersSource(vStart, vEnd),
    // prettier-ignore
    concat([
      // maxUnits
      vMaxUnits, // static amount
      // price
      vBasePrice,
    ]),
  ];

  const sale = await Util.saleDeploy(
    saleFactory,
    creator,
    {
      vmStateConfig: {
        sources: sources,
        constants: constants,
      },
      recipient: recipient.address,
      reserve: saleReserve.address,
      cooldownDuration: 1,
      minimumRaise: minimumRaise,
      dustSize: 0,
      saleTimeout: 100,
    },
    {
      erc20Config: redeemableERC20Config,
      tier: tier.address,
      minimumTier: Tier.ZERO,
      distributionEndForwardingAddress: Util.zeroAddress,
    }
  );

  const redeemableERC20 = new RedeemableERC20__factory(deployer).attach(
    await Util.getChild(redeemableERC20Factory, sale.deployTransaction)
  );

  return { sale, redeemableERC20 };
};

describe("Subgraph Tier Test", function () {
  describe("VerifyTier Factory - Queries", function () {
    let verify: Verify, verifyTier: VerifyTier;

    before("deploy fresh test contracts", async function () {
      // Creating a new Verify Child
      verify = await Util.verifyDeploy(verifyFactory, creator, {
        admin: admin.address,
        callback: zeroAddress,
      });

      // Admin grants all roles to himself.
      // ⚠️ NOTE: This is for testing purposes only ⚠️
      await verify.connect(admin).grantRole(Util.APPROVER, admin.address);
      await verify.connect(admin).grantRole(Util.REMOVER, admin.address);
      await verify.connect(admin).grantRole(Util.BANNER, admin.address);

      await waitForSubgraphToBeSynced();
    });

    it("should query VerifyTierFactory correctly after construction", async function () {
      // Get the VerifyTier implementation
      const implementation = await getImplementation(verifyTierFactory);

      const query = `
        {
          verifyTierFactory (id: "${verifyTierFactory.address.toLowerCase()}") {
            address
            implementation
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.verifyTierFactory;

      expect(data.address).to.equals(verifyTierFactory.address.toLowerCase());
      expect(data.implementation).to.equals(implementation.toLowerCase());
    });

    it("should query the VerifyTier child from Factory after creation", async function () {
      // Creating the VerifyTier Contract with the Verify
      verifyTier = await Util.verifyTierDeploy(
        verifyTierFactory,
        creator,
        verify.address
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          verifyTierFactory  (id: "${verifyTierFactory.address.toLowerCase()}") {
            children {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.verifyTierFactory;

      expect(data.children).deep.include({
        id: verifyTier.address.toLowerCase(),
      });
    });

    it("should query the VerityTier contract correclty", async function () {
      const [deployBlock, deployTimestamp] = await getTxTimeblock(
        verifyTier.deployTransaction
      );

      const query = `
        {
          verifyTier (id: "${verifyTier.address.toLowerCase()}") {
            id
            address
            deployer
            deployBlock
            deployTimestamp
            factory {
              address
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.verifyTier;

      expect(data.id).to.equals(verifyTier.address.toLowerCase());
      expect(data.address).to.equals(verifyTier.address.toLowerCase());
      expect(data.deployer).to.equals(creator.address.toLowerCase());

      expect(data.deployBlock).to.equals(deployBlock.toString());
      expect(data.deployTimestamp).to.equals(deployTimestamp.toString());
      expect(data.factory.address).to.equals(
        verifyTierFactory.address.toLowerCase()
      );
    });

    it("should query the Verify contract from VerifyTier correclty", async function () {
      const [deployBlock, deployTimestamp] = await getTxTimeblock(
        verify.deployTransaction
      );

      const query = `
        {
          verifyTier (id: "${verifyTier.address.toLowerCase()}") {
            verifyContract {
              id
              address
              deployer
              deployBlock
              deployTimestamp
              factory {
                id
              }
              verifyAddresses {
                id
              }
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.verifyTier.verifyContract;

      expect(data.id).to.equals(verify.address.toLowerCase());
      expect(data.address).to.equals(verify.address.toLowerCase());
      expect(data.deployer).to.equals(creator.address.toLowerCase());

      expect(data.deployBlock).to.equals(deployBlock.toString());
      expect(data.deployTimestamp).to.equals(deployTimestamp.toString());
      expect(data.factory.id).to.equals(verifyFactory.address.toLowerCase());

      // expect(data.verifyAddresses).to.be.empty;
    });

    it("should continue query if the Verify Address in VerifyTier is a non-Verify contract address", async function () {
      const nonVerifyAddress = signer2.address;

      // Creating the VerifyTier Contract with the non-Verify contract address
      verifyTier = await Util.verifyTierDeploy(
        verifyTierFactory,
        creator,
        nonVerifyAddress
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          verifyTier (id: "${verifyTier.address.toLowerCase()}") {
            address
            verifyContract {
              id
              address
              deployBlock
              deployTimestamp
              deployer
              factory {
                id
              }
              verifyAddresses {
                id
              }
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;
      const dataTier = response.data.verifyTier;
      const data = response.data.verifyTier.verifyContract;

      expect(dataTier.address).to.equals(verifyTier.address.toLowerCase());

      expect(data.id).to.equals(nonVerifyAddress.toLowerCase());
      expect(data.address).to.equals(nonVerifyAddress.toLowerCase());

      expect(data.deployBlock).to.equals("0");
      expect(data.deployTimestamp).to.equals("0");

      expect(data.deployer).to.equals(zeroAddress.toLowerCase());
      expect(data.factory).to.be.null;
      expect(data.verifyAddresses).to.be.empty;
    });

    it("should query a Verify that was deployed without the factory and it is in VerifyTier", async function () {
      // Verify deployed without factory
      const verifyIndependent = await new Verify__factory(deployer).deploy();

      await verifyIndependent.initialize({
        admin: admin.address,
        callback: zeroAddress,
      });

      // Creating the VerifyTier Contract with the Verify
      verifyTier = await Util.verifyTierDeploy(
        verifyTierFactory,
        creator,
        verifyIndependent.address
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          verifyTier (id: "${verifyTier.address.toLowerCase()}") {
            address
            verifyContract {
              id
              address
              deployer
              deployBlock
              deployTimestamp
              factory {
                id
              }
              verifyAddresses {
                id
              }
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;
      const dataTier = response.data.verifyTier;
      const data = response.data.verifyTier.verifyContract;

      expect(dataTier.address).to.equals(verifyTier.address.toLowerCase());

      expect(data.id).to.equals(verifyIndependent.address.toLowerCase());
      expect(data.address).to.equals(verifyIndependent.address.toLowerCase());

      // Is there any way to get this values if was deployed without the factory?
      expect(data.deployBlock).to.equals("0");
      expect(data.deployTimestamp).to.equals("0");

      expect(data.deployer).to.equals(zeroAddress.toLowerCase());
      expect(data.factory).to.null;
      expect(data.verifyAddresses).to.be.empty;
    });
  });

  describe("CombineTier Factory - Queries", function () {
    let combineTier: CombineTier;

    // prettier-ignore
    const sourceReportTimeForTierDefault = concat([
        op(Opcode.THIS_ADDRESS),
        op(Opcode.CONTEXT, 0),
      op(Opcode.ITIERV2_REPORT),
    ]);

    const configAlways = {
      combinedTiersLength: 0,
      sourceConfig: {
        sources: [op(Opcode.CONSTANT, 0), sourceReportTimeForTierDefault],
        constants: [0],
      },
    };

    it("should query CombineTierFactory correctly", async function () {
      // Get the CombineTier implementation
      const implementation = await getImplementation(combineTierFactory);

      const query = `
        {
          combineTierFactory (id: "${combineTierFactory.address.toLowerCase()}"){
            address
            implementation
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.combineTierFactory;

      expect(data.address).to.equals(combineTierFactory.address.toLowerCase());
      expect(data.implementation).to.equals(implementation.toLowerCase());
    });

    it("should query the CombineTier child from factory after creation", async function () {
      combineTier = await Util.combineTierDeploy(
        combineTierFactory,
        creator,
        configAlways
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          combineTierFactory (id: "${combineTierFactory.address.toLowerCase()}") {
            children {
              id
            }
          }
        }
      `;

      const queryResponse = (await subgraph({
        query,
      })) as FetchResult;

      const data = queryResponse.data.combineTierFactory;

      expect(data.children).deep.include({
        id: combineTier.address.toLowerCase(),
      });
    });

    it("should query the CombineTier correctly", async function () {
      const [deployBlock, deployTimestamp] = await getTxTimeblock(
        combineTier.deployTransaction
      );

      const stateId = combineTier.deployTransaction.hash.toLowerCase();

      const query = `
        {
          combineTier (id: "${combineTier.address.toLowerCase()}") {
            address
            deployer
            deployBlock
            deployTimestamp
            factory {
              id
            }
            state {
              id
            }
            notices {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.combineTier;

      expect(data.address).to.equals(combineTier.address.toLowerCase());
      expect(data.deployer).to.equals(creator.address.toLowerCase());
      expect(data.deployBlock).to.equals(deployBlock.toString());
      expect(data.deployTimestamp).to.equals(deployTimestamp.toString());

      expect(data.notices).to.be.empty;
      expect(data.state.id).to.equals(stateId);
      expect(data.factory.id).to.equals(
        combineTierFactory.address.toLowerCase()
      );
    });

    it("should query the State present on CombineTier correclty", async function () {
      const stateId = `${combineTier.deployTransaction.hash.toLowerCase()}`;
      const { config } = (await getEventArgs(
        combineTier.deployTransaction,
        "Initialize",
        combineTier
      )) as InitializeEvent["args"];

      const stateExpected = config.sourceConfig;

      const arrayToString = (arr: BigNumber[]): string[] => {
        return arr.map((x: BigNumber) => x.toString());
      };

      // Using the values form Event
      const sourcesExpected = stateExpected.sources;
      const constantsExpected = arrayToString(stateExpected.constants);

      const query = `
        {
          combineTier (id: "${combineTier.address.toLowerCase()}") {
            state {
              id
            }
          }
          stateConfig (id: "${stateId}") {
            sources
            constants
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.stateConfig;
      const dataTier = response.data.combineTier;

      expect(dataTier.state.id).to.equals(stateId);

      expect(data.sources).to.deep.equal(sourcesExpected);
      expect(data.constants).to.deep.equals(constantsExpected);
    });

    it("should query Notice in CombineTier correctly", async function () {
      const notices = [
        {
          subject: combineTier.address,
          data: "0x01",
        },
      ];

      transaction = await noticeBoard.connect(signer1).createNotices(notices);

      // Waiting for sync
      await waitForSubgraphToBeSynced();

      const noticeId = `${combineTier.address.toLowerCase()} - ${transaction.hash.toLowerCase()} - 0`;

      const query = `
        {
          combineTier (id: "${combineTier.address.toLowerCase()}") {
            notices {
              id
            }
          }
          notice (id: "${noticeId}") {
            sender
            subject{
              id
            }
            data
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const dataTier = response.data.combineTier.notices;
      const data = response.data.notice;

      expect(dataTier).deep.include({ id: noticeId });

      expect(data.data).to.equals("0x01");
      expect(data.sender).to.equals(signer1.address.toLowerCase());
      expect(data.subject.id).to.equals(combineTier.address.toLowerCase());
    });
  });

  describe("UnknownTiers - Queries", function () {
    // It will work with any Tier Contract deployed without any the indexed Tier Factories
    let tierIndependent: CombineTier;

    before("deploy independent tier contract", async function () {
      // Deploy and initialize an Independent Tier
      tierIndependent = await new CombineTier__factory(deployer).deploy(
        vmStateBuilder.address
      );

      // prettier-ignore
      const sourceReportTimeForTierDefault = concat([
          op(Opcode.THIS_ADDRESS),
          op(Opcode.CONTEXT, 0),
        op(Opcode.ITIERV2_REPORT),
      ]);

      const alwaysArg = {
        combinedTiersLength: 0,
        sourceConfig: {
          sources: [op(Opcode.CONSTANT, 0), sourceReportTimeForTierDefault],
          constants: [0],
        },
      };

      await tierIndependent.initialize(alwaysArg);
    });

    it("should be UnknownTier when used in a Sale RedeemableERC20 contract", async function () {
      const { redeemableERC20 } = await deploySale(tierIndependent);

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableERC20(id: "${redeemableERC20.address.toLowerCase()}") {
            tier {
              __typename
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.redeemableERC20.tier;

      expect(data.__typename).to.equals("UnknownTier");
      expect(data.id).to.equals(tierIndependent.address.toLowerCase());
    });
  });
});
