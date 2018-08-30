const { pay } = require('./src/index')

pay(100, '$twitter.xrptipbot.com/ahopebailie')
  .then(({sent, received}) =>
    console.log(`Sent ${sent.toString()} and receiver got ${received.toString()}`))
  .catch(console.error)
