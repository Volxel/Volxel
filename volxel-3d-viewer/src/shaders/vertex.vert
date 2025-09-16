#version 300 es

in vec4 a_position;

out vec2 tex;

void main() {
  gl_Position = a_position;
  tex = a_position.xy * 0.5 + 0.5;
}