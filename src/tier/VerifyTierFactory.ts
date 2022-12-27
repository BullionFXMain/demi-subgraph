import {
  NewChild,
  Implementation,
} from "../../generated/VerifyTierFactory/VerifyTierFactory";
import { VerifyTierFactory, VerifyTier } from "../../generated/schema";
import { VerifyTierTemplate } from "../../generated/templates";
import { ONE_BI, ZERO_BI } from "../utils";

export function handleNewChild(event: NewChild): void {
  let verifyTierFactory = VerifyTierFactory.load(event.address.toHex());

  let verifyTier = new VerifyTier(event.params.child.toHex());

  verifyTier.address = event.params.child;
  verifyTier.deployBlock = event.block.number;
  verifyTier.deployTimestamp = event.block.timestamp;
  verifyTier.deployer = event.transaction.from;
  verifyTier.factory = event.address.toHex();
  verifyTier.notices = [];

  if (verifyTierFactory) {
    let children = verifyTierFactory.children;
    if (children) children.push(verifyTier.id);
    verifyTierFactory.children = children;
    verifyTierFactory.childrenCount =
      verifyTierFactory.childrenCount.plus(ONE_BI);
    verifyTierFactory.save();
  }

  verifyTier.save();
  event.block;

  VerifyTierTemplate.create(event.params.child);
}

export function handleImplementation(event: Implementation): void {
  let verifyTierFactory = new VerifyTierFactory(event.address.toHex());
  verifyTierFactory.implementation = event.params.implementation;
  verifyTierFactory.address = event.address;
  verifyTierFactory.children = [];
  verifyTierFactory.childrenCount = ZERO_BI;
  verifyTierFactory.save();
}
