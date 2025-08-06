import {Quaternion, Vector2, Vector3} from "math.gl";

export class Camera {
  pos: Vector3;
  view: Vector3;
  yaw: number = 0;
  pitch: number = 0;
  static up: Vector3 = new Vector3(0, 1, 0);

  constructor(distance: number,
              private posLoc: WebGLUniformLocation | null,
              private viewLoc: WebGLUniformLocation | null) {
    this.view = new Vector3();
    this.pos = new Vector3(0, 0, distance);
  }

  rotateAroundView(by: Vector2) {
    this.yaw += -by.x;
    this.pitch += by.y;

    const maxPitch = Math.PI / 2 - 0.01;
    if (this.pitch > maxPitch) this.pitch = maxPitch;
    if (this.pitch < -maxPitch) this.pitch = -maxPitch;

    const qYaw = new Quaternion().fromAxisRotation(Camera.up, this.yaw);
    const right = new Vector3(1, 0, 0).transformByQuaternion(qYaw).normalize();
    const qPitch = new Quaternion().fromAxisRotation(right, this.pitch);

    const orientation = qPitch.multiply(qYaw);

    const finalDir = new Vector3(0, 0, -1).transformByQuaternion(orientation).multiplyByScalar(this.pos.clone().subtract(this.view).len());

    this.pos = finalDir.clone().add(this.view);
  }

  zoom(by: number) {
    const dir = this.pos.clone().subtract(this.view);
    if (dir.len() * by <= 0.1 || dir.len() * by >= 10) return;
    this.pos = dir.multiplyByScalar(by).add(this.view);
  }

  translateOnPlane(by: Vector2) {
    const dir = this.pos.clone().subtract(this.view);
    const right = dir.clone().cross(Camera.up).normalize();
    const localUp = dir.clone().cross(right).normalize();
    this.translate(right.clone().multiplyByScalar(by.x * 5).add(localUp.clone().multiplyByScalar(-by.y * 5)))
  }

  translate(by: Vector3) {
    this.pos = this.pos.add(by);
    this.view = this.view.add(by);
  }

  bindAsUniforms(gl: WebGL2RenderingContext) {
    gl.uniform3f(this.posLoc, this.pos.x, this.pos.y, this.pos.z);
    const viewDir = this.view.clone().subtract(this.pos);
    gl.uniform3f(this.viewLoc, viewDir.x, viewDir.y, viewDir.z);
  }
}

export function setupPanningListeners(element: HTMLCanvasElement, onPan: (by: Vector2) => void, onZoom: (by: number) => void, onMove: (by: Vector2) => void) {
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
    onZoom(by)
  })
}