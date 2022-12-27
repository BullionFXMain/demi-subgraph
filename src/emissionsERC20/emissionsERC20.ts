import {
  Initialize,
  Claim,
  Transfer,
  EmissionsERC20 as EmissionsERC20Contract,
} from "../../generated/templates/EmissionsERC20Template/EmissionsERC20";
import {
  EmissionsERC20,
  EmissionsERC20Claim,
  EmissionsERC20StateConfig,
} from "../../generated/schema";
import { ZERO_ADDRESS } from "../utils";
export function handleInitialize(event: Initialize): void {
  let emissionsERC20 = EmissionsERC20.load(event.address.toHex());
  if (emissionsERC20) {
    let stateConfig = new EmissionsERC20StateConfig(
      event.transaction.hash.toHex()
    );
    stateConfig.sources = event.params.config.vmStateConfig.sources;
    stateConfig.constants = event.params.config.vmStateConfig.constants;

    emissionsERC20.calculateClaimStateConfig = stateConfig.id;
    emissionsERC20.allowDelegatedClaims =
      event.params.config.allowDelegatedClaims;

    stateConfig.save();
    emissionsERC20.save();
  }
}

export function handleClaim(event: Claim): void {
  let emissionsERC20Claim = EmissionsERC20Claim.load(
    event.transaction.hash.toHex()
  );

  if (emissionsERC20Claim) {
    emissionsERC20Claim.block = event.block.number;
    emissionsERC20Claim.timestamp = event.block.timestamp;
    emissionsERC20Claim.sender = event.params.sender;
    emissionsERC20Claim.claimant = event.params.claimant;
    emissionsERC20Claim.data = event.params.data;
    emissionsERC20Claim.emissionsERC20 = event.address.toHex();
    emissionsERC20Claim.save();

    let emissionsERC20 = EmissionsERC20.load(event.address.toHex());
    if (emissionsERC20) {
      let claims = emissionsERC20.claims;
      if (claims) claims.push(emissionsERC20Claim.id);
      emissionsERC20.claims = claims;
      emissionsERC20.save();
    }
  }
}

export function handleTransfer(event: Transfer): void {
  let emissionsERC20Claim = new EmissionsERC20Claim(
    event.transaction.hash.toHex()
  );

  emissionsERC20Claim.amount = event.params.value;
  emissionsERC20Claim.save();

  if (event.params.from.toHex() == ZERO_ADDRESS) {
    let emissionsERC20Contract = EmissionsERC20Contract.bind(event.address);
    let emissionsERC20 = EmissionsERC20.load(event.address.toHex());
    if (emissionsERC20) {
      emissionsERC20.totalSupply = emissionsERC20Contract.totalSupply();
      emissionsERC20.save();
    }
  }
}
