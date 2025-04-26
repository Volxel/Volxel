#version 300 es

precision highp float;
precision mediump sampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler3D u_texture;
uniform float u_depth;

void main() {
    outColor = texture(u_texture, vec3(tex, u_depth));
}