#version 300 es

precision highp float;
precision highp sampler2D;

uniform sampler2D u_result;

in vec2 tex;

out vec4 out_color;

uniform float exposure;
uniform float gamma;

float luma(const vec3 col) { return dot(col, vec3(0.212671f, 0.715160f, 0.072169f)); }

vec3 hable(in vec3 rgb) {
    const float A = 0.15f;
    const float B = 0.50f;
    const float C = 0.10f;
    const float D = 0.20f;
    const float E = 0.02f;
    const float F = 0.30f;
    return ((rgb * (A * rgb + C * B) + D * E) / (rgb * (A * rgb + B) + D * F)) - E / F;
}
vec3 hable_tonemap(in vec3 rgb, in float exposure) {
    const float W = 11.2f;
    return hable(exposure * rgb) / hable(vec3(W));
}

void main() {
    vec4 accumulated = texture(u_result, tex);
    out_color = accumulated;
    out_color.rgb = pow(hable_tonemap(out_color.rgb, exposure), vec3(1.0 / gamma));
}
