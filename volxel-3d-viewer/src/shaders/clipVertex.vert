#version 300 es

precision highp float;

in vec4 a_position;
in int a_sideIndex;

#include "utils.glsl"

// AABB info
uniform vec3 u_volume_aabb[2];
uniform int u_selected_face;

out float cursorDistance;
out vec3 worldPos;
out vec4 debugFragment;
flat out int selection;

void main() {
    vec3 aabb[2] = u_volume_aabb;
    vec4 relativePos = a_position * 0.5 + 0.5;
    worldPos = relativePos.xyz * (aabb[1] - aabb[0]) + aabb[0];
    vec4 viewPos = camera_view * vec4(worldPos, 1);
    gl_Position = camera_proj * viewPos;

    // 0 means no face selected, -i means face i is held down, i means face i is hovered
    if (u_selected_face != 0) {
        bool mouseDown = u_selected_face < 0;
        int selectedIndex = abs(u_selected_face) - 1;
        if (selectedIndex == a_sideIndex) selection = mouseDown ? -1 : 1;
        else selection = 0;
    }
}
