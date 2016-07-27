/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DOMChildrenOperations
 */

'use strict';

var DOMLazyTree = require('DOMLazyTree');
var Danger = require('Danger');
var ReactMultiChildUpdateTypes = require('ReactMultiChildUpdateTypes');
var ReactDOMComponentTree = require('ReactDOMComponentTree');
var ReactInstrumentation = require('ReactInstrumentation');
var ReactPerf = require('ReactPerf');

var createMicrosoftUnsafeLocalFunction = require('createMicrosoftUnsafeLocalFunction');
var setInnerHTML = require('setInnerHTML');
var setTextContent = require('setTextContent');

function getNodeAfter(parentNode, node) {
  // Special case for text components, which return [open, close] comments
  // from getNativeNode.
  if (Array.isArray(node)) {
    node = node[1];
  }
  return node ? node.nextSibling : parentNode.firstChild;
}

/**
 * Inserts `childNode` as a child of `parentNode` at the `index`.
 *
 * @param {DOMElement} parentNode Parent node in which to insert.
 * @param {DOMElement} childNode Child node to insert.
 * @param {number} index Index at which to insert the child.
 * @internal
 */
var insertChildAt = createMicrosoftUnsafeLocalFunction(
  function(parentNode, childNode, referenceNode) {
    // We rely exclusively on `insertBefore(node, null)` instead of also using
    // `appendChild(node)`. (Using `undefined` is not allowed by all browsers so
    // we are careful to use `null`.)
    parentNode.insertBefore(childNode, referenceNode);
  }
);

function insertLazyTreeChildAt(parentNode, childTree, referenceNode) {
  DOMLazyTree.insertTreeBefore(parentNode, childTree, referenceNode);
}

function moveChild(parentNode, childNode, referenceNode) {
  if (Array.isArray(childNode)) {
    moveDelimitedNodes(parentNode, childNode[0], childNode[1], referenceNode);
  } else {
    insertChildAt(parentNode, childNode, referenceNode);
  }
}

function removeChild(parentNode, childNode) {
  if (Array.isArray(childNode)) {
    var closingComment = childNode[1];
    childNode = childNode[0];
    removeDelimitedNodes(parentNode, childNode, closingComment);
    parentNode.removeChild(closingComment);
  }
  parentNode.removeChild(childNode);
}

function moveDelimitedNodes(
  parentNode,
  openingComment,
  closingComment,
  referenceNode
) {
  var node = openingComment;
  while (true) {
    var nextNode = node.nextSibling;
    insertChildAt(parentNode, node, referenceNode);
    if (node === closingComment) {
      break;
    }
    node = nextNode;
  }
}

function removeDelimitedNodes(parentNode, startNode, closingComment) {
  while (true) {
    var node = startNode.nextSibling;
    if (node === closingComment) {
      // The closing comment is removed by ReactMultiChild.
      break;
    } else {
      parentNode.removeChild(node);
    }
  }
}

function replaceDelimitedText(openingComment, closingComment, stringText) {
  var parentNode = openingComment.parentNode;
  var nodeAfterComment = openingComment.nextSibling;
  if (nodeAfterComment === closingComment) {
    // There are no text nodes between the opening and closing comments; insert
    // a new one if stringText isn't empty.
    if (stringText) {
      insertChildAt(
        parentNode,
        document.createTextNode(stringText),
        nodeAfterComment
      );
    }
  } else {
    if (stringText) {
      // Set the text content of the first node after the opening comment, and
      // remove all following nodes up until the closing comment.
      setTextContent(nodeAfterComment, stringText);
      removeDelimitedNodes(parentNode, nodeAfterComment, closingComment);
    } else {
      removeDelimitedNodes(parentNode, openingComment, closingComment);
    }
  }

  if (__DEV__) {
    ReactInstrumentation.debugTool.onNativeOperation(
      ReactDOMComponentTree.getInstanceFromNode(openingComment)._debugID,
      'replace text',
      stringText
    );
  }
}

function replaceDelimitedHTML(openingComment, closingComment, firstNode, stringMarkup) {
  var parentNode = openingComment.parentNode;
  removeDelimitedNodes(parentNode, openingComment, closingComment);

  var node = firstNode;
  while (node) {
    var nextSibling = node.nextSibling
    insertChildAt(parentNode, node, closingComment);
    node = nextSibling;
  }

  if (__DEV__) {
    ReactInstrumentation.debugTool.onNativeOperation(
      ReactDOMComponentTree.getInstanceFromNode(openingComment)._debugID,
      'replace html',
      stringMarkup
    );
  }
}

var dangerouslyReplaceNodeWithMarkup = Danger.dangerouslyReplaceNodeWithMarkup;
if (__DEV__) {
  dangerouslyReplaceNodeWithMarkup = function(oldChild, markup, prevInstance) {
    Danger.dangerouslyReplaceNodeWithMarkup(oldChild, markup);
    ReactInstrumentation.debugTool.onNativeOperation(
      prevInstance._debugID,
      'replace with',
      markup.toString()
    );
  };
}

/**
 * Operations for updating with DOM children.
 */
var DOMChildrenOperations = {

  dangerouslyReplaceNodeWithMarkup: dangerouslyReplaceNodeWithMarkup,

  replaceDelimitedText: replaceDelimitedText,
  replaceDelimitedHTML: replaceDelimitedHTML,

  /**
   * Updates a component's children by processing a series of updates. The
   * update configurations are each expected to have a `parentNode` property.
   *
   * @param {array<object>} updates List of update configurations.
   * @internal
   */
  processUpdates: function(parentNode, updates) {
    if (__DEV__) {
      var parentNodeDebugID =
        ReactDOMComponentTree.getInstanceFromNode(parentNode)._debugID;
    }

    for (var k = 0; k < updates.length; k++) {
      var update = updates[k];
      switch (update.type) {
        case ReactMultiChildUpdateTypes.INSERT_MARKUP:
          insertLazyTreeChildAt(
            parentNode,
            update.content,
            getNodeAfter(parentNode, update.afterNode)
          );
          if (__DEV__) {
            ReactInstrumentation.debugTool.onNativeOperation(
              parentNodeDebugID,
              'insert child',
              {toIndex: update.toIndex, content: update.content.toString()}
            );
          }
          break;
        case ReactMultiChildUpdateTypes.MOVE_EXISTING:
          moveChild(
            parentNode,
            update.fromNode,
            getNodeAfter(parentNode, update.afterNode)
          );
          if (__DEV__) {
            ReactInstrumentation.debugTool.onNativeOperation(
              parentNodeDebugID,
              'move child',
              {fromIndex: update.fromIndex, toIndex: update.toIndex}
            );
          }
          break;
        case ReactMultiChildUpdateTypes.SET_MARKUP:
          setInnerHTML(
            parentNode,
            update.content
          );
          if (__DEV__) {
            ReactInstrumentation.debugTool.onNativeOperation(
              parentNodeDebugID,
              'replace children',
              update.content.toString()
            );
          }
          break;
        case ReactMultiChildUpdateTypes.TEXT_CONTENT:
          setTextContent(
            parentNode,
            update.content
          );
          if (__DEV__) {
            ReactInstrumentation.debugTool.onNativeOperation(
              parentNodeDebugID,
              'replace text',
              update.content.toString()
            );
          }
          break;
        case ReactMultiChildUpdateTypes.REMOVE_NODE:
          removeChild(parentNode, update.fromNode);
          if (__DEV__) {
            ReactInstrumentation.debugTool.onNativeOperation(
              parentNodeDebugID,
              'remove child',
              {fromIndex: update.fromIndex}
            );
          }
          break;
      }
    }
  },

};

ReactPerf.measureMethods(DOMChildrenOperations, 'DOMChildrenOperations', {
  replaceDelimitedText: 'replaceDelimitedText',
});

module.exports = DOMChildrenOperations;
