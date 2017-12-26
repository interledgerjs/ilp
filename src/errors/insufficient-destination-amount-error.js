'use strict'

const BaseError = require('extensible-error')
const { codes } = require('../utils/ilp-errors')

class InsufficientDestinationAmountError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F04_INSUFFICIENT_DESTINATION_AMOUNT
  }
}

module.exports = InsufficientDestinationAmountError
