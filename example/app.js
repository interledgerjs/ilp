const { normalizeAmount } = require('../lib/main/types/asset')
const Client = require('../lib/main/client').Client
const { createBackend, createLogger } = require('ilp-module-loader')

;(async () => {
  try {
    const log = createLogger('app')
    const client = new Client()
    const paymentPointer = '$twitter.xrptipbot.com/WietseWind'

    log.info('Connecting to payment pointer...')
    const { amountRequested, reference, remoteName } = await client.connect({
      paymentPointer
    })

    const remote = remoteName || paymentPointer 
    if (amountRequested) {
      log.info(`${remote} requested payment of ${normalizeAmount({
        amount: result.amountRequested,
        assetInfo: client.remoteAssetInfo,
      })}, reference=${reference}`)

      // Get sensible exchange rate
      const backend = createBackend()
      const marketRate = backend.getRate(client.assetInfo, client.remoteAssetInfo)
      log.info(`Market rate is ${marketRate.toString()}`)
      const currentRate = client.currentRate
      log.info(`Rate on connection is ${currentRate.toString()}`)      
      const sendMax = amountRequested.dividedBy(marketRate).times(1.05)
      log.info(`Setting max send amount to ${sendMax.toString()} (based on 5% allowed slippage from market rate)`)
      
      client.pay()
    } else {
      log.info(`${remote} did not request a specific amount, reference=${reference}`)
    }
    // Send to Payment Pointer
    // const paymentPointer = '$twitter.xrptipbot.com/WietseWind'
    // const receipt1 = await pay({ amount: 100, paymentPointer })
    // console.log(`Sent ${normalizeAmount(receipt1.sent)} to ${paymentPointer} (${receipt1.destinationAccount}) ` +
    //   `who received ${normalizeAmount(receipt1.received)}`)

    // Create invoice, pay it and wait for payment
    // const receiver = await receive(100, 'test-payment-123')
    // const [ senderReceipt, [ receiverReceipt, receiverData ] ] = await Promise.all([
    //   pay(receiver, Buffer.from(JSON.stringify(serializeInvoice(receiver)), 'utf8')),
    //   receiver.receive(30 * 1000)
    // ])
    // console.log(`According to sender, sent ${normalizeAmount(senderReceipt.sent)} and receiver got ${normalizeAmount(senderReceipt.received)}`)
    // console.log(`According to receiver, got ${normalizeAmount(receiverReceipt.received)} and the following data: ${receiverData.toString('utf8')}`)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
