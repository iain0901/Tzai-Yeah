"use client";

import { Component, createRef, type ReactNode } from "react";
import { Puzzle } from "lucide-react";
import "./scene-transition.css";

export type SceneTransitionProps = {
  sceneKey: string;
  direction: number;
  motion: boolean;
  children: ReactNode;
};
type Snapshot = { ghost: HTMLDivElement; transform: string; opacity: number; restoreFocus: boolean };
const DURATION = 560;
const EASING = "cubic-bezier(.22,.76,.24,1)";

/**
 * The departing scene is an inert visual snapshot, never a second React tree.
 * Real children receive current props immediately and retain their normal identity.
 */
export default class SceneTransition extends Component<SceneTransitionProps, Record<string, never>, Snapshot | null> {
  private shell = createRef<HTMLDivElement>();
  private content = createRef<HTMLDivElement>();
  private ghosts = createRef<HTMLDivElement>();
  private effects = createRef<HTMLDivElement>();
  private animations: Animation[] = [];
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private run = 0;
  private reducedMotion: MediaQueryList | null = null;

  componentDidMount() {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion.addEventListener("change", this.onMotionPreference);
  }

  private onMotionPreference = () => {
    if (this.reducedMotion?.matches) this.cancelTransition();
  };

  getSnapshotBeforeUpdate(previous: Readonly<SceneTransitionProps>): Snapshot | null {
    const content = this.content.current;
    if (previous.sceneKey === this.props.sceneKey || !this.props.motion || this.reducedMotion?.matches || !content) return null;
    const style = getComputedStyle(content);
    const ghost = content.cloneNode(true) as HTMLDivElement;
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    ghost.classList.add("scene-transition-ghost");

    // Preserve the frame of any running decorative animation instead of restarting it.
    // Removing IDs keeps labels and anchors on the real, interactive scene only.
    const originals = [content, ...content.querySelectorAll<HTMLElement | SVGElement>("*")];
    const copies = [ghost, ...ghost.querySelectorAll<HTMLElement | SVGElement>("*")];
    for (let index = 0; index < copies.length; index++) {
      const copy = copies[index], original = originals[index];
      copy.removeAttribute("id");
      copy.removeAttribute("autofocus");
      copy.removeAttribute("name");
      if (copy instanceof HTMLElement || copy instanceof SVGElement) {
        const computed = getComputedStyle(original);
        if (computed.animationName !== "none") {
          copy.style.transform = computed.transform;
          copy.style.opacity = computed.opacity;
        }
        copy.style.animation = "none";
        copy.style.transition = "none";
      }
    }
    // A decorative snapshot must not start a second media player or embedded page.
    for (const media of ghost.querySelectorAll("iframe, audio, video")) media.replaceWith(document.createElement("span"));
    const canvases = content.querySelectorAll("canvas"), clonedCanvases = ghost.querySelectorAll("canvas");
    canvases.forEach((canvas, index) => {
      try { clonedCanvases[index]?.getContext("2d")?.drawImage(canvas, 0, 0); } catch { /* A protected canvas may remain blank for the brief exit. */ }
    });
    return { ghost, transform: style.transform === "none" ? "translate3d(0,0,0) scale(1)" : style.transform, opacity: Number(style.opacity) || 0, restoreFocus: content.contains(document.activeElement) };
  }

  componentDidUpdate(previous: Readonly<SceneTransitionProps>, _state: Readonly<Record<string, never>>, snapshot: Snapshot | null) {
    if (!this.props.motion || this.reducedMotion?.matches) { this.cancelTransition(); return; }
    if (previous.sceneKey !== this.props.sceneKey) {
      this.cancelTransition();
      if (snapshot) this.startTransition(snapshot);
    }
  }

  componentWillUnmount() {
    this.reducedMotion?.removeEventListener("change", this.onMotionPreference);
    this.cancelTransition();
  }

  private animate(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions, fallback: string) {
    if (typeof element.animate === "function") {
      const animation = element.animate(frames, options);
      void animation.finished.catch(() => {});
      this.animations.push(animation);
    } else {
      // The CSS fallback has the same timing and direction, with no dependency.
      element.style.animation = `${fallback} ${options.duration}ms ${options.easing || EASING} ${options.delay || 0}ms both`;
    }
  }

  private startTransition(snapshot: Snapshot) {
    const content = this.content.current, shell = this.shell.current, ghosts = this.ghosts.current, effects = this.effects.current;
    if (!content || !shell || !ghosts || !effects) return;
    const current = this.run;
    const direction = Math.sign(this.props.direction) || 1;
    shell.style.setProperty("--scene-direction", String(direction));
    shell.dataset.transitioning = "true";
    snapshot.ghost.style.setProperty("--scene-old-transform", snapshot.transform);
    snapshot.ghost.style.setProperty("--scene-old-opacity", String(snapshot.opacity));
    ghosts.appendChild(snapshot.ghost);
    content.inert = true;

    this.animate(snapshot.ghost, [
      { opacity: snapshot.opacity, transform: snapshot.transform },
      { opacity: 0, transform: `translate3d(${-direction * 18}px,-5px,0) scale(.985)` },
    ], { duration: 210, easing: EASING, fill: "forwards" }, "scene-leave");
    this.animate(content, [
      { opacity: 0, transform: `translate3d(${direction * 24}px,12px,0) scale(.985)` },
      { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
    ], { duration: 440, delay: 120, easing: EASING, fill: "both" }, "scene-arrive");
    const glow = effects.querySelector<HTMLElement>(".scene-transition-glow");
    if (glow) this.animate(glow, [
      { opacity: 0, transform: `translateX(${-direction * 8}%) scale(.75)` },
      { opacity: .72, transform: "translateX(0) scale(1)", offset: .4 },
      { opacity: 0, transform: `translateX(${direction * 8}%) scale(1.12)` },
    ], { duration: DURATION, easing: "ease-in-out" }, "scene-glow");
    effects.querySelectorAll<HTMLElement>(".scene-transition-piece").forEach((piece, index) => {
      piece.style.setProperty("--piece-distance", `${direction * (12 + index * 7)}px`);
      this.animate(piece, [
        { opacity: 0, transform: "translate3d(0,9px,0) rotate(-12deg) scale(.6)" },
        { opacity: .72, transform: "translate3d(0,-4px,0) rotate(3deg) scale(1)", offset: .35 },
        { opacity: 0, transform: `translate3d(${direction * (12 + index * 7)}px,-28px,0) rotate(13deg) scale(.75)` },
      ], { duration: 450, delay: 35 + index * 20, easing: EASING }, "scene-piece");
    });
    this.finishTimer = setTimeout(() => {
      if (current !== this.run) return;
      this.cancelTransition();
      if (snapshot.restoreFocus && document.activeElement === document.body) content.focus({ preventScroll: true });
    }, DURATION + 20);
  }

  private cancelTransition() {
    this.run++;
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    for (const animation of this.animations) animation.cancel();
    this.animations = [];
    this.ghosts.current?.replaceChildren();
    if (this.content.current) { this.content.current.inert = false; this.content.current.style.animation = ""; }
    if (this.shell.current) delete this.shell.current.dataset.transitioning;
    this.effects.current?.querySelectorAll<HTMLElement>(".scene-transition-glow, .scene-transition-piece").forEach(element => { element.style.animation = ""; });
  }

  render() {
    return <div className="scene-transition" ref={this.shell}>
      <div className="scene-transition-content" ref={this.content} tabIndex={-1}>{this.props.children}</div>
      <div className="scene-transition-ghosts" ref={this.ghosts} aria-hidden="true" inert/>
      <div className="scene-transition-effects" ref={this.effects} aria-hidden="true" inert>
        <i className="scene-transition-glow"/>
        {[0, 1, 2].map(index => <span className={`scene-transition-piece scene-transition-piece-${index}`} key={index}><Puzzle strokeWidth={1.3}/></span>)}
      </div>
    </div>;
  }
}
