/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  Address,
  BigInt,
  ByteArray,
  Bytes,
  crypto,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  AfterClear,
  Deposit,
  Withdraw,
  OrderDead,
  OrderLive,
  Clear,
} from "../../generated/OrderBook/OrderBook";

import {
  Order,
  OrderClear,
  Vault,
  VaultDeposit,
  VaultWithdraw,
  TokenVault,
  OrderClearStateChange,
  Bounty,
} from "../../generated/schema";

import { getERC20, ZERO_BI } from "../utils";

export function handleAfterClear(event: AfterClear): void {
  let orderClearStateChange = new OrderClearStateChange(
    event.block.timestamp.toString()
  );

  orderClearStateChange.aInput = event.params.stateChange.aInput;
  orderClearStateChange.aOutput = event.params.stateChange.aOutput;
  orderClearStateChange.bInput = event.params.stateChange.bInput;
  orderClearStateChange.bOutput = event.params.stateChange.aInput;

  orderClearStateChange.save();

  let bounty = Bounty.load(event.block.timestamp.toString());

  if (bounty) {
    bounty.bountyAmountA = event.params.stateChange.aOutput.minus(
      event.params.stateChange.bInput
    );
    bounty.bountyAmountA = event.params.stateChange.bOutput.minus(
      event.params.stateChange.aInput
    );

    bounty.save();
  }

  let orderClear = OrderClear.load(event.block.timestamp.toString());
  if (orderClear) {
    orderClear.stateChange = orderClearStateChange.id;
    orderClear.save();

    let OrderA = Order.load(orderClear.orderA);

    if (OrderA) {
      let inputTokenVault = TokenVault.load(OrderA.inputTokenVault);
      if (inputTokenVault) {
        inputTokenVault.balance = inputTokenVault.balance.plus(
          event.params.stateChange.aInput
        );

        let orderClears = inputTokenVault.orderClears;
        if (orderClears) orderClears.push(orderClear.id);
        inputTokenVault.orderClears = orderClears;

        inputTokenVault.save();
      }

      let outputTokenVault = TokenVault.load(OrderA.outputTokenVault);
      if (outputTokenVault) {
        outputTokenVault.balance = outputTokenVault.balance.minus(
          event.params.stateChange.aOutput
        );

        let orderClears = outputTokenVault.orderClears;
        if (orderClears) orderClears.push(orderClear.id);
        outputTokenVault.orderClears = orderClears;

        outputTokenVault.save();
      }
    }

    let OrderB = Order.load(orderClear.orderB);

    if (OrderB) {
      let inputTokenVault = TokenVault.load(OrderB.inputTokenVault);
      if (inputTokenVault) {
        inputTokenVault.balance = inputTokenVault.balance.plus(
          event.params.stateChange.bInput
        );

        let orderClears = inputTokenVault.orderClears;
        if (orderClears) orderClears.push(orderClear.id);
        inputTokenVault.orderClears = orderClears;

        inputTokenVault.save();
      }

      let outputTokenVault = TokenVault.load(OrderB.outputTokenVault);
      if (outputTokenVault) {
        outputTokenVault.balance = outputTokenVault.balance.minus(
          event.params.stateChange.bOutput
        );

        let orderClears = outputTokenVault.orderClears;
        if (orderClears) orderClears.push(orderClear.id);
        outputTokenVault.orderClears = orderClears;

        outputTokenVault.save();
      }
    }
  }
}

export function handleDeposit(event: Deposit): void {
  let vaultDeposit = new VaultDeposit(event.transaction.hash.toHex());
  vaultDeposit.sender = event.params.sender;
  vaultDeposit.token = getERC20(event.params.config.token, event.block).id;
  vaultDeposit.vaultId = event.params.config.vaultId;

  let vault = getVault(
    event.params.config.vaultId,
    event.params.sender.toHex()
  );

  vaultDeposit.vault = vault.id;
  vaultDeposit.amount = event.params.config.amount;

  let tokenVault = getTokenVault(
    event.params.config.token.toHex(),
    event.params.sender.toHex(),
    event.params.config.vaultId
  );

  vaultDeposit.tokenVault = tokenVault.id;

  tokenVault.balance = tokenVault.balance.plus(event.params.config.amount);
  tokenVault.vaultId = event.params.config.vaultId;

  tokenVault.save();

  vaultDeposit.save();

  if (vault) {
    let vDeposits = vault.deposits;
    if (vDeposits) vDeposits.push(vaultDeposit.id);
    vault.deposits = vDeposits;

    let tokenVaults = vault.tokenVaults;
    if (tokenVaults && !tokenVaults.includes(tokenVault.id))
      tokenVaults.push(tokenVault.id);
    vault.tokenVaults = tokenVaults;
    vault.save();
  }
}

export function handleWithdraw(event: Withdraw): void {
  let vaultWithdraw = new VaultWithdraw(event.transaction.hash.toHex());
  vaultWithdraw.sender = event.params.sender;
  vaultWithdraw.amount = event.params.amount;
  vaultWithdraw.vaultId = event.params.config.vaultId;
  vaultWithdraw.requestedAmount = event.params.config.amount;

  let token = getERC20(event.params.config.token, event.block);
  vaultWithdraw.token = token.id;

  let tokenVault = getTokenVault(
    token.id,
    event.params.sender.toHex(),
    event.params.config.vaultId
  );

  vaultWithdraw.tokenVault = tokenVault.id;
  tokenVault.balance = tokenVault.balance.minus(event.params.amount);
  tokenVault.save();

  let vault = getVault(
    event.params.config.vaultId,
    event.params.sender.toHex()
  );
  vaultWithdraw.vault = vault.id;

  if (vault) {
    let vWithdraws = vault.withdraws;
    if (vWithdraws) vWithdraws.push(vaultWithdraw.id);
    vault.withdraws = vWithdraws;
    vault.save();
  }

  vaultWithdraw.save();
}

export function handleOrderDead(event: OrderDead): void {
  let order = getOrderDead(event);
  order.orderLiveness = false;
  order.tracking = event.params.config.tracking;
  order.save();
}

export function handleOrderLive(event: OrderLive): void {
  let order = getOrderLive(event);
  if (order) {
    let inputTokenVault = getTokenVault(
      order.inputToken,
      order.owner.toHex(),
      event.params.config.inputVaultId
    );

    if (inputTokenVault) {
      let ITVOrders = inputTokenVault.orders;
      if (ITVOrders) {
        if (!ITVOrders.includes(order.id)) {
          ITVOrders.push(order.id);
          inputTokenVault.orders = ITVOrders;
        }
      }

      inputTokenVault.save();
    }

    let inputValut = getVault(
      event.params.config.inputVaultId,
      order.owner.toHex()
    );

    if (inputValut) {
      let IVTokenvaults = inputValut.tokenVaults;
      if (inputTokenVault && IVTokenvaults)
        IVTokenvaults.push(inputTokenVault.id);
    }

    inputValut.save();

    let outputTokenVault = getTokenVault(
      order.outputToken,
      order.owner.toHex(),
      event.params.config.outputVaultId
    );

    if (outputTokenVault) {
      let OTVOrders = outputTokenVault.orders;
      if (OTVOrders) {
        if (!OTVOrders.includes(order.id)) {
          OTVOrders.push(order.id);
          outputTokenVault.orders = OTVOrders;
        }
      }
      // if (OTVOrders) OTVOrders.push(order.id);
      // outputTokenVault.orders = OTVOrders;

      // let outputTokenContract = ERC20.bind(event.params.config.outputToken);
      // let OTVBalance = outputTokenContract.try_balanceOf(
      //   event.params.config.outputToken
      // );

      // if (!OTVBalance.reverted) {
      //   outputTokenVault.balance = OTVBalance.value;
      // }

      outputTokenVault.save();
    }

    let outputValut = getVault(
      event.params.config.outputVaultId,
      order.owner.toHex()
    );

    if (outputValut) {
      let OVTokenvaults = outputValut.tokenVaults;
      if (outputTokenVault && OVTokenvaults) OVTokenvaults.push(outputValut.id);
    }

    outputValut.save();

    order.orderLiveness = true;
    order.save();
  }
}

export function handleClear(event: Clear): void {
  let orderClear = new OrderClear(event.block.timestamp.toString());

  orderClear.sender = event.params.sender;
  orderClear.clearer = event.params.sender;

  let order_a_: Order, order_b_: Order;

  let orders = getOrderClear(event);
  order_a_ = orders[0];
  order_b_ = orders[1];

  orderClear.orderA = order_a_.id;
  orderClear.orderB = order_b_.id;

  orderClear.owners = [order_a_.owner, order_b_.owner];

  orderClear.aInput = order_a_.inputToken;
  orderClear.bInput = order_b_.inputToken;

  let bounty = new Bounty(event.block.timestamp.toString());
  bounty.clearer = event.params.sender;
  bounty.orderClear = event.block.timestamp.toString();

  let bountyVaultA = getVault(
    event.params.bountyConfig.aVaultId,
    event.params.sender.toHex()
  );

  let bountyVaultB = getVault(
    event.params.bountyConfig.bVaultId,
    event.params.sender.toHex()
  );

  bounty.bountyVaultA = bountyVaultA.id;
  bounty.bountyVaultB = bountyVaultB.id;

  bounty.bountyTokenA = order_a_.outputToken;
  bounty.bountyTokenB = order_b_.outputToken;
  bounty.save();

  orderClear.bounty = bounty.id;

  orderClear.save();
}

function getOrderClear(event: Clear): Order[] {
  let tupleArray_a_: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(event.params.a_.owner),
    ethereum.Value.fromAddress(event.params.a_.inputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.a_.inputVaultId),
    ethereum.Value.fromAddress(event.params.a_.outputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.a_.outputVaultId),
    ethereum.Value.fromUnsignedBigInt(event.params.a_.tracking),
    ethereum.Value.fromBytes(event.params.a_.vmState),
  ];

  let tuple_a_ = changetype<ethereum.Tuple>(tupleArray_a_);
  let encodedOrder_a_ = ethereum.encode(ethereum.Value.fromTuple(tuple_a_))!;
  let keccak256_a_ = crypto.keccak256(encodedOrder_a_ as ByteArray);
  let uint256_a_ = hexToBI(keccak256_a_.toHex());

  let order_a_ = Order.load(uint256_a_.toString());

  let tupleArray_b_: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(event.params.b_.owner),
    ethereum.Value.fromAddress(event.params.b_.inputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.b_.inputVaultId),
    ethereum.Value.fromAddress(event.params.b_.outputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.b_.outputVaultId),
    ethereum.Value.fromUnsignedBigInt(event.params.b_.tracking),
    ethereum.Value.fromBytes(event.params.b_.vmState),
  ];

  let tuple_b_ = changetype<ethereum.Tuple>(tupleArray_b_);
  let encodedOrder_b_ = ethereum.encode(ethereum.Value.fromTuple(tuple_b_))!;
  let keccak256_b_ = crypto.keccak256(encodedOrder_b_ as ByteArray);
  let uint256_b_ = hexToBI(keccak256_b_.toHex());

  let order_b_ = Order.load(uint256_b_.toString());
  if (order_a_ && order_b_) return [order_a_, order_b_];
  else log.info("Orders not found", []);
  return [];
}

function getOrderLive(event: OrderLive): Order {
  let tupleArray: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(event.params.config.owner),
    ethereum.Value.fromAddress(event.params.config.inputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.config.inputVaultId),
    ethereum.Value.fromAddress(event.params.config.outputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.config.outputVaultId),
    ethereum.Value.fromUnsignedBigInt(event.params.config.tracking),
    ethereum.Value.fromBytes(event.params.config.vmState),
  ];

  let tuple = changetype<ethereum.Tuple>(tupleArray);
  let encodedOrder = ethereum.encode(ethereum.Value.fromTuple(tuple))!;
  let keccak256 = crypto.keccak256(encodedOrder as ByteArray);
  let uint256 = hexToBI(keccak256.toHex());

  let order = Order.load(uint256.toString());
  if (!order) {
    order = new Order(uint256.toString());
    order.owner = event.params.config.owner;

    let inputToken = getERC20(event.params.config.inputToken, event.block);
    order.inputToken = inputToken.id;

    let inputTokenVault = getTokenVault(
      inputToken.id,
      event.params.config.owner.toHex(),
      event.params.config.inputVaultId
    );
    order.inputTokenVault = inputTokenVault.id;

    let inputVault = getVault(
      event.params.config.inputVaultId,
      event.params.config.owner.toHex()
    );
    order.inputVault = inputVault.id;

    let outputToken = getERC20(event.params.config.outputToken, event.block);
    order.outputToken = outputToken.id;

    let outputTokenVault = getTokenVault(
      outputToken.id,
      event.params.config.owner.toHex(),
      event.params.config.outputVaultId
    );

    order.outputTokenVault = outputTokenVault.id;

    let outputVault = getVault(
      event.params.config.outputVaultId,
      event.params.config.owner.toHex()
    );
    order.outputVault = outputVault.id;
    order.vmState = event.params.config.vmState;
  }

  order.tracking = event.params.config.tracking;
  order.save();
  return order as Order;
}

function getOrderDead(event: OrderDead): Order {
  let tupleArray: Array<ethereum.Value> = [
    ethereum.Value.fromAddress(event.params.config.owner),
    ethereum.Value.fromAddress(event.params.config.inputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.config.inputVaultId),
    ethereum.Value.fromAddress(event.params.config.outputToken),
    ethereum.Value.fromUnsignedBigInt(event.params.config.outputVaultId),
    ethereum.Value.fromUnsignedBigInt(event.params.config.tracking),
    ethereum.Value.fromBytes(event.params.config.vmState),
  ];

  let tuple = changetype<ethereum.Tuple>(tupleArray);
  let encodedOrder = ethereum.encode(ethereum.Value.fromTuple(tuple))!;
  let keccak256 = crypto.keccak256(encodedOrder as ByteArray);
  let uint256 = hexToBI(keccak256.toHex());

  let order = Order.load(uint256.toString());
  if (!order) {
    order = new Order(uint256.toString());
    order.owner = event.params.config.owner;

    let inputToken = getERC20(event.params.config.inputToken, event.block);
    order.inputToken = inputToken.id;

    let inputTokenVault = getTokenVault(
      inputToken.id,
      event.params.config.owner.toHex(),
      event.params.config.inputVaultId
    );
    order.inputTokenVault = inputTokenVault.id;

    let inputVault = getVault(
      event.params.config.inputVaultId,
      event.params.config.owner.toHex()
    );
    order.inputVault = inputVault.id;

    let outputToken = getERC20(event.params.config.outputToken, event.block);
    order.outputToken = outputToken.id;

    let outputTokenVault = getTokenVault(
      outputToken.id,
      event.params.config.owner.toHex(),
      event.params.config.outputVaultId
    );

    order.outputTokenVault = outputTokenVault.id;

    let outputVault = getVault(
      event.params.config.outputVaultId,
      event.params.config.owner.toHex()
    );
    order.outputVault = outputVault.id;
    order.vmState = event.params.config.vmState;
  }

  order.tracking = event.params.config.tracking;
  order.save();
  return order as Order;
}

function getTokenVault(
  token: string,
  owner: string,
  valutId: BigInt
): TokenVault {
  let tokenVault = TokenVault.load(
    valutId.toString() + " - " + owner + " - " + token
  );

  if (!tokenVault) {
    tokenVault = new TokenVault(
      valutId.toString() + " - " + owner + " - " + token
    );
    tokenVault.owner = Address.fromString(owner);
    tokenVault.token = token;
    tokenVault.orders = [];
    tokenVault.orderClears = [];
    tokenVault.vaultId = valutId;
    tokenVault.balance = ZERO_BI;
  }

  return tokenVault as TokenVault;
}

function getVault(valutId: BigInt, owner: string): Vault {
  let vault = Vault.load(valutId.toString() + " - " + owner);

  if (!vault) {
    vault = new Vault(valutId.toString() + " - " + owner);
    vault.owner = Address.fromString(owner);
    vault.tokenVaults = [];
    vault.deposits = [];
    vault.withdraws = [];
    vault.save();
  }

  return vault as Vault;
}

function hexToBI(hexString: string): BigInt {
  return BigInt.fromUnsignedBytes(
    changetype<Bytes>(Bytes.fromHexString(hexString).reverse())
  );
}
