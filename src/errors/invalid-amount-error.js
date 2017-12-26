'use strict'

const BaseError = require('extensible-error')
const { codes } = require('../utils/ilp-errors')

class InvalidAmountError extends BaseError {
  constructor (message) {
    super(message)

    this.ilpErrorCode = codes.F03_INVALID_AMOUNT
  }
}

module.exports = InvalidAmountError
