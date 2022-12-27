import {
  Address,
  dataSource,
  DataSourceContext,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  Buy,
  Construct,
  CooldownInitialize,
  CooldownTriggered,
  End,
  Initialize,
  Refund,
  Start,
} from "../../generated/SaleFactory/Sale";
import {
  Sale,
  SaleFactory,
  ERC20,
  SaleStart,
  SaleEnd,
  SaleBuy,
  SaleFeeRecipient,
  SaleReceipt,
  SaleRefund,
  RedeemableERC20,
  SaleStateConfig,
} from "../../generated/schema";
import { RedeemableERC20Template } from "../../generated/templates";
import { ERC20 as ERC20Contract } from "../../generated/templates/SaleTemplate/ERC20";
import {
  ETHER,
  getERC20,
  HUNDRED_BD,
  SaleStatus,
  ZERO_ADDRESS,
  ZERO_BI,
} from "../utils";

export function handleBuy(event: Buy): void {
  let sale = Sale.load(event.address.toHex());

  if (sale) {
    let saleBuy = new SaleBuy(event.transaction.hash.toHex());

    saleBuy.block = event.block.number;
    saleBuy.refunded = false;
    saleBuy.transactionHash = event.transaction.hash;
    saleBuy.timestamp = event.block.timestamp;
    saleBuy.saleContract = sale.id;
    saleBuy.saleContractAddress = event.address;
    saleBuy.feeRecipientAddress = event.params.receipt.feeRecipient;
    saleBuy.minimumUnits = event.params.config.minimumUnits;
    saleBuy.desiredUnits = event.params.config.desiredUnits;
    saleBuy.maximumPrice = event.params.config.maximumPrice;
    saleBuy.fee = event.params.receipt.fee;
    saleBuy.sender = event.params.sender;

    let receipt = new SaleReceipt(
      sale.id + " - " + event.params.receipt.id.toString()
    );
    receipt.receiptId = event.params.receipt.id;
    receipt.saleTransaction = event.transaction.hash.toHex();
    receipt.feeRecipient = event.params.receipt.feeRecipient;
    receipt.fee = event.params.receipt.fee;
    receipt.units = event.params.receipt.units;
    receipt.price = event.params.receipt.price;
    receipt.save();

    saleBuy.receipt = receipt.id;
    saleBuy.totalIn = receipt.units
      .times(receipt.price)
      .div(ETHER)
      .plus(event.params.receipt.fee);

    let saleFeeRecipient = SaleFeeRecipient.load(
      sale.id + " - " + event.params.receipt.feeRecipient.toHex()
    );

    if (!saleFeeRecipient) {
      saleFeeRecipient = new SaleFeeRecipient(
        sale.id + " - " + event.params.receipt.feeRecipient.toHex()
      );
      saleFeeRecipient.address = event.params.receipt.feeRecipient;
      saleFeeRecipient.totalFees = ZERO_BI;
      saleFeeRecipient.buys = [];
      saleFeeRecipient.refunds = [];
      saleFeeRecipient.sale = event.address.toHex();
      saleFeeRecipient.save();

      let saleFeeRecipients = sale.saleFeeRecipients;
      if (saleFeeRecipients) saleFeeRecipients.push(saleFeeRecipient.id);
      sale.saleFeeRecipients = saleFeeRecipients;
    }

    saleBuy.feeRecipient = saleFeeRecipient.id;
    saleBuy.save();

    let buys = saleFeeRecipient.buys;
    if (buys) buys.push(saleBuy.id);
    saleFeeRecipient.buys = buys;
    saleFeeRecipient.save();

    let sbuys = sale.buys;
    if (sbuys) sbuys.push(saleBuy.id);
    sale.buys = sbuys;

    let saleTransactions = sale.saleTransactions;
    if (saleTransactions) saleTransactions.push(saleBuy.id);
    sale.saleTransactions = saleTransactions;

    sale.save();

    updateSale(sale as Sale);
    updateFeeRecipient(saleFeeRecipient as SaleFeeRecipient);
  }
}
export function handleConstruct(event: Construct): void {
  let context = dataSource.context();
  let saleFactory = SaleFactory.load(context.getString("factory"));
  if (saleFactory) {
    saleFactory.redeemableERC20Factory =
      event.params.config.redeemableERC20Factory;
    saleFactory.save();
  }
}

export function handleCooldownInitialize(event: CooldownInitialize): void {
  let sale = Sale.load(event.address.toHex());
  if (sale) {
    sale.cooldownDuration = event.params.cooldownDuration;
    sale.save();
  }
}

export function handleCooldownTriggered(event: CooldownTriggered): void {
  // EMPTY Block
}

export function handleEnd(event: End): void {
  let sale = Sale.load(event.address.toHex());

  if (sale) {
    let endEvent = new SaleEnd(event.transaction.hash.toHex());
    endEvent.block = event.block.number;
    endEvent.timestamp = event.block.timestamp;
    endEvent.transactionHash = event.transaction.hash;
    endEvent.saleContract = sale.id;
    endEvent.sender = event.params.sender;
    endEvent.saleStatus = event.params.saleStatus;
    endEvent.save();

    sale.endEvent = endEvent.id;
    sale.saleStatus = event.params.saleStatus;
    sale.save();
  }
}

export function handleInitialize(event: Initialize): void {
  let sale = Sale.load(event.address.toHex());
  if (sale) {
    let token = getRedeemableERC20(
      event.address,
      event.transaction.from,
      event.params.token,
      event.block
    );

    if (token) sale.token = token.id;
    let reserve = getERC20(event.params.config.reserve, event.block);
    if (reserve) sale.reserve = reserve.id;

    let tokenContract = ERC20Contract.bind(event.params.token);

    sale.recipient = event.params.config.recipient;
    sale.cooldownDuration = event.params.config.cooldownDuration;
    sale.minimumRaise = event.params.config.minimumRaise;
    if (sale.minimumRaise == ZERO_BI) sale.percentRaised = HUNDRED_BD;
    sale.dustSize = event.params.config.dustSize;
    sale.saleStatus = SaleStatus.Pending;

    let balance = tokenContract.try_balanceOf(event.address);
    if (!balance.reverted) sale.unitsAvailable = balance.value;

    let saleStateConfig = new SaleStateConfig(event.address.toHex());
    saleStateConfig.sources = event.params.config.vmStateConfig.sources;
    saleStateConfig.constants = event.params.config.vmStateConfig.constants;
    saleStateConfig.save();

    sale.vmStateConfig = saleStateConfig.id;
    token.save();
    reserve.save();
    sale.save();
  }
}

export function handleRefund(event: Refund): void {
  let sale = Sale.load(event.address.toHex());

  if (sale) {
    let saleRefund = new SaleRefund(event.transaction.hash.toHex());
    saleRefund.block = event.block.number;
    saleRefund.transactionHash = event.transaction.hash;
    saleRefund.timestamp = event.block.timestamp;
    saleRefund.saleContract = sale.id;
    saleRefund.saleContractAddress = event.address;
    saleRefund.fee = event.params.receipt.fee;
    saleRefund.feeRecipientAddress = event.params.receipt.feeRecipient;
    saleRefund.sender = event.params.sender;

    let receipt = SaleReceipt.load(
      sale.id + " - " + event.params.receipt.id.toString()
    );
    if (receipt) {
      saleRefund.receipt = receipt.id;
      saleRefund.totalOut = receipt.units
        .times(receipt.price)
        .div(ETHER)
        .plus(event.params.receipt.fee);
    }

    let feeRecipient = SaleFeeRecipient.load(
      sale.id + " - " + saleRefund.feeRecipientAddress.toHex()
    );

    if (feeRecipient) saleRefund.feeRecipient = feeRecipient.id;

    saleRefund.save();

    let saleFeeRecipient = SaleFeeRecipient.load(saleRefund.feeRecipient);
    if (saleFeeRecipient) {
      let refunds = saleFeeRecipient.refunds;
      if (refunds) refunds.push(saleRefund.id);
      saleFeeRecipient.refunds = refunds;
      saleFeeRecipient.save();
    }

    let srefunds = sale.refunds;
    if (srefunds) srefunds.push(saleRefund.id);
    sale.refunds = srefunds;

    if (receipt) {
      let saleBuy = SaleBuy.load(receipt.saleTransaction);
      if (saleBuy) {
        saleBuy.refunded = true;
        saleBuy.refundEvent = saleRefund.id;
        saleBuy.save();
      }
    }

    let saleTransactions = sale.saleTransactions;
    if (saleTransactions) saleTransactions.push(saleRefund.id);
    sale.saleTransactions = saleTransactions;

    sale.save();

    updateSale(sale as Sale);
    updateFeeRecipient(saleFeeRecipient as SaleFeeRecipient);
  }
}

export function handleStart(event: Start): void {
  let sale = Sale.load(event.address.toHex());
  if (sale) {
    sale.saleStatus = SaleStatus.Active;
    let salestart = new SaleStart(event.transaction.hash.toHex());
    salestart.transactionHash = event.transaction.hash;
    salestart.block = event.block.number;
    salestart.timestamp = event.block.timestamp;
    salestart.saleContract = sale.id;
    salestart.sender = event.params.sender;
    salestart.save();

    sale.startEvent = salestart.id;

    sale.save();
  }
}

function getRedeemableERC20(
  sale: Address,
  deployer: Address,
  token: Address,
  block: ethereum.Block
): RedeemableERC20 {
  let redeemableERC20 = RedeemableERC20.load(token.toHex());
  let erc20Contract = ERC20Contract.bind(token);
  if (!redeemableERC20) {
    redeemableERC20 = new RedeemableERC20(token.toHex());
    redeemableERC20.deployBlock = block.number;
    redeemableERC20.deployTimestamp = block.timestamp;

    redeemableERC20.saleAddress = sale;
    redeemableERC20.escrowSupplyTokenWithdrawers = [];

    let name = erc20Contract.try_name();
    let symbol = erc20Contract.try_symbol();
    let decimals = erc20Contract.try_decimals();
    let totalSupply = erc20Contract.try_totalSupply();
    if (
      !(
        name.reverted ||
        symbol.reverted ||
        decimals.reverted ||
        totalSupply.reverted
      )
    ) {
      redeemableERC20.name = name.value;
      redeemableERC20.symbol = symbol.value;
      redeemableERC20.decimals = decimals.value;
      redeemableERC20.totalSupply = totalSupply.value;
    }
    redeemableERC20.deployer = deployer;
    redeemableERC20.redeems = [];
    redeemableERC20.treasuryAssets = [];
    redeemableERC20.holders = [];
    redeemableERC20.grantedReceivers = [];
    redeemableERC20.grantedSenders = [];

    redeemableERC20.save();

    let context = new DataSourceContext();
    context.setString("trust", ZERO_ADDRESS);
    RedeemableERC20Template.createWithContext(token, context);
  }

  return redeemableERC20 as RedeemableERC20;
}

function updateFeeRecipient(recipient: SaleFeeRecipient): void {
  let buys = recipient.buys;
  let buyAmount = ZERO_BI;
  let buyLength = buys.length;

  for (let i = 0; i < buyLength; i++) {
    let buy = buys.pop();
    if (buy) {
      let saleBuy = SaleBuy.load(buy);
      if (saleBuy) buyAmount = buyAmount.plus(saleBuy.fee);
    }
  }

  let refunds = recipient.refunds;
  let refundAmount = ZERO_BI;
  let refundLength = refunds.length;

  for (let i = 0; i < refundLength; i++) {
    let refund = refunds.pop();
    if (refund) {
      let saleRefund = SaleRefund.load(refund);
      if (saleRefund) refundAmount = refundAmount.plus(saleRefund.fee);
    }
  }

  recipient.totalFees = buyAmount.minus(refundAmount);
  recipient.save();
}

function updateSale(sale: Sale): void {
  if (sale) {
    let erc20 = ERC20Contract.bind(Address.fromString(sale.token));

    let balance = erc20.try_balanceOf(Address.fromString(sale.id));
    if (!balance.reverted) sale.unitsAvailable = balance.value;

    let saleBuys = sale.buys;
    let saleRefunds = sale.refunds;
    let totalIn = ZERO_BI;
    let buyFee = ZERO_BI;
    let totalOut = ZERO_BI;
    let refundFee = ZERO_BI;

    if (saleBuys) {
      let buyLength = saleBuys.length;

      for (let i = 0; i < buyLength; i++) {
        let buy = saleBuys.pop();
        if (buy) {
          let saleBuy = SaleBuy.load(buy);
          if (saleBuy) {
            totalIn = totalIn.plus(saleBuy.totalIn);
            buyFee = buyFee.plus(saleBuy.fee);
          }
        }
      }
    }

    if (saleRefunds) {
      let refundLength = saleRefunds.length;

      for (let i = 0; i < refundLength; i++) {
        let refund = saleRefunds.pop();
        if (refund) {
          let saleRefund = SaleRefund.load(refund);
          if (saleRefund) {
            totalOut = totalOut.plus(saleRefund.totalOut);
            refundFee = refundFee.plus(saleRefund.fee);
          }
        }
      }
    }

    if (sale.saleStatus >= SaleStatus.Active)
      sale.totalRaised = totalIn.minus(totalOut).minus(buyFee.minus(refundFee));
    sale.totalFees = buyFee.minus(refundFee);

    if (sale.minimumRaise == ZERO_BI) sale.percentRaised = HUNDRED_BD;
    else
      sale.percentRaised = sale.totalRaised
        .toBigDecimal()
        .div(sale.minimumRaise.toBigDecimal())
        .times(HUNDRED_BD);
    sale.save();
  }
}
