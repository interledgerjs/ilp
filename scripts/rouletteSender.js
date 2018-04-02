const PluginBtp = require('ilp-plugin-btp')
const ILP = require('..')

// The threshold for accepting a chunk is
// the average seen so far, times a factor that
// goes from INITIAL_OPTIMISM to 0.0, dropping
// by 1.0 each TARGET_NUM_CHUNKS chunks
const TARGET_NUM_CHUNKS = 100
const INITIAL_OPTIMISM = 2.5

;(async function test () {
  const pluginOut = new PluginBtp({ server: 'btp+ws://:pluginOut@localhost:8912/' })
  const pluginIn = new PluginBtp({ server: 'btp+ws://:pluginIn@localhost:8913/' })
  console.log('connecting plugin 2')
  await pluginIn.connect()
  console.log('connecting plugin 1')
  await pluginOut.connect()
  console.log('connected plugins')
  const loop = await ILP.LT.createLoop({ pluginOut, pluginIn })
  let cummSeen = 0
  let numSeen = 0
  let numAccepted = 0

  async function payOnce () {
    let destinationAmountSeen
    const result = await loop.pay({
      sourceAmount: '1',
      expiresAt: new Date(new Date().getTime() + 10000),
      loopbackHandler: (destinationAmount) => {
        destinationAmountSeen = parseInt(destinationAmount)
        cummSeen += destinationAmountSeen
        numSeen++
        const avg = (cummSeen / numSeen)
        const progress = (numSeen / TARGET_NUM_CHUNKS)
        // Optimism drops from a factor INITIAL_OPTIMISM to INITIAL_OPTIMISM-1 in TARGET_NUM_CHUNKS steps,
        // Then to INITIAL_OPTIMISM-2 in the next TARGET_NUM_CHUNKS steps, etc.
        // until optimism drops under zero, from which point on, all chunks will be accepted.
        const optimism = INITIAL_OPTIMISM - progress
        // console.log({ destinationAmountSeen, threshold: (cummSeen / numSeen) })
        return (destinationAmountSeen > optimism * avg)
      }
    })
    if (result) {
      numAccepted++
      return destinationAmountSeen
    }
    return 0
  }

  let received = 0
  while (received < 100) {
    received += await payOnce()
  }
  console.log({ numAccepted, cummSeen, numSeen, avg: (cummSeen / numSeen), received, avgAccepted: (received / numAccepted) })
  await pluginOut.disconnect()
  await pluginIn.disconnect()
})()
