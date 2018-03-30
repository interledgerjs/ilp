const PluginBtp = require('ilp-plugin-btp')
const ILP = require('..')

;(async function test () {
  const plugin1 = new PluginBtp({ server: 'btp+ws://:plugin1@localhost:8912/' })
  const plugin2 = new PluginBtp({ server: 'btp+ws://:plugin2@localhost:8912/' })
  await plugin1.connect()
  await plugin2.connect()
  const loop = await ILP.LT.createLoop(plugin1, plugin2)
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
  await plugin1.disconnect()
  await plugin2.disconnect()
})()
