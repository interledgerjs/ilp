const BigNumber = require('bignumber.js')
const { pay, receive } = require('./src/index')

function normalizeAmount (assetAmount) {
  if (assetAmount.assetScale) {
    const value = new BigNumber(assetAmount.amount).dividedBy(new BigNumber(10).exponentiatedBy(assetAmount.assetScale))
    return `${value.toString()} ${assetAmount.assetCode}`
  }
  return `${assetAmount.amount} units of unknown asset type and scale`
}

;(async () => {
  try {
    // Send to Payment Pointer
    const paymentPointer = '$twitter.xrptipbot.com/WietseWind'
    const receipt1 = await pay({ amount: 100, paymentPointer })
    console.log(`Sent ${normalizeAmount(receipt1.sent)} to ${paymentPointer} (${receipt1.destinationAccount}) ` +
      `who received ${normalizeAmount(receipt1.received)}`)

    // Create invoice, pay it and wait for payment
    const receiver = await receive(100, 'test-payment-123')
    const [ senderReceipt, receiverReceipt ] = await Promise.all([
      pay(receiver),
      receiver.receivePayment(30 * 1000)
    ])
    console.log(`According to sender, sent ${normalizeAmount(senderReceipt.sent)} and receiver got ${normalizeAmount(senderReceipt.received)}`)
    console.log(`According to receiver, got ${normalizeAmount(receiverReceipt.received)}`)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
