/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Interaction,
  MouseDownInteraction,
  MouseMoveInteraction,
  MouseUpInteraction,
  WheelWithShiftInteraction,
} from './useCanvasInteraction';
import type {Rect} from './geometry';
import type {ScrollState} from './utils/scrollState';
import type {ViewRefs} from './Surface';
import type {ViewState} from '../types';

import {Surface} from './Surface';
import {View} from './View';
import {rectContainsPoint} from './geometry';
import {
  clampState,
  areScrollStatesEqual,
  translateState,
} from './utils/scrollState';
import {MOVE_WHEEL_DELTA_THRESHOLD} from './constants';
import {COLORS} from '../content-views/constants';

const CARET_MARGIN = 3;
const CARET_WIDTH = 5;
const CARET_HEIGHT = 3;

type OnChangeCallback = (
  scrollState: ScrollState,
  containerLength: number,
) => void;

export class VerticalScrollView extends View {
  _contentView: View;
  _isPanning: boolean;
  _mutableViewStateKey: string;
  _onChangeCallback: OnChangeCallback | null;
  _scrollState: ScrollState;
  _viewState: ViewState;

  constructor(
    surface: Surface,
    frame: Rect,
    contentView: View,
    viewState: ViewState,
    label: string,
  ) {
    super(surface, frame);

    this._contentView = contentView;
    this._isPanning = false;
    this._mutableViewStateKey = label + ':VerticalScrollView';
    this._onChangeCallback = null;
    this._scrollState = {
      offset: 0,
      length: 0,
    };
    this._viewState = viewState;

    this.addSubview(contentView);

    this._restoreMutableViewState();
  }

  setFrame(newFrame: Rect) {
    super.setFrame(newFrame);

    // Revalidate scrollState
    this._setScrollState(this._scrollState);
  }

  desiredSize() {
    return this._contentView.desiredSize();
  }

  draw(context: CanvasRenderingContext2D, viewRefs: ViewRefs) {
    super.draw(context, viewRefs);

    // Show carets if there's scroll overflow above or below the viewable area.
    if (this.frame.size.height > CARET_HEIGHT * 2 + CARET_MARGIN * 3) {
      const offset = this._scrollState.offset;
      const desiredSize = this._contentView.desiredSize();

      const above = offset;
      const below = this.frame.size.height - desiredSize.height - offset;

      if (above < 0 || below < 0) {
        const {visibleArea} = this;
        const {x, y} = visibleArea.origin;
        const {width, height} = visibleArea.size;
        const horizontalCenter = x + width / 2;

        const halfWidth = CARET_WIDTH;
        const left = horizontalCenter + halfWidth;
        const right = horizontalCenter - halfWidth;

        if (above < 0) {
          const topY = y + CARET_MARGIN;

          context.beginPath();
          context.moveTo(horizontalCenter, topY);
          context.lineTo(left, topY + CARET_HEIGHT);
          context.lineTo(right, topY + CARET_HEIGHT);
          context.closePath();
          context.fillStyle = COLORS.SCROLL_CARET;
          context.fill();
        }

        if (below < 0) {
          const bottomY = y + height - CARET_MARGIN;

          context.beginPath();
          context.moveTo(horizontalCenter, bottomY);
          context.lineTo(left, bottomY - CARET_HEIGHT);
          context.lineTo(right, bottomY - CARET_HEIGHT);
          context.closePath();
          context.fillStyle = COLORS.SCROLL_CARET;
          context.fill();
        }
      }
    }
  }

  layoutSubviews() {
    const {offset} = this._scrollState;
    const desiredSize = this._contentView.desiredSize();

    const minimumHeight = this.frame.size.height;
    const desiredHeight = desiredSize ? desiredSize.height : 0;
    // Force view to take up at least all remaining vertical space.
    const height = Math.max(desiredHeight, minimumHeight);

    const proposedFrame = {
      origin: {
        x: this.frame.origin.x,
        y: this.frame.origin.y + offset,
      },
      size: {
        width: this.frame.size.width,
        height,
      },
    };
    this._contentView.setFrame(proposedFrame);
    super.layoutSubviews();
  }

  handleInteraction(interaction: Interaction): ?boolean {
    switch (interaction.type) {
      case 'mousedown':
        return this._handleMouseDown(interaction);
      case 'mousemove':
        return this._handleMouseMove(interaction);
      case 'mouseup':
        return this._handleMouseUp(interaction);
      case 'wheel-shift':
        return this._handleWheelShift(interaction);
    }
  }

  onChange(callback: OnChangeCallback) {
    this._onChangeCallback = callback;
  }

  scrollBy(deltaY: number): boolean {
    const newState = translateState({
      state: this._scrollState,
      delta: -deltaY,
      containerLength: this.frame.size.height,
    });

    // If the state is updated by this wheel scroll,
    // return true to prevent the interaction from bubbling.
    // For instance, this prevents the outermost container from also scrolling.
    return this._setScrollState(newState);
  }

  _handleMouseDown(interaction: MouseDownInteraction) {
    if (rectContainsPoint(interaction.payload.location, this.frame)) {
      this._isPanning = true;
    }
  }

  _handleMouseMove(interaction: MouseMoveInteraction) {
    if (!this._isPanning) {
      return;
    }
    const newState = translateState({
      state: this._scrollState,
      delta: interaction.payload.event.movementY,
      containerLength: this.frame.size.height,
    });
    this._setScrollState(newState);
    return true;
  }

  _handleMouseUp(interaction: MouseUpInteraction) {
    if (this._isPanning) {
      this._isPanning = false;
    }
  }

  _handleWheelShift(interaction: WheelWithShiftInteraction): boolean {
    const {
      location,
      delta: {deltaX, deltaY},
    } = interaction.payload;

    if (!rectContainsPoint(location, this.frame)) {
      return false; // Not scrolling on view
    }

    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);
    if (absDeltaX > absDeltaY) {
      return false; // Scrolling horizontally
    }

    if (absDeltaY < MOVE_WHEEL_DELTA_THRESHOLD) {
      return false; // Movement was too small and should be ignored.
    }

    return this.scrollBy(deltaY);
  }

  _restoreMutableViewState() {
    if (
      this._viewState.viewToMutableViewStateMap.has(this._mutableViewStateKey)
    ) {
      this._scrollState = ((this._viewState.viewToMutableViewStateMap.get(
        this._mutableViewStateKey,
      ): any): ScrollState);
    } else {
      this._viewState.viewToMutableViewStateMap.set(
        this._mutableViewStateKey,
        this._scrollState,
      );
    }

    this.setNeedsDisplay();
  }

  _setScrollState(proposedState: ScrollState): boolean {
    const height = this._contentView.frame.size.height;
    const clampedState = clampState({
      state: proposedState,
      minContentLength: height,
      maxContentLength: height,
      containerLength: this.frame.size.height,
    });
    if (!areScrollStatesEqual(clampedState, this._scrollState)) {
      this._scrollState.offset = clampedState.offset;
      this._scrollState.length = clampedState.length;

      this.setNeedsDisplay();

      if (this._onChangeCallback !== null) {
        this._onChangeCallback(clampedState, this.frame.size.height);
      }

      return true;
    }

    return false;
  }
}
