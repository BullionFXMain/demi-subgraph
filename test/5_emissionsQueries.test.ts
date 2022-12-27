import { expect, assert } from "chai";
import { concat, hexlify } from "ethers/lib/utils";
import * as Util from "./utils/utils";
import { waitForSubgraphToBeSynced, op, AllStandardOps } from "./utils/utils";

import {
  subgraph,
  creator,
  signer1,
  signer2,
  emissionsERC20Factory,
} from "./1_initQueries.test";

// Types
import type { FetchResult } from "apollo-fetch";
import type { ContractTransaction, BigNumber } from "ethers";
import type {
  EmissionsERC20,
  ClaimEvent,
  TransferEvent,
  InitializeEvent,
} from "../typechain/EmissionsERC20";

let emissionsERC20: EmissionsERC20, transaction: ContractTransaction;

describe("EmissionsERC20 queries test", function () {
  const claimAmount = 123;
  const allowDelegatedClaims = true;
  const claimMessage = hexlify([...Buffer.from("Custom claim message")]);

  const vmStateConfig = {
    sources: [concat([op(AllStandardOps.CONSTANT)])],
    constants: [claimAmount],
  };

  it("should query the EmissionsERC20Factory after construction correctly", async function () {
    // Get the EmissionsERC20 implementation
    const implementation = await Util.getImplementation(emissionsERC20Factory);

    const query = `
      {
        emissionsERC20Factory (id: "${emissionsERC20Factory.address.toLowerCase()}") {
          address
          implementation
        }
      }
    `;

    const response = (await subgraph({
      query,
    })) as FetchResult;

    const data = response.data.emissionsERC20Factory;

    expect(data.address).to.equals(emissionsERC20Factory.address.toLowerCase());
    expect(data.implementation).to.equals(implementation.toLowerCase());
  });

  it("should query the EmissionsERC20 child from factory after creation", async function () {
    // ERC20 Config
    const erc20Config = {
      name: "Emissions",
      symbol: "EMS",
      distributor: creator.address,
      initialSupply: 0,
    };

    // Creating a child
    emissionsERC20 = await Util.emissionsDeploy(
      emissionsERC20Factory,
      creator,
      {
        allowDelegatedClaims: allowDelegatedClaims,
        erc20Config: erc20Config,
        vmStateConfig: vmStateConfig,
      }
    );

    // Wait for sync
    await waitForSubgraphToBeSynced();

    const query = `
      {
        emissionsERC20Factory (id: "${emissionsERC20Factory.address.toLowerCase()}") {
          children {
            id
          }
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;

    const data = response.data.emissionsERC20Factory;

    expect(data.children).deep.include({
      id: emissionsERC20.address.toLowerCase(),
    });
  });

  it("should query EmissionsERC20 deploy information correclty", async function () {
    const [block, timestamp] = await Util.getTxTimeblock(
      emissionsERC20.deployTransaction
    );

    const query = `
      {
        emissionsERC20 (id: "${emissionsERC20.address.toLowerCase()}") {
          address
          deployBlock
          deployTimestamp
          deployer
          factory {
            id
          }
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;
    const data = response.data.emissionsERC20;

    expect(data.address).to.equals(emissionsERC20.address.toLowerCase());

    expect(data.deployer).to.equals(creator.address.toLowerCase());

    expect(data.deployBlock).to.equals(block.toString());

    expect(data.deployTimestamp).to.equals(timestamp.toString());

    expect(data.factory.id).to.equals(
      emissionsERC20Factory.address.toLowerCase()
    );
  });

  it("should query EmissionsERC20 token information correclty", async function () {
    const query = `
      {
        emissionsERC20 (id: "${emissionsERC20.address.toLowerCase()}") {
          name
          symbol
          decimals
          totalSupply
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;
    const data = response.data.emissionsERC20;

    expect(data.name).to.equals(await emissionsERC20.name());
    expect(data.symbol).to.equals(await emissionsERC20.symbol());
    expect(data.decimals).to.equals(await emissionsERC20.decimals());
    expect(data.totalSupply).to.equals(await emissionsERC20.totalSupply());
  });

  it("should query EmissionsERC20 config information correclty", async function () {
    const query = `
      {
        emissionsERC20 (id: "${emissionsERC20.address.toLowerCase()}") {
          allowDelegatedClaims
          calculateClaimStateConfig {
            id
          }
          claims {
            id
          }
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;
    const data = response.data.emissionsERC20;

    expect(data.claims).to.be.empty;
    expect(data.allowDelegatedClaims).to.equals(allowDelegatedClaims);
    expect(data.calculateClaimStateConfig.id).to.equals(
      emissionsERC20.deployTransaction.hash.toLowerCase()
    );
  });

  it("should query the State config of the EmissionsERC20 correclty", async function () {
    // Get the state from initialization with Initialize event
    const { config } = (await Util.getEventArgs(
      emissionsERC20.deployTransaction,
      "Initialize",
      emissionsERC20
    )) as InitializeEvent["args"];

    const stateExpected = config.vmStateConfig;

    const arrayToString = (arr: BigNumber[]): string[] => {
      return arr.map((x: BigNumber) => x.toString());
    };

    // Using the values form Event
    const sourcesExpected = stateExpected.sources;
    const constantsExpected = arrayToString(stateExpected.constants);

    const stateId = emissionsERC20.deployTransaction.hash.toLowerCase();

    const query = `
      {
        emissionsERC20 (id: "${emissionsERC20.address.toLowerCase()}") {
          calculateClaimStateConfig {
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
    const dataEmission = response.data.emissionsERC20;

    expect(dataEmission.calculateClaimStateConfig.id).to.equals(stateId);

    expect(data.sources).to.deep.equal(sourcesExpected);
    expect(data.constants).to.deep.equals(constantsExpected);
  });

  it("should update the EmissionsERC20 after a claim", async function () {
    // Signer1 claim in name of the Signer2
    transaction = await emissionsERC20
      .connect(signer1)
      .claim(signer2.address, claimMessage);

    const expectedClaim = {
      id: transaction.hash.toLowerCase(),
    };

    // Wait sync
    await waitForSubgraphToBeSynced();

    const query = `
      {
        emissionsERC20 (id: "${emissionsERC20.address.toLowerCase()}") {
          totalSupply
          claims {
            id
          }
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;
    const data = response.data.emissionsERC20;

    expect(data.totalSupply).to.equals(await emissionsERC20.totalSupply());
    expect(data.claims).deep.include(expectedClaim);
  });

  it("should query EmissionsERC20Claim entity after a claim", async function () {
    const [block, timestamp] = await Util.getTxTimeblock(transaction);

    const { sender, claimant } = (await Util.getEventArgs(
      transaction,
      "Claim",
      emissionsERC20
    )) as ClaimEvent["args"];

    const { from, value: claimedAmount } = (await Util.getEventArgs(
      transaction,
      "Transfer",
      emissionsERC20
    )) as TransferEvent["args"];

    // Double check that it is the mint/claim
    assert(from == Util.zeroAddress, `wrong transfer event. It is a not mint`);

    const query = `
      {
        emissionsERC20Claim (id: "${transaction.hash.toLowerCase()}") {
          block
          timestamp
          sender
          claimant
          data
          amount
          emissionsERC20 {
            id
          }
        }
      }
    `;
    const response = (await subgraph({
      query,
    })) as FetchResult;
    const data = response.data.emissionsERC20Claim;

    expect(data.block).to.equals(block.toString());
    expect(data.timestamp).to.equals(timestamp.toString());

    expect(data.sender).to.equals(sender.toLowerCase());
    expect(data.claimant).to.equals(claimant.toLowerCase());

    expect(data.data).to.equals(claimMessage.toLowerCase());
    expect(data.amount).to.equals(claimedAmount.toString());

    expect(data.emissionsERC20.id).to.equals(
      emissionsERC20.address.toLowerCase()
    );
  });
});
