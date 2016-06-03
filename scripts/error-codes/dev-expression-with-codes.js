/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

var evalToString = require('./evalToString');
var existingErrorMap = require('./codes.json');
var invertObject = require('./invertObject');
var prodInvariantName = require('./constants').prodInvariantName;

var errorMap = invertObject(existingErrorMap);
var prodInvariantModuleName = 'reactProdInvariant';

module.exports = function(babel) {
  var t = babel.types;

  var SEEN_SYMBOL = Symbol();

  var buildRequire = babel.template(`var IMPORT_NAME = require(SOURCE);`);

  var REQUIRE_PROD_INVARIANT = buildRequire({
    IMPORT_NAME: t.identifier(prodInvariantName),
    SOURCE: t.stringLiteral(prodInvariantModuleName),
  });

  var DEV_EXPRESSION = t.binaryExpression(
    '!==',
    t.memberExpression(
      t.memberExpression(
        t.identifier('process'),
        t.identifier('env'),
        false
      ),
      t.identifier('NODE_ENV'),
      false
    ),
    t.stringLiteral('production')
  );

  return {
    visitor: {
      Identifier: {
        enter: function(path) {
          // Do nothing when testing
          if (process.env.NODE_ENV === 'test') {
            return;
          }
          // replace __DEV__ with process.env.NODE_ENV !== 'production'
          if (path.isIdentifier({name: '__DEV__'})) {
            path.replaceWith(DEV_EXPRESSION);
          }
        },
      },
      CallExpression: {
        exit: function(path) {
          var node = path.node;
          // Ignore if it's already been processed
          if (node[SEEN_SYMBOL]) {
            return;
          }
          // Insert require('reactProdInvariant') after all `require('invariant')`s.
          // NOTE currently it only supports the format of
          // `var invariant = require('invariant');` (VariableDeclaration)
          // and NOT ES6 imports/assignments.
          if (
            path.get('callee').isIdentifier({name: 'require'}) &&
            path.get('arguments')[0] &&
            path.get('arguments')[0].isStringLiteral({value: 'invariant'})
          ) {
            node[SEEN_SYMBOL] = true;
            path.parentPath.parentPath.insertAfter(REQUIRE_PROD_INVARIANT);
          } else if (path.get('callee').isIdentifier({name: 'invariant'})) {
            // Turns this code:
            //
            // invariant(condition, argument, 'foo', 'bar');
            //
            // into this:
            //
            // if (!condition) {
            //   if ("production" !== process.env.NODE_ENV) {
            //     invariant(false, argument, 'foo', 'bar');
            //   } else {
            //     PROD_INVARIANT('XYZ', 'foo', 'bar');
            //   }
            // }
            //
            // where
            // - `XYZ` is an error code: an unique identifier (a number string)
            //   that references a verbose error message.
            //   The mapping is stored in `scripts/error-codes/codes.json`.
            // - PROD_INVARIANT is the `reactProdInvariant` function that always throw with a error URL like
            //   http://facebook.github.io/react/docs/error-codes.html?invariant=XYZ&args="foo"&args="bar"
            //
            // Specifically this does 3 things:
            // 1. Checks the condition first, preventing an extra function call.
            // 2. Adds an environment check so that verbose error messages aren't
            //    shipped to production.
            // 3. Rewrite the call to `invariant` in production to `reactProdInvariant`
            //   - `reactProdInvariant` is always renamed to avoid shadowing
            // The generated code is longer than the original code but will dead
            // code removal in a minifier will strip that out.
            var condition = node.arguments[0];
            var errorMsgLiteral = evalToString(node.arguments[1]);

            var prodErrorId = errorMap[errorMsgLiteral];
            if (prodErrorId === undefined) {
              // The error cannot be found in the map.
              node[SEEN_SYMBOL] = true;
              if (process.env.NODE_ENV !== 'test') {
                console.warn(
                  'Error message "' + errorMsgLiteral +
                  '" cannot be found. The current React version ' +
                  'and the error map are probably out of sync. ' +
                  'Please run `gulp react:extract-errors` before building React.'
                );
              }
              return;
            }

            var devInvariant = t.callExpression(node.callee, [
              t.booleanLiteral(false),
              t.stringLiteral(errorMsgLiteral),
            ].concat(node.arguments.slice(2)));

            devInvariant[SEEN_SYMBOL] = true;

            var prodInvariant = t.callExpression(t.identifier(prodInvariantName), [
              t.stringLiteral(prodErrorId),
            ].concat(node.arguments.slice(2)));

            prodInvariant[SEEN_SYMBOL] = true;
            path.replaceWith(t.ifStatement(
              t.unaryExpression('!', condition),
              t.blockStatement([
                t.ifStatement(
                  DEV_EXPRESSION,
                  t.blockStatement([
                    t.expressionStatement(devInvariant),
                  ]),
                  t.blockStatement([
                    t.expressionStatement(prodInvariant),
                  ])
                ),
              ])
            ));
          } else if (path.get('callee').isIdentifier({name: 'warning'})) {
            // Turns this code:
            //
            // warning(condition, argument, argument);
            //
            // into this:
            //
            // if ("production" !== process.env.NODE_ENV) {
            //   warning(condition, argument, argument);
            // }
            //
            // The goal is to strip out warning calls entirely in production. We
            // don't need the same optimizations for conditions that we use for
            // invariant because we don't care about an extra call in __DEV__

            node[SEEN_SYMBOL] = true;
            path.replaceWith(t.ifStatement(
              DEV_EXPRESSION,
              t.blockStatement([
                t.expressionStatement(
                  node
                ),
              ])
            ));
          }
        },
      },
    },
  };
};
