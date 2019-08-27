/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {AnyNativeEvent} from 'legacy-events/PluginModuleType';
import type {Fiber} from 'react-reconciler/src/ReactFiber';
import type {DOMTopLevelEventType} from 'legacy-events/TopLevelEventTypes';

// Intentionally not named imports because Rollup would use dynamic dispatch for
// CommonJS interop named imports.
import * as Scheduler from 'scheduler';

import {
  batchedEventUpdates,
  discreteUpdates,
  flushDiscreteUpdatesIfNeeded,
} from 'legacy-events/ReactGenericBatching';
import {runExtractedPluginEventsInBatch} from 'legacy-events/EventPluginHub';
import {dispatchEventForResponderEventSystem} from '../events/DOMEventResponderSystem';
import {isFiberMounted} from 'react-reconciler/reflection';
import {HostRoot} from 'shared/ReactWorkTags';
import {
  type EventSystemFlags,
  PLUGIN_EVENT_SYSTEM,
  RESPONDER_EVENT_SYSTEM,
  IS_PASSIVE,
  IS_ACTIVE,
  PASSIVE_NOT_SUPPORTED,
} from 'legacy-events/EventSystemFlags';

import {
  addEventBubbleListener,
  addEventCaptureListener,
  addEventCaptureListenerWithPassiveFlag,
} from './EventListener';
import getEventTarget from './getEventTarget';
import {
  getClosestInstanceFromNode,
  getInstanceFromNode,
} from '../client/ReactDOMComponentTree';
import SimpleEventPlugin from './SimpleEventPlugin';
import {getRawEventName} from './DOMTopLevelEventTypes';
import {passiveBrowserEventsSupported} from './checkPassiveEvents';
import {getParentSuspenseInstance} from '../client/ReactDOMHostConfig';

import {
  enableFlareAPI,
  enableUserBlockingEvents,
} from 'shared/ReactFeatureFlags';
import {
  UserBlockingEvent,
  ContinuousEvent,
  DiscreteEvent,
} from 'shared/ReactTypes';

const {
  unstable_UserBlockingPriority: UserBlockingPriority,
  unstable_runWithPriority: runWithPriority,
} = Scheduler;

const {getEventPriority} = SimpleEventPlugin;

const CALLBACK_BOOKKEEPING_POOL_SIZE = 10;
const callbackBookkeepingPool = [];

type BookKeepingInstance = {
  topLevelType: DOMTopLevelEventType | null,
  nativeEvent: AnyNativeEvent | null,
  targetInst: Fiber | null,
  ancestors: Array<Fiber | null>,
};

/**
 * Find the deepest React component completely containing the root of the
 * passed-in instance (for use when entire React trees are nested within each
 * other). If React trees are not nested, returns null.
 */
function findRootContainerNode(inst) {
  // TODO: It may be a good idea to cache this to prevent unnecessary DOM
  // traversal, but caching is difficult to do correctly without using a
  // mutation observer to listen for all DOM changes.
  while (inst.return) {
    inst = inst.return;
  }
  if (inst.tag !== HostRoot) {
    // This can happen if we're in a detached tree.
    return null;
  }
  return inst.stateNode.containerInfo;
}

// Used to store ancestor hierarchy in top level callback
function getTopLevelCallbackBookKeeping(
  topLevelType: DOMTopLevelEventType,
  nativeEvent: AnyNativeEvent,
  targetInst: Fiber | null,
): BookKeepingInstance {
  if (callbackBookkeepingPool.length) {
    const instance = callbackBookkeepingPool.pop();
    instance.topLevelType = topLevelType;
    instance.nativeEvent = nativeEvent;
    instance.targetInst = targetInst;
    return instance;
  }
  return {
    topLevelType,
    nativeEvent,
    targetInst,
    ancestors: [],
  };
}

function releaseTopLevelCallbackBookKeeping(
  instance: BookKeepingInstance,
): void {
  instance.topLevelType = null;
  instance.nativeEvent = null;
  instance.targetInst = null;
  instance.ancestors.length = 0;
  if (callbackBookkeepingPool.length < CALLBACK_BOOKKEEPING_POOL_SIZE) {
    callbackBookkeepingPool.push(instance);
  }
}

function handleTopLevel(bookKeeping: BookKeepingInstance) {
  let targetInst = bookKeeping.targetInst;

  // Loop through the hierarchy, in case there's any nested components.
  // It's important that we build the array of ancestors before calling any
  // event handlers, because event handlers can modify the DOM, leading to
  // inconsistencies with ReactMount's node cache. See #1105.
  let ancestor = targetInst;
  do {
    if (!ancestor) {
      const ancestors = bookKeeping.ancestors;
      ((ancestors: any): Array<Fiber | null>).push(ancestor);
      break;
    }
    const root = findRootContainerNode(ancestor);
    if (!root) {
      break;
    }
    bookKeeping.ancestors.push(ancestor);
    ancestor = getClosestInstanceFromNode(root);
  } while (ancestor);

  for (let i = 0; i < bookKeeping.ancestors.length; i++) {
    targetInst = bookKeeping.ancestors[i];
    const eventTarget = getEventTarget(bookKeeping.nativeEvent);
    const topLevelType = ((bookKeeping.topLevelType: any): DOMTopLevelEventType);
    const nativeEvent = ((bookKeeping.nativeEvent: any): AnyNativeEvent);

    runExtractedPluginEventsInBatch(
      topLevelType,
      targetInst,
      nativeEvent,
      eventTarget,
    );
  }
}

// TODO: can we stop exporting these?
export let _enabled = true;

export function setEnabled(enabled: ?boolean) {
  _enabled = !!enabled;
}

export function isEnabled() {
  return _enabled;
}

export function trapBubbledEvent(
  topLevelType: DOMTopLevelEventType,
  element: Document | Element | Node,
): void {
  trapEventForPluginEventSystem(element, topLevelType, false);
}

export function trapCapturedEvent(
  topLevelType: DOMTopLevelEventType,
  element: Document | Element | Node,
): void {
  trapEventForPluginEventSystem(element, topLevelType, true);
}

export function trapEventForResponderEventSystem(
  element: Document | Element | Node,
  topLevelType: DOMTopLevelEventType,
  passive: boolean,
): void {
  if (enableFlareAPI) {
    const rawEventName = getRawEventName(topLevelType);
    let eventFlags = RESPONDER_EVENT_SYSTEM;

    // If passive option is not supported, then the event will be
    // active and not passive, but we flag it as using not being
    // supported too. This way the responder event plugins know,
    // and can provide polyfills if needed.
    if (passive) {
      if (passiveBrowserEventsSupported) {
        eventFlags |= IS_PASSIVE;
      } else {
        eventFlags |= IS_ACTIVE;
        eventFlags |= PASSIVE_NOT_SUPPORTED;
        passive = false;
      }
    } else {
      eventFlags |= IS_ACTIVE;
    }
    // Check if interactive and wrap in discreteUpdates
    const listener = dispatchEvent.bind(null, topLevelType, eventFlags);
    if (passiveBrowserEventsSupported) {
      addEventCaptureListenerWithPassiveFlag(
        element,
        rawEventName,
        listener,
        passive,
      );
    } else {
      addEventCaptureListener(element, rawEventName, listener);
    }
  }
}

function trapEventForPluginEventSystem(
  element: Document | Element | Node,
  topLevelType: DOMTopLevelEventType,
  capture: boolean,
): void {
  let listener;
  switch (getEventPriority(topLevelType)) {
    case DiscreteEvent:
      listener = dispatchDiscreteEvent.bind(
        null,
        topLevelType,
        PLUGIN_EVENT_SYSTEM,
      );
      break;
    case UserBlockingEvent:
      listener = dispatchUserBlockingUpdate.bind(
        null,
        topLevelType,
        PLUGIN_EVENT_SYSTEM,
      );
      break;
    case ContinuousEvent:
    default:
      listener = dispatchEvent.bind(null, topLevelType, PLUGIN_EVENT_SYSTEM);
      break;
  }

  const rawEventName = getRawEventName(topLevelType);
  if (capture) {
    addEventCaptureListener(element, rawEventName, listener);
  } else {
    addEventBubbleListener(element, rawEventName, listener);
  }
}

function dispatchDiscreteEvent(topLevelType, eventSystemFlags, nativeEvent) {
  flushDiscreteUpdatesIfNeeded(nativeEvent.timeStamp);
  discreteUpdates(dispatchEvent, topLevelType, eventSystemFlags, nativeEvent);
}

function dispatchUserBlockingUpdate(
  topLevelType,
  eventSystemFlags,
  nativeEvent,
) {
  if (enableUserBlockingEvents) {
    runWithPriority(
      UserBlockingPriority,
      dispatchEvent.bind(null, topLevelType, eventSystemFlags, nativeEvent),
    );
  } else {
    dispatchEvent(topLevelType, eventSystemFlags, nativeEvent);
  }
}

function dispatchEventForPluginEventSystem(
  topLevelType: DOMTopLevelEventType,
  eventSystemFlags: EventSystemFlags,
  nativeEvent: AnyNativeEvent,
  targetInst: null | Fiber,
): void {
  const bookKeeping = getTopLevelCallbackBookKeeping(
    topLevelType,
    nativeEvent,
    targetInst,
  );

  try {
    // Event queue being processed in the same cycle allows
    // `preventDefault`.
    batchedEventUpdates(handleTopLevel, bookKeeping);
  } finally {
    releaseTopLevelCallbackBookKeeping(bookKeeping);
  }
}

export function dispatchEvent(
  topLevelType: DOMTopLevelEventType,
  eventSystemFlags: EventSystemFlags,
  nativeEvent: AnyNativeEvent,
): void {
  if (!_enabled) {
    return;
  }
  const nativeEventTarget = getEventTarget(nativeEvent);

  // This is effectively an inlined version of getClosestInstanceFromNode with
  // some special semantics for dehydrated Suspense boundaries.
  let targetInst = getInstanceFromNode(nativeEventTarget);
  if (targetInst === null) {
    // If the direct event target isn't a React owned DOM node, we need to look
    // to see if one of its parents is a React owned DOM node.
    let targetNode = nativeEventTarget;
    let parentNode = targetNode.parentNode;
    while (parentNode) {
      targetInst = getInstanceFromNode(parentNode);
      if (targetInst !== null) {
        // Since this wasn't the direct target of the event, we might have
        // stepped past dehydrated DOM nodes to get here. However they could
        // also have been non-React nodes. We need to answer which one.

        // If we the instance doesn't have any children, then there can't be
        // a nested suspense boundary within it. So we can use this as a fast
        // bailout. Most of the time, when people add non-React children to
        // the tree, it is using a ref to a child-less DOM node.
        // We only need to check one of the fibers because if it has ever
        // gone from having children to deleting them or vice versa it would
        // have deleted the dehydrated boundary nested inside already.
        if (targetInst.child !== null) {
          // Next we need to figure out if the node that skipped past is
          // nested within a dehydrated boundary and if so, which one.
          let suspenseInstance = getParentSuspenseInstance(targetNode);
          if (suspenseInstance !== null) {
            // We found a suspense instance. That means that we haven't
            // hydrated it yet. Even though we leave the comments in the
            // DOM after hydrating, and there are boundaries in the DOM
            // that could already be hydrated, we wouldn't have found them
            // through this pass since if the target is hydrated it would
            // have had an internalInstanceKey on it.
            // We're going to proceed as if there was no target yet.
            // TODO: This is a good opportunity to schedule a replay of
            // the event instead once this boundary has been hydrated.
            targetInst = null;
          }
        }
        break;
      }
      targetNode = parentNode;
      parentNode = targetNode.parent;
    }
  }

  if (targetInst !== null && !isFiberMounted(targetInst)) {
    // If we get an event (ex: img onload) before committing that
    // component's mount, ignore it for now (that is, treat it as if it was an
    // event on a non-React tree). We might also consider queueing events and
    // dispatching them after the mount.
    targetInst = null;
  }

  if (enableFlareAPI) {
    if (eventSystemFlags === PLUGIN_EVENT_SYSTEM) {
      dispatchEventForPluginEventSystem(
        topLevelType,
        eventSystemFlags,
        nativeEvent,
        targetInst,
      );
    } else {
      // React Flare event system
      dispatchEventForResponderEventSystem(
        (topLevelType: any),
        targetInst,
        nativeEvent,
        nativeEventTarget,
        eventSystemFlags,
      );
    }
  } else {
    dispatchEventForPluginEventSystem(
      topLevelType,
      eventSystemFlags,
      nativeEvent,
      targetInst,
    );
  }
}
