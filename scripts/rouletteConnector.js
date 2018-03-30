const PluginMiniAccounts = require('ilp-plugin-mini-accounts')
const IlpPacket = require('ilp-packet')
const IlDcp = require('ilp-protocol-ildcp')
const PORT = 8912
const MAX_EXCHANGE_RATE = 10

async function run(port) {
  const plugin = new PluginMiniAccounts({
    wsOpts: {
      port
    }
  })
  plugin.registerDataHandler(packet => {
    const obj = IlpPacket.deserializeIlpPrepare(packet)
    console.log(obj)
    if (obj.destination === 'peer.config') {
      return IlDcp.serializeIldcpResponse({
        clientAddress: 'roulette',
        assetCode: 'USD',
        assetScale: 6
      })
    }
    const exchangeRate = Math.random() * MAX_EXCHANGE_RATE
    obj.amount = '' + Math.floor(parseInt(obj.amount) * exchangeRate)
    console.log(obj.amount, exchangeRate)
    return plugin.sendData(IlpPacket.serializeIlpPrepare(obj))
  })
  await plugin.connect()
  console.log(`Listening for ILPv4 over BTP/2.0 on port ${port}`)
}


run(PORT)
