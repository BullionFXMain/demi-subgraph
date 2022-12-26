import {
  Implementation as ImplementationEvent,
  NewChild as NewChildEvent
} from "../generated/StakeFactory/StakeFactory"
import { Implementation, NewChild } from "../generated/schema"

export function handleImplementation(event: ImplementationEvent): void {
  let entity = new Implementation(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sender = event.params.sender
  entity.implementation = event.params.implementation

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}

export function handleNewChild(event: NewChildEvent): void {
  let entity = new NewChild(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  )
  entity.sender = event.params.sender
  entity.child = event.params.child

  entity.blockNumber = event.block.number
  entity.blockTimestamp = event.block.timestamp
  entity.transactionHash = event.transaction.hash

  entity.save()
}
