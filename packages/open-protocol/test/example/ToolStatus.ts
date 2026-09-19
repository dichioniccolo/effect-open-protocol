/**
 * The definitions a user writes for the worked example: a status MID with two
 * revisions, the request that asks for it, and the subscription to its pushes.
 *
 * MIDs 9100 to 9104 and their layouts are illustrative, made up for this
 * example; they are not taken from the Open Protocol specification.
 */
import * as Field from "../../src/protocol/Field.ts"
import { commandAccepted } from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"

const status = [
  ["toolId", Field.digits({ id: "01", width: 3 })],
  ["temperature", Field.digits({ id: "02", width: 4 })]
] as const

/** MID 9101: a tool's status. Revision 2 appends the motor hours. */
export const ToolStatus = Mid.define({
  tag: "ToolStatus",
  mid: 9101,
  revisions: {
    1: Field.layout(status),
    2: Field.layout([...status, ["motorHours", Field.digits({ id: "03", width: 6 })]])
  }
})

/** MID 9100: asks for a tool's status, answered at the same revision. */
export const ToolStatusRequest = Mid.request(
  Mid.define({
    tag: "ToolStatusRequest",
    mid: 9100,
    revisions: {
      1: Field.layout([["toolId", Field.digits({ width: 3 })]]),
      2: Field.layout([["toolId", Field.digits({ width: 3 })]])
    }
  }),
  { 1: ToolStatus.rev(1), 2: ToolStatus.rev(2) }
)

const bare = (tag: string, mid: number) => Mid.define({ tag, mid, revisions: { 1: Field.layout([]) } })

/** MID 9102: subscribes to MID 9101 at the same revision, accepted with 0005. */
export const SubscribeToolStatus = Mid.request(
  Mid.define({ tag: "SubscribeToolStatus", mid: 9102, revisions: { 1: Field.layout([]), 2: Field.layout([]) } }),
  { 1: commandAccepted, 2: commandAccepted }
)

/** MID 9103: acknowledges a pushed status; nothing answers it. */
const AcknowledgeToolStatus = bare("AcknowledgeToolStatus", 9103)

/** MID 9104: stops the pushes, accepted with 0005. */
const UnsubscribeToolStatus = Mid.request(bare("UnsubscribeToolStatus", 9104), { 1: commandAccepted })

/** MID 9101 pushed after MID 9102, acknowledged with MID 9103, stopped with MID 9104. */
export const ToolStatusSubscription = Mid.subscription(ToolStatus, {
  1: {
    subscribe: SubscribeToolStatus.rev(1),
    ack: AcknowledgeToolStatus.rev(1),
    unsubscribe: UnsubscribeToolStatus.rev(1)
  },
  2: {
    subscribe: SubscribeToolStatus.rev(2),
    ack: AcknowledgeToolStatus.rev(1),
    unsubscribe: UnsubscribeToolStatus.rev(1)
  }
})
