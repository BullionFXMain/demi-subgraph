import { expect } from "chai";
import { ethers } from "hardhat";
import { FetchResult } from "apollo-fetch";
import * as Util from "./utils/utils";
import { concat } from "ethers/lib/utils";

import {
  getEventArgs,
  waitForSubgraphToBeSynced,
  Tier,
  SaleStatus,
  AllStandardOps,
  op,
} from "./utils/utils";

// Typechain Factories
import { ReserveTokenTest__factory } from "../typechain/factories/ReserveTokenTest__factory";
import { RedeemableERC20__factory } from "../typechain/factories/RedeemableERC20__factory";

// Types
import type { ReserveTokenTest } from "../typechain/ReserveTokenTest";
import type { CombineTier } from "../typechain/CombineTier";
import type {
  Sale,
  BuyConfigStruct as BuyConfig,
  StateConfigStruct,
  SaleConfigStruct,
  SaleRedeemableERC20ConfigStruct,
} from "../typechain/Sale";
import type { RedeemableERC20 } from "../typechain/RedeemableERC20";

import type {
  DepositEvent,
  PendingDepositEvent,
  UndepositEvent,
  WithdrawEvent,
} from "../typechain/RedeemableERC20ClaimEscrow";

import {
  // Subgraph
  subgraph,
  // Signers
  deployer,
  creator,
  signer1,
  signer2,
  recipient,
  feeRecipient,
  // Factories
  saleFactory,
  redeemableERC20Factory,
  redeemableERC20ClaimEscrow as escrow,
  combineTierFactory,
  noticeBoard,
} from "./1_initQueries.test";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractTransaction, Signer } from "ethers";

let claimableReserve: ReserveTokenTest,
  sale: Sale,
  tier: CombineTier,
  redeemableERC20: RedeemableERC20;

let escrowAddress: string,
  claimableReserveAddress: string,
  saleAddress: string,
  redeemableAddress: string,
  signer1Address: string,
  signer2Address: string;

// TODO: Remove old test after finish this

/**
 * Deploy a sale with prederminated values and setup to the env to avoid code repetition
 *
 * @param tokenReceivers - Signer or signers to receive and approve token saleReserve
 */
const deploySale = async (
  tokenReceivers: SignerWithAddress[] | SignerWithAddress
): Promise<{
  sale: Sale;
  redeemableERC20: RedeemableERC20;
}> => {
  const saleReserve = await new ReserveTokenTest__factory(deployer).deploy();

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

  const sale = await Util.saleDeploy(
    saleFactory,
    creator,
    saleConfig,
    saleRedeemableConfig
  );

  const redeemableERC20 = new RedeemableERC20__factory(deployer).attach(
    await Util.getChild(redeemableERC20Factory, sale.deployTransaction)
  );

  // Save new addresses
  saleAddress = sale.address.toLowerCase();
  redeemableAddress = redeemableERC20.address.toLowerCase();

  if (Array.isArray(tokenReceivers)) {
    // Split and send tokens to all signers and approve to the sale
    const amount = (await saleReserve.totalSupply()).div(tokenReceivers.length);
    for (let i = 0; i < tokenReceivers.length; i++) {
      await saleReserve.transfer(tokenReceivers[i].address, amount);
      await saleReserve
        .connect(tokenReceivers[i])
        .approve(sale.address, amount);
    }
  } else {
    // Sending all to a single signer
    const amount = await saleReserve.totalSupply();
    await saleReserve.transfer(tokenReceivers.address, amount);
    await saleReserve.connect(tokenReceivers).approve(sale.address, amount);
  }

  return { sale, redeemableERC20 };
};

/**
 * Pass a already started sale and finish it
 */
const finishSale = async (_sale: Sale): Promise<void> => {
  if ((await _sale.saleStatus()) === SaleStatus.ACTIVE) {
    while (!(await _sale.canLive())) {
      await Util.createEmptyBlock();
    }
    await _sale.end();
  }
};

/**
 * Make a buy with in `_sale`
 * @param _sale - the sale used to buy
 * @param buyer - the signer that will buy
 * @param buyConfig - (optional) An buy configuration. If not provided, will buy with a predeterminated config
 */
const buySale = async (
  _sale: Sale,
  buyer: Signer,
  buyConfig: BuyConfig = null
): Promise<ContractTransaction> => {
  if (!buyConfig) {
    const desiredUnits = 100;
    const fee = 10;
    buyConfig = {
      feeRecipient: feeRecipient.address,
      fee: fee,
      minimumUnits: desiredUnits,
      desiredUnits: desiredUnits,
      maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
    };
  }

  return await _sale.connect(buyer).buy(buyConfig);
};

describe("Subgraph RedeemableERC20ClaimEscrow test", function () {
  before("deploy general contracts", async function () {
    // Deploying tokens
    claimableReserve = await new ReserveTokenTest__factory(deployer).deploy();

    // Deploying an always tier
    tier = await Util.deployAlwaysTier(combineTierFactory, creator);

    // Providing to signers a lot of tokens to avoid sending everytime
    const amount = (await claimableReserve.totalSupply()).div(2);
    await claimableReserve.transfer(signer1.address, amount);
    await claimableReserve.transfer(signer2.address, amount);

    // Approve the escrow to use the respective all tokens from signers
    await claimableReserve.connect(signer1).approve(escrow.address, amount);
    await claimableReserve.connect(signer2).approve(escrow.address, amount);

    // Save to reduce long lines
    claimableReserveAddress = claimableReserve.address.toLowerCase();
    escrowAddress = escrow.address.toLowerCase();
    signer1Address = signer1.address.toLowerCase();
    signer2Address = signer2.address.toLowerCase();
  });

  describe("RedeemableERC20ClaimEscrow entity", function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale(signer1));
    });

    it("should update RedeemableERC20ClaimEscrow after a PendingDeposit", async function () {
      const tx = await escrow
        .connect(signer1)
        .depositPending(sale.address, claimableReserve.address, 1000);

      await waitForSubgraphToBeSynced();

      // IDs
      const pendingDepositId = tx.hash.toLowerCase();
      const pendingDepositorTokenId = `${saleAddress} - ${escrowAddress} - ${signer1Address} - ${claimableReserveAddress}`;
      const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;

      const query = `
        {
          redeemableERC20ClaimEscrow (id: "${escrowAddress}") {
            pendingDeposits {
              id
            }
            pendingDepositorTokens {
              id
            }
            depositors {
              id
            }
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableERC20ClaimEscrow;

      expect(data.pendingDeposits).to.deep.include(
        { id: pendingDepositId },
        `pendingDeposits response does not include ID "${pendingDepositId}"`
      );

      expect(data.pendingDepositorTokens).to.deep.include(
        { id: pendingDepositorTokenId },
        `pendingDepositorTokens response does not include ID "${pendingDepositorTokenId}"`
      );

      expect(data.depositors).to.deep.include(
        { id: escrowDepositorId },
        `depositors response does not include ID "${escrowDepositorId}"`
      );
    });

    it("should update RedeemableERC20ClaimEscrow after a Deposit", async function () {
      // Start sale
      await sale.start();

      // Make a buy to have Redeemable
      await buySale(sale, signer1);

      // Finish the sale
      await finishSale(sale);

      // Make deposit
      const tx = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const { supply } = (await getEventArgs(
        tx,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowDeposit = tx.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress}`;
      const escrowSupplyTokenDepositorId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;

      const query = `
        {
          redeemableERC20ClaimEscrow (id: "${escrowAddress}") {
            deposits {
              id
            }
            depositors {
              id
            }
            supplyTokenDeposits {
              id
            }
            supplyTokenDepositors {
              id
            }
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableERC20ClaimEscrow;

      expect(data.deposits).to.deep.include({ id: escrowDeposit });
      expect(data.depositors).to.deep.include({ id: escrowDepositorId });

      expect(data.supplyTokenDeposits).to.deep.include({
        id: escrowSupplyTokenDepositId,
      });
      expect(data.supplyTokenDepositors).to.deep.include({
        id: escrowSupplyTokenDepositorId,
      });
    });

    it("should update RedeemableERC20ClaimEscrow after a Undeposit", async function () {
      // Start sale
      await sale.start();

      // Make a buy of all Redeemable

      await buySale(sale, signer1);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.FAIL);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 1000);

      const { supply, amount } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txUndeposit = await escrow
        .connect(signer1)
        .undeposit(saleAddress, claimableReserveAddress, supply, amount);

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowUndepositId = txUndeposit.hash.toLowerCase();

      const query = `
          {
            redeemableERC20ClaimEscrow (id: "${escrowAddress}") {
              undeposits {
                id
              }
            }
          }
        `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableERC20ClaimEscrow;

      expect(data.undeposits).to.deep.include({ id: escrowUndepositId });
    });

    it("should update RedeemableERC20ClaimEscrow after a Withdraw", async function () {
      // Start sale
      await sale.start();

      // Make a buy of all Redeemable
      const desiredUnits = await redeemableERC20.totalSupply();
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      await buySale(sale, signer1, buyConfig);

      // Finish the sale as Succes since reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 1000);

      const { supply } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txWithdraw = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply);

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowWithdrawId = txWithdraw.hash.toLowerCase();
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;
      const escrowWithdrawerId = `${escrowAddress} - ${signer1Address}`;

      const query = `
          {
            redeemableERC20ClaimEscrow (id: "${escrowAddress}") {
              withdraws {
                id
              }
              supplyTokenWithdrawers {
                id
              }
              withdrawers {
                id
              }
            }
          }
        `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableERC20ClaimEscrow;

      expect(data.withdraws).to.deep.include({ id: escrowWithdrawId });
      expect(data.withdrawers).to.deep.include({ id: escrowWithdrawerId });
      expect(data.supplyTokenWithdrawers).to.deep.include({
        id: escrowSupplyTokenWithdrawerId,
      });
    });

    it("should update RedeemableERC20ClaimEscrow after a Notice", async function () {
      const dataToSend = "0x01";
      const notices = [
        {
          subject: escrow.address,
          data: dataToSend,
        },
      ];

      const tx = await noticeBoard.connect(signer2).createNotices(notices);

      const noticeId = `${escrowAddress} - ${tx.hash.toLowerCase()} - 0`;
      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableERC20ClaimEscrow (id: "${escrowAddress}") {
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

      const queryResponse = (await subgraph({
        query,
      })) as FetchResult;
      const dataEscrow = queryResponse.data.redeemableERC20ClaimEscrow.notices;
      const dataNotice = queryResponse.data.notice;

      expect(dataEscrow).deep.include({ id: noticeId });

      expect(dataNotice.sender).to.equals(signer2Address);
      expect(dataNotice.subject.id).to.equals(escrowAddress);
      expect(dataNotice.data).to.equals(dataToSend);
    });
  });

  describe("RedeemableEscrowDepositor entity", function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale } = await deploySale(signer2));
    });

    it("should update RedeemableEscrowDepositor after a PendingDeposit", async function () {
      const tx = await escrow
        .connect(signer2)
        .depositPending(sale.address, claimableReserve.address, 1000);

      await waitForSubgraphToBeSynced();

      // IDs
      const pendingDepositId = tx.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer2Address}`;
      const pendingDepositorTokenId = `${saleAddress} - ${escrowAddress} - ${signer2Address} - ${claimableReserveAddress}`;

      const query = `
          {
            redeemableEscrowDepositor (id: "${escrowDepositorId}") {
              address
              pendingDepositorTokens {
                id
              }
              pendingDeposits {
                id
              }
            }
          }
        `;

      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowDepositor;

      expect(data.address).to.be.equals(signer2Address);
      expect(data.pendingDeposits).to.deep.include({ id: pendingDepositId });
      expect(data.pendingDepositorTokens).to.deep.include({
        id: pendingDepositorTokenId,
      });
    });

    it("should update RedeemableEscrowDepositor after a Deposit", async function () {
      // Start sale
      await sale.start();

      // Make a buy to have Redeemable
      await buySale(sale, signer2);

      // Finish the sale
      await finishSale(sale);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 1000);

      const { supply } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowDeposit = txDeposit.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer2Address}`;
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress}`;

      const query = `
        {
          redeemableEscrowDepositor (id: "${escrowDepositorId}") {
            supplyTokenDeposits {
              id
            }
            deposits {
              id
            }
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowDepositor;

      expect(data.deposits).to.deep.include({ id: escrowDeposit });
      expect(data.supplyTokenDeposits).to.deep.include({
        id: escrowSupplyTokenDepositId,
      });
    });

    it("should update RedeemableEscrowDepositor after a Undeposit", async function () {
      // Start sale
      await sale.start();

      // Make a buy of all Redeemable

      await buySale(sale, signer2);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.FAIL);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer2)
        .deposit(saleAddress, claimableReserveAddress, 1000);

      const { supply, amount } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txUndeposit = await escrow
        .connect(signer2)
        .undeposit(saleAddress, claimableReserveAddress, supply, amount);

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowUndepositId = txUndeposit.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer2Address}`;

      const query = `
          {
            redeemableEscrowDepositor (id: "${escrowDepositorId}") {
              undeposits {
                id
              }
            }
          }
        `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowDepositor;

      expect(data.undeposits).to.deep.include({ id: escrowUndepositId });
    });
  });

  describe("RedeemableEscrowPendingDepositorToken entity", function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale(signer1));
    });

    it("should query RedeemableEscrowPendingDepositorToken after PendingDeposits correctly", async function () {
      // Make two depositPending
      const txDepositPending1 = await escrow
        .connect(signer1)
        .depositPending(sale.address, claimableReserve.address, 1000);

      const txDepositPending2 = await escrow
        .connect(signer1)
        .depositPending(sale.address, claimableReserve.address, 2500);

      const { amount: amount1 } = (await getEventArgs(
        txDepositPending1,
        "PendingDeposit",
        escrow
      )) as PendingDepositEvent["args"];

      const { amount: amount2 } = (await getEventArgs(
        txDepositPending2,
        "PendingDeposit",
        escrow
      )) as PendingDepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // queries
      const totalDepositedExpected = amount1.add(amount2);
      const pendingDepositId_1 = txDepositPending1.hash.toLowerCase();
      const pendingDepositId_2 = txDepositPending2.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;
      const pendingDepositorTokenId = `${saleAddress} - ${escrowAddress} - ${signer1Address} - ${claimableReserveAddress}`;

      const query = `
        {
          redeemableEscrowPendingDepositorToken (id: "${pendingDepositorTokenId}") {
            iSale {
              saleStatus
            }
            iSaleAddress
            escrow {
              id
            }
            escrowAddress
            depositor {
              id
            }
            depositorAddress
            pendingDeposits {
              id
            }
            token {
              id
            }
            tokenAddress
            totalDeposited
            swept
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowPendingDepositorToken;

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.depositor.id).to.be.equals(escrowDepositorId);
      expect(data.depositorAddress).to.be.equals(signer1Address);

      expect(data.pendingDeposits).to.deep.include({ id: pendingDepositId_1 });
      expect(data.pendingDeposits).to.deep.include({ id: pendingDepositId_2 });

      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);

      expect(data.totalDeposited).to.be.equals(totalDepositedExpected);
      expect(data.swept, `no sweep pending was made`).to.be.false;
    });

    it("should update RedeemableEscrowPendingDepositorToken after a SweepPending", async function () {
      const txDepositPending = await escrow
        .connect(signer1)
        .depositPending(sale.address, claimableReserve.address, 1000);

      const { amount } = (await getEventArgs(
        txDepositPending,
        "PendingDeposit",
        escrow
      )) as PendingDepositEvent["args"];

      await sale.start();

      // Make a buy to have zero redeemable supply
      await buySale(sale, signer1);

      // Finishing the sale
      await finishSale(sale);

      // Call sweepPending
      await escrow
        .connect(signer1)
        .sweepPending(saleAddress, claimableReserveAddress, signer1Address);

      await waitForSubgraphToBeSynced();

      // IDs
      const pendingDepositorTokenId = `${saleAddress} - ${escrowAddress} - ${signer1Address} - ${claimableReserveAddress}`;

      const query = `
        {
          redeemableEscrowPendingDepositorToken (id: "${pendingDepositorTokenId}") {
            iSale {
              saleStatus
            }
            totalDeposited
            swept
          }
        }
      `;

      const response = (await subgraph({
        query,
      })) as FetchResult;

      const data = response.data.redeemableEscrowPendingDepositorToken;

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.totalDeposited).to.be.equals(amount);
      expect(data.swept, `swap pending was already called`).to.be.true;
    });
  });

  describe("RedeemableEscrowPendingDeposit entity", function () {
    it("should query RedeemableEscrowPendingDeposit after a PendingDeposit", async function () {
      // This will have a fresh sale, redeemable and saleReserve
      ({ sale } = await deploySale(signer1));

      const txDepositPending = await escrow
        .connect(signer1)
        .depositPending(sale.address, claimableReserve.address, 1000);

      const { amount } = (await getEventArgs(
        txDepositPending,
        "PendingDeposit",
        escrow
      )) as PendingDepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const pendingDepositId = txDepositPending.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;

      const query = `
        {
          redeemableEscrowPendingDeposit (id: "${pendingDepositId}") {
            depositor {
              id
            }
            depositorAddress
            escrow {
              id
            }
            escrowAddress
            iSale {
              saleStatus
            }
            iSaleAddress
            redeemable {
              id
            }
            token {
              id
            }
            tokenAddress
            amount
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowPendingDeposit;

      expect(data.depositor.id).to.be.equals(escrowDepositorId);
      expect(data.depositorAddress).to.be.equals(signer1Address);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.redeemable.id).to.be.equals(redeemableAddress);
      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);
      expect(data.amount).to.be.equals(amount);

      expect(data.iSaleAddress).to.be.equals(saleAddress);
      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
    });
  });

  describe("RedeemableEscrowDeposit entity", function () {
    it("should query RedeemableEscrowDeposit after a Deposit", async function () {
      // This will have a fresh sale, redeemable and saleReserve
      ({ sale } = await deploySale(signer1));

      await sale.start();

      // Make a buy to have Redeemable
      await buySale(sale, signer1);

      // Finish the sale
      await finishSale(sale);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const { amount, supply } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowDeposit = txDeposit.hash.toLowerCase();
      const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;

      const query = `
        {
          redeemableEscrowDeposit (id: "${escrowDeposit}") {
            depositor {
              id
            }
            depositorAddress
            escrow {
              id
            }
            escrowAddress
            iSale {
              saleStatus
            }
            iSaleAddress
            token {
              id
            }
            tokenAddress
            tokenAmount
            redeemable {
              id
            }
            redeemableSupply
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowDeposit;

      expect(data.depositor.id).to.be.equals(escrowDepositorId);
      expect(data.depositorAddress).to.be.equals(signer1Address);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.iSaleAddress).to.be.equals(saleAddress);
      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());

      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);
      expect(data.tokenAmount).to.be.equals(amount);

      expect(data.redeemable.id).to.be.equals(redeemableAddress);
      expect(data.redeemableSupply).to.be.equals(supply);
    });
  });

  describe("RedeemableEscrowUndeposit entity", function () {
    it("should query RedeemableEscrowUndeposit after a Undeposit", async function () {
      // This will have a fresh sale, redeemable and saleReserve
      ({ sale } = await deploySale(signer1));

      // Start sale
      await sale.start();

      // Make a buy
      await buySale(sale, signer1);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.FAIL);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 1000);

      const { supply, amount } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txUndeposit = await escrow
        .connect(signer1)
        .undeposit(saleAddress, claimableReserveAddress, supply, amount);

      const { supply: undepositSupply, amount: undepositAmount } =
        (await getEventArgs(
          txUndeposit,
          "Undeposit",
          escrow
        )) as UndepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowUndepositId = txUndeposit.hash.toLowerCase();

      const query = `
        {
          redeemableEscrowUndeposit (id: "${escrowUndepositId}") {
            sender
            escrow {
              id
            }
            escrowAddress
            iSale {
              saleStatus
            }
            iSaleAddress
            token {
              id
            }
            tokenAddress
            redeemableSupply
            tokenAmount
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowUndeposit;

      expect(data.sender).to.be.equals(signer1Address);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);

      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);

      expect(data.tokenAmount).to.be.equals(undepositAmount);
      expect(data.redeemableSupply).to.be.equals(undepositSupply);
    });
  });

  describe("RedeemableEscrowWithdraw entity", function () {
    it("should query RedeemableEscrowWithdraw after a Withdraw", async function () {
      // This will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale(signer1));

      // Start sale
      await sale.start();

      // Make a buy of all Redeemable
      const desiredUnits = await redeemableERC20.totalSupply();
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      await buySale(sale, signer1, buyConfig);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 1000);

      const { supply } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txWithdraw = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply);

      const { supply: withdrawSupply, amount: withdrawAmount } =
        (await getEventArgs(
          txWithdraw,
          "Withdraw",
          escrow
        )) as WithdrawEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowWithdrawId = txWithdraw.hash.toLowerCase();

      const query = `
          {
            redeemableEscrowWithdraw (id: "${escrowWithdrawId}") {
              withdrawer
              escrow {
                id
              }
              escrowAddress
              iSale {
                saleStatus
              }
              iSaleAddress
              redeemable {
                id
              }
              token {
                id
              }
              tokenAddress
              redeemableSupply
              tokenAmount
            }
          }
        `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowWithdraw;

      expect(data.withdrawer).to.be.equals(signer1Address);
      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);

      expect(data.redeemable.id).to.be.equals(redeemableAddress);
      expect(data.token.id).to.be.equals(claimableReserveAddress);

      expect(data.redeemableSupply).to.be.equals(withdrawSupply);
      expect(data.tokenAmount).to.be.equals(withdrawAmount);
    });
  });

  describe("RedeemableEscrowSupplyTokenDeposit entity", async function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale([signer1, signer2]));

      // Start sale
      await sale.start();
    });

    it("should query the RedeemableEscrowSupplyTokenDeposit after a single Deposit", async function () {
      // Make a buy to have Redeemable
      await buySale(sale, signer1);

      // Finish the sale
      await finishSale(sale);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const { supply, amount: amountDeposited } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const depositId = txDeposit.hash.toLowerCase();
      const depositorId = `${escrowAddress} - ${signer1Address}`;
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress}`;
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;

      // Since any withdraw or undeposit was made, remaining is the same that total
      const remainingExpected = amountDeposited;

      const query = `
        {
          redeemableEscrowSupplyTokenDeposit (id: "${escrowSupplyTokenDepositId}") {
            iSale {
              saleStatus
            }
            iSaleAddress
            escrow {
              id
            }
            escrowAddress
            deposits {
              id
            }
            depositors {
              id
            }
            depositorAddress
            withdraws {
              id
            }
            token {
              id
            }
            tokenAddress
            redeemableSupply
            totalDeposited
            totalRemaining
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDeposit;

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.deposits).to.deep.include({ id: depositId });
      expect(data.depositors).to.deep.include({ id: depositorId });
      expect(data.depositorAddress).to.deep.include(signer1Address);

      expect(data.withdraws).to.deep.include({
        id: escrowSupplyTokenWithdrawerId,
      });

      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);
      expect(data.redeemableSupply).to.be.equals(supply);

      expect(data.totalDeposited).to.be.equals(amountDeposited);
      expect(data.totalRemaining).to.be.equals(remainingExpected);
    });

    it("should update the RedeemableEscrowSupplyTokenDeposit after a multiple Deposits", async function () {
      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1);
      await buySale(sale, signer2);

      // Finish the sale
      await finishSale(sale);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2000);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // IDs
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress}`;
      const depositId_1 = txDeposit1.hash.toLowerCase();
      const depositId_2 = txDeposit2.hash.toLowerCase();
      const depositorId_1 = `${escrowAddress} - ${signer1Address}`;
      const depositorId_2 = `${escrowAddress} - ${signer2Address}`;
      const totalDeposited = amountDeposited1.add(amountDeposited2);
      const totalRemaining = totalDeposited;

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableEscrowSupplyTokenDeposit (id: "${escrowSupplyTokenDepositId}") {
            deposits {
              id
            }
            depositors {
              id
            }
            depositorAddress
            redeemableSupply
            totalDeposited
            totalRemaining
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDeposit;

      expect(data.deposits).to.deep.include({ id: depositId_1 });
      expect(data.deposits).to.deep.include({ id: depositId_2 });

      expect(data.depositors).to.deep.include({ id: depositorId_1 });
      expect(data.depositors).to.deep.include({ id: depositorId_2 });

      expect(data.depositorAddress).to.deep.include(signer1Address);
      expect(data.depositorAddress).to.deep.include(signer2Address);

      expect(data.redeemableSupply).to.be.equals(supply1);
      expect(data.totalDeposited).to.be.equals(totalDeposited);
      expect(data.totalRemaining).to.be.equals(totalRemaining);
    });

    it("should update the RedeemableEscrowSupplyTokenDeposit after Undeposits", async function () {
      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1);
      await buySale(sale, signer2);

      // Finish the sale
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.FAIL);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2500);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // Make undeposits with half of amounts deposited
      const txUndeposit1 = await escrow
        .connect(signer1)
        .undeposit(
          saleAddress,
          claimableReserveAddress,
          supply1,
          amountDeposited1.div(2)
        );

      const txUndeposit2 = await escrow
        .connect(signer2)
        .undeposit(
          saleAddress,
          claimableReserveAddress,
          supply1,
          amountDeposited2.div(2)
        );

      const { amount: undepositAmount1 } = (await getEventArgs(
        txUndeposit1,
        "Undeposit",
        escrow
      )) as UndepositEvent["args"];

      const { amount: undepositAmount2 } = (await getEventArgs(
        txUndeposit2,
        "Undeposit",
        escrow
      )) as UndepositEvent["args"];

      // IDs
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress}`;
      const totalDeposited = amountDeposited1.add(amountDeposited2);
      const totalRemaining = totalDeposited.sub(
        undepositAmount1.add(undepositAmount2)
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableEscrowSupplyTokenDeposit (id: "${escrowSupplyTokenDepositId}") {
            totalDeposited
            totalRemaining
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDeposit;

      expect(data.totalDeposited).to.be.equals(totalDeposited);
      expect(data.totalRemaining).to.be.equals(totalRemaining);
    });

    it("should update the RedeemableEscrowSupplyTokenDeposit after Withdraws", async function () {
      // Buy all between 2 users
      const desiredUnits = (await redeemableERC20.totalSupply()).div(2);
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1, buyConfig);
      await buySale(sale, signer2, buyConfig);

      // Finish the sale as succesfull
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2500);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // Signer1 withdraw
      const txWithdraw1 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn1 } = (await getEventArgs(
        txWithdraw1,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      // IDs
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress}`;
      const totalDeposited = amountDeposited1.add(amountDeposited2);
      const totalRemaining = totalDeposited.sub(amountWithdrawn1);

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableEscrowSupplyTokenDeposit (id: "${escrowSupplyTokenDepositId}") {
            totalDeposited
            totalRemaining
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDeposit;

      expect(data.totalDeposited).to.be.equals(totalDeposited);
      expect(data.totalRemaining).to.be.equals(totalRemaining);
    });
  });

  describe("RedeemableEscrowSupplyTokenDepositor entity", async function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale([signer1, signer2]));

      // Start sale
      await sale.start();
    });

    it("should update the RedeemableEscrowSupplyTokenDepositor after a multiple Deposits", async function () {
      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1);

      // Finish the sale
      await finishSale(sale);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 2000);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // IDs
      const escrowSupplyTokenDepositorId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress} - ${signer1Address}`;
      // const escrowDepositorId = `${escrowAddress} - ${signer1Address}`;
      const depositId_1 = txDeposit1.hash.toLowerCase();
      const depositId_2 = txDeposit2.hash.toLowerCase();
      const totalDeposited = amountDeposited1.add(amountDeposited2);
      const totalRemaining = totalDeposited;

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableEscrowSupplyTokenDepositor (id: "${escrowSupplyTokenDepositorId}") {
            iSale {
              saleStatus
            }
            iSaleAddress
            escrow {
              id
            }
            escrowAddress
            deposits {
              id
            }
            despositor {
              id
            }
            depositorAddress
            undeposits {
              id
            }
            token {
              id
            }
            tokenAddress
            redeemableSupply
            totalDeposited
            totalRemaining
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDepositor;

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);

      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);

      expect(data.deposits).to.deep.include({ id: depositId_1 });
      expect(data.deposits).to.deep.include({ id: depositId_2 });

      // expect(data.depositor.id).to.be.equals(escrowDepositorId); TODO: uncomment and fix the query from `despositor` to `depositor`
      expect(data.depositorAddress).to.be.equals(signer1Address);

      expect(data.undeposits).to.be.empty;

      expect(data.token.id).to.be.equals(claimableReserveAddress);
      expect(data.tokenAddress).to.be.equals(claimableReserveAddress);
      expect(data.redeemableSupply).to.be.equals(supply1);

      expect(data.totalDeposited).to.be.equals(totalDeposited);
      expect(data.totalRemaining).to.be.equals(totalRemaining);
    });

    it("should update the RedeemableEscrowSupplyTokenDepositor after Undeposits", async function () {
      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1);

      // Finish the sale
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.FAIL);

      // Make deposits with signers
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 5000);

      const { supply, amount: amountDeposited } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      // Undeposit the 25% of the amount deposit
      const txUndeposit1 = await escrow
        .connect(signer1)
        .undeposit(
          saleAddress,
          claimableReserveAddress,
          supply,
          amountDeposited.mul(25).div(100)
        );

      // Now undeposit the 50% of the amount deposit
      const txUndeposit2 = await escrow
        .connect(signer1)
        .undeposit(
          saleAddress,
          claimableReserveAddress,
          supply,
          amountDeposited.mul(50).div(100)
        );

      const { amount: undepositAmount1 } = (await getEventArgs(
        txUndeposit1,
        "Undeposit",
        escrow
      )) as UndepositEvent["args"];

      const { amount: undepositAmount2 } = (await getEventArgs(
        txUndeposit2,
        "Undeposit",
        escrow
      )) as UndepositEvent["args"];

      // IDs
      const escrowSupplyTokenDepositorId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;
      const undepositId_1 = txUndeposit1.hash.toLowerCase();
      const undepositId_2 = txUndeposit2.hash.toLowerCase();
      const totalDeposited = amountDeposited;
      const totalRemaining = totalDeposited.sub(
        undepositAmount1.add(undepositAmount2)
      );

      await waitForSubgraphToBeSynced();

      const query = `
        {
          redeemableEscrowSupplyTokenDepositor (id: "${escrowSupplyTokenDepositorId}") {
            totalDeposited
            totalRemaining
            undeposits {
              id
            }
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenDepositor;

      expect(data.totalDeposited).to.be.equals(totalDeposited);
      expect(data.totalRemaining).to.be.equals(totalRemaining);

      expect(data.undeposits).to.deep.include({ id: undepositId_1 });
      expect(data.undeposits).to.deep.include({ id: undepositId_2 });
    });
  });

  describe("RedeemableEscrowWithdrawer entity", function () {
    it("should query RedeemableEscrowWithdrawer after withdraw", async function () {
      ({ sale, redeemableERC20 } = await deploySale(signer2));
      // Start sale
      await sale.start();

      // Make a buy of all Redeemable
      const desiredUnits = await redeemableERC20.totalSupply();
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      await buySale(sale, signer2, buyConfig);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer2)
        .deposit(saleAddress, claimableReserveAddress, 2000);

      const { supply } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const txWithdraw = await escrow
        .connect(signer2)
        .withdraw(saleAddress, claimableReserveAddress, supply);

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowWithdrawId = txWithdraw.hash.toLowerCase();
      const escrowWithdrawerId = `${escrowAddress} - ${signer2Address}`;

      const query = `
          {
            redeemableEscrowWithdrawer (id: "${escrowWithdrawerId}") {
              address
              escrow {
                id
              }
              escrowAddress
              withdraws {
                id
              }
            }
          }
        `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowWithdrawer;

      expect(data.address).to.be.equals(signer2Address);
      expect(data.escrow.id).to.be.equals(escrowAddress);
      expect(data.escrowAddress).to.be.equals(escrowAddress);
      expect(data.withdraws).to.deep.include({ id: escrowWithdrawId });
    });
  });

  describe("RedeemableEscrowSupplyTokenWithdrawer entity", function () {
    beforeEach("deploying fresh sale", async function () {
      // In each `it` statement will have a fresh sale, redeemable and saleReserve
      ({ sale, redeemableERC20 } = await deploySale([signer1, signer2]));

      // Start sale
      await sale.start();
    });

    it("should query RedeemableEscrowSupplyTokenWithdrawer after a Deposit", async function () {
      // Make buys
      await buySale(sale, signer1);
      await buySale(sale, signer2);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 2000);

      const { supply, amount: amountDeposited } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;
      const escrowSupplyTokenDepositId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress}`;
      const redeemableBalance = await redeemableERC20.balanceOf(signer1Address);
      const totalWithdrawn = ethers.constants.Zero;
      const totalWithdrawnAgainst = ethers.constants.Zero;

      const claimable = amountDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalance)
        .div(supply);

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {
            deposit {
              id
            }
            withdrawerAddress
            redeemableBalance
            withdraws {
              id
            }
            totalWithdrawn
            totalWithdrawnAgainst
            claimable
            iSale {
              saleStatus
            }
            iSaleAddress
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.deposit.id).to.be.equals(escrowSupplyTokenDepositId);
      expect(data.withdrawerAddress).to.be.equals(signer1Address);

      expect(data.redeemableBalance).to.be.equals(redeemableBalance);
      expect(data.withdraws).to.be.empty;

      expect(data.totalWithdrawn).to.be.equals(totalWithdrawn);
      expect(data.totalWithdrawnAgainst).to.be.equals(totalWithdrawnAgainst);
      expect(data.claimable).to.be.equals(claimable);

      expect(data.iSale.saleStatus).to.be.equals(await sale.saleStatus());
      expect(data.iSaleAddress).to.be.equals(saleAddress);
    });

    it("should query RedeemableEscrowSupplyTokenWithdrawer after multiple Deposits", async function () {
      // Make buys
      await buySale(sale, signer1);
      await buySale(sale, signer2);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);

      // Make deposits
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 2000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(saleAddress, claimableReserveAddress, 3000);

      const { supply, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;

      const redeemableBalanceSigner1 = await redeemableERC20.balanceOf(
        signer1Address
      );
      const totalWithdrawnAgainst = ethers.constants.Zero;

      // RedeemableEscrowSupplyTokenDeposit.totalDeposited
      const totalDeposited = amountDeposited1.add(amountDeposited2);

      const claimable = totalDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalanceSigner1)
        .div(supply);

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {
            withdrawerAddress
            redeemableBalance
            withdraws {
              id
            }
            totalWithdrawn
            totalWithdrawnAgainst
            claimable
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.claimable).to.be.equals(claimable);
      expect(data.redeemableBalance).to.be.equals(redeemableBalanceSigner1);
    });

    it("should update RedeemableEscrowSupplyTokenWithdrawer after a change in the withdrawer Redeemable balance", async function () {
      // Make buys
      await buySale(sale, signer1);
      await buySale(sale, signer2);

      // Finish the sale as failed since does not reach the minimum raise
      await finishSale(sale);

      // Make deposit
      const txDeposit = await escrow
        .connect(signer1)
        .deposit(saleAddress, claimableReserveAddress, 2000);

      const { supply, amount: amountDeposited } = (await getEventArgs(
        txDeposit,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      // Burning 25% of the Redeemable token
      await redeemableERC20
        .connect(signer1)
        .burn((await redeemableERC20.balanceOf(signer1Address)).div(4));

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply} - ${claimableReserveAddress} - ${signer1Address}`;
      const redeemableBalance = await redeemableERC20.balanceOf(signer1Address);

      const totalWithdrawnAgainst = ethers.constants.Zero;
      const claimable = amountDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalance)
        .div(supply);

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {
            redeemableBalance
            claimable
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.redeemableBalance).to.be.equals(redeemableBalance);
      expect(data.claimable).to.be.equals(claimable);
    });

    it("should update RedeemableEscrowSupplyTokenWithdrawer after a withdraw", async function () {
      // Buy all between 2 users
      const desiredUnits = (await redeemableERC20.totalSupply()).div(2);
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1, buyConfig);
      await buySale(sale, signer2, buyConfig);

      // Finish the sale as succesfull
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2500);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // Signer1 withdraw
      const txWithdraw1 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn1 } = (await getEventArgs(
        txWithdraw1,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress} - ${signer1Address}`;
      const escrowWithdrawId = txWithdraw1.hash.toLowerCase();
      const totalDeposited = amountDeposited1.add(amountDeposited2);
      const totalWithdrawnAgainst = totalDeposited;
      const totalWithdrawn = amountWithdrawn1;
      const redeemableBalanceSigner1 = await redeemableERC20.balanceOf(
        signer1Address
      );
      const claimable = totalDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalanceSigner1)
        .div(supply1);

      // ((RedeemableEscrowSupplyTokenDeposit.totalDeposited - totalWithdrawnAgainst) * (redeemable.balanceOf(withdrawer)) / supply

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {          
            withdraws {
              id
            }
            redeemableBalance
            totalWithdrawn
            totalWithdrawnAgainst
            claimable
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.withdraws).to.deep.include({ id: escrowWithdrawId });

      expect(data.totalWithdrawn).to.be.equals(totalWithdrawn);
      expect(data.totalWithdrawnAgainst).to.be.equals(totalWithdrawnAgainst);

      expect(data.claimable).to.be.equals(claimable);

      expect(data.redeemableBalance).to.be.equals(redeemableBalanceSigner1);
    });

    it("should update the claimable when a deposit is made after a withdraw", async function () {
      // Buy all between 2 users
      const desiredUnits = (await redeemableERC20.totalSupply()).div(2);
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1, buyConfig);
      await buySale(sale, signer2, buyConfig);

      // Finish the sale as succesfull
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2500);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // Signer1 withdraw
      const txWithdraw1 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn1 } = (await getEventArgs(
        txWithdraw1,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      // Make a new deposit after a withdraw
      const txDeposit3 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 3000);

      const { supply: supply3, amount: amountDeposited3 } = (await getEventArgs(
        txDeposit3,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply3);

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress} - ${signer1Address}`;
      const escrowWithdrawId = txWithdraw1.hash.toLowerCase();
      const totalDeposited = amountDeposited1
        .add(amountDeposited2)
        .add(amountDeposited3);
      const totalWithdrawnAgainst = amountDeposited1.add(amountDeposited2);
      const totalWithdrawn = amountWithdrawn1;
      const redeemableBalanceSigner1 = await redeemableERC20.balanceOf(
        signer1Address
      );
      const claimable = totalDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalanceSigner1)
        .div(supply1);

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {
            withdraws {
              id
            }
            redeemableBalance
            totalWithdrawn
            totalWithdrawnAgainst
            claimable
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.withdraws).to.deep.include({ id: escrowWithdrawId });
      expect(data.redeemableBalance).to.be.equals(redeemableBalanceSigner1);

      expect(data.totalWithdrawn).to.be.equals(totalWithdrawn);
      expect(data.totalWithdrawnAgainst).to.be.equals(totalWithdrawnAgainst);

      expect(data.claimable).to.be.equals(claimable);

      // Signer1 withdraw again with the expected claimable
      const txWithdraw2 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn2 } = (await getEventArgs(
        txWithdraw2,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      expect(data.claimable).to.be.equals(
        amountWithdrawn2,
        "the amount claimed is not the expected by the subgraph"
      );
    });

    it("should update the claimable after a change in the withdrawer Redeemable balance, when a deposit is made after a withdraw", async function () {
      // Buy all between 2 users
      const desiredUnits = (await redeemableERC20.totalSupply()).div(2);
      const fee = 10;
      const buyConfig = {
        feeRecipient: feeRecipient.address,
        fee: fee,
        minimumUnits: desiredUnits,
        desiredUnits: desiredUnits,
        maximumPrice: (await sale.calculateBuy(desiredUnits))[1].add(100),
      };

      // Make a buy to have Redeemable with signers
      await buySale(sale, signer1, buyConfig);
      await buySale(sale, signer2, buyConfig);

      // Finish the sale as succesfull
      await finishSale(sale);
      expect(await sale.saleStatus()).to.be.equals(SaleStatus.SUCCESS);

      // Make deposits with signers
      const txDeposit1 = await escrow
        .connect(signer1)
        .deposit(sale.address, claimableReserve.address, 1000);

      const txDeposit2 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 2500);

      const { supply: supply1, amount: amountDeposited1 } = (await getEventArgs(
        txDeposit1,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      const { supply: supply2, amount: amountDeposited2 } = (await getEventArgs(
        txDeposit2,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply2);

      // Signer1 withdraw
      const txWithdraw1 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn1 } = (await getEventArgs(
        txWithdraw1,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      // Make a new deposit after a withdraw
      const txDeposit3 = await escrow
        .connect(signer2)
        .deposit(sale.address, claimableReserve.address, 3000);

      const { supply: supply3, amount: amountDeposited3 } = (await getEventArgs(
        txDeposit3,
        "Deposit",
        escrow
      )) as DepositEvent["args"];

      expect(supply1).to.be.equals(supply3);

      // Burning 25% of the Redeemable token
      await redeemableERC20
        .connect(signer1)
        .burn((await redeemableERC20.balanceOf(signer1Address)).div(4));

      await waitForSubgraphToBeSynced();

      // IDs
      const escrowSupplyTokenWithdrawerId = `${saleAddress} - ${escrowAddress} - ${supply1} - ${claimableReserveAddress} - ${signer1Address}`;
      const escrowWithdrawId = txWithdraw1.hash.toLowerCase();
      const totalDeposited = amountDeposited1
        .add(amountDeposited2)
        .add(amountDeposited3);
      const totalWithdrawnAgainst = amountDeposited1.add(amountDeposited2);
      const totalWithdrawn = amountWithdrawn1;
      const redeemableBalanceSigner1 = await redeemableERC20.balanceOf(
        signer1Address
      );
      const claimable = totalDeposited
        .sub(totalWithdrawnAgainst)
        .mul(redeemableBalanceSigner1)
        .div(supply1);

      const query = `
        {
          redeemableEscrowSupplyTokenWithdrawer (id: "${escrowSupplyTokenWithdrawerId}") {
            withdraws {
              id
            }
            redeemableBalance
            totalWithdrawn
            totalWithdrawnAgainst
            claimable
          }
        }
      `;
      const response = (await subgraph({
        query,
      })) as FetchResult;
      const data = response.data.redeemableEscrowSupplyTokenWithdrawer;

      expect(data.withdraws).to.deep.include({ id: escrowWithdrawId });
      expect(data.redeemableBalance).to.be.equals(redeemableBalanceSigner1);

      expect(data.totalWithdrawn).to.be.equals(totalWithdrawn);
      expect(data.totalWithdrawnAgainst).to.be.equals(totalWithdrawnAgainst);

      expect(data.claimable).to.be.equals(claimable);

      // Signer1 withdraw again with the expected claimable
      const txWithdraw2 = await escrow
        .connect(signer1)
        .withdraw(saleAddress, claimableReserveAddress, supply1);

      const { amount: amountWithdrawn2 } = (await getEventArgs(
        txWithdraw2,
        "Withdraw",
        escrow
      )) as WithdrawEvent["args"];

      expect(data.claimable).to.be.equals(
        amountWithdrawn2,
        "the amount claimed is not the expected by the subgraph"
      );
    });
  });
});
