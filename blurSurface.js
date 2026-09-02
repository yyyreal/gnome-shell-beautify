import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

export const BLUR_EFFECT_NAME = 'gnome-beautify-background-blur';

// The sampling layer must be outside Dash's ALWAYS offscreen redirect. Its
// zero-sized wrapper must never acquire the target's preferred size: panelBox
// and Ubuntu Dock contain BoxLayouts, where that would create another row.
export class BackgroundBlurLayer {
    constructor(target, anchor, laters, onDestroy, onStateChange) {
        this.target = target;
        this.anchor = anchor;
        this.parent = anchor.get_parent();
        if (!this.parent)
            throw new Error('The background anchor has no parent');

        this._laters = laters;
        this._onDestroy = onDestroy;
        this._onStateChange = onStateChange;
        this.state = 'waiting';
        this._signals = [];
        this._laterId = 0;
        this.destroyed = false;

        this.group = new Meta.BackgroundGroup({
            name: 'gnome-beautify-background-group',
            width: 0,
            height: 0,
            x_expand: false,
            y_expand: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.START,
            reactive: false,
            clip_to_allocation: false,
            layout_manager: new Clutter.FixedLayout(),
        });
        this.surface = new St.Widget({
            name: 'gnome-beautify-blur-surface',
            reactive: false,
            can_focus: false,
            clip_to_allocation: true,
            visible: false,
        });

        try {
            this._connect(this.group, 'destroy', () => this.destroy(true));
            this.group.add_child(this.surface);
            this.parent.insert_child_below(this.group, anchor);

            // Watch intermediate actors too: panel hiding, overview fading and
            // vertical/horizontal Dock movement do not always resize the target.
            let actor = target;
            while (actor && actor !== this.parent) {
                for (const signal of [
                    'notify::allocation', 'notify::mapped', 'notify::visible',
                    'notify::opacity', 'notify::translation-x', 'notify::translation-y',
                    'notify::scale-x', 'notify::scale-y',
                ])
                    this._connect(actor, signal, () => this._queueSync());
                this._connect(actor, 'destroy', () => this.destroy());
                actor = actor.get_parent();
            }
            this._connect(this.group, 'notify::allocation', () => this._queueSync());
            this._connect(this.parent, 'notify::allocation', () => this._queueSync());
            this._queueSync();
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    _connect(actor, signal, callback) {
        this._signals.push([actor, actor.connect(signal, callback)]);
    }

    matches(target, anchor) {
        return !this.destroyed && this.target === target && this.anchor === anchor &&
            this.parent === anchor.get_parent() && this.group.get_parent() === this.parent;
    }

    update(radius, brightness, corner) {
        if (this.destroyed)
            return;
        this.surface.set_style([
            'background-color: rgba(0,0,0,0)',
            `border-radius: ${corner}px`,
            'border-width: 0px',
            'box-shadow: none',
        ].join(';') + ';');
        let blur = this.surface.get_effect(BLUR_EFFECT_NAME);
        if (!blur) {
            blur = new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius,
                brightness,
            });
            this.surface.add_effect_with_name(BLUR_EFFECT_NAME, blur);
        } else {
            blur.radius = radius;
            blur.brightness = brightness;
        }
        blur.queue_repaint();
        this._setState('waiting');
        this._queueSync();
    }

    _setState(state) {
        if (this.state === state)
            return;
        this.state = state;
        this._onStateChange?.(this, state);
    }

    _queueSync() {
        if (this.destroyed || this._laterId)
            return;
        this._laterId = this._laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            try {
                this._syncGeometry();
            } catch (error) {
                this.surface.hide();
                this._setState('failed');
                console.warn(`Gnome美化: blur geometry failed: ${error.message}`);
            }
            return false;
        });
    }

    _syncGeometry() {
        if (this.destroyed)
            return;
        if (!this.matches(this.target, this.anchor)) {
            this.destroy();
            return;
        }
        if (!this.target.is_mapped()) {
            this.surface.hide();
            this._setState('hidden');
            return;
        }
        if (!this.target.has_allocation() || !this.parent.has_allocation()) {
            this.surface.hide();
            this._setState('waiting');
            return;
        }

        const [stageX, stageY] = this.target.get_transformed_position();
        const [width, height] = this.target.get_transformed_size();
        const [ok1, x1, y1] = this.parent.transform_stage_point(stageX, stageY);
        const [ok2, x2, y2] = this.parent.transform_stage_point(stageX + width, stageY + height);
        if (!ok1 || !ok2 || x2 <= x1 || y2 <= y1) {
            this.surface.hide();
            this._setState('waiting');
            return;
        }

        let opacity = 255;
        let actor = this.target;
        while (actor && actor !== this.parent) {
            opacity *= actor.opacity / 255;
            actor = actor.get_parent();
        }
        if (actor !== this.parent) {
            this.destroy();
            return;
        }

        // Convert both corners to the common parent's coordinates. This also
        // handles monitor offsets and scaling without assuming a bottom Dock.
        const [groupX, groupY] = this.group.get_position();
        this.surface.set_position(x1 - groupX, y1 - groupY);
        this.surface.set_size(x2 - x1, y2 - y1);
        this.surface.opacity = Math.round(opacity);
        this.surface.show();
        this._setState('applied');
    }

    destroy(groupAlreadyDestroying = false) {
        if (this.destroyed)
            return;
        this.destroyed = true;
        if (this._laterId)
            this._laters.remove(this._laterId);
        this._laterId = 0;
        for (const [actor, id] of this._signals)
            actor.disconnect(id);
        this._signals = [];
        if (!groupAlreadyDestroying)
            this.group.destroy();
        this._onDestroy?.(this);
        this._onDestroy = null;
        this._onStateChange = null;
    }
}
