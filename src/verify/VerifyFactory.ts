import {
  NewChild,
  Implementation,
} from "../../generated/VerifyFactory/VerifyFactory";
import { VerifyFactory, Verify } from "../../generated/schema";
import { VerifyTemplate } from "../../generated/templates";
import { ZERO_BI } from "../utils";

/**
 * @description Hnadler for NewChild event emited from VerifyFactory contract
 * @param event NewChild event
 */
export function handleNewChild(event: NewChild): void {
  // Load the VerifyFactory entity
  let verifyFactory = VerifyFactory.load(event.address.toHex());

  // Create a new Verify Contract entity with default values
  let verify = new Verify(event.params.child.toHex());
  verify.address = event.params.child;
  verify.deployBlock = event.block.number;
  verify.deployTimestamp = event.block.timestamp;
  verify.deployer = event.transaction.from;
  verify.verifyEventCount = ZERO_BI;
  verify.verifyAddresses = [];
  verify.verifyRequestApprovals = [];
  verify.verifyRequestBans = [];
  verify.verifyRequestRemovals = [];
  verify.verifyApprovals = [];
  verify.verifyRemovals = [];
  verify.verifyBans = [];
  verify.approvers = [];
  verify.removers = [];
  verify.banners = [];
  verify.approverAdmins = [];
  verify.bannerAdmins = [];
  verify.removerAdmins = [];
  verify.notices = [];

  // Add the new verify contract entity in VerifyFactory entity
  if (verifyFactory) {
    verify.factory = verifyFactory.id;
    verify.save();

    let children = verifyFactory.children;
    if (children) children.push(verify.id);
    verifyFactory.children = children;
    verifyFactory.save();
  }

  // Create a dynamic Datasource to index Verify contract events
  VerifyTemplate.create(event.params.child);
}

/**
 * @description handler for Implementation event of Verify Factory
 *              This is the first event emited by VerifyFactiry
 * @param event Implementation event
 */
export function handleImplementation(event: Implementation): void {
  let verifyFactory = new VerifyFactory(event.address.toHex());
  verifyFactory.address = event.address;
  verifyFactory.implementation = event.params.implementation;
  verifyFactory.children = [];

  verifyFactory.save();
}
