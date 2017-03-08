"use strict";

const { resolve, basename } = require('path');
const { sync } = require('glob');
const {
  bundleTypes,
 } = require('./bundles');

const exclude = [
  'src/**/__benchmarks__/**/*.js',
  'src/**/__tests__/**/*.js',
  'src/**/__mocks__/**/*.js',
];

function createModuleMap(paths) {
  const moduleMap = {};

  paths.forEach(path => {
    const files = sync(path, exclude);
    
    files.forEach(file => {
      const moduleName = basename(file, '.js');

      moduleMap[moduleName] = resolve(file);
    });
  });
  return moduleMap;
}

function getExternalModules(bundleType) {
  switch (bundleType) {
    case bundleTypes.DEV:
    case bundleTypes.PROD:
      return {
        'object-assign': resolve('./node_modules/object-assign/index.js'),
      };
    case bundleTypes.NODE:
    case bundleTypes.FB:
      return {};
  }
}

function getInternalModules() {
  return {
    reactProdInvariant: resolve('./src/shared/utils/reactProdInvariant.js'),
    'ReactCurrentOwner': resolve('./src/isomorphic/classic/element/ReactCurrentOwner.js'),
    'ReactComponentTreeHook': resolve('./src/isomorphic/hooks/ReactComponentTreeHook.js'),
    'react/lib/ReactCurrentOwner': resolve('./src/isomorphic/classic/element/ReactCurrentOwner.js'),
    'react/lib/checkPropTypes': resolve('./src/isomorphic/classic/types/checkPropTypes.js'),
    'react/lib/ReactDebugCurrentFrame': resolve('./src/isomorphic/classic/element/ReactDebugCurrentFrame.js'),
    'react/lib/ReactComponentTreeHook': resolve('./src/isomorphic/hooks/ReactComponentTreeHook.js'),
  };
}

function replaceInternalModules() {
  return {
    'react-dom/lib/ReactPerf': resolve('./src/renderers/shared/ReactPerf.js'),
    'react-dom/lib/ReactTestUtils': resolve('./src/test/ReactTestUtils.js'),
    'react-dom/lib/ReactInstanceMap': resolve('./src/renderers/shared/shared/ReactInstanceMap.js'),
    'react-dom': resolve('./src/renderers/dom/ReactDOM.js'),
  };
}

function getFbjsModuleAliases(bundleType) {
  switch (bundleType) {
    case bundleTypes.DEV:
    case bundleTypes.PROD:
      return {
        'fbjs/lib/warning': resolve('./node_modules/fbjs/lib/warning.js'),
        'fbjs/lib/invariant': resolve('./node_modules/fbjs/lib/invariant.js'),
        'fbjs/lib/emptyFunction': resolve('./node_modules/fbjs/lib/emptyFunction.js'),
        'fbjs/lib/emptyObject': resolve('./node_modules/fbjs/lib/emptyObject.js'),
        'fbjs/lib/hyphenateStyleName': resolve('./node_modules/fbjs/lib/hyphenateStyleName.js'),
        'fbjs/lib/getUnboundedScrollPosition': resolve('./node_modules/fbjs/lib/getUnboundedScrollPosition.js'),
        'fbjs/lib/camelizeStyleName': resolve('./node_modules/fbjs/lib/camelizeStyleName.js'),
        'fbjs/lib/containsNode': resolve('./node_modules/fbjs/lib/containsNode.js'),
        'fbjs/lib/shallowEqual': resolve('./node_modules/fbjs/lib/shallowEqual.js'),
        'fbjs/lib/getActiveElement': resolve('./node_modules/fbjs/lib/getActiveElement.js'),
        'fbjs/lib/focusNode': resolve('./node_modules/fbjs/lib/focusNode.js'),
        'fbjs/lib/EventListener': resolve('./node_modules/fbjs/lib/EventListener.js'),
        'fbjs/lib/memoizeStringOnly': resolve('./node_modules/fbjs/lib/memoizeStringOnly.js'),
        'fbjs/lib/ExecutionEnvironment': resolve('./node_modules/fbjs/lib/ExecutionEnvironment.js'),
        'fbjs/lib/createNodesFromMarkup': resolve('./node_modules/fbjs/lib/createNodesFromMarkup.js'),
        'fbjs/lib/performanceNow': resolve('./node_modules/fbjs/lib/performanceNow.js'),
      };
    case bundleTypes.NODE:
    case bundleTypes.FB:
      return {};
  }
}

function replaceFbjsModuleAliases(bundleType) {
  switch (bundleType) {
    case bundleTypes.DEV:
    case bundleTypes.PROD:
    case bundleTypes.NODE:
      return {};
    case bundleTypes.FB:
      return {
        'fbjs/lib/warning': 'warning',
        'fbjs/lib/invariant': 'invariant',
        'fbjs/lib/emptyFunction': 'emptyFunction',
        'fbjs/lib/emptyObject': 'emptyObject',
        'fbjs/lib/hyphenateStyleName': 'hyphenateStyleName',
        'fbjs/lib/getUnboundedScrollPosition': 'getUnboundedScrollPosition',
        'fbjs/lib/camelizeStyleName': 'camelizeStyleName',
        'fbjs/lib/containsNode': 'containsNode',
        'fbjs/lib/shallowEqual': 'shallowEqual',
        'fbjs/lib/getActiveElement': 'getActiveElement',
        'fbjs/lib/focusNode': 'focusNode',
        'fbjs/lib/EventListener': 'EventListener',
        'fbjs/lib/memoizeStringOnly': 'memoizeStringOnly',
        'fbjs/lib/ExecutionEnvironment': 'ExecutionEnvironment',
        'fbjs/lib/createNodesFromMarkup': 'createNodesFromMarkup',
        'fbjs/lib/performanceNow': 'performanceNow',
      };
  }
}

module.exports = {
  createModuleMap,
  getExternalModules,
  replaceInternalModules,
  getInternalModules,
  getFbjsModuleAliases,
  replaceFbjsModuleAliases,
};
