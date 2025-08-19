#version 300 es

precision highp float;

in vec4 a_position;

#include "utils.glsl"

// AABB info
uniform vec3 u_volume_aabb[2];

out float cursorDistance;
out vec3 worldPos;
out vec4 debugFragment;

void main() {
    vec3 aabb[2] = u_volume_aabb;
    // TODO: this is all a bit whack
    vec4 relativePos = a_position * 0.5 + 0.5;
    worldPos = relativePos.xyz * (aabb[1] - aabb[0]) + aabb[0];
    vec4 viewPos = camera_view * vec4(worldPos, 1);
    gl_Position = camera_proj * viewPos;
}
