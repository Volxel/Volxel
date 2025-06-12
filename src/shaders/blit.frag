#version 300 es

precision highp float;

uniform sampler2D u_result;

in vec2 tex;

out vec4 out_color;

void main() {
    vec2 uv = tex * 0.5 + 0.5;
    vec4 accumulated = texture(u_result, uv);
    out_color = accumulated / accumulated.a;
}
