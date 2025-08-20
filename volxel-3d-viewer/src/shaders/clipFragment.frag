#version 300 es

precision highp float;

out vec4 out_color;

in float cursorDistance;
in vec4 debugFragment;
in vec3 worldPos;
flat in int selection;

uniform vec3 u_volume_aabb[2];
uniform vec3 u_mouse_pos_world;

#include "utils.glsl"

void main() {
    if (selection == 0) discard;
    else if (selection == 1) out_color = vec4(0.8, 0.8, 0.2, 0.5);
    else if (selection == -1) out_color = vec4(0.8, 0.8, 0.2, 0.8);
    else out_color = vec4(1, 1, 0, 1);

    if (length(debugFragment) > 0.0) out_color = debugFragment;
}
