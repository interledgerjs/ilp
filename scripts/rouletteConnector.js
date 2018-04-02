const PluginMiniAccounts = require('ilp-plugin-mini-accounts')
const PluginBtp = require('ilp-plugin-btp')
const IlpPacket = require('ilp-packet')
const IlDcp = require('ilp-protocol-ildcp')
const PORT = 8912
const MAX_EXCHANGE_RATE = 10

async function run (port) {
  const pluginIn = new PluginMiniAccounts({
    wsOpts: {
      port
    }
  })
  const pluginOut = new PluginBtp({ server: 'btp+ws://:plugin1@localhost:8913/' })
  pluginIn.registerDataHandler(packet => {
    const obj = IlpPacket.deserializeIlpPrepare(packet)
    console.log(obj)
    if (obj.destination === 'peer.config') {
      return IlDcp.serializeIldcpResponse({
        clientAddress: 'connector',
        assetCode: 'USD',
        assetScale: 6
      })
    }
    const exchangeRate = Math.random() * MAX_EXCHANGE_RATE
    obj.amount = '' + Math.floor(parseInt(obj.amount) * exchangeRate)
    console.log(obj.amount, exchangeRate)
    return pluginOut.sendData(IlpPacket.serializeIlpPrepare(obj))
  })
  console.log('connection pluginIn')
  await pluginIn.connect()
  console.log('connection pluginOut')
  await pluginOut.connect()
  console.log('connected')
  console.log(`Listening for ILPv4 over BTP/2.0 on port ${port}`)
}

run(PORT)
