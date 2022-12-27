import { Address } from "@graphprotocol/graph-ts";
import { VerifyTier, Verify } from "../../generated/schema";
import { Initialize } from "../../generated/templates/VerifyTierTemplate/VerifyTier";
import { ZERO_ADDRESS, ZERO_BI } from "../utils";

export function handleInitialize(event: Initialize): void {
  let verifyTier = VerifyTier.load(event.address.toHex());

  let verify = Verify.load(event.params.verify.toHex());
  if (verify == null) {
    verify = new Verify(event.params.verify.toHex());
    verify.address = event.params.verify;
    verify.deployBlock = ZERO_BI;
    verify.deployTimestamp = ZERO_BI;
    verify.deployer = Address.fromString(ZERO_ADDRESS);
    verify.factory = ZERO_ADDRESS;
    verify.verifyAddresses = [];
    verify.approvers = [];
    verify.removers = [];
    verify.banners = [];
    verify.approverAdmins = [];
    verify.bannerAdmins = [];
    verify.removerAdmins = [];
    verify.verifyEventCount = ZERO_BI;
    verify.save();
  }

  if (verifyTier) {
    verifyTier.verifyContract = verify.id;

    verifyTier.save();
  }
}
