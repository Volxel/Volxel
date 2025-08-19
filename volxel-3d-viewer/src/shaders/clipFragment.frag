#version 300 es

precision highp float;

out vec4 out_color;

in float cursorDistance;
in vec4 debugFragment;
in vec3 worldPos;

uniform vec3 u_volume_aabb[2];
uniform vec2 u_mouse_pos;

#include "utils.glsl"

void main() {
    vec3 worldDir = normalize(worldPos - cameraWorldPos());

    Ray cursorRay = Ray(cameraWorldPos(), worldDir);
    Ray mouseRay = Ray(cameraWorldPos(), cameraWorldDir(u_mouse_pos));
    vec3 viewHit, mouseHit, tmp;
    if (
        ray_box_intersection_positions(cursorRay, u_volume_aabb, viewHit, tmp) &&
        ray_box_intersection_positions(mouseRay, u_volume_aabb, mouseHit, tmp) &&
        distance(viewHit, mouseHit) < 0.1
    ) {
        out_color = vec4(pow(1.0 - distance(viewHit, mouseHit) / 0.1, 0.5));
    }
}
