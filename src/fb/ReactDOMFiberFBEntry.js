/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ReactDOMFBEntry
 */

'use strict';

var ReactDOMFiber = require('ReactDOMFiber');

ReactDOMFiber.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  ReactBrowserEventEmitter: require('ReactBrowserEventEmitter'),
  getVendorPrefixedEventName: require('getVendorPrefixedEventName'),
  getEventCharCode: require('getEventCharCode'),
  ReactInputSelection: require('ReactInputSelection'),
  isEventSupported: require('isEventSupported'),
  SyntheticEvent: require('SyntheticEvent'),
};

module.exports = ReactDOMFiber;
