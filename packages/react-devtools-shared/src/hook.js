/**
 * Install the hook on window, which is an event emitter.
 * Note: this global hook __REACT_DEVTOOLS_GLOBAL_HOOK__ is a de facto public API.
 * It's especially important to avoid creating direct dependency on the DevTools Backend.
 * That's why we still inline the whole event emitter implementation,
 * the string format implementation, and part of the console implementation here.
 *
 * @flow
 */

import type {Fiber} from 'react-reconciler/src/ReactInternalTypes';
import type {
  DevToolsHook,
  Handler,
  ReactRenderer,
  RendererID,
  RendererInterface,
  DevToolsBackend,
  DevToolsHookSettings,
  WorkTagMap,
} from 'react-devtools-shared/src/backend/types';

import {
  FIREFOX_CONSOLE_DIMMING_COLOR,
  ANSI_STYLE_DIMMING_TEMPLATE,
  ANSI_STYLE_DIMMING_TEMPLATE_WITH_COMPONENT_STACK,
} from 'react-devtools-shared/src/constants';
import getWorkTagMap from 'react-devtools-shared/src/backend/fiber/getWorkTagMap';
import getDispatcherRef from 'react-devtools-shared/src/backend/fiber/getDispatcherRef';
import {
  getOwnerStackByFiberInDev,
  getStackByFiberInDevAndProd,
  supportsConsoleTasks,
  supportsOwnerStacks,
} from 'react-devtools-shared/src/backend/fiber/DevToolsFiberComponentStack';
import {formatOwnerStack} from 'react-devtools-shared/src/backend/shared/DevToolsOwnerStack';

// We add a suffix to some frames that older versions of React didn't do.
// To compare if it's equivalent we strip out the suffix to see if they're
// still equivalent. Similarly, we sometimes use [] and sometimes () so we
// strip them to for the comparison.
const frameDiffs = / \(\<anonymous\>\)$|\@unknown\:0\:0$|\(|\)|\[|\]/gm;
function areStackTracesEqual(a: string, b: string): boolean {
  return a.replace(frameDiffs, '') === b.replace(frameDiffs, '');
}

// React's custom built component stack strings match "\s{4}in"
// Chrome's prefix matches "\s{4}at"
const PREFIX_REGEX = /\s{4}(in|at)\s{1}/;
// Firefox and Safari have no prefix ("")
// but we can fallback to looking for location info (e.g. "foo.js:12:345")
const ROW_COLUMN_NUMBER_REGEX = /:\d+:\d+(\n|$)/;

function isStringComponentStack(text: string): boolean {
  return PREFIX_REGEX.test(text) || ROW_COLUMN_NUMBER_REGEX.test(text);
}

const targetConsole: Object = console;

export function installHook(
  target: any,
  injectedSettings?: DevToolsHookSettings,
): DevToolsHook | null {
  if (target.hasOwnProperty('__REACT_DEVTOOLS_GLOBAL_HOOK__')) {
    return null;
  }

  function detectReactBuildType(renderer: ReactRenderer) {
    try {
      if (typeof renderer.version === 'string') {
        // React DOM Fiber (16+)
        if (renderer.bundleType > 0) {
          // This is not a production build.
          // We are currently only using 0 (PROD) and 1 (DEV)
          // but might add 2 (PROFILE) in the future.
          return 'development';
        }

        // React 16 uses flat bundles. If we report the bundle as production
        // version, it means we also minified and envified it ourselves.
        return 'production';
        // Note: There is still a risk that the CommonJS entry point has not
        // been envified or uglified. In this case the user would have *both*
        // development and production bundle, but only the prod one would run.
        // This would be really bad. We have a separate check for this because
        // it happens *outside* of the renderer injection. See `checkDCE` below.
      }

      // $FlowFixMe[method-unbinding]
      const toString = Function.prototype.toString;
      if (renderer.Mount && renderer.Mount._renderNewRootComponent) {
        // React DOM Stack
        const renderRootCode = toString.call(
          renderer.Mount._renderNewRootComponent,
        );
        // Filter out bad results (if that is even possible):
        if (renderRootCode.indexOf('function') !== 0) {
          // Hope for the best if we're not sure.
          return 'production';
        }
        // Check for React DOM Stack < 15.1.0 in development.
        // If it contains "storedMeasure" call, it's wrapped in ReactPerf (DEV only).
        // This would be true even if it's minified, as method name still matches.
        if (renderRootCode.indexOf('storedMeasure') !== -1) {
          return 'development';
        }
        // For other versions (and configurations) it's not so easy.
        // Let's quickly exclude proper production builds.
        // If it contains a warning message, it's either a DEV build,
        // or an PROD build without proper dead code elimination.
        if (renderRootCode.indexOf('should be a pure function') !== -1) {
          // Now how do we tell a DEV build from a bad PROD build?
          // If we see NODE_ENV, we're going to assume this is a dev build
          // because most likely it is referring to an empty shim.
          if (renderRootCode.indexOf('NODE_ENV') !== -1) {
            return 'development';
          }
          // If we see "development", we're dealing with an envified DEV build
          // (such as the official React DEV UMD).
          if (renderRootCode.indexOf('development') !== -1) {
            return 'development';
          }
          // I've seen process.env.NODE_ENV !== 'production' being smartly
          // replaced by `true` in DEV by Webpack. I don't know how that
          // works but we can safely guard against it because `true` was
          // never used in the function source since it was written.
          if (renderRootCode.indexOf('true') !== -1) {
            return 'development';
          }
          // By now either it is a production build that has not been minified,
          // or (worse) this is a minified development build using non-standard
          // environment (e.g. "staging"). We're going to look at whether
          // the function argument name is mangled:
          if (
            // 0.13 to 15
            renderRootCode.indexOf('nextElement') !== -1 ||
            // 0.12
            renderRootCode.indexOf('nextComponent') !== -1
          ) {
            // We can't be certain whether this is a development build or not,
            // but it is definitely unminified.
            return 'unminified';
          } else {
            // This is likely a minified development build.
            return 'development';
          }
        }
        // By now we know that it's envified and dead code elimination worked,
        // but what if it's still not minified? (Is this even possible?)
        // Let's check matches for the first argument name.
        if (
          // 0.13 to 15
          renderRootCode.indexOf('nextElement') !== -1 ||
          // 0.12
          renderRootCode.indexOf('nextComponent') !== -1
        ) {
          return 'unminified';
        }
        // Seems like we're using the production version.
        // However, the branch above is Stack-only so this is 15 or earlier.
        return 'outdated';
      }
    } catch (err) {
      // Weird environments may exist.
      // This code needs a higher fault tolerance
      // because it runs even with closed DevTools.
      // TODO: should we catch errors in all injected code, and not just this part?
    }
    return 'production';
  }

  function checkDCE(fn: Function) {
    // This runs for production versions of React.
    // Needs to be super safe.
    try {
      // $FlowFixMe[method-unbinding]
      const toString = Function.prototype.toString;
      const code = toString.call(fn);

      // This is a string embedded in the passed function under DEV-only
      // condition. However the function executes only in PROD. Therefore,
      // if we see it, dead code elimination did not work.
      if (code.indexOf('^_^') > -1) {
        // Remember to report during next injection.
        hasDetectedBadDCE = true;

        // Bonus: throw an exception hoping that it gets picked up by a reporting system.
        // Not synchronously so that it doesn't break the calling code.
        setTimeout(function () {
          throw new Error(
            'React is running in production mode, but dead code ' +
              'elimination has not been applied. Read how to correctly ' +
              'configure React for production: ' +
              'https://react.dev/link/perf-use-production-build',
          );
        });
      }
    } catch (err) {}
  }

  // NOTE: KEEP IN SYNC with src/backend/utils.js
  function formatWithStyles(
    inputArgs: $ReadOnlyArray<any>,
    style?: string,
  ): $ReadOnlyArray<any> {
    if (
      inputArgs === undefined ||
      inputArgs === null ||
      inputArgs.length === 0 ||
      // Matches any of %c but not %%c
      (typeof inputArgs[0] === 'string' &&
        inputArgs[0].match(/([^%]|^)(%c)/g)) ||
      style === undefined
    ) {
      return inputArgs;
    }

    // Matches any of %(o|O|d|i|s|f), but not %%(o|O|d|i|s|f)
    const REGEXP = /([^%]|^)((%%)*)(%([oOdisf]))/g;
    if (typeof inputArgs[0] === 'string' && inputArgs[0].match(REGEXP)) {
      return [`%c${inputArgs[0]}`, style, ...inputArgs.slice(1)];
    } else {
      const firstArg = inputArgs.reduce((formatStr, elem, i) => {
        if (i > 0) {
          formatStr += ' ';
        }
        switch (typeof elem) {
          case 'string':
          case 'boolean':
          case 'symbol':
            return (formatStr += '%s');
          case 'number':
            const formatting = Number.isInteger(elem) ? '%i' : '%f';
            return (formatStr += formatting);
          default:
            return (formatStr += '%o');
        }
      }, '%c');
      return [firstArg, style, ...inputArgs];
    }
  }
  // NOTE: KEEP IN SYNC with src/backend/utils.js
  function formatConsoleArguments(
    maybeMessage: any,
    ...inputArgs: $ReadOnlyArray<any>
  ): $ReadOnlyArray<any> {
    if (inputArgs.length === 0 || typeof maybeMessage !== 'string') {
      return [maybeMessage, ...inputArgs];
    }

    const args = inputArgs.slice();

    let template = '';
    let argumentsPointer = 0;
    for (let i = 0; i < maybeMessage.length; ++i) {
      const currentChar = maybeMessage[i];
      if (currentChar !== '%') {
        template += currentChar;
        continue;
      }

      const nextChar = maybeMessage[i + 1];
      ++i;

      // Only keep CSS and objects, inline other arguments
      switch (nextChar) {
        case 'c':
        case 'O':
        case 'o': {
          ++argumentsPointer;
          template += `%${nextChar}`;

          break;
        }
        case 'd':
        case 'i': {
          const [arg] = args.splice(argumentsPointer, 1);
          template += parseInt(arg, 10).toString();

          break;
        }
        case 'f': {
          const [arg] = args.splice(argumentsPointer, 1);
          template += parseFloat(arg).toString();

          break;
        }
        case 's': {
          const [arg] = args.splice(argumentsPointer, 1);
          template += arg.toString();
        }
      }
    }

    return [template, ...args];
  }

  let uidCounter = 0;
  function inject(renderer: ReactRenderer): number {
    const id = ++uidCounter;
    renderers.set(id, renderer);

    const reactBuildType = hasDetectedBadDCE
      ? 'deadcode'
      : detectReactBuildType(renderer);

    // If we have just reloaded to profile, we need to inject the renderer interface before the app loads.
    // Otherwise the renderer won't yet exist and we can skip this step.
    const attach = target.__REACT_DEVTOOLS_ATTACH__;
    if (typeof attach === 'function') {
      const rendererInterface = attach(hook, id, renderer, target);
      hook.rendererInterfaces.set(id, rendererInterface);
    }

    const version = renderer.reconcilerVersion || renderer.version;
    if (version !== undefined) {
      // React 16+
      const workTagMap = getWorkTagMap(version);
      hook.workTagMapByRendererId.set(id, workTagMap);
    }

    hook.emit('renderer', {
      id,
      renderer,
      reactBuildType,
    });

    return id;
  }

  let hasDetectedBadDCE = false;

  function sub(event: string, fn: Handler) {
    hook.on(event, fn);
    return () => hook.off(event, fn);
  }

  function on(event: string, fn: Handler) {
    if (!listeners[event]) {
      listeners[event] = [];
    }
    listeners[event].push(fn);
  }

  function off(event: string, fn: Handler) {
    if (!listeners[event]) {
      return;
    }
    const index = listeners[event].indexOf(fn);
    if (index !== -1) {
      listeners[event].splice(index, 1);
    }
    if (!listeners[event].length) {
      delete listeners[event];
    }
  }

  function emit(event: string, data: any) {
    if (listeners[event]) {
      listeners[event].map(fn => fn(data));
    }
  }

  function getFiberRoots(rendererID: RendererID) {
    const roots = fiberRoots;
    if (!roots[rendererID]) {
      roots[rendererID] = new Set();
    }
    return roots[rendererID];
  }

  function onCommitFiberUnmount(rendererID: RendererID, fiber: any) {
    const rendererInterface = rendererInterfaces.get(rendererID);
    if (rendererInterface != null) {
      rendererInterface.handleCommitFiberUnmount(fiber);
    }
  }

  function onCommitFiberRoot(
    rendererID: RendererID,
    root: any,
    priorityLevel: void | number,
  ) {
    const mountedRoots = hook.getFiberRoots(rendererID);
    const current = root.current;
    const isKnownRoot = mountedRoots.has(root);
    const isUnmounting =
      current.memoizedState == null || current.memoizedState.element == null;

    // Keep track of mounted roots so we can hydrate when DevTools connect.
    if (!isKnownRoot && !isUnmounting) {
      mountedRoots.add(root);
    } else if (isKnownRoot && isUnmounting) {
      mountedRoots.delete(root);
    }
    const rendererInterface = rendererInterfaces.get(rendererID);
    if (rendererInterface != null) {
      rendererInterface.handleCommitFiberRoot(root, priorityLevel);
    }
  }

  function onPostCommitFiberRoot(rendererID: RendererID, root: any) {
    const rendererInterface = rendererInterfaces.get(rendererID);
    if (rendererInterface != null) {
      rendererInterface.handlePostCommitFiberRoot(root);
    }
  }

  let isRunningDuringStrictModeInvocation = false;
  function setStrictMode(rendererID: RendererID, isStrictMode: boolean) {
    isRunningDuringStrictModeInvocation = isStrictMode;

    if (isStrictMode) {
      patchConsoleForStrictMode();
    } else {
      unpatchConsoleForStrictMode();
    }
  }

  const unpatchConsoleCallbacks = [];
  // For StrictMode we patch console once we are running in StrictMode and unpatch right after it
  // So patching could happen multiple times during the runtime
  // Notice how we don't patch error or warn methods, because they are already patched in patchConsoleForErrorsAndWarnings
  // This will only happen once, when hook is installed
  function patchConsoleForStrictMode() {
    // Don't patch twice
    if (unpatchConsoleCallbacks.length > 0) {
      return;
    }

    // At this point 'error', 'warn', and 'trace' methods are already patched
    // by React DevTools hook to append component stacks and other possible features.
    const consoleMethodsToOverrideForStrictMode = [
      'group',
      'groupCollapsed',
      'info',
      'log',
    ];

    for (const method of consoleMethodsToOverrideForStrictMode) {
      const originalMethod = targetConsole[method];
      const overrideMethod: (...args: Array<any>) => void = (
        ...args: any[]
      ) => {
        if (hook.settings.hideConsoleLogsInStrictMode) {
          return;
        }

        // Dim the text color of the double logs if we're not hiding them.
        // Firefox doesn't support ANSI escape sequences
        if (__IS_FIREFOX__) {
          originalMethod(
            ...formatWithStyles(args, FIREFOX_CONSOLE_DIMMING_COLOR),
          );
        } else {
          originalMethod(
            ANSI_STYLE_DIMMING_TEMPLATE,
            ...formatConsoleArguments(...args),
          );
        }
      };

      targetConsole[method] = overrideMethod;
      unpatchConsoleCallbacks.push(() => {
        targetConsole[method] = originalMethod;
      });
    }
  }

  function unpatchConsoleForStrictMode() {
    unpatchConsoleCallbacks.forEach(callback => callback());
    unpatchConsoleCallbacks.length = 0;
  }

  type StackFrameString = string;

  const openModuleRangesStack: Array<StackFrameString> = [];
  const moduleRanges: Array<[StackFrameString, StackFrameString]> = [];

  function getTopStackFrameString(error: Error): StackFrameString | null {
    const frames = error.stack.split('\n');
    const frame = frames.length > 1 ? frames[1] : null;
    return frame;
  }

  function getInternalModuleRanges(): Array<
    [StackFrameString, StackFrameString],
  > {
    return moduleRanges;
  }

  function registerInternalModuleStart(error: Error) {
    const startStackFrame = getTopStackFrameString(error);
    if (startStackFrame !== null) {
      openModuleRangesStack.push(startStackFrame);
    }
  }

  function registerInternalModuleStop(error: Error) {
    if (openModuleRangesStack.length > 0) {
      const startStackFrame = openModuleRangesStack.pop();
      const stopStackFrame = getTopStackFrameString(error);
      if (stopStackFrame !== null) {
        moduleRanges.push([startStackFrame, stopStackFrame]);
      }
    }
  }

  // For Errors and Warnings we only patch console once
  function patchConsoleForErrorsAndWarnings() {
    const consoleMethodsToOverrideForErrorsAndWarnings = [
      'error',
      'trace',
      'warn',
    ];

    for (const method of consoleMethodsToOverrideForErrorsAndWarnings) {
      const originalMethod = targetConsole[method];
      const overrideMethod: (...args: Array<any>) => void = (...args) => {
        if (
          isRunningDuringStrictModeInvocation &&
          hook.settings.hideConsoleLogsInStrictMode
        ) {
          return;
        }

        let injectedComponentStackAsFakeError = false;
        let alreadyHasComponentStack = false;
        if (method !== 'log' && hook.settings.appendComponentStack) {
          const lastArg = args.length > 0 ? args[args.length - 1] : null;
          alreadyHasComponentStack =
            typeof lastArg === 'string' && isStringComponentStack(lastArg); // The last argument should be a component stack.
        }

        const shouldShowInlineWarningsAndErrors =
          hook.settings.showInlineWarningsAndErrors &&
          (method === 'error' || method === 'warn');

        // Search for the first renderer that has a current Fiber.
        // We don't handle the edge case of stacks for more than one (e.g. interleaved renderers?)
        // eslint-disable-next-line no-for-of-loops/no-for-of-loops
        for (const [rendererId, renderer] of hook.renderers.entries()) {
          const currentDispatcherRef = getDispatcherRef(renderer);
          const {getCurrentFiber} = renderer;
          const current: ?Fiber =
            typeof getCurrentFiber === 'function' ? getCurrentFiber() : null;
          const workTagMap = hook.workTagMapByRendererId.get(rendererId);

          if (!workTagMap) {
            // React <16. Unsupported.
            continue;
          }

          if (current != null) {
            try {
              if (shouldShowInlineWarningsAndErrors) {
                const rendererInterface =
                  hook.rendererInterfaces.get(rendererId);
                // The backend is what implements a message queue, so it's the only one that injects onErrorOrWarning.
                // This may not be available (not yet injected) by the time error is emitted
                if (rendererInterface !== undefined) {
                  rendererInterface.onErrorOrWarning(
                    current,
                    ((method: any): 'error' | 'warn'),
                    args.slice(),
                  );
                }
              }

              if (
                hook.settings.appendComponentStack &&
                !supportsConsoleTasks(current)
              ) {
                const enableOwnerStacks = supportsOwnerStacks(current);
                let componentStack = '';
                if (enableOwnerStacks) {
                  // Prefix the owner stack with the current stack. I.e. what called
                  // console.error. While this will also be part of the native stack,
                  // it is hidden and not presented alongside this argument so we print
                  // them all together.
                  const topStackFrames = formatOwnerStack(
                    new Error('react-stack-top-frame'),
                  );
                  if (topStackFrames) {
                    componentStack += '\n' + topStackFrames;
                  }
                  componentStack += getOwnerStackByFiberInDev(
                    workTagMap,
                    current,
                    (currentDispatcherRef: any),
                  );
                } else {
                  componentStack = getStackByFiberInDevAndProd(
                    workTagMap,
                    current,
                    (currentDispatcherRef: any),
                  );
                }
                if (componentStack !== '') {
                  // Create a fake Error so that when we print it we get native source maps. Every
                  // browser will print the .stack property of the error and then parse it back for source
                  // mapping. Rather than print the internal slot. So it doesn't matter that the internal
                  // slot doesn't line up.
                  const fakeError = new Error('');
                  // In Chromium, only the stack property is printed but in Firefox the <name>:<message>
                  // gets printed so to make the colon make sense, we name it so we print Component Stack:
                  // and similarly Safari leave an expandable slot.
                  fakeError.name = enableOwnerStacks
                    ? 'Stack'
                    : 'Component Stack'; // This gets printed
                  // In Chromium, the stack property needs to start with ^[\w.]*Error\b to trigger stack
                  // formatting. Otherwise it is left alone. So we prefix it. Otherwise we just override it
                  // to our own stack.
                  fakeError.stack =
                    __IS_CHROME__ || __IS_EDGE__
                      ? (enableOwnerStacks
                          ? 'Error Stack:'
                          : 'Error Component Stack:') + componentStack
                      : componentStack;
                  if (alreadyHasComponentStack) {
                    // Only modify the component stack if it matches what we would've added anyway.
                    // Otherwise we assume it was a non-React stack.
                    if (
                      areStackTracesEqual(args[args.length - 1], componentStack)
                    ) {
                      const firstArg = args[0];
                      if (
                        args.length > 1 &&
                        typeof firstArg === 'string' &&
                        firstArg.endsWith('%s')
                      ) {
                        args[0] = firstArg.slice(0, firstArg.length - 2); // Strip the %s param
                      }
                      args[args.length - 1] = fakeError;
                      injectedComponentStackAsFakeError = true;
                    }
                  } else {
                    args.push(fakeError);
                    injectedComponentStackAsFakeError = true;
                  }
                }
              }
            } catch (error) {
              // Don't let a DevTools or React internal error interfere with logging.
              setTimeout(() => {
                throw error;
              }, 0);
            } finally {
              break;
            }
          }
        }

        if (hook.settings.breakOnConsoleErrors) {
          // --- Welcome to debugging with React DevTools ---
          // This debugger statement means that you've enabled the "break on warnings" feature.
          // Use the browser's Call Stack panel to step out of this override function
          // to where the original warning or error was logged.
          // eslint-disable-next-line no-debugger
          debugger;
        }

        if (isRunningDuringStrictModeInvocation) {
          // Dim the text color of the double logs if we're not hiding them.
          // Firefox doesn't support ANSI escape sequences
          if (__IS_FIREFOX__) {
            const argsWithCSSStyles = formatWithStyles(
              args,
              FIREFOX_CONSOLE_DIMMING_COLOR,
            );

            if (injectedComponentStackAsFakeError) {
              argsWithCSSStyles[0] = `${argsWithCSSStyles[0]} %o`;
            }

            originalMethod(...argsWithCSSStyles);
          } else {
            originalMethod(
              injectedComponentStackAsFakeError
                ? ANSI_STYLE_DIMMING_TEMPLATE_WITH_COMPONENT_STACK
                : ANSI_STYLE_DIMMING_TEMPLATE,
              ...formatConsoleArguments(...args),
            );
          }
        } else {
          originalMethod(...args);
        }
      };

      targetConsole[method] = overrideMethod;
    }
  }

  // TODO: More meaningful names for "rendererInterfaces" and "renderers".
  const fiberRoots: {[RendererID]: Set<mixed>} = {};
  const rendererInterfaces = new Map<RendererID, RendererInterface>();
  const listeners: {[string]: Array<Handler>} = {};
  const renderers = new Map<RendererID, ReactRenderer>();
  const workTagMapByRendererId = new Map<RendererID, WorkTagMap>();
  const backends = new Map<string, DevToolsBackend>();
  const settings = injectedSettings
    ? injectedSettings
    : {
        appendComponentStack: true,
        breakOnConsoleErrors: false,
        showInlineWarningsAndErrors: false,
        hideConsoleLogsInStrictMode: false,
      };

  const hook: DevToolsHook = {
    rendererInterfaces,
    listeners,

    backends,

    // Fast Refresh for web relies on this.
    renderers,

    emit,
    getFiberRoots,
    inject,
    on,
    off,
    sub,

    // This is a legacy flag.
    // React v16 checks the hook for this to ensure DevTools is new enough.
    supportsFiber: true,

    // React calls these methods.
    checkDCE,
    onCommitFiberUnmount,
    onCommitFiberRoot,
    onPostCommitFiberRoot,
    setStrictMode,

    // Schedule Profiler runtime helpers.
    // These internal React modules to report their own boundaries
    // which in turn enables the profiler to dim or filter internal frames.
    getInternalModuleRanges,
    registerInternalModuleStart,
    registerInternalModuleStop,

    settings,
    workTagMapByRendererId,
  };

  patchConsoleForErrorsAndWarnings();

  Object.defineProperty(
    target,
    '__REACT_DEVTOOLS_GLOBAL_HOOK__',
    ({
      // This property needs to be configurable for the test environment,
      // else we won't be able to delete and recreate it between tests.
      configurable: __DEV__,
      enumerable: false,
      get() {
        return hook;
      },
    }: Object),
  );

  return hook;
}
