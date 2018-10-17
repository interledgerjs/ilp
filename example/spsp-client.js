const { normalizeAmount, Client } = require('../build/lib')

;(async () => {
  // This assumes you are running the spsp-server-express.js sample.
  const paymentPointer = 'http://localhost:3000?amount=100&reference=INV001'
  const client = new Client()
  await client.connect({ paymentPointer })

  // const receipt = await client.({ amount: 105, paymentPointer })
  // console.log(`Sent ${normalizeAmount(receipt.sent)} to ${paymentPointer} (${receipt.destinationAccount}) ` +
  //   `who received ${normalizeAmount(receipt.received)}`)
})()
