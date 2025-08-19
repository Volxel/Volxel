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

export function html(strings: TemplateStringsArray, ...props: any[]) {
    let string = "";
    for (let i = 0; i < strings.length; i++) {
        string += strings[i];
        if (i < props.length) string += props[i];
    }
    return string;
}


export function setupPanningListeners(element: HTMLElement, onPan: (by: Vector2) => void, onZoom: (by: number) => boolean = () => false, onMove: (by: Vector2) => void = () => {}) {
    let isDragging = false;
    let isZooming = false;
    let isMoving = false;
    let lastPos = Vector2.from([0, 0]);
    let lastTouchDistance = 0;

    const mouseMoveListener = (e: MouseEvent) => {
        if (!isDragging && !isMoving) return;
        const current = new Vector2(e.clientX, e.clientY);
        if (isDragging) {
            onPan(current.clone().subtract(lastPos).divide(new Vector2(element.clientWidth, element.clientHeight)).multiply(new Vector2(Math.PI, Math.PI)));
        } else if (isMoving) {
            onMove(current.clone().subtract(lastPos).divide(new Vector2(element.clientWidth, element.clientHeight)));
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
            onPan(current.clone().subtract(lastPos).divide(new Vector2(element.clientWidth, element.clientHeight)).multiply(new Vector2(Math.PI, Math.PI)));
            lastPos = current;
        } else if (isZooming) {
            if (e.touches.length !== 2) {
                isZooming = false;
                return;
            }
            const current = new Vector2(e.touches[0].clientX, e.touches[0].clientY).distance(new Vector2(e.touches[1].clientX, e.touches[1].clientY));;
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
        document.removeEventListener("mousemove", mouseMoveListener);
        document.removeEventListener("touchmove", touchMoveListener);
        document.removeEventListener("mouseup", stop);
        document.removeEventListener("mouseleave", stop);
        document.removeEventListener("touchend", stop);
        document.removeEventListener("touchcancel", stop);
        isDragging = false;
        isZooming = false;
        isMoving = false;
    }

    element.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        e.preventDefault()
        document.addEventListener("mousemove", mouseMoveListener);
        document.addEventListener("mouseup", stop);
        document.addEventListener("mouseleave", stop);
        if (e.shiftKey) {
            isMoving = true;
        } else {
            isDragging = true;
        }
        lastPos = new Vector2(e.clientX, e.clientY);
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
    const viewPos = new Vector3(viewPosH.x, viewPosH.y, viewPosH.z).multiplyByScalar(1/viewPosH.w);

    const invView = camera.viewMatrix().invert();
    const worldPosH = new Vector4(viewPos.x, viewPos.y, viewPos.z, 1.0).transform(invView);
    const worldPos = new Vector3(worldPosH.x, worldPosH.y, worldPosH.z).multiplyByScalar(1/worldPosH.w);

    const dir = worldPos.subtract(camera.pos).normalize();

    return {
        origin: camera.pos,
        direction: dir
    }
}