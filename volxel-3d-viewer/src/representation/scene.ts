import {Matrix4, Quaternion, Vector2, Vector3} from "math.gl";

export class Camera {
  pos: Vector3;
  view: Vector3;
  yaw: number = 0;
  pitch: number = 0;
  static up: Vector3 = new Vector3(0, 1, 0);

  constructor(distance: number) {
    this.view = new Vector3();
    this.pos = new Vector3(0, 0, -distance);
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
    if (dir.len() * by <= 0.1 || dir.len() * by >= 10) return false;
    this.pos = dir.multiplyByScalar(by).add(this.view);
    return true;
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

  bindAsUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "camera_view"),  false, this.viewMatrix())
    gl.uniformMatrix4fv(gl.getUniformLocation(program, "camera_proj"), false, this.projMatrix(gl.canvas.width / gl.canvas.height))
  }

  viewMatrix(): Matrix4 {
    return new Matrix4().lookAt({
      eye: this.pos,
      center: this.view,
      up: Camera.up
    });
  }
  projMatrix(aspect: number, fov: number = Math.PI / 3): Matrix4 {
    return new Matrix4().perspective({
      fovy: fov,
      far: 1000,
      near: 0.1,
      aspect: aspect
    })
  }
}
