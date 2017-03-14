'use strict'

const parseHeaders = require('parse-headers')
const base64url = require('./base64url')
const cryptoHelper = require('./crypto')
const Packet = require('./packet')
const debug = require('debug')('ilp:psk-data')
const DATA_DELIMITER = '\n\n'
const STATUS_LINE_REGEX = /^PSK\/1\.0$/
const KEY_HEADER_REGEX = /^hmac-sha-256 (.+)$/

function _createRequest ({
  statusLine,
  headers,
  data
}) {
  const statusLineText = statusLine ? 'PSK/1.0\n' : ''
  const headerLines = Object.keys(headers)
    .map((k) => k + ': ' + headers[k])
    .join('\n') + DATA_DELIMITER

  let rawData = data
  if (!Buffer.isBuffer(data) && typeof data === 'object') {
    rawData = Buffer.from(JSON.stringify(data), 'utf8')
  } else if (data === undefined) {
    rawData = Buffer.from([])
  }

  return Buffer.concat([
    Buffer.from(statusLineText, 'utf8'),
    Buffer.from(headerLines, 'utf8'),
    rawData
  ])
}

function createDetails ({
  disableEncryption,
  publicHeaders,
  headers,
  secret,
  data
}) {
  const nonce = cryptoHelper.getPskToken()
  const privateRequest = _createRequest({
    statusLine: false,
    headers,
    data
  })

  const encryption = !disableEncryption
  const publicData = encryption
    ? cryptoHelper.aesEncryptBuffer(secret, nonce, privateRequest)
    : privateRequest

  const defaultPublicHeaders = {}
  defaultPublicHeaders['Nonce'] = base64url(nonce)
  defaultPublicHeaders['Encryption'] = encryption ? 'aes-256-ctr' : 'none'

  const publicRequest = _createRequest({
    statusLine: true,
    headers: Object.assign({}, defaultPublicHeaders, publicHeaders),
    data: publicData
  })

  return publicRequest
}

function _parseRequest ({ request, statusLine }) {
  const dataIndex = request.indexOf(Buffer.from(DATA_DELIMITER, 'utf8'))
  if (dataIndex === -1) {
    throw new Error('invalid request: "' + request.toString('utf8') + '"')
  }

  const head = request.slice(0, dataIndex).toString('utf8')
  const data = request.slice(dataIndex + DATA_DELIMITER.length)

  const headLines = head.split('\n')
  if (statusLine) {
    // take off the first line, because it's the status line
    const statusLineText = headLines.shift()
    const match = statusLineText.match(STATUS_LINE_REGEX)
    if (!match) {
      debug('unsupported status line:', statusLineText)
      throw new Error('unsupported status')
    }
  }

  const headers = parseHeaders(headLines.join('\n'))

  return {
    data,
    headers
  }
}

function parseDetails ({
  details,
  secret
}) {
  const detailsBuffer = Buffer.from(details, 'base64')
  const publicRequest = _parseRequest({
    request: detailsBuffer,
    statusLine: true
  })

  if (publicRequest.headers['key']) {
    debug('unsupported key in', JSON.stringify(publicRequest.headers))
    throw new Error('unsupported key')
  }

  if (!publicRequest.headers['nonce']) {
    debug('missing nonce in', JSON.stringify(publicRequest.headers))
    throw new Error('missing nonce')
  }

  const encryption = (publicRequest.headers['encryption'] === 'aes-256-ctr')
  const nonce = Buffer.from(publicRequest.headers['nonce'], 'base64')

  if (!encryption && publicRequest.headers['encryption'] !== 'none') {
    debug('unsupported encryption in', JSON.stringify(publicRequest.headers))
    throw new Error('unsupported encryption')
  }

  if (encryption && !secret) {
    throw new Error('PSK data is encrypted but no secret provided: ' +
      JSON.stringify(publicRequest.headers) + ' secret=' + secret)
  }

  if (!nonce) {
    throw new Error('invalid nonce header in ' +
      JSON.stringify(publicRequest.headers))
  }

  const decrypted = encryption
    ? cryptoHelper.aesDecryptBuffer(secret, nonce, publicRequest.data)
    : publicRequest.data

  const privateRequest = _parseRequest({
    request: decrypted,
    statusLine: false
  })

  return {
    publicHeaders: publicRequest.headers,
    headers: privateRequest.headers,
    data: privateRequest.data
  }
}

function parsePacketAndDetails ({
  packet,
  secret
}) {
  const { account, amount, data } = Packet.parse(packet)
  return Object.assign(parseDetails({
    details: data,
    secret
  }), {
    account,
    amount
  })
}

module.exports = {
  _createRequest,
  _parseRequest,
  createDetails,
  parseDetails,
  parsePacketAndDetails,
  KEY_HEADER_REGEX
}
