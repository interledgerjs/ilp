'use strict'

const isUndefined = require('lodash/fp/isUndefined')
const omitUndefined = require('lodash/fp/omitBy')(isUndefined)
const startsWith = require('lodash/fp/startsWith')
const DEFAULT_CONNECT_TIMEOUT = 10000

function safeConnect (plugin, timeoutOption) {
  const timeout = timeoutOption || DEFAULT_CONNECT_TIMEOUT
  let timer
  return Promise.race([
    plugin.connect().then(() => { clearTimeout(timer) }),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeout)
    }).then(() => {
      throw new Error('plugin timed out during connect (' + timeout + ' ms)')
    })
  ])
}

function xor (a, b) {
  return ((a || b) && (!a || !b))
}

function wait (duration) {
  return new Promise((resolve) => setTimeout(resolve, duration))
}

module.exports = {
  xor,
  wait,
  startsWith,
  safeConnect,
  omitUndefined,
  isUndefined
}
