import { expect, assert } from "chai";
import { ethers } from "hardhat";
import { concat } from "ethers/lib/utils";

import * as Util from "./utils/utils";
import {
  op,
  waitForSubgraphToBeSynced,
  getEventArgs,
  Tier,
  SaleStatus,
  zeroAddress,
  VMState,
  AllStandardOps,
  betweenBlockNumbersSource,
} from "./utils/utils";

// Typechain Factories
import { ReserveTokenTest__factory } from "../typechain/factories/ReserveTokenTest__factory";
import { RedeemableERC20__factory } from "../typechain/factories/RedeemableERC20__factory";

// Types
import type { FetchResult } from "apollo-fetch";
import type { ContractTransaction, Signer } from "ethers";
import type { ReserveTokenTest } from "../typechain/ReserveTokenTest";
import type { CombineTier } from "../typechain/CombineTier";
import type { RedeemableERC20 } from "../typechain/RedeemableERC20";
import type {
  Sale,
  BuyEvent,
  RefundEvent,
  StartEvent,
  StateConfigStruct,
  SaleConfigStruct,
  SaleRedeemableERC20ConfigStruct,
} from "../typechain/Sale";

import {
  // Subgraph
  subgraph,
  // Signers
  deployer,
  creator,
  signer1,
  recipient,
  // Factories
  saleFactory,
  feeRecipient,
  combineTierFactory,
  redeemableERC20Factory,
  noticeBoard,
} from "./1_initQueries.test";

let tier: CombineTier;

/**
 * Deploy a sale
 */
const deploySale = async (
  config: {
    _creator?: Signer;
    _saleConfig?: Partial<SaleConfigStruct>;
    _saleRedeemableConfig?: Partial<SaleRedeemableERC20ConfigStruct>;
  } = {}
): Promise<{
  sale: Sale;
  redeemableERC20: RedeemableERC20;
  saleReserve: ReserveTokenTest;
}> => {
  const { _creator, _saleConfig, _saleRedeemableConfig } = config;
  const deployer = _creator ? _creator : creator;

  // SaleConfig predefined values
  let saleReserve = await new ReserveTokenTest__factory(deployer).deploy();
  const cooldownDuration = 1;
  const dustSize = 0;
  const minimumRaise = ethers.BigNumber.from("50000").mul(Util.RESERVE_ONE);
  const saleTimeout = 100;

  const startBlock = await ethers.provider.getBlockNumber();
  const saleEnd = 30;

  const basePrice = ethers.BigNumber.from("75").mul(Util.RESERVE_ONE);
  const maxUnits = ethers.BigNumber.from(3);
  const constants = [
    basePrice,
    startBlock - 1,
    startBlock + saleEnd - 1,
    maxUnits,
  ];

  const vBasePrice = op(AllStandardOps.CONSTANT, 0);
  const vStart = op(AllStandardOps.CONSTANT, 1);
  const vEnd = op(AllStandardOps.CONSTANT, 2);
  const vMaxUnits = op(AllStandardOps.CONSTANT, 3);
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

  const _vmStateConfig: StateConfigStruct = {
    sources: sources,
    constants: constants,
  };

  // SaleRedeemableERC20Config predefined values
  const totalTokenSupply = ethers.BigNumber.from("2000").mul(Util.ONE);
  const redeemableERC20Config = {
    name: "Token",
    symbol: "TKN",
    distributor: Util.zeroAddress,
    initialSupply: totalTokenSupply,
  };

  const saleConfig: SaleConfigStruct = {
    cooldownDuration: cooldownDuration,
    dustSize: dustSize,
    minimumRaise: minimumRaise,
    recipient: recipient.address,
    reserve: saleReserve.address,
    saleTimeout: saleTimeout,
    vmStateConfig: _vmStateConfig,
  };

  const saleRedeemableConfig: SaleRedeemableERC20ConfigStruct = {
    distributionEndForwardingAddress: Util.zeroAddress,
    erc20Config: redeemableERC20Config,
    minimumTier: Tier.ZERO,
    tier: tier.address,
  };

  // Check if it is necessary add a non predefined value
  if (_saleConfig) {
    if (saleConfig.cooldownDuration) {
      saleConfig.cooldownDuration = _saleConfig.cooldownDuration;
    }

    if (saleConfig.dustSize) {
      saleConfig.dustSize = _saleConfig.dustSize;
    }

    if (saleConfig.minimumRaise) {
      saleConfig.minimumRaise = _saleConfig.minimumRaise;
    }

    if (saleConfig.recipient) {
      saleConfig.recipient = _saleConfig.recipient;
    }

    if (saleConfig.reserve) {
      saleConfig.reserve = _saleConfig.reserve;
      saleReserve = new ReserveTokenTest__factory(deployer).attach(
        _saleConfig.reserve
      );
    }

    if (saleConfig.saleTimeout) {
      saleConfig.saleTimeout = _saleConfig.saleTimeout;
    }

    if (saleConfig.vmStateConfig) {
      saleConfig.vmStateConfig = _saleConfig.vmStateConfig;
    }
  }

  if (_saleRedeemableConfig) {
    if (_saleRedeemableConfig.distributionEndForwardingAddress) {
      saleRedeemableConfig.distributionEndForwardingAddress =
        _saleRedeemableConfig.distributionEndForwardingAddress;
    }

    if (_saleRedeemableConfig.erc20Config) {
      saleRedeemableConfig.erc20Config = _saleRedeemableConfig.erc20Config;
    }

    if (_saleRedeemableConfig.minimumTier) {
      saleRedeemableConfig.minimumTier = _saleRedeemableConfig.minimumTier;
    }

    if (_saleRedeemableConfig.tier) {
      saleRedeemableConfig.tier = _saleRedeemableConfig.tier;
    }
  }

  const sale = await Util.saleDeploy(
    saleFactory,
    deployer,
    saleConfig,
    saleRedeemableConfig
  );

  const redeemableERC20 = new RedeemableERC20__factory(deployer).attach(
    await Util.getChild(redeemableERC20Factory, sale.deployTransaction)
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  redeemableERC20.deployTransaction = sale.deployTransaction;

  // Save new addresses
  return { sale, redeemableERC20, saleReserve };
};

/**
 * Helper function to check agains a sale and start it.
 * It will throw an error if the sale already has started of it's finished.
 *
 * @param _sale - The sale to start
 * @returns - The sale start transaction
 */
const startSale = async (_sale: Sale): Promise<ContractTransaction> => {
  const status = await _sale.saleStatus();
  // If it's active, does not required to start
  if (status === SaleStatus.ACTIVE) {
    throw new Error("WRONG: The sale has already started");
  }

  // If alrady finished, then it's a mistake call this funcion
  if (status > SaleStatus.ACTIVE) {
    throw new Error("WRONG: The sale has been finished ");
  }

  while (!(await _sale.canLive())) {
    await Util.createEmptyBlock();
  }

  return await _sale.start();
};

/**
 * Helper function to check agains a sale and end it.
 * It will throw an error if the sale already has ended
 *
 * @param _sale - The sale to start
 * @returns - The sale start transaction
 */
const endSale = async (_sale: Sale): Promise<ContractTransaction> => {
  const status = await _sale.saleStatus();

  if (status === SaleStatus.ACTIVE) {
    while (await _sale.canLive()) {
      await Util.createEmptyBlock();
    }

    return await _sale.end();
  }

  // If it's PENDING, cannot end
  if (status === SaleStatus.PENDING) {
    throw new Error("WRONG: The sale has not started");
  } else {
    // If already finished, then it's a mistake call this funcion
    throw new Error("WRONG: The sale has already finished ");
  }
};

describe("Sales queries test", function () {
  before("deploying tier contract", async function () {
    // Deploying a tier
    tier = await Util.deployAlwaysTier(combineTierFactory, creator);
  });

  describe("SaleFactory entity", async () => {
    it("should query all the basic fields correctly", async () => {
      // Get the Sale implementation
      const implementation = await Util.getImplementation(saleFactory);

      const query = `
      {
        saleFactory (id: "${saleFactory.address.toLowerCase()}") {
          address
          implementation
          redeemableERC20Factory
        }
      }
    `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.saleFactory;

      expect(data.address).to.equals(saleFactory.address.toLowerCase());
      expect(data.implementation).to.equals(implementation.toLowerCase());
      expect(data.redeemableERC20Factory).to.equals(
        redeemableERC20Factory.address.toLowerCase()
      );
    });

    it("should query multiples Sales from the entity correctly", async () => {
      // Deploying two sales to be query
      const { sale: sale1 } = await deploySale();
      const { sale: sale2 } = await deploySale();

      await waitForSubgraphToBeSynced();

      const query = `
      {
        saleFactory (id: "${saleFactory.address.toLowerCase()}") {
          children {
            id
          }
        }
      }
    `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.saleFactory;

      expect(data.children).to.deep.include({
        id: sale1.address.toLowerCase(),
      });
      expect(data.children).to.deep.include({
        id: sale2.address.toLowerCase(),
      });
    });
  });

  describe("Sale entity", async () => {
    it("should query the Sale after creation", async () => {
      const reserve = await new ReserveTokenTest__factory(creator).deploy();
      const cooldownDuration = "1";
      const dustSize = "0";
      const minimumRaise = ethers.BigNumber.from("50000").mul(Util.RESERVE_ONE);
      const saleTimeout = "100";

      const startBlock = await ethers.provider.getBlockNumber();
      const saleEnd = 30;

      const basePrice = ethers.BigNumber.from("75").mul(Util.RESERVE_ONE);
      const maxUnits = ethers.BigNumber.from(3);
      const constants = [
        basePrice,
        startBlock - 1,
        startBlock + saleEnd - 1,
        maxUnits,
      ];

      const vBasePrice = op(AllStandardOps.CONSTANT, 0);
      const vStart = op(AllStandardOps.CONSTANT, 1);
      const vEnd = op(AllStandardOps.CONSTANT, 2);
      const vMaxUnits = op(AllStandardOps.CONSTANT, 3);
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

      const _vmStateConfig: StateConfigStruct = {
        sources: sources,
        constants: constants,
      };

      const totalTokenSupply = ethers.BigNumber.from("2000").mul(Util.ONE);
      const redeemableERC20Config = {
        name: "Token",
        symbol: "TKN",
        distributor: Util.zeroAddress,
        initialSupply: totalTokenSupply,
      };

      const saleConfig: SaleConfigStruct = {
        cooldownDuration: cooldownDuration,
        dustSize: dustSize,
        minimumRaise: minimumRaise,
        recipient: recipient.address,
        reserve: reserve.address,
        saleTimeout: saleTimeout,
        vmStateConfig: _vmStateConfig,
      };

      const saleRedeemableConfig: SaleRedeemableERC20ConfigStruct = {
        distributionEndForwardingAddress: Util.zeroAddress,
        erc20Config: redeemableERC20Config,
        minimumTier: Tier.ZERO,
        tier: tier.address,
      };

      // Deploying sale with specific config
      const { sale, redeemableERC20, saleReserve } = await deploySale({
        _creator: creator,
        _saleConfig: saleConfig,
        _saleRedeemableConfig: saleRedeemableConfig,
      });

      // Wait by sync
      await waitForSubgraphToBeSynced();

      // Getting the info of tx
      const [deployBlock, deployTime] = await Util.getTxTimeblock(
        sale.deployTransaction
      );

      const unitsAvailableExpected = await redeemableERC20.balanceOf(
        sale.address
      );

      const query = `
        {
          sale (id: "${sale.address.toLowerCase()}") {
            address
            deployBlock
            deployTimestamp
            deployer
            factory {
              id
            }
            token {
              id
            }
            reserve {
              id
            }
            recipient
            cooldownDuration
            minimumRaise
            dustSize
            unitsAvailable
            totalRaised
            percentRaised
            totalFees
            saleStatus
            buys {
              id
            }
            refunds {
              id
            }
            saleTransactions {
              id
            }
            notices {
              id
            }
            saleFeeRecipients {
              id
            }
            startEvent {
              id
            }
            endEvent {
              id
            }
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.sale;

      expect(data.address).to.be.equals(sale.address.toLowerCase());
      expect(data.deployBlock).to.be.equals(deployBlock.toString());
      expect(data.deployTimestamp).to.be.equals(deployTime.toString());
      expect(data.deployer).to.be.equals(creator.address.toLowerCase());
      expect(data.factory.id).to.be.equals(saleFactory.address.toLowerCase());

      expect(data.token.id).to.be.equals(redeemableERC20.address.toLowerCase());
      expect(data.reserve.id).to.be.equals(saleReserve.address.toLowerCase());
      expect(data.recipient).to.be.equals(recipient.address.toLowerCase());

      expect(data.recipient).to.be.equals(recipient.address.toLowerCase());
      expect(data.cooldownDuration).to.be.equals(cooldownDuration);
      expect(data.minimumRaise).to.be.equals(minimumRaise);
      expect(data.dustSize).to.be.equals(dustSize);

      // Dinamic values
      expect(data.unitsAvailable).to.be.equals(unitsAvailableExpected);
      expect(data.totalRaised).to.be.equals("0");
      expect(data.percentRaised).to.be.equals("0");
      expect(data.totalFees).to.be.equals("0");
      expect(data.saleStatus).to.be.equals(SaleStatus.PENDING);

      // Empty values not happened yet in this sale
      expect(data.buys).to.be.empty;
      expect(data.refunds).to.be.empty;
      expect(data.saleTransactions).to.be.empty;
      expect(data.notices).to.be.empty;
      expect(data.saleFeeRecipients).to.be.empty;

      // Start/End events not happened yet
      expect(data.startEvent).to.be.null;
      expect(data.endEvent).to.be.null;
    });

    it("should update the Sale and query the SaleStart after the sale started", async () => {
      const { sale } = await deploySale({ _creator: creator });

      expect(await sale.saleStatus()).to.be.equals(
        SaleStatus.PENDING,
        "Wrong sale status"
      );

      // Start the sale
      const startTx = await startSale(sale);
      const startSender = startTx.from;
      const [startBlock, startTime] = await Util.getTxTimeblock(startTx);
      const startID = startTx.hash.toLowerCase();

      expect(await sale.saleStatus()).to.be.equals(
        SaleStatus.ACTIVE,
        "Wrong sale has not been started"
      );

      await waitForSubgraphToBeSynced();

      const query = `
      {
        sale (id: "${sale.address.toLowerCase()}") {
          saleStatus
          startEvent {
            id
          }
        }
        saleStart (id: "${startID}") {
          block
          timestamp
          transactionHash
          saleContract {
            id
          }
          sender
        }
      }
    `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const dataSale = response.data.sale;
      const dataStart = response.data.saleStart;

      expect(dataSale.saleStatus).to.be.equals(SaleStatus.ACTIVE);
      expect(dataSale.startEvent.id).to.be.equals(startID);

      expect(dataStart.block).to.be.equals(startBlock.toString());
      expect(dataStart.timestamp).to.be.equals(startTime.toString());

      expect(dataStart.transactionHash).to.be.equals(
        startTx.hash.toLowerCase()
      );
      expect(dataStart.saleContract.id).to.be.equals(
        sale.address.toLowerCase()
      );
      expect(dataStart.sender).to.be.equals(startSender.toLowerCase());
    });

    it("should update the Sale and query the SaleEnd after the sale ended", async () => {
      const { sale } = await deploySale({ _creator: creator });

      expect(await sale.saleStatus()).to.be.equals(
        SaleStatus.PENDING,
        "Wrong sale status"
      );

      // Start the sale
      await startSale(sale);

      expect(await sale.saleStatus()).to.be.equals(
        SaleStatus.ACTIVE,
        "Wrong sale has not been started"
      );

      // End the sale
      const endTx = await endSale(sale);

      expect(await sale.saleStatus()).to.be.oneOf(
        [SaleStatus.FAIL, SaleStatus.SUCCESS],
        "Wrong sale has not finished"
      );

      const endSender = endTx.from;
      const [endBlock, endTime] = await Util.getTxTimeblock(endTx);
      const endID = endTx.hash.toLowerCase();

      await waitForSubgraphToBeSynced();

      const query = `
        {
          sale (id: "${sale.address.toLowerCase()}") {
            saleStatus
            endEvent {
              id
            }
          }
          saleEnd (id: "${endID}") {
            block
            transactionHash
            timestamp
            saleContract {
              id
            }
            sender
            saleStatus
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;

      const dataSale = response.data.sale;
      const dataEnd = response.data.saleEnd;

      expect(dataSale.saleStatus).to.be.oneOf([
        SaleStatus.FAIL,
        SaleStatus.SUCCESS,
      ]);
      expect(dataSale.endEvent.id).to.be.equals(endID);

      expect(dataEnd.block).to.be.equals(endBlock.toString());
      expect(dataEnd.timestamp).to.be.equals(endTime.toString());

      expect(dataEnd.transactionHash).to.be.equals(endTx.hash.toLowerCase());
      expect(dataEnd.saleContract.id).to.be.equals(sale.address.toLowerCase());
      expect(dataEnd.sender).to.be.equals(endSender.toLowerCase());
      expect(dataEnd.SaleEnd).to.be.oneOf([
        SaleStatus.FAIL,
        SaleStatus.SUCCESS,
      ]);
    });
  });

  // "Sale with a non-ERC20 token as reserve"
});
