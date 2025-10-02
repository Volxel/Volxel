#version 300 es

in vec2 a_position;

out vec2 tex;

void main() {
  gl_Position = vec4(a_position, 1, 1);
  tex = a_position.xy * 0.5 + 0.5;
}