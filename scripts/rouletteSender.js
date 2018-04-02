const PluginBtp = require('ilp-plugin-btp')
const ILP = require('..')

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

  async function payOnce() {
    let destinationAmountSeen
    const result = await loop.pay({
      sourceAmount: '1',
      expiresAt: new Date(new Date().getTime() + 10000),
      loopbackHandler: (destinationAmount) => {
        destinationAmountSeen = parseInt(destinationAmount)
        cummSeen += destinationAmountSeen
        numSeen++
        // console.log({ destinationAmountSeen, threshold: (cummSeen / numSeen) })
        return (destinationAmountSeen > (cummSeen/numSeen))
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
