import {Vector2, Vector3, Vector4} from "math.gl";
import {Camera} from "./scene";

export function css(strings: TemplateStringsArray, ...props: any[]) {
    let string = "";
    for (let i = 0; i < strings.length; i++) {
        string += strings[i];
        if (i < props.length) string += props[i];
    }
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(string);
    return stylesheet;
}

const templates = new Map<string, HTMLTemplateElement>()
export function html(strings: TemplateStringsArray, ...props: any[]) {
    let string = "";
    for (let i = 0; i < strings.length; i++) {
        string += strings[i];
        if (i < props.length) string += props[i];
    }
    if (templates.has(string)) return templates.get(string)!;
    const template = document.createElement("template");
    template.innerHTML = string;
    templates.set(string, template);
    return template;
}


export function setupPanningListeners(
    element: HTMLElement,
    onPan: (by: Vector2, right: boolean) => void,
    onZoom: (by: number) => boolean = () => false,
    onMove: (by: Vector2) => void = () => undefined,
    onStart: (right: boolean) => void = () => undefined,
    onEnd: (right: boolean) => void = () => undefined
) {
    let isDragging = false;
    let isZooming = false;
    let isMoving = false;
    let rightClick = false;
    let lastPos = Vector2.from([0, 0]);
    let lastTouchDistance = 0;

    const mouseMoveListener = (e: MouseEvent) => {
        if (!isDragging && !isMoving) return;
        const current = new Vector2(e.clientX, e.clientY);
        if (isDragging) {
            onPan(current.clone().subtract(lastPos).multiplyByScalar(1 / Math.max(element.clientWidth, element.clientHeight)).multiply(new Vector2(Math.PI, Math.PI)), rightClick);
        } else if (isMoving) {
            onMove(current.clone().subtract(lastPos).multiplyByScalar(1 / Math.max(element.clientWidth, element.clientHeight)));
        }
        lastPos = current;
    }
    const touchMoveListener = (e: TouchEvent) => {
        if (isDragging) {
            if (e.touches.length !== 1) {
                isDragging = false;
                return;
            }
            const current = new Vector2(e.touches[0].clientX, e.touches[0].clientY);
            onPan(current.clone().subtract(lastPos).multiplyByScalar(1 / Math.max(element.clientWidth, element.clientHeight)).multiply(new Vector2(Math.PI, Math.PI)), rightClick);
            lastPos = current;
        } else if (isZooming) {
            if (e.touches.length !== 2) {
                isZooming = false;
                return;
            }
            const current = new Vector2(e.touches[0].clientX, e.touches[0].clientY).distance(new Vector2(e.touches[1].clientX, e.touches[1].clientY));
            ;
            onZoom(lastTouchDistance / current);
            lastTouchDistance = current;
        } else if (isMoving) {
            if (e.touches.length !== 3) {
                isMoving = false;
                return;
            }
            const current = new Vector2(e.touches[0].clientX, e.touches[0].clientY);
            onMove(current.clone().subtract(lastPos).divide(new Vector2(element.clientWidth, element.clientHeight)));
            lastPos = current;
        }
    }

    const stop = () => {
        onEnd(rightClick);
        document.removeEventListener("mousemove", mouseMoveListener);
        document.removeEventListener("touchmove", touchMoveListener);
        document.removeEventListener("mouseup", stop);
        document.removeEventListener("mouseleave", stop);
        document.removeEventListener("touchend", stop);
        document.removeEventListener("touchcancel", stop);
        isDragging = false;
        isZooming = false;
        isMoving = false;
        rightClick = false;
    }

    // override context menu event handling to be able to use right click for controls
    element.addEventListener("contextmenu", e => {
        if (e.button === 2) e.preventDefault();
    })
    element.addEventListener("mousedown", e => {
        if (e.button !== 0 && e.button !== 2) return;
        rightClick = e.button === 2;
        e.preventDefault();
        e.stopPropagation();
        document.addEventListener("mousemove", mouseMoveListener);
        document.addEventListener("mouseup", stop);
        document.addEventListener("mouseleave", stop);
        if (e.shiftKey) {
            isMoving = true;
        } else {
            isDragging = true;
        }
        lastPos = new Vector2(e.clientX, e.clientY);
        onStart(rightClick);
    });
    element.addEventListener("touchstart", e => {
        if (e.touches.length === 1 || e.touches.length === 3) {
            e.preventDefault();
            isDragging = e.touches.length === 1;
            isMoving = e.touches.length === 3;
            lastPos = new Vector2(e.touches[0].clientX, e.touches[0].clientY);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            isZooming = true;
            lastTouchDistance = new Vector2(e.touches[0].clientX, e.touches[0].clientY).distance(new Vector2(e.touches[1].clientX, e.touches[1].clientY));
        }
        document.addEventListener("touchmove", touchMoveListener);
        document.addEventListener("touchcancel", stop);
        document.addEventListener("touchend", stop);
        onStart(false);
    })

    element.addEventListener("wheel", e => {
        let by = 1;
        if (e.deltaY < 0) by = 0.9
        if (e.deltaY > 0) by = 1.1
        if (onZoom(by)) {
            e.preventDefault();
        }
    })
}

export type Ray = {
    origin: Vector3,
    direction: Vector3
}

// ray box for cpu side world mouse pos
export function rayBoxIntersection(ray: Ray, aabb: [Vector3, Vector3], nearFar: Vector2): boolean {
    const invDir = new Vector3(1, 1, 1).divide(ray.direction)
    const lo = aabb[0].clone().subtract(ray.origin).multiply(invDir);
    const hi = aabb[1].clone().subtract(ray.origin).multiply(invDir);
    const tmin = lo.clone().min(hi);
    const tmax = lo.clone().max(hi);
    nearFar.x = Math.max(0, Math.max(tmin.x, Math.max(tmin.y, tmin.z)));
    nearFar.y = Math.min(tmax.x, Math.min(tmax.y, tmax.z));
    return nearFar.x <= nearFar.y;
}

export function rayBoxIntersectionPositions(ray: Ray, aabb: [Vector3, Vector3]): [hitMin: Vector3, hitMax: Vector3] | null {
    const nearFar = new Vector2();
    if (!rayBoxIntersection(ray, aabb, nearFar)) return null;

    const hitMin = new Vector3();
    const hitMax = new Vector3();

    if (nearFar.x < 0) {
        hitMin.copy(ray.origin);
        hitMax.copy(ray.origin.clone().add(ray.direction.clone().multiplyByScalar(nearFar.y)))
    } else {
        hitMin.copy(ray.origin.clone().add(ray.direction.clone().multiplyByScalar(nearFar.x)))
        hitMax.copy(ray.origin.clone().add(ray.direction.clone().multiplyByScalar(nearFar.y)))
    }

    return [hitMin, hitMax];
}

export function worldRay(gl: WebGLRenderingContext, camera: Camera, [x, y]: [number, number]): Ray {
    const invProj = camera.projMatrix(gl.canvas.width / gl.canvas.height).invert();
    const clipPos = new Vector4(x, y, 0, 1);

    const viewPosH = clipPos.transform(invProj);
    const viewPos = new Vector3(viewPosH.x, viewPosH.y, viewPosH.z).multiplyByScalar(1 / viewPosH.w);

    const invView = camera.viewMatrix().invert();
    const worldPosH = new Vector4(viewPos.x, viewPos.y, viewPos.z, 1.0).transform(invView);
    const worldPos = new Vector3(worldPosH.x, worldPosH.y, worldPosH.z).multiplyByScalar(1 / worldPosH.w);

    const dir = worldPos.subtract(camera.pos).normalize();

    return {
        origin: camera.pos,
        direction: dir
    }
}

function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
}

function nearlyEqual(a: number, b: number, eps = 1e-5) {
    return Math.abs(a - b) <= eps;
}

export function cubeFace([min, max]: [Vector3, Vector3], pos: Vector3 | undefined | null): number | null {
    if (!pos) return null;
    // perpendicular distances to the six face planes
    const dFront = Math.abs(pos.z - max.z); // face 0
    const dBack = Math.abs(pos.z - min.z); // face 1
    const dLeft = Math.abs(pos.x - min.x); // face 2
    const dRight = Math.abs(pos.x - max.x); // face 3
    const dTop = Math.abs(pos.y - max.y); // face 4
    const dBottom = Math.abs(pos.y - min.y); // face 5

    const dists = [dFront, dBack, dLeft, dRight, dTop, dBottom];

    // compute clamped (closest) point on AABB to pos
    const clamped = {
        x: clamp(pos.x, min.x, max.x),
        y: clamp(pos.y, min.y, max.y),
        z: clamp(pos.z, min.z, max.z),
    };

    // collect candidate faces based on clamped point being on a face
    const candidates: number[] = [];
    if (nearlyEqual(clamped.z, max.z)) candidates.push(0); // front
    if (nearlyEqual(clamped.z, min.z)) candidates.push(1); // back
    if (nearlyEqual(clamped.x, min.x)) candidates.push(2); // left
    if (nearlyEqual(clamped.x, max.x)) candidates.push(3); // right
    if (nearlyEqual(clamped.y, max.y)) candidates.push(4); // top
    if (nearlyEqual(clamped.y, min.y)) candidates.push(5); // bottom

    if (candidates.length < 1) return null;
    // pick the candidate face with smallest perpendicular distance
    let bestIndex = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        const idx = candidates[i];
        if (dists[idx] < dists[bestIndex]) bestIndex = idx;
    }
    return bestIndex;
}
export function closestPoints(l1: Ray, l2: Ray): [pOn1: Vector3, pOn2: Vector3] | null {
    const r = l1.origin.clone().subtract(l2.origin);
    const a = l1.direction.dot(l1.direction);
    const b = l1.direction.dot(l2.direction);
    const c = l2.direction.dot(l2.direction);
    const d = l1.direction.dot(r);
    const e = l2.direction.dot(r);

    const denom = a * c - b * b;
    let t: number, u: number;

    if (Math.abs(denom) > 1e-8) {
        t = (b * e - c * d) / denom;
        u = (a * e - b * d) / denom;
    } else return null;

    const pOn1 = l1.origin.clone().add(l1.direction.clone().multiplyByScalar(t))
    const pOn2 = l2.origin.clone().add(l2.direction.clone().multiplyByScalar(u))
    return [pOn1, pOn2];
}