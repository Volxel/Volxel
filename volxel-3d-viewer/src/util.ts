import {Vector2} from "math.gl";

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