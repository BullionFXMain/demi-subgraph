import { CombineTier, CombineTierStateConfig } from "../../generated/schema";
import { Initialize } from "../../generated/templates/CombineTierTemplate/CombineTier";

export function handleInitialize(event: Initialize): void {
  let combineTier = CombineTier.load(event.address.toHex());

  if (combineTier) {
    let stateConfig = new CombineTierStateConfig(
      event.transaction.hash.toHex()
    );
    stateConfig.sources = event.params.config.sourceConfig.sources;
    stateConfig.constants = event.params.config.sourceConfig.constants;

    combineTier.combinedTiersLength = event.params.config.combinedTiersLength;
    combineTier.state = stateConfig.id;

    stateConfig.save();
    combineTier.save();
  }
}
