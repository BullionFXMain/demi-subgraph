import { NewNotice } from "../generated/NoticeBoard/NoticeBoard";
import {
  UnknownTier,
  Notice,
  Sale,
  Verify,
  VerifyTier,
  CombineTier,
  RedeemableERC20ClaimEscrow,
  UnknownNotice,
} from "../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

/**
 * @description handler of NewNotice event
 * @param event NewNotice Event
 */
export function handleNewNotice(event: NewNotice): void {
  /**
   * Get the subject of event i.e to which contract the notice is sent
   * Currently we only save notice which sent to Trust, Sale, Verify
   * ERC20BalancerTier, ERC20TransferTier, ERC721BalanceTIer, CombineTier
   * UnknownTier, GatedNFT, RedeemableERC20ClaimEscrow
   */
  let subject = event.params.notice.subject.toHex();

  let newNotice: Notice; // Empty notice object

  /**
   * load all the bojects to compare
   */
  let sale = Sale.load(subject);
  let verify = Verify.load(subject);
  let verifyTier = VerifyTier.load(subject);
  let combineTier = CombineTier.load(subject);
  let unknownTier = UnknownTier.load(subject);
  let redeemableERC20ClaimEscrow = RedeemableERC20ClaimEscrow.load(subject);

  /**
   * check if subject is from which Entity and add the newNotice to it
   * else Create a UnknownNotice Entitiy and add notice in it
   */
  if (sale) {
    let notices = sale.notices;

    if (notices) {
      newNotice = new Notice(
        sale.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;

      newNotice.subject = sale.id;
      notices.push(newNotice.id);
      sale.notices = notices;

      newNotice.save();
      sale.save();
    }
  } else if (verify) {
    let notices = verify.notices;

    if (notices) {
      newNotice = new Notice(
        verify.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;
      newNotice.subject = verify.id;

      notices.push(newNotice.id);
      verify.notices = notices;

      newNotice.save();
      verify.save();
    }
  } else if (verifyTier) {
    let notices = verifyTier.notices;

    if (notices) {
      newNotice = new Notice(
        verifyTier.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;

      newNotice.subject = verifyTier.id;
      notices.push(newNotice.id);
      verifyTier.notices = notices;

      newNotice.save();
      verifyTier.save();
    }
  } else if (combineTier) {
    let notices = combineTier.notices;

    if (notices) {
      newNotice = new Notice(
        combineTier.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;

      newNotice.subject = combineTier.id;
      notices.push(newNotice.id);
      combineTier.notices = notices;

      newNotice.save();
      combineTier.save();
    }
  } else if (redeemableERC20ClaimEscrow) {
    let notices = redeemableERC20ClaimEscrow.notices;

    if (notices) {
      newNotice = new Notice(
        redeemableERC20ClaimEscrow.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;

      newNotice.subject = redeemableERC20ClaimEscrow.id;
      notices.push(newNotice.id);
      redeemableERC20ClaimEscrow.notices = notices;

      newNotice.save();
      redeemableERC20ClaimEscrow.save();
    }
  } else if (unknownTier) {
    let notices = unknownTier.notices;

    if (notices) {
      newNotice = new Notice(
        unknownTier.id +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;

      newNotice.subject = unknownTier.id;
      notices.push(newNotice.id);
      unknownTier.notices = notices;

      newNotice.save();
      unknownTier.save();
    }
  } else {
    let unknownNotice = UnknownNotice.load("UNKNOWN_NOTICES");
    if (unknownNotice == null) {
      unknownNotice = new UnknownNotice("UNKNOWN_NOTICES");
      unknownNotice.notices = [];
    }

    let notices = unknownNotice.notices;

    if (notices) {
      newNotice = new Notice(
        "UNKNOWN_NOTICES" +
          " - " +
          event.transaction.hash.toHex() +
          " - " +
          BigInt.fromI32(notices.length).toString()
      );
      newNotice.data = event.params.notice.data;
      newNotice.sender = event.params.sender;
      newNotice.deployBlock = event.block.number;
      newNotice.deployTimestamp = event.block.timestamp;
      newNotice.subject = "UNKNOWN_NOTICES";

      notices.push(newNotice.id);
      unknownNotice.notices = notices;

      newNotice.save();
      unknownNotice.save();
    }
  }
}
