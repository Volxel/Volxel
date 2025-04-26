#version 300 es

in vec4 a_position;

out vec2 tex;

void main() {
  gl_Position = a_position;
  tex = (vec2(a_position.x, a_position.y) + vec2(1)) / vec2(2);
}