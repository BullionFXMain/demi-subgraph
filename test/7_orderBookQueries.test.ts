import { ethers } from "hardhat";
import { concat } from "ethers/lib/utils";
import { BigNumber } from "ethers";

import {
  op,
  getEventArgs,
  eighteenZeros,
  OrderBookOpcode,
  waitForSubgraphToBeSynced,
} from "./utils/utils";
import * as Util from "./utils/utils";

// Typechain Factories
import { ReserveTokenTest__factory } from "../typechain/factories/ReserveTokenTest__factory";

// Types
import type { FetchResult } from "apollo-fetch";
import type { ReserveTokenTest } from "../typechain/ReserveTokenTest";
import type {
  // Structs - configs
  OrderConfigStruct,
  OrderStruct,
  DepositConfigStruct,
  BountyConfigStruct,
  WithdrawConfigStruct,
  // Events
  OrderLiveEvent,
  DepositEvent,
  WithdrawEvent,
  ClearEvent,
  AfterClearEvent,
} from "../typechain/OrderBook";

import {
  // Subgraph
  subgraph,
  // Contracts
  orderBook,
  // Signers
  deployer,
  signer1,
  signer2,
  signer3 as bountyAccount,
} from "./1_initQueries.test";
import { expect } from "chai";

let tokenA: ReserveTokenTest, tokenB: ReserveTokenTest;

function getOrderClearId(
  _afterClear: Readonly<AfterClearEvent["args"]>,
  _clear: Readonly<ClearEvent["args"]>,
  _txHash: Readonly<string>
) {
  const abiCoder = ethers.utils.defaultAbiCoder;
  const _keccak256 = ethers.utils.keccak256;

  // AFTERCLEAR
  // id: ID! # hash(hash(AfterClear), hash(Clear), transactionHash)
  const { stateChange } = _afterClear;
  const afterClearHash = _keccak256(
    abiCoder.encode(
      ["tuple(uint256, uint256, uint256, uint256)"],
      [
        [
          stateChange.aOutput,
          stateChange.bOutput,
          stateChange.aInput,
          stateChange.bInput,
        ],
      ]
    )
  );

  // CLEAR
  const { sender, a_, b_, bountyConfig } = _clear;
  // Tuple definitions
  const orderTuple =
    "tuple(address, address, uint256, address, uint256, uint256, bytes)";
  const bountyConfigTuple = "tuple(uint256, uint256)";

  // Value definitions
  const orderA = [
    a_.owner,
    a_.inputToken,
    a_.inputVaultId,
    a_.outputToken,
    a_.outputVaultId,
    a_.tracking,
    a_.vmState,
  ];
  const orderB = [
    b_.owner,
    b_.inputToken,
    b_.inputVaultId,
    b_.outputToken,
    b_.outputVaultId,
    b_.tracking,
    b_.vmState,
  ];
  const bounty = [bountyConfig.aVaultId, bountyConfig.bVaultId];

  const clearHash = _keccak256(
    abiCoder.encode(
      ["address", orderTuple, orderTuple, bountyConfigTuple],
      [sender, orderA, orderB, bounty]
    )
  );

  // Combine tree values with the encoder
  return _keccak256(
    abiCoder.encode(
      ["bytes32", "bytes32", "bytes32"],
      [afterClearHash, clearHash, _txHash]
    )
  );
}

function getOrderIdFromOrder(_order: Readonly<OrderStruct>): string {
  const encodeOrder = ethers.utils.defaultAbiCoder.encode(
    ["tuple(address, address, uint256, address, uint256, uint256, bytes)"],
    [
      [
        _order.owner,
        _order.inputToken,
        _order.inputVaultId,
        _order.outputToken,
        _order.outputVaultId,
        _order.tracking,
        _order.vmState,
      ],
    ]
  );

  return BigNumber.from(ethers.utils.keccak256(encodeOrder)).toString();
}

describe("Orderbook test", () => {
  const TRACK_CLEARED_ORDER = 0x1;
  const cOrderHash = op(OrderBookOpcode.CONTEXT, 0);

  beforeEach("deploying fresh test contracts", async () => {
    tokenA = await new ReserveTokenTest__factory(deployer).deploy();
    tokenB = await new ReserveTokenTest__factory(deployer).deploy();
  });

  describe("Order entity", async () => {
    it("should query the Order after addOrder", async () => {
      const InputVault = 1;
      const OutputVault = 2;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const transaction = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: orderConfig } = (await getEventArgs(
        transaction,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      const orderId = getOrderIdFromOrder(orderConfig);
      const vault_inputVaultID = `${orderConfig.inputVaultId.toString()} - ${orderConfig.owner.toLowerCase()}`; // {vaultId}-{owner}
      const vault_outputVaultID = `${orderConfig.outputVaultId.toString()} - ${orderConfig.owner.toLowerCase()}`; // {vaultId}-{owner}

      // #{vaultId}-{owner}-{token}
      const tokenVaultInput_ID = `${orderConfig.inputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.inputToken.toLowerCase()}`;
      const tokenVaultOutput_ID = `${orderConfig.outputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.outputToken.toLowerCase()}`;

      await waitForSubgraphToBeSynced();

      // Make the order with a fixed ID
      const query = `
        {
          order (id: "${orderId}") {
            owner
            tracking
            vmState
            orderLiveness
            inputToken {
              id
            }
            outputToken {
              id
            }
            inputVault {
              id
            }
            outputVault {
              id
            }
            inputTokenVault {
              id
            }
            outputTokenVault {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.order;

      expect(data.orderLiveness).to.be.true;
      expect(data.owner).to.be.equals(orderConfig.owner.toLowerCase());

      expect(data.tracking).to.be.equals(orderConfig.tracking);
      expect(data.vmState).to.be.equals(orderConfig.vmState);

      expect(data.inputToken.id).to.be.equals(
        orderConfig.inputToken.toLowerCase()
      );
      expect(data.outputToken.id).to.be.equals(
        orderConfig.outputToken.toLowerCase()
      );

      // Vault
      expect(data.inputVault.id).to.be.equals(vault_inputVaultID);
      expect(data.outputVault.id).to.be.equals(vault_outputVaultID);

      // TokenVault
      expect(data.inputTokenVault.id).to.be.equals(tokenVaultInput_ID);
      expect(data.outputTokenVault.id).to.be.equals(tokenVaultOutput_ID);
    });

    it("should update orderLiveness to false in the Order after removeOrder", async () => {
      const InputVault = 10;
      const OutputVault = 20;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const txAddOrder = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: orderConfig } = (await getEventArgs(
        txAddOrder,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // Removing the order
      await orderBook.connect(signer1).removeOrder(orderConfig);

      const orderId = getOrderIdFromOrder(orderConfig);

      await waitForSubgraphToBeSynced();

      const query = `
        {
          order (id: "${orderId}") {
            orderLiveness
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.order;

      expect(data.orderLiveness).to.be.false;
    });

    it("should update orderLiveness to true in the Order after addOrder again", async () => {
      const InputVault = 10;
      const OutputVault = 20;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const txAddOrder = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: orderConfig } = (await getEventArgs(
        txAddOrder,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // Removing the order
      await orderBook.connect(signer1).removeOrder(orderConfig);

      // Add again the order
      await orderBook.connect(signer1).addOrder(askOrderConfig);

      const orderId = getOrderIdFromOrder(orderConfig);

      await waitForSubgraphToBeSynced();

      const query = `
        {
          order (id: "${orderId}") {
            orderLiveness
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.order;

      expect(data.orderLiveness).to.be.true;
    });

    it("should update the Order after a deposit", async () => {
      const InputVault = 1;
      const OutputVault = 2;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const txAddOrder = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      // DEPOSITS
      // Provide tokens to Signer1
      const amountB = ethers.BigNumber.from("1000" + eighteenZeros);
      await tokenB.transfer(signer1.address, amountB);

      const depositConfigOrder: DepositConfigStruct = {
        token: tokenB.address,
        vaultId: OutputVault,
        amount: amountB,
      };

      await tokenB
        .connect(signer1)
        .approve(orderBook.address, depositConfigOrder.amount);

      // Signer1 deposits tokenB into his output vault
      const txDepositOrder = await orderBook
        .connect(signer1)
        .deposit(depositConfigOrder);

      const { config: orderConfig } = (await getEventArgs(
        txAddOrder,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      const { config: depositConfig } = (await getEventArgs(
        txDepositOrder,
        "Deposit",
        orderBook
      )) as DepositEvent["args"];

      expect(orderConfig.outputToken).to.be.equals(depositConfig.token);
      expect(orderConfig.outputVaultId).to.be.equals(depositConfig.vaultId);

      await waitForSubgraphToBeSynced();

      const orderId = getOrderIdFromOrder(orderConfig);
      // {vaultId}-{owner}-{token}
      const outputTokenVault_Id = `${orderConfig.outputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.outputToken.toLowerCase()}`;

      const query = `
        {
          order (id: "${orderId}") {
            outputTokenVault {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.order;
      expect(data.outputTokenVault.id).to.be.equals(outputTokenVault_Id);
    });

    it("should update the Order after a clear", async () => {
      const signer1InputVault = ethers.BigNumber.from(1);
      const signer1OutputVault = ethers.BigNumber.from(2);
      const signer2InputVault = ethers.BigNumber.from(1);
      const signer2OutputVault = ethers.BigNumber.from(2);
      const bountyAccVaultA = ethers.BigNumber.from(1);
      const bountyAccVaultB = ethers.BigNumber.from(2);

      // ASK ORDER

      const askPrice = ethers.BigNumber.from("90" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: signer1InputVault,
        outputToken: tokenB.address,
        outputVaultId: signer1OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const txAskOrderLive = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: askConfig } = (await getEventArgs(
        txAskOrderLive,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // BID ORDER
      const bidOutputMax = Util.max_uint256;
      const bidPrice = Util.fixedPointDiv(Util.ONE, askPrice);
      const bidConstants = [bidOutputMax, bidPrice];
      const vBidOutputMax = op(OrderBookOpcode.CONSTANT, 0);
      const vBidPrice = op(OrderBookOpcode.CONSTANT, 1);
      // prettier-ignore
      const bidSource = concat([
        vBidOutputMax,
        vBidPrice,
      ]);
      const bidOrderConfig: OrderConfigStruct = {
        inputToken: tokenB.address,
        inputVaultId: signer2InputVault,
        outputToken: tokenA.address,
        outputVaultId: signer2OutputVault,
        tracking: 0x0,
        vmStateConfig: {
          sources: [bidSource],
          constants: bidConstants,
        },
      };

      const txBidOrderLive = await orderBook
        .connect(signer2)
        .addOrder(bidOrderConfig);

      const { config: bidConfig } = (await Util.getEventArgs(
        txBidOrderLive,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // DEPOSITS
      const amountB = ethers.BigNumber.from("1000" + Util.eighteenZeros);
      const amountA = ethers.BigNumber.from("1000" + Util.eighteenZeros);

      await tokenB.transfer(signer1.address, amountB);
      await tokenA.transfer(signer2.address, amountA);

      const depositConfigSigner1: DepositConfigStruct = {
        token: tokenB.address,
        vaultId: signer1OutputVault,
        amount: amountB,
      };
      const depositConfigSigner2: DepositConfigStruct = {
        token: tokenA.address,
        vaultId: signer2OutputVault,
        amount: amountA,
      };

      await tokenB
        .connect(signer1)
        .approve(orderBook.address, depositConfigSigner1.amount);
      await tokenA
        .connect(signer2)
        .approve(orderBook.address, depositConfigSigner2.amount);

      // Signer1 deposits tokenB into her output vault
      await orderBook.connect(signer1).deposit(depositConfigSigner1);
      // Signer2 deposits tokenA into his output vault
      await orderBook.connect(signer2).deposit(depositConfigSigner2);

      // BOUNTY BOT CLEARS THE ORDER
      const bountyConfig: BountyConfigStruct = {
        aVaultId: bountyAccVaultA,
        bVaultId: bountyAccVaultB,
      };

      await orderBook
        .connect(bountyAccount)
        .clear(askConfig, bidConfig, bountyConfig);

      await waitForSubgraphToBeSynced();

      const orderId = getOrderIdFromOrder(askConfig);
      // {vaultId}-{owner}-{token}
      const inputTokenVault_Id = `${askConfig.inputVaultId.toString()} - ${askConfig.owner.toLowerCase()} - ${askConfig.inputToken.toLowerCase()}`;
      const outputTokenVault_Id = `${askConfig.outputVaultId.toString()} - ${askConfig.owner.toLowerCase()} - ${askConfig.outputToken.toLowerCase()}`;

      const query = `
          {
            order (id: "${orderId}") {
              inputTokenVault {
                id
              }
              outputTokenVault {
                id
              }
            }
          }
        `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.order;
      expect(data.inputTokenVault.id).to.be.equals(inputTokenVault_Id);
      expect(data.outputTokenVault.id).to.be.equals(outputTokenVault_Id);
    });
  });

  describe("TokenVault entity", async () => {
    it("should query the TokenVault after addOrder", async () => {
      const InputVault = 1;
      const OutputVault = 2;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const transaction = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: orderConfig } = (await getEventArgs(
        transaction,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      const orderId = getOrderIdFromOrder(orderConfig);

      // #{vaultId}-{owner}-{token}
      const tokenVaultInput_ID = `${orderConfig.inputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.inputToken.toLowerCase()}`;
      const tokenVaultOutput_ID = `${orderConfig.outputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.outputToken.toLowerCase()}`;

      await waitForSubgraphToBeSynced();

      const query = `
        {
          tokenInput: tokenVault (id: "${tokenVaultInput_ID}") {
            owner
            vaultId
            balance
            token {
              id
            }
            orders {
              id
            }
            orderClears {
              id
            }
          }
          tokenOutput: tokenVault (id: "${tokenVaultOutput_ID}") {
            owner
            vaultId
            balance
            token {
              id
            }
            orders {
              id
            }
            orderClears {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const dataInput = response.data.tokenInput;
      const dataOutput = response.data.tokenOutput;

      // Input
      expect(dataInput.owner).to.be.equals(orderConfig.owner.toLowerCase());
      expect(dataInput.vaultId).to.be.equals(orderConfig.inputVaultId);
      expect(dataInput.balance).to.be.equals("0");

      expect(dataInput.token.id).to.be.equals(
        orderConfig.inputToken.toLowerCase()
      );
      expect(dataInput.orders).to.deep.include({ id: orderId });
      expect(dataInput.orderClears).to.be.empty;

      // Output
      expect(dataOutput.owner).to.be.equals(orderConfig.owner.toLowerCase());
      expect(dataOutput.vaultId).to.be.equals(orderConfig.outputVaultId);
      expect(dataOutput.balance).to.be.equals("0");

      expect(dataOutput.token.id).to.be.equals(
        orderConfig.outputToken.toLowerCase()
      );
      expect(dataOutput.orders).to.deep.include({ id: orderId });
      expect(dataOutput.orderClears).to.be.empty;
    });

    it("should update the TokenVault after a Deposit or Withdraw", async () => {
      const InputVault = 1;
      const OutputVault = 2;

      // ASK ORDER
      const askPrice = ethers.BigNumber.from("1" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: InputVault,
        outputToken: tokenB.address,
        outputVaultId: OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const transaction = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: orderConfig } = (await getEventArgs(
        transaction,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // DEPOSIT
      const amountB = ethers.BigNumber.from("1000" + Util.eighteenZeros);
      await tokenB.transfer(signer1.address, amountB);
      const depositConfig: DepositConfigStruct = {
        token: tokenB.address,
        vaultId: OutputVault,
        amount: amountB,
      };

      await tokenB
        .connect(signer1)
        .approve(orderBook.address, depositConfig.amount);

      // Signer1 deposits tokenB into his output vault
      const txDeposit = await orderBook.connect(signer1).deposit(depositConfig);

      const { config: depositConfigEmitted } = (await Util.getEventArgs(
        txDeposit,
        "Deposit",
        orderBook
      )) as DepositEvent["args"];

      expect(depositConfigEmitted.amount).to.be.equals(depositConfig.amount);

      const tokenVaultOutput_ID = `${orderConfig.outputVaultId.toString()} - ${orderConfig.owner.toLowerCase()} - ${orderConfig.outputToken.toLowerCase()}`;
      const balanceExpected = depositConfigEmitted.amount;

      await waitForSubgraphToBeSynced();

      // Make the order with a fixed ID
      const query = `
        {
          tokenVault (id: "${tokenVaultOutput_ID}") {
            balance
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.tokenVault;

      expect(data.balance).to.be.equals(balanceExpected);

      // WITHDRAW
      const amountBToWithdraw = amountB.div(2);
      const withdrawConfig: WithdrawConfigStruct = {
        token: tokenB.address,
        vaultId: OutputVault,
        amount: amountBToWithdraw,
      };
      const txWithdraw = await orderBook
        .connect(signer1)
        .withdraw(withdrawConfig);

      const { amount: amountWithdrawn } = (await Util.getEventArgs(
        txWithdraw,
        "Withdraw",
        orderBook
      )) as WithdrawEvent["args"];

      await waitForSubgraphToBeSynced();

      const balanceAfterWithdrawExpected = balanceExpected.sub(amountWithdrawn);

      // Using the same query to check the balance
      const responseAfterWithdraw = (await subgraph({
        query,
      })) as FetchResult;
      const data2 = responseAfterWithdraw.data.tokenVault;

      expect(data2.balance).to.be.equals(balanceAfterWithdrawExpected);
    });

    it("should update the TokenVault after a clear", async () => {
      // Vaults balance will changes after a deposit, withdraw or clear
      let signer1InputVaultBalance = ethers.constants.Zero;
      let signer1OutputVaultBalance = ethers.constants.Zero;
      let signer2InputVaultBalance = ethers.constants.Zero;
      let signer2OutputVaultBalance = ethers.constants.Zero;

      const signer1InputVault = ethers.BigNumber.from(1);
      const signer1OutputVault = ethers.BigNumber.from(2);
      const signer2InputVault = ethers.BigNumber.from(1);
      const signer2OutputVault = ethers.BigNumber.from(2);
      const bountyAccVaultA = ethers.BigNumber.from(1);
      const bountyAccVaultB = ethers.BigNumber.from(2);

      // ASK ORDE
      const askPrice = ethers.BigNumber.from("90" + eighteenZeros);
      const askBlock = await ethers.provider.getBlockNumber();
      const askConstants = [askPrice, askBlock, 5];
      const vAskPrice = op(OrderBookOpcode.CONSTANT, 0);
      const vAskBlock = op(OrderBookOpcode.CONSTANT, 1);
      const v5 = op(OrderBookOpcode.CONSTANT, 2);
      // prettier-ignore
      const askSource = concat([
        // outputMax = (currentBlock - askBlock) * 5 - aliceCleared
        // 5 tokens available per block
              op(OrderBookOpcode.BLOCK_NUMBER),
              vAskBlock,
            op(OrderBookOpcode.SUB, 2),
            v5,
          op(OrderBookOpcode.MUL, 2),
            cOrderHash,
          op(OrderBookOpcode.ORDER_FUNDS_CLEARED),
        op(OrderBookOpcode.SUB, 2),
        vAskPrice,
      ]);

      const askOrderConfig: OrderConfigStruct = {
        inputToken: tokenA.address,
        inputVaultId: signer1InputVault,
        outputToken: tokenB.address,
        outputVaultId: signer1OutputVault,
        tracking: TRACK_CLEARED_ORDER,
        vmStateConfig: {
          sources: [askSource],
          constants: askConstants,
        },
      };

      const txAskOrderLive = await orderBook
        .connect(signer1)
        .addOrder(askOrderConfig);

      const { config: askConfig } = (await getEventArgs(
        txAskOrderLive,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // BID ORDER
      const bidOutputMax = Util.max_uint256;
      const bidPrice = Util.fixedPointDiv(Util.ONE, askPrice);
      const bidConstants = [bidOutputMax, bidPrice];
      const vBidOutputMax = op(OrderBookOpcode.CONSTANT, 0);
      const vBidPrice = op(OrderBookOpcode.CONSTANT, 1);
      // prettier-ignore
      const bidSource = concat([
        vBidOutputMax,
        vBidPrice,
      ]);
      const bidOrderConfig: OrderConfigStruct = {
        inputToken: tokenB.address,
        inputVaultId: signer2InputVault,
        outputToken: tokenA.address,
        outputVaultId: signer2OutputVault,
        tracking: 0x0,
        vmStateConfig: {
          sources: [bidSource],
          constants: bidConstants,
        },
      };

      const txBidOrderLive = await orderBook
        .connect(signer2)
        .addOrder(bidOrderConfig);

      const { config: bidConfig } = (await Util.getEventArgs(
        txBidOrderLive,
        "OrderLive",
        orderBook
      )) as OrderLiveEvent["args"];

      // DEPOSITS
      const amountB = ethers.BigNumber.from("1000" + Util.eighteenZeros);
      const amountA = ethers.BigNumber.from("1000" + Util.eighteenZeros);

      await tokenB.transfer(signer1.address, amountB);
      await tokenA.transfer(signer2.address, amountA);

      const depositConfigSigner1: DepositConfigStruct = {
        token: tokenB.address,
        vaultId: signer1OutputVault,
        amount: amountB,
      };
      const depositConfigSigner2: DepositConfigStruct = {
        token: tokenA.address,
        vaultId: signer2OutputVault,
        amount: amountA,
      };

      await tokenB
        .connect(signer1)
        .approve(orderBook.address, depositConfigSigner1.amount);
      await tokenA
        .connect(signer2)
        .approve(orderBook.address, depositConfigSigner2.amount);

      // Signer1 deposits tokenB into her output vault
      await orderBook.connect(signer1).deposit(depositConfigSigner1);
      // Signer2 deposits tokenA into his output vault
      await orderBook.connect(signer2).deposit(depositConfigSigner2);

      // Update the balances in VaultTokens after deposit
      signer1OutputVaultBalance = signer1OutputVaultBalance.add(
        depositConfigSigner1.amount
      );
      signer2OutputVaultBalance = signer2OutputVaultBalance.add(
        depositConfigSigner2.amount
      );

      // BOUNTY BOT CLEARS THE ORDER
      const bountyConfigToSend: BountyConfigStruct = {
        aVaultId: bountyAccVaultA,
        bVaultId: bountyAccVaultB,
      };

      const txClear = await orderBook
        .connect(bountyAccount)
        .clear(askConfig, bidConfig, bountyConfigToSend);

      const clearValues = (await Util.getEventArgs(
        txClear,
        "Clear",
        orderBook
      )) as ClearEvent["args"];

      const afterClearValues = (await Util.getEventArgs(
        txClear,
        "AfterClear",
        orderBook
      )) as AfterClearEvent["args"];

      // Update the balances in VaultTokens after Clear - Inputs increase, outputs decrease
      signer1InputVaultBalance = signer1InputVaultBalance.add(
        afterClearValues.stateChange.aInput
      );
      signer1OutputVaultBalance = signer1OutputVaultBalance.sub(
        afterClearValues.stateChange.aOutput
      );
      signer2InputVaultBalance = signer2InputVaultBalance.add(
        afterClearValues.stateChange.bInput
      );
      signer2OutputVaultBalance = signer2OutputVaultBalance.sub(
        afterClearValues.stateChange.bOutput
      );

      // ASK ORDER IDs
      const askTokenVaultInput_ID = `${askConfig.inputVaultId.toString()} - ${askConfig.owner.toLowerCase()} - ${askConfig.inputToken.toLowerCase()}`;
      const askTokenVaultOutput_ID = `${askConfig.outputVaultId.toString()} - ${askConfig.owner.toLowerCase()} - ${askConfig.outputToken.toLowerCase()}`;
      // BID ORDER IDs
      const bidTokenVaultInput_ID = `${bidConfig.inputVaultId.toString()} - ${bidConfig.owner.toLowerCase()} - ${bidConfig.inputToken.toLowerCase()}`;
      const bidTokenVaultOutput_ID = `${bidConfig.outputVaultId.toString()} - ${bidConfig.owner.toLowerCase()} - ${bidConfig.outputToken.toLowerCase()}`;

      const askOrder_ID = getOrderIdFromOrder(askConfig);
      const bidOrder_ID = getOrderIdFromOrder(bidConfig);
      // const orderClear_ID = getOrderClearId(
      //   afterClearValues,
      //   clearValues,
      //   txClear.hash
      // );

      const orderClearBlock = await ethers.provider.getBlock(
        txClear.blockNumber
      );

      const orderClear_ID = orderClearBlock.timestamp;

      await waitForSubgraphToBeSynced();

      const query = `
        {
          askTokenInput: tokenVault (id: "${askTokenVaultInput_ID}") {
            balance
            orders {
              id
            }
            orderClears {
              id
            }
          }
          askTokenOutput: tokenVault (id: "${askTokenVaultOutput_ID}") {
            balance
            orders {
              id
            }
            orderClears {
              id
            }
          }

          bidTokenInput: tokenVault (id: "${bidTokenVaultInput_ID}") {
            balance
            orders {
              id
            }
            orderClears {
              id
            }
          }
          bidTokenOutput: tokenVault (id: "${bidTokenVaultOutput_ID}") {
            balance
            orders {
              id
            }
            orderClears {
              id
            }
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const dataAskTokenInput = response.data.askTokenInput;
      const dataAskTokenOutput = response.data.askTokenOutput;
      const dataBidTokenInput = response.data.bidTokenInput;
      const dataBidTokenOutput = response.data.bidTokenOutput;

      // Ask Order related values
      expect(dataAskTokenInput.balance).to.be.equals(signer1InputVaultBalance);
      expect(dataAskTokenInput.orders).to.deep.include({ id: askOrder_ID });
      expect(dataAskTokenInput.orderClears).to.deep.include({
        id: orderClear_ID.toString(),
      });
      expect(dataAskTokenOutput.balance).to.be.equals(
        signer1OutputVaultBalance
      );
      expect(dataAskTokenOutput.orders).to.deep.include({ id: askOrder_ID });
      expect(dataAskTokenOutput.orderClears).to.deep.include({
        id: orderClear_ID.toString(),
      });

      // Bid Order related values
      expect(dataBidTokenInput.balance).to.be.equals(signer2InputVaultBalance);
      expect(dataBidTokenInput.orders).to.deep.include({ id: bidOrder_ID });
      expect(dataBidTokenInput.orderClears).to.deep.include({
        id: orderClear_ID.toString(),
      });
      expect(dataBidTokenOutput.balance).to.be.equals(
        signer2OutputVaultBalance
      );
      expect(dataBidTokenOutput.orders).to.deep.include({ id: bidOrder_ID });
      expect(dataBidTokenOutput.orderClears).to.deep.include({
        id: orderClear_ID.toString(),
      });
    });
  });
});
