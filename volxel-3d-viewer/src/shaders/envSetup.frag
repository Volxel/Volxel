#version 300 es

precision highp float;
precision highp int;
precision highp sampler2D;

// compute uniforms
uniform sampler2D u_input;
uniform ivec2 u_dimension;

// environment specific uniforms
uniform ivec2 output_size_samples;
uniform ivec2 num_samples;
uniform float inv_samples;

// compute vertex input
in vec2 tex;

// compute output (environment map is R32F, so float)
out vec4 out_imp;

float luma(const vec3 col) { return dot(col, vec3(0.212671f, 0.715160f, 0.072169f)); }

void main() {
    ivec2 pixel = ivec2(tex * vec2(u_dimension));
    ivec2 size_env = textureSize(u_input, 0);

    float importance = 0.0F;
    for (int y = 0; y < num_samples.y; ++y) {
        for (int x = 0; x < num_samples.x; ++x) {
            vec2 uv = (vec2(pixel * num_samples) + vec2(float(x) + 0.5F, float(y) + 0.5F)) / vec2(output_size_samples);
            importance += luma(texture(u_input, uv).rgb);
        }
    }

    out_imp = vec4(importance * inv_samples);
}
