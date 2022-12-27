import { Address } from "@graphprotocol/graph-ts";
import {
  StakeDeposit,
  StakeERC20,
  StakeHolder,
  StakeWithdraw,
} from "../../generated/schema";
import {
  Initialize,
  Approval,
  Transfer,
  Stake,
} from "../../generated/templates/StakeERC20Template/Stake";
import { getERC20, ZERO_ADDRESS, ZERO_BI } from "../utils";

export function handleInitialize(event: Initialize): void {
  let stakeContract = Stake.bind(event.address);
  let stakeERC20 = StakeERC20.load(event.address.toHex());
  if (stakeERC20) {
    stakeERC20.name = event.params.config.name;
    stakeERC20.symbol = event.params.config.symbol;
    stakeERC20.decimals = stakeContract.decimals();
    stakeERC20.totalSupply = stakeContract.totalSupply();
    stakeERC20.initialRatio = event.params.config.initialRatio;

    let token = getERC20(event.params.config.token, event.block);
    if (token) {
      stakeERC20.token = token.id;
      let stakeContracts = token.stakeContracts;
      if (stakeContracts && !stakeContracts.includes(stakeERC20.id))
        stakeContracts.push(stakeERC20.id);
      token.stakeContracts = stakeContracts;
      token.save();
    }

    stakeERC20.save();
  }
}

export function handleApproval(event: Approval): void {
  //
}

export function handleTransfer(event: Transfer): void {
  let stakeERC20 = StakeERC20.load(event.address.toHex());
  let stakeContract = Stake.bind(event.address);

  if (stakeERC20) {
    stakeERC20.totalSupply = stakeContract.totalSupply();

    if (stakeERC20.tokenPoolSize != ZERO_BI) {
      stakeERC20.tokenToStakeTokenRatio = stakeERC20.totalSupply
        .toBigDecimal()
        .div(stakeERC20.tokenPoolSize.toBigDecimal());
    }

    if (stakeERC20.totalSupply != ZERO_BI) {
      stakeERC20.stakeTokenToTokenRatio = stakeERC20.tokenPoolSize
        .toBigDecimal()
        .div(stakeERC20.totalSupply.toBigDecimal());
    }

    if (event.params.from.toHex() == ZERO_ADDRESS) {
      let stakeDeposit = getStakeDepositFromHash(
        event.transaction.hash.toHex()
      );

      // Deposit
      stakeDeposit.depositor =
        event.address.toHex() + "-" + event.params.to.toHex();
      stakeDeposit.stakeToken = event.address.toHex();
      stakeDeposit.token = stakeERC20.token;
      stakeDeposit.stakeTokenMinted = event.params.value;
      stakeDeposit.timestamp = event.block.timestamp;
      stakeDeposit.tokenPoolSize = stakeERC20.tokenPoolSize;
      stakeDeposit.value = event.params.value;
      stakeDeposit.depositedAmount = ZERO_BI;
      stakeDeposit.save();

      stakeERC20.save();
    }

    if (event.params.to.toHex() == ZERO_ADDRESS) {
      let stakeWithdraw = getStakeWithdrawFromHash(
        event.transaction.hash.toHex()
      );

      // Withdraw
      stakeWithdraw.withdrawer =
        event.address.toHex() + "-" + event.params.from.toHex();
      stakeWithdraw.stakeToken = event.address.toHex();
      stakeWithdraw.token = stakeERC20.token;
      stakeWithdraw.stakeTokenBurned = event.params.value;
      stakeWithdraw.timestamp = event.block.timestamp;
      stakeWithdraw.tokenPoolSize = stakeERC20.tokenPoolSize;
      stakeWithdraw.value = event.params.value;
      stakeWithdraw.save();

      stakeERC20.save();
    }

    if (event.params.to.toHex() != ZERO_ADDRESS) {
      let stakeHolder = getStakeHolder(
        event.address.toHex() + "-" + event.params.to.toHex()
      );
      stakeHolder.address = event.params.to;
      stakeHolder.token = stakeERC20.token;
      stakeHolder.stakeToken = stakeERC20.id;

      stakeHolder.totalStake = ZERO_BI;
      stakeHolder.totalDeposited = ZERO_BI;

      stakeHolder.balance = stakeHolder.balance.plus(event.params.value);
      if (stakeERC20.totalSupply != ZERO_BI) {
        stakeHolder.totalEntitlement = stakeHolder.balance
          .times(stakeERC20.tokenPoolSize)
          .div(stakeERC20.totalSupply);
      }

      stakeHolder.save();
    }

    if (event.params.from.toHex() != ZERO_ADDRESS) {
      let stakeHolder = getStakeHolder(
        event.address.toHex() + "-" + event.params.from.toHex()
      );
      stakeHolder.balance = stakeHolder.balance.minus(event.params.value);
      if (stakeERC20.totalSupply != ZERO_BI) {
        stakeHolder.totalEntitlement = stakeHolder.balance
          .times(stakeERC20.tokenPoolSize)
          .div(stakeERC20.totalSupply);
      }
      stakeHolder.save();
    }
  }
}

export function getStakeDepositFromHash(txHash: string): StakeDeposit {
  let _stakeDeposit = StakeDeposit.load(txHash);

  if (_stakeDeposit) {
    // Exist and return
    return _stakeDeposit;
  } else {
    // Does not exist but we have only the tx hash
    let _stakeDeposit = new StakeDeposit(txHash);

    _stakeDeposit.depositor = ZERO_ADDRESS;
    _stakeDeposit.stakeToken = ZERO_ADDRESS;
    _stakeDeposit.token = ZERO_ADDRESS;
    _stakeDeposit.stakeTokenMinted = ZERO_BI;
    _stakeDeposit.timestamp = ZERO_BI;
    _stakeDeposit.tokenPoolSize = ZERO_BI;
    _stakeDeposit.value = ZERO_BI;
    _stakeDeposit.depositedAmount = ZERO_BI;
    _stakeDeposit.save();
    return _stakeDeposit;
  }
}

export function getStakeWithdrawFromHash(txHash: string): StakeWithdraw {
  let _stakeWithdraw = StakeWithdraw.load(txHash);

  if (_stakeWithdraw) {
    // Exist and return
    return _stakeWithdraw;
  } else {
    // Does not exist but we have only the tx hash
    let _stakeWithdraw = new StakeWithdraw(txHash);
    _stakeWithdraw.save();
    return _stakeWithdraw;
  }
}

export function getStakeHolder(holderId: string): StakeHolder {
  let _stakeHolder = StakeHolder.load(holderId);

  if (_stakeHolder) {
    return _stakeHolder;
  } else {
    let _stakeHolder = new StakeHolder(holderId);
    _stakeHolder.balance = ZERO_BI;
    _stakeHolder.totalStake = ZERO_BI;
    _stakeHolder.totalDeposited = ZERO_BI;

    _stakeHolder.address = Address.fromString(ZERO_ADDRESS);
    _stakeHolder.token = ZERO_ADDRESS;
    _stakeHolder.stakeToken = ZERO_ADDRESS;
    _stakeHolder.totalEntitlement = ZERO_BI;
    _stakeHolder.save();
    return _stakeHolder;
  }
}
