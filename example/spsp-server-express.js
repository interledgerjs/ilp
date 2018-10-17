const { normalizeAmount, express } = require('.')
const app = require('express')()

;(async () => {
  const template = {
    receiver_info: {
      name: 'Bob Smith'
    }
  }

  const paymentHandler = async (receiver) => {
    const reference = receiver.reference

    console.log(`Waiting for payment: reference=${reference}, maxAmount=${receiver.amount}, timeout=15minutes`)

    try {
      const receipt = await receiver.receivePayment(15 * 60 * 1000) // 15 minute timeout
      const data = await receiver.receiveData()

      console.log(`Received payment: reference=${reference}`)
      console.log(` - got ${normalizeAmount(receipt.received)}`)
      console.log(` - data:${data.toString('utf8')}`)
    } catch (e) {
      console.error(`Error receiving payment:  reference=${reference}`, e)
    }
  }

  app.get('/.well-known/pay', await express.createMiddleware(template, paymentHandler))
  app.listen(3000, () => {
    console.log('Listening on port 3000...')
  })
})()
