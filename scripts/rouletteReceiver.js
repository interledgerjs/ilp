const PluginMiniAccounts = require('ilp-plugin-mini-accounts')
const IlpPacket = require('ilp-packet')
const IlDcp = require('ilp-protocol-ildcp')
const PORT = 8913

async function run (port) {
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
        clientAddress: 'receiver',
        assetCode: 'USD',
        assetScale: 6
      })
    }
    return plugin.sendData(IlpPacket.serializeIlpPrepare(obj))
  })
  await plugin.connect()
  console.log(`Listening for ILPv4 over BTP/2.0 on port ${port}`)
}

run(PORT)
