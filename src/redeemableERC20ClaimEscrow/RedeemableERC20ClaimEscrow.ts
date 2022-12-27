import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  Deposit,
  PendingDeposit,
  Sweep,
  Undeposit,
  Withdraw,
} from "../../generated/RedeemableERC20ClaimEscrow/RedeemableERC20ClaimEscrow";
import {
  Holder,
  RedeemableERC20,
  RedeemableERC20ClaimEscrow,
  RedeemableEscrowDeposit,
  RedeemableEscrowDepositor,
  RedeemableEscrowPendingDeposit,
  RedeemableEscrowPendingDepositorToken,
  RedeemableEscrowSupplyTokenDeposit,
  RedeemableEscrowSupplyTokenDepositor,
  RedeemableEscrowSupplyTokenWithdrawer,
  RedeemableEscrowUndeposit,
  RedeemableEscrowWithdraw,
  RedeemableEscrowWithdrawer,
  Sale,
  UnknownSale,
} from "../../generated/schema";
import { getERC20, SaleStatus, ZERO_BI } from "../utils";
import { Sale as SaleContract } from "../../generated/SaleFactory/Sale";

export function handleDeposit(event: Deposit): void {
  let redeemableERC20ClaimEscrow = getRedeemableERC20ClaimEscrow(
    event.address.toHex()
  );
  let redeemableEscrowDeposit = new RedeemableEscrowDeposit(
    event.transaction.hash.toHex()
  );
  redeemableEscrowDeposit.depositorAddress = event.params.depositor;
  redeemableEscrowDeposit.escrow = redeemableERC20ClaimEscrow.id;
  redeemableEscrowDeposit.escrowAddress = event.address;
  redeemableEscrowDeposit.iSaleAddress = event.params.sale;
  redeemableEscrowDeposit.redeemableSupply = event.params.supply;
  redeemableEscrowDeposit.tokenAmount = event.params.amount;

  let token = getERC20(event.params.token, event.block);
  redeemableEscrowDeposit.token = token.id;
  redeemableEscrowDeposit.tokenAddress = event.params.token;

  let iSale = getIsale(event.params.sale.toHex());
  redeemableEscrowDeposit.iSale = iSale;

  let depositor = getRedeemableEscrowDepositor(
    event.address.toHex(),
    event.params.depositor
  );
  let dDeposits = depositor.deposits;
  if (dDeposits) dDeposits.push(redeemableEscrowDeposit.id);
  depositor.deposits = dDeposits;
  depositor.save();

  let redeemableEscrowSupplyTokenDeposit =
    getRedeemableEscrowSupplyTokenDeposit(
      Address.fromString(iSale),
      event.address,
      event.params.supply,
      event.params.token
    );

  let allDeposits = redeemableEscrowSupplyTokenDeposit.deposits;
  let totalDeposit = event.params.amount;
  while (allDeposits && allDeposits.length > 0) {
    let _deposit = allDeposits.pop();
    if (_deposit) {
      let deposit = RedeemableEscrowDeposit.load(_deposit);
      if (deposit) totalDeposit = totalDeposit.plus(deposit.tokenAmount);
    }
  }

  redeemableEscrowSupplyTokenDeposit.totalDeposited = totalDeposit;

  if (redeemableEscrowSupplyTokenDeposit.totalRemaining == ZERO_BI)
    redeemableEscrowSupplyTokenDeposit.totalRemaining = event.params.amount;
  else
    redeemableEscrowSupplyTokenDeposit.totalRemaining =
      redeemableEscrowSupplyTokenDeposit.totalRemaining.plus(
        event.params.amount
      );

  let redeemableEscrowSupplyTokenDepositDepositors =
    redeemableEscrowSupplyTokenDeposit.depositors;
  if (redeemableEscrowSupplyTokenDepositDepositors)
    redeemableEscrowSupplyTokenDepositDepositors.push(depositor.id);
  redeemableEscrowSupplyTokenDeposit.depositors =
    redeemableEscrowSupplyTokenDepositDepositors;

  let redeemableEscrowSupplyTokenDepositdepositorAddress =
    redeemableEscrowSupplyTokenDeposit.depositorAddress;
  if (redeemableEscrowSupplyTokenDepositdepositorAddress)
    redeemableEscrowSupplyTokenDepositdepositorAddress.push(
      event.params.depositor
    );
  redeemableEscrowSupplyTokenDeposit.depositorAddress =
    redeemableEscrowSupplyTokenDepositdepositorAddress;

  redeemableEscrowSupplyTokenDeposit.redeemableSupply = event.params.supply;

  let redeemableEscrowSupplyTokenDepositDeposits =
    redeemableEscrowSupplyTokenDeposit.deposits;
  if (redeemableEscrowSupplyTokenDepositDeposits)
    redeemableEscrowSupplyTokenDepositDeposits.push(redeemableEscrowDeposit.id);
  redeemableEscrowSupplyTokenDeposit.deposits =
    redeemableEscrowSupplyTokenDepositDeposits;

  let RESTDWithdraws = redeemableEscrowSupplyTokenDeposit.withdraws;

  // Load the RedeemableERC20 entity
  let redeemableERC20 = RedeemableERC20.load(event.params.redeemable.toHex());
  if (redeemableERC20) {
    // Save the redeemable into the RedeemableEscrowDeposit
    redeemableEscrowDeposit.redeemable = redeemableERC20.id;

    let rTKNHolders = redeemableERC20.holders;
    let supplyTokenWithdrawers =
      redeemableERC20ClaimEscrow.supplyTokenWithdrawers;

    if (rTKNHolders) {
      for (let i = 0; i < rTKNHolders.length; i++) {
        let holder = Holder.load(rTKNHolders[i]);
        if (holder) {
          let redeemableEscrowSupplyTokenWithdrawer =
            getRedeemableEscrowSupplyTokenWithdrawer(
              Address.fromString(iSale),
              event.address,
              event.params.supply,
              event.params.token,
              Address.fromBytes(
                getRedeemableEscrowWithdrawer(
                  event.address,
                  Address.fromBytes(holder.address)
                ).address
              )
            );

          // Save EscrowSupplyTokenWithdrawers into the Redeemable
          let redeemEscrowSTW = redeemableERC20.escrowSupplyTokenWithdrawers;
          if (
            redeemEscrowSTW &&
            !redeemEscrowSTW.includes(redeemableEscrowSupplyTokenWithdrawer.id)
          ) {
            // Save all the redeemableEscrowSupplyTokenWithdrawer since all use the same RedeemableERC20
            redeemEscrowSTW.push(redeemableEscrowSupplyTokenWithdrawer.id);
            redeemableERC20.escrowSupplyTokenWithdrawers = redeemEscrowSTW;
          }

          redeemableEscrowSupplyTokenWithdrawer.deposit =
            redeemableEscrowSupplyTokenDeposit.id;

          if (holder && event.params.supply != ZERO_BI) {
            redeemableEscrowSupplyTokenWithdrawer.redeemableBalance =
              holder.balance;
            redeemableEscrowSupplyTokenWithdrawer.claimable =
              redeemableEscrowSupplyTokenDeposit.totalDeposited
                .minus(
                  redeemableEscrowSupplyTokenWithdrawer.totalWithdrawnAgainst
                )
                .times(holder.balance)
                .div(event.params.supply);
          }

          if (supplyTokenWithdrawers) {
            if (
              !supplyTokenWithdrawers.includes(
                redeemableEscrowSupplyTokenWithdrawer.id
              )
            ) {
              supplyTokenWithdrawers.push(
                redeemableEscrowSupplyTokenWithdrawer.id
              );
              redeemableERC20ClaimEscrow.supplyTokenWithdrawers =
                supplyTokenWithdrawers;
            }
          }

          if (RESTDWithdraws && event.params.supply != ZERO_BI) {
            for (let i = 0; i < RESTDWithdraws.length; i++) {
              let withdrawer = RedeemableEscrowSupplyTokenWithdrawer.load(
                RESTDWithdraws[i]
              );
              if (withdrawer) {
                withdrawer.claimable =
                  redeemableEscrowSupplyTokenDeposit.totalDeposited
                    .minus(withdrawer.totalWithdrawnAgainst)
                    .times(withdrawer.redeemableBalance)
                    .div(event.params.supply);

                withdrawer.save();
              }
            }

            RESTDWithdraws.push(redeemableEscrowSupplyTokenWithdrawer.id);
          }

          redeemableEscrowSupplyTokenWithdrawer.save();
        }
      }
    }

    redeemableEscrowSupplyTokenDeposit.withdraws = RESTDWithdraws;

    redeemableEscrowSupplyTokenDeposit.save();

    redeemableERC20.save();
  }

  let DsupplyTokenDeposits = depositor.supplyTokenDeposits;
  if (
    DsupplyTokenDeposits &&
    !DsupplyTokenDeposits.includes(redeemableEscrowSupplyTokenDeposit.id)
  )
    DsupplyTokenDeposits.push(redeemableEscrowSupplyTokenDeposit.id);
  depositor.supplyTokenDeposits = DsupplyTokenDeposits;

  depositor.save();

  redeemableEscrowDeposit.depositor = depositor.id;

  redeemableEscrowDeposit.save();

  let deposits = redeemableERC20ClaimEscrow.deposits;
  if (deposits) deposits.push(redeemableEscrowDeposit.id);
  redeemableERC20ClaimEscrow.deposits = deposits;

  let depositors = redeemableERC20ClaimEscrow.depositors;
  if (depositors && !depositors.includes(depositor.id)) {
    depositors.push(depositor.id);
  }
  redeemableERC20ClaimEscrow.depositors = depositors;

  let supplyTokenDeposits = redeemableERC20ClaimEscrow.supplyTokenDeposits;
  if (
    supplyTokenDeposits &&
    !supplyTokenDeposits.includes(redeemableEscrowSupplyTokenDeposit.id)
  )
    supplyTokenDeposits.push(redeemableEscrowSupplyTokenDeposit.id);
  redeemableERC20ClaimEscrow.supplyTokenDeposits = supplyTokenDeposits;

  let redeemableEscrowSupplyTokenDepositor =
    getRedeemableEscrowSupplyTokenDepositor(
      Address.fromString(iSale),
      event.address,
      event.params.supply,
      event.params.token,
      Address.fromBytes(
        getRedeemableEscrowDepositor(
          event.address.toHex(),
          event.params.depositor
        ).address
      )
    );

  let rSupplyTokenDeposits = redeemableEscrowSupplyTokenDepositor.deposits;
  if (rSupplyTokenDeposits)
    rSupplyTokenDeposits.push(redeemableEscrowDeposit.id);
  redeemableEscrowSupplyTokenDepositor.deposits = rSupplyTokenDeposits;

  redeemableEscrowSupplyTokenDepositor.totalDeposited =
    redeemableEscrowSupplyTokenDepositor.totalDeposited.plus(
      event.params.amount
    );

  if (redeemableEscrowSupplyTokenDepositor.totalRemaining == ZERO_BI)
    redeemableEscrowSupplyTokenDepositor.totalRemaining = event.params.amount;
  else
    redeemableEscrowSupplyTokenDepositor.totalRemaining =
      redeemableEscrowSupplyTokenDepositor.totalRemaining.plus(
        event.params.amount
      );

  redeemableEscrowSupplyTokenDepositor.redeemableSupply = event.params.supply;

  redeemableEscrowSupplyTokenDepositor.save();

  let supplyTokenDepositors = redeemableERC20ClaimEscrow.supplyTokenDepositors;
  if (supplyTokenDepositors)
    supplyTokenDepositors.push(redeemableEscrowSupplyTokenDepositor.id);

  redeemableERC20ClaimEscrow.supplyTokenDepositors = supplyTokenDepositors;

  redeemableERC20ClaimEscrow.save();
}

export function handlePendingDeposit(event: PendingDeposit): void {
  let redeemableERC20ClaimEscrow = getRedeemableERC20ClaimEscrow(
    event.address.toHex()
  );
  let redeemableEscrowPendingDeposit = new RedeemableEscrowPendingDeposit(
    event.transaction.hash.toHex()
  );
  redeemableEscrowPendingDeposit.depositorAddress = event.params.sender;
  redeemableEscrowPendingDeposit.escrow = redeemableERC20ClaimEscrow.id;
  redeemableEscrowPendingDeposit.escrowAddress = event.address;
  redeemableEscrowPendingDeposit.iSaleAddress = event.params.sale;
  redeemableEscrowPendingDeposit.amount = event.params.amount;

  let redeemableERC20 = RedeemableERC20.load(event.params.redeemable.toHex());
  if (redeemableERC20 != null)
    redeemableEscrowPendingDeposit.redeemable = redeemableERC20.id;

  let token = getERC20(event.params.token, event.block);
  redeemableEscrowPendingDeposit.token = token.id;
  redeemableEscrowPendingDeposit.tokenAddress = event.params.token;

  let iSale = getIsale(event.params.sale.toHex());
  redeemableEscrowPendingDeposit.iSale = iSale;

  let depositor = getRedeemableEscrowDepositor(
    event.address.toHex(),
    event.params.sender
  );
  let DpendingDeposits = depositor.pendingDeposits;
  if (DpendingDeposits)
    DpendingDeposits.push(redeemableEscrowPendingDeposit.id);
  depositor.pendingDeposits = DpendingDeposits;
  depositor.save();

  let repdt = getRedeemableEscrowPendingDepositorToken(
    Address.fromString(iSale),
    event.address,
    event.params.sender,
    event.params.token
  );

  repdt.totalDeposited = repdt.totalDeposited.plus(event.params.amount);

  let repdtPendingDeposits = repdt.pendingDeposits;

  if (repdtPendingDeposits)
    repdtPendingDeposits.push(redeemableEscrowPendingDeposit.id);
  repdt.pendingDeposits = repdtPendingDeposits;

  repdt.save();

  let DpendingDepositorTokens = depositor.pendingDepositorTokens;
  if (DpendingDepositorTokens && !DpendingDepositorTokens.includes(repdt.id))
    DpendingDepositorTokens.push(repdt.id);
  depositor.pendingDepositorTokens = DpendingDepositorTokens;

  depositor.save();

  redeemableEscrowPendingDeposit.depositor = depositor.id;

  redeemableEscrowPendingDeposit.save();

  let pendingDeposits = redeemableERC20ClaimEscrow.pendingDeposits;
  if (pendingDeposits) pendingDeposits.push(redeemableEscrowPendingDeposit.id);
  redeemableERC20ClaimEscrow.pendingDeposits = pendingDeposits;

  let depositors = redeemableERC20ClaimEscrow.depositors;
  if (depositors && !depositors.includes(depositor.id)) {
    depositors.push(depositor.id);
  }
  redeemableERC20ClaimEscrow.depositors = depositors;

  let pendingDepositorTokens =
    redeemableERC20ClaimEscrow.pendingDepositorTokens;
  if (pendingDepositorTokens && !pendingDepositorTokens.includes(repdt.id))
    pendingDepositorTokens.push(repdt.id);
  redeemableERC20ClaimEscrow.pendingDepositorTokens = pendingDepositorTokens;

  redeemableERC20ClaimEscrow.save();
}

export function handleSweep(event: Sweep): void {
  let sale = Sale.load(event.params.sale.toHex());
  if (sale) {
    if (
      SaleStatus.Success == sale.saleStatus ||
      SaleStatus.Fail == sale.saleStatus
    ) {
      let repdt = getRedeemableEscrowPendingDepositorToken(
        event.params.sale,
        event.address,
        event.params.depositor,
        event.params.token
      );
      repdt.swept = true;
      repdt.save();
    }
  }
}

export function handleUndeposit(event: Undeposit): void {
  let redeemableERC20ClaimEscrow = getRedeemableERC20ClaimEscrow(
    event.address.toHex()
  );

  let redeemableEscrowUndeposit = new RedeemableEscrowUndeposit(
    event.transaction.hash.toHex()
  );
  redeemableEscrowUndeposit.sender = event.params.sender;
  redeemableEscrowUndeposit.escrow = event.address.toHex();
  redeemableEscrowUndeposit.escrowAddress = event.address;
  redeemableEscrowUndeposit.iSaleAddress = event.params.sale;

  let iSale = getIsale(event.params.sale.toHex());
  redeemableEscrowUndeposit.iSale = iSale;

  let token = getERC20(event.params.token, event.block);
  redeemableEscrowUndeposit.token = token.id;
  redeemableEscrowUndeposit.tokenAddress = event.params.token;
  redeemableEscrowUndeposit.tokenAmount = event.params.amount;
  redeemableEscrowUndeposit.redeemableSupply = event.params.supply;

  redeemableEscrowUndeposit.save();

  let undeposits = redeemableERC20ClaimEscrow.undeposits;
  if (undeposits) undeposits.push(redeemableEscrowUndeposit.id);
  redeemableERC20ClaimEscrow.undeposits = undeposits;

  redeemableERC20ClaimEscrow.save();

  let depositor = getRedeemableEscrowDepositor(
    event.address.toHex(),
    event.params.sender
  );
  let dUndeposits = depositor.undeposits;
  if (dUndeposits) dUndeposits.push(redeemableEscrowUndeposit.id);
  depositor.undeposits = dUndeposits;

  depositor.save();

  let redeemableEscrowSupplyTokenDepositor =
    getRedeemableEscrowSupplyTokenDepositor(
      event.params.sale,
      event.address,
      event.params.supply,
      event.params.token,
      event.params.sender
    );

  let STDundeposits = redeemableEscrowSupplyTokenDepositor.undeposits;
  if (STDundeposits) STDundeposits.push(redeemableEscrowUndeposit.id);
  redeemableEscrowSupplyTokenDepositor.undeposits = STDundeposits;

  if (redeemableEscrowSupplyTokenDepositor.totalRemaining != ZERO_BI)
    redeemableEscrowSupplyTokenDepositor.totalRemaining =
      redeemableEscrowSupplyTokenDepositor.totalRemaining.minus(
        event.params.amount
      );

  redeemableEscrowSupplyTokenDepositor.save();

  let redeemableEscrowSupplyTokenDeposit =
    getRedeemableEscrowSupplyTokenDeposit(
      Address.fromString(iSale),
      event.address,
      event.params.supply,
      event.params.token
    );

  redeemableEscrowSupplyTokenDeposit.totalRemaining =
    redeemableEscrowSupplyTokenDeposit.totalRemaining.minus(
      event.params.amount
    );

  redeemableEscrowSupplyTokenDeposit.save();
}

export function handleWithdraw(event: Withdraw): void {
  let redeemableERC20ClaimEscrow = getRedeemableERC20ClaimEscrow(
    event.address.toHex()
  );

  let redeemableEscrowWithdraw = new RedeemableEscrowWithdraw(
    event.transaction.hash.toHex()
  );
  redeemableEscrowWithdraw.withdrawer = event.params.withdrawer;
  redeemableEscrowWithdraw.escrow = event.address.toHex();
  redeemableEscrowWithdraw.escrowAddress = event.address;
  redeemableEscrowWithdraw.iSaleAddress = event.params.sale;

  let iSale = getIsale(event.params.sale.toHex());
  redeemableEscrowWithdraw.iSale = iSale;

  redeemableEscrowWithdraw.redeemable = event.params.redeemable.toHex();

  let token = getERC20(event.params.token, event.block);
  redeemableEscrowWithdraw.tokenAddress = event.params.token;
  redeemableEscrowWithdraw.token = token.id;
  redeemableEscrowWithdraw.redeemableSupply = event.params.supply;
  redeemableEscrowWithdraw.tokenAmount = event.params.amount;

  redeemableEscrowWithdraw.save();

  let withdraws = redeemableERC20ClaimEscrow.withdraws;
  if (withdraws) withdraws.push(redeemableEscrowWithdraw.id);
  redeemableERC20ClaimEscrow.withdraws = withdraws;

  let redeemableEscrowWithdrawer = getRedeemableEscrowWithdrawer(
    event.address,
    event.params.withdrawer
  );

  let rWithdraws = redeemableEscrowWithdrawer.withdraws;
  if (rWithdraws) rWithdraws.push(redeemableEscrowWithdraw.id);
  redeemableEscrowWithdrawer.withdraws = rWithdraws;

  redeemableEscrowWithdrawer.save();

  let withdrawers = redeemableERC20ClaimEscrow.withdrawers;
  if (withdrawers && !withdrawers.includes(redeemableEscrowWithdrawer.id))
    withdrawers.push(redeemableEscrowWithdrawer.id);
  redeemableERC20ClaimEscrow.withdrawers = withdrawers;

  // here1 RedeemableEscrowSupplyTokenDeposit - getRedeemableEscrowSupplyTokenDeposit
  let redeemableEscrowSupplyTokenDeposit =
    getRedeemableEscrowSupplyTokenDeposit(
      Address.fromString(iSale),
      event.address,
      event.params.supply,
      event.params.token
    );

  redeemableEscrowSupplyTokenDeposit.totalRemaining =
    redeemableEscrowSupplyTokenDeposit.totalRemaining.minus(
      event.params.amount
    );

  // here2 RedeemableEscrowSupplyTokenWithdrawer - getRedeemableEscrowSupplyTokenWithdrawer
  let redeemableEscrowSupplyTokenWithdrawer =
    getRedeemableEscrowSupplyTokenWithdrawer(
      Address.fromString(iSale),
      event.address,
      event.params.supply,
      event.params.token,
      event.params.withdrawer
    );

  redeemableEscrowSupplyTokenWithdrawer.deposit =
    redeemableEscrowSupplyTokenDeposit.id;

  redeemableEscrowSupplyTokenWithdrawer.totalWithdrawn =
    redeemableEscrowSupplyTokenWithdrawer.totalWithdrawn.plus(
      event.params.amount
    );

  redeemableEscrowSupplyTokenWithdrawer.totalWithdrawnAgainst =
    redeemableEscrowSupplyTokenDeposit.totalDeposited;

  let rSWithdraws = redeemableEscrowSupplyTokenWithdrawer.withdraws;
  if (rSWithdraws) rSWithdraws.push(redeemableEscrowWithdraw.id);
  redeemableEscrowSupplyTokenWithdrawer.withdraws = rSWithdraws;

  redeemableEscrowSupplyTokenWithdrawer.deposit =
    redeemableEscrowSupplyTokenDeposit.id;

  let holder = Holder.load(
    event.params.redeemable.toHex() +
      " - " +
      redeemableEscrowSupplyTokenWithdrawer.withdrawerAddress.toHex()
  );

  if (holder && event.params.supply != ZERO_BI) {
    redeemableEscrowSupplyTokenWithdrawer.redeemableBalance = holder.balance;
    redeemableEscrowSupplyTokenWithdrawer.claimable =
      redeemableEscrowSupplyTokenDeposit.totalDeposited
        .minus(redeemableEscrowSupplyTokenWithdrawer.totalWithdrawnAgainst)
        .times(holder.balance)
        .div(event.params.supply);
  }

  redeemableEscrowSupplyTokenWithdrawer.save();

  let RSDTWithdraws = redeemableEscrowSupplyTokenDeposit.withdraws;

  if (RSDTWithdraws) {
    let len = RSDTWithdraws.length;
    for (let i = 0; i < len; i++) {
      let RSDTWithdrawer = RedeemableEscrowSupplyTokenWithdrawer.load(
        RSDTWithdraws[i]
      );
      if (RSDTWithdrawer) {
        let holder = Holder.load(
          event.params.redeemable.toHex() +
            " - " +
            RSDTWithdrawer.withdrawerAddress.toHex()
        );

        if (holder && event.params.supply != ZERO_BI) {
          redeemableEscrowSupplyTokenWithdrawer.redeemableBalance =
            holder.balance;
          redeemableEscrowSupplyTokenWithdrawer.claimable =
            redeemableEscrowSupplyTokenDeposit.totalDeposited
              .minus(
                redeemableEscrowSupplyTokenWithdrawer.totalWithdrawnAgainst
              )
              .times(holder.balance)
              .div(event.params.supply);
        }

        RSDTWithdrawer.save();
      }
    }

    RSDTWithdraws.push(redeemableEscrowSupplyTokenWithdrawer.id);
  }

  redeemableEscrowSupplyTokenDeposit.withdraws = RSDTWithdraws;

  redeemableEscrowSupplyTokenDeposit.save();

  let supplyTokenWithdrawers =
    redeemableERC20ClaimEscrow.supplyTokenWithdrawers;
  if (supplyTokenWithdrawers)
    supplyTokenWithdrawers.push(redeemableEscrowSupplyTokenWithdrawer.id);

  redeemableERC20ClaimEscrow.supplyTokenWithdrawers = supplyTokenWithdrawers;

  redeemableERC20ClaimEscrow.save();
}

function getRedeemableERC20ClaimEscrow(
  address: string
): RedeemableERC20ClaimEscrow {
  let redeemableERC20ClaimEscrow = RedeemableERC20ClaimEscrow.load(address);
  if (redeemableERC20ClaimEscrow == null) {
    redeemableERC20ClaimEscrow = new RedeemableERC20ClaimEscrow(address);
    redeemableERC20ClaimEscrow.address = Address.fromString(address);
    redeemableERC20ClaimEscrow.pendingDeposits = [];
    redeemableERC20ClaimEscrow.deposits = [];
    redeemableERC20ClaimEscrow.undeposits = [];
    redeemableERC20ClaimEscrow.withdraws = [];
    redeemableERC20ClaimEscrow.pendingDepositorTokens = [];
    redeemableERC20ClaimEscrow.supplyTokenDeposits = [];
    redeemableERC20ClaimEscrow.supplyTokenDepositors = [];
    redeemableERC20ClaimEscrow.supplyTokenWithdrawers = [];
    redeemableERC20ClaimEscrow.depositors = [];
    redeemableERC20ClaimEscrow.withdrawers = [];
    redeemableERC20ClaimEscrow.notices = [];
    redeemableERC20ClaimEscrow.save();
  }
  return redeemableERC20ClaimEscrow as RedeemableERC20ClaimEscrow;
}

function getRedeemableEscrowDepositor(
  escrow: string,
  address: Address
): RedeemableEscrowDepositor {
  let redeemableEscrowDepositor = RedeemableEscrowDepositor.load(
    escrow + " - " + address.toHex()
  );
  if (redeemableEscrowDepositor == null) {
    redeemableEscrowDepositor = new RedeemableEscrowDepositor(
      escrow + " - " + address.toHex()
    );
    redeemableEscrowDepositor.address = address;
    redeemableEscrowDepositor.pendingDepositorTokens = [];
    redeemableEscrowDepositor.supplyTokenDeposits = [];
    redeemableEscrowDepositor.pendingDeposits = [];
    redeemableEscrowDepositor.deposits = [];
    redeemableEscrowDepositor.undeposits = [];
    redeemableEscrowDepositor.save();
  }
  return redeemableEscrowDepositor as RedeemableEscrowDepositor;
}

function getIsale(iSale: string): string {
  let contract = SaleContract.bind(Address.fromString(iSale));
  let sale = Sale.load(iSale);
  if (sale != null) {
    sale.saleStatus = contract.saleStatus();
    sale.save();
    return sale.id;
  }
  let unknownSale = UnknownSale.load(iSale);
  if (unknownSale == null) {
    unknownSale = new UnknownSale(iSale);
    unknownSale.address = Address.fromString(iSale);
  }
  unknownSale.saleStatus = contract.saleStatus();
  unknownSale.save();
  return unknownSale.id;
}

function getRedeemableEscrowPendingDepositorToken(
  sale: Address,
  escrow: Address,
  depositor: Address,
  token: Address
): RedeemableEscrowPendingDepositorToken {
  let REPDT = RedeemableEscrowPendingDepositorToken.load(
    sale.toHex() +
      " - " +
      escrow.toHex() +
      " - " +
      depositor.toHex() +
      " - " +
      token.toHex()
  );
  if (REPDT == null) {
    REPDT = new RedeemableEscrowPendingDepositorToken(
      sale.toHex() +
        " - " +
        escrow.toHex() +
        " - " +
        depositor.toHex() +
        " - " +
        token.toHex()
    );
    REPDT.iSale = sale.toHex();
    REPDT.iSaleAddress = sale;
    REPDT.escrow = escrow.toHex();
    REPDT.escrowAddress = escrow;
    REPDT.depositor = escrow.toHex() + " - " + depositor.toHex();
    REPDT.depositorAddress = depositor;
    REPDT.pendingDeposits = [];
    REPDT.token = token.toHex();
    REPDT.tokenAddress = token;
    REPDT.totalDeposited = ZERO_BI;
    REPDT.swept = false;
  }
  return REPDT as RedeemableEscrowPendingDepositorToken;
}

function getRedeemableEscrowSupplyTokenDeposit(
  sale: Address,
  escrow: Address,
  supply: BigInt,
  token: Address
): RedeemableEscrowSupplyTokenDeposit {
  let redeemableEscrowSupplyTokenDeposit =
    RedeemableEscrowSupplyTokenDeposit.load(
      sale.toHex() +
        " - " +
        escrow.toHex() +
        " - " +
        supply.toString() +
        " - " +
        token.toHex()
    );
  if (redeemableEscrowSupplyTokenDeposit == null) {
    redeemableEscrowSupplyTokenDeposit = new RedeemableEscrowSupplyTokenDeposit(
      sale.toHex() +
        " - " +
        escrow.toHex() +
        " - " +
        supply.toString() +
        " - " +
        token.toHex()
    );
    redeemableEscrowSupplyTokenDeposit.iSale = sale.toHex();
    redeemableEscrowSupplyTokenDeposit.iSaleAddress = sale;
    redeemableEscrowSupplyTokenDeposit.escrow = escrow.toHex();
    redeemableEscrowSupplyTokenDeposit.escrowAddress = escrow;
    redeemableEscrowSupplyTokenDeposit.deposits = [];
    redeemableEscrowSupplyTokenDeposit.depositors = [];
    redeemableEscrowSupplyTokenDeposit.withdraws = [];
    redeemableEscrowSupplyTokenDeposit.depositorAddress = [];
    redeemableEscrowSupplyTokenDeposit.redeemableSupply = supply;
    redeemableEscrowSupplyTokenDeposit.token = token.toHex();
    redeemableEscrowSupplyTokenDeposit.tokenAddress = token;
    redeemableEscrowSupplyTokenDeposit.totalDeposited = ZERO_BI;
    redeemableEscrowSupplyTokenDeposit.totalRemaining = ZERO_BI;
  }
  return redeemableEscrowSupplyTokenDeposit as RedeemableEscrowSupplyTokenDeposit;
}

function getRedeemableEscrowWithdrawer(
  escrow: Address,
  account: Address
): RedeemableEscrowWithdrawer {
  let redeemableEscrowWithdrawer = RedeemableEscrowWithdrawer.load(
    escrow.toHex() + " - " + account.toHex()
  );
  if (redeemableEscrowWithdrawer == null) {
    redeemableEscrowWithdrawer = new RedeemableEscrowWithdrawer(
      escrow.toHex() + " - " + account.toHex()
    );
    redeemableEscrowWithdrawer.address = account;
    redeemableEscrowWithdrawer.escrow = escrow.toHex();
    redeemableEscrowWithdrawer.escrowAddress = escrow;
    redeemableEscrowWithdrawer.withdraws = [];
  }

  return redeemableEscrowWithdrawer as RedeemableEscrowWithdrawer;
}

function getRedeemableEscrowSupplyTokenDepositor(
  sale: Address,
  escrow: Address,
  supply: BigInt,
  token: Address,
  depositor: Address
): RedeemableEscrowSupplyTokenDepositor {
  let RESTD = RedeemableEscrowSupplyTokenDepositor.load(
    sale.toHex() +
      " - " +
      escrow.toHex() +
      " - " +
      supply.toString() +
      " - " +
      token.toHex() +
      " - " +
      depositor.toHex()
  );

  if (!RESTD) {
    RESTD = new RedeemableEscrowSupplyTokenDepositor(
      sale.toHex() +
        " - " +
        escrow.toHex() +
        " - " +
        supply.toString() +
        " - " +
        token.toHex() +
        " - " +
        depositor.toHex()
    );
    RESTD.iSale = getIsale(sale.toHex());
    RESTD.iSaleAddress = sale;
    RESTD.escrow = escrow.toHex();
    RESTD.escrowAddress = escrow;
    RESTD.despositor = getRedeemableEscrowDepositor(
      escrow.toHex(),
      depositor
    ).id;
    RESTD.depositorAddress = depositor;
    RESTD.deposits = [];
    RESTD.undeposits = [];
    RESTD.token = token.toHex();
    RESTD.tokenAddress = token;
    RESTD.redeemableSupply = supply;
    RESTD.totalDeposited = ZERO_BI;
    RESTD.totalRemaining = ZERO_BI;
    RESTD.save();
  }
  return RESTD as RedeemableEscrowSupplyTokenDepositor;
}

function getRedeemableEscrowSupplyTokenWithdrawer(
  sale: Address,
  escrow: Address,
  supply: BigInt,
  token: Address,
  withdrawer: Address
): RedeemableEscrowSupplyTokenWithdrawer {
  let RESTW = RedeemableEscrowSupplyTokenWithdrawer.load(
    sale.toHex() +
      " - " +
      escrow.toHex() +
      " - " +
      supply.toString() +
      " - " +
      token.toHex() +
      " - " +
      withdrawer.toHex()
  );

  if (!RESTW) {
    RESTW = new RedeemableEscrowSupplyTokenWithdrawer(
      sale.toHex() +
        " - " +
        escrow.toHex() +
        " - " +
        supply.toString() +
        " - " +
        token.toHex() +
        " - " +
        withdrawer.toHex()
    );

    RESTW.withdrawerAddress = withdrawer;
    RESTW.withdraws = [];
    RESTW.totalWithdrawn = ZERO_BI;
    RESTW.claimable = ZERO_BI;
    RESTW.totalWithdrawnAgainst = ZERO_BI;
    RESTW.iSale = getIsale(sale.toHex());
    RESTW.iSaleAddress = sale;
  }

  return RESTW as RedeemableEscrowSupplyTokenWithdrawer;
}
