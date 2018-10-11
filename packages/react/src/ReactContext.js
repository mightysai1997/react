/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {REACT_PROVIDER_TYPE, REACT_CONTEXT_TYPE} from 'shared/ReactSymbols';

import type {ReactContext} from 'shared/ReactTypes';

import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';

import ReactCurrentOwner from './ReactCurrentOwner';

export function readContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  const dispatcher = ReactCurrentOwner.currentDispatcher;
  invariant(
    dispatcher !== null,
    'Context.unstable_read(): Context can only be read while React is ' +
      'rendering, e.g. inside the render method or getDerivedStateFromProps.',
  );
  return dispatcher.readContext(context, observedBits);
}

export function createContext<T>(
  defaultValue: T,
  calculateChangedBits: ?(a: T, b: T) => number,
): ReactContext<T> {
  if (calculateChangedBits === undefined) {
    calculateChangedBits = null;
  } else {
    if (__DEV__) {
      warningWithoutStack(
        calculateChangedBits === null ||
          typeof calculateChangedBits === 'function',
        'createContext: Expected the optional second argument to be a ' +
          'function. Instead received: %s',
        calculateChangedBits,
      );
    }
  }

  const context: ReactContext<T> = {
    $$typeof: REACT_CONTEXT_TYPE,
    _calculateChangedBits: calculateChangedBits,
    // As a workaround to support multiple concurrent renderers, we categorize
    // some renderers as primary and others as secondary. We only expect
    // there to be two concurrent renderers at most: React Native (primary) and
    // Fabric (secondary); React DOM (primary) and React ART (secondary).
    // Secondary renderers store their context values on separate fields.
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
    // These are circular
    Provider: (null: any),
    Consumer: (null: any),
    unstable_read: (null: any),
  };

  context.Provider = {
    $$typeof: REACT_PROVIDER_TYPE,
    _context: context,
  };

  if (__DEV__) {
    // A separate object, but proxies back to the original context object for
    // backwards compatibility. It has a different $$typeof, so we can properly
    // warn for the incorrect usage of Context as a Consumer.
    context.Consumer = {
      $$typeof: REACT_CONTEXT_TYPE,
      _context: context,
      get _calculateChangedBits() {
        return context._calculateChangedBits;
      },
      set _calculateChangedBits(_calculateChangedBits) {
        context._calculateChangedBits = _calculateChangedBits;
      },
      get _currentValue() {
        return context._currentValue;
      },
      set _currentValue(_currentValue) {
        context._currentValue = _currentValue;
      },
      get _currentValue2() {
        return context._currentValue2;
      },
      set _currentValue2(_currentValue2) {
        context._currentValue2 = _currentValue2;
      },
      Provider: context.Provider,
      get Consumer() {
        return context.Consumer;
      },
      get unstable_read() {
        return context.unstable_read;
      },
      set unstable_read(unstable_read) {
        context.unstable_read = unstable_read;
      },
    };
  } else {
    context.Consumer = context;
  }
  context.unstable_read = readContext.bind(null, context);

  if (__DEV__) {
    context._currentRenderer = null;
    context._currentRenderer2 = null;
  }

  return context;
}
