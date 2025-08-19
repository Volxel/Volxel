#version 300 es

precision highp float;

out vec4 out_color;

in float cursorDistance;
in vec4 debugFragment;
in vec3 worldPos;

uniform vec3 u_volume_aabb[2];
uniform vec3 u_mouse_pos_world;

#include "utils.glsl"

void main() {
    vec3 worldDir = normalize(worldPos - cameraWorldPos());

    Ray cursorRay = Ray(cameraWorldPos(), worldDir);
    vec3 viewHit, tmp;
    float d;
    if (
        ray_box_intersection_positions(cursorRay, u_volume_aabb, viewHit, tmp) &&
        length(u_mouse_pos_world) > 0.0 &&
        (d = distance(viewHit, u_mouse_pos_world)) < 0.1
    ) {
        out_color = vec4(pow(1.0 - d / 0.1, 0.5));
    }
}
