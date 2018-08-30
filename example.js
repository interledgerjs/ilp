const { pay, receive } = require('./src/index')

;(async () => {
  try {
    // Send to Payment Pointer
    const receiver = '$twitter.xrptipbot.com/WietseWind'
    const {sent, received} = await pay(100, receiver)
    console.log(`Sent ${sent.toString()} and ${receiver} got ${received.toString()}`)

    // Create invoice, pay it and wait for payment
    const invoice = await receive(100)
    const [ sent2, received2 ] = await Promise.all([
      pay(100, {destinationAccount: invoice.address, sharedSecret: invoice.secret}),
      invoice.receivePayment(30 * 1000)
    ])
    console.log(`Sent ${sent2.toString()} and receiver got ${received2.toString()}`)
    process.exit(0)
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
