#version 300 es

precision highp float;
precision mediump sampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler3D u_texture;
uniform vec3 u_volume_aabb[2];
uniform ivec2 u_res;

uniform vec3 camera_pos;
uniform vec3 camera_view;
const vec3 camera_up = vec3(0, 1, 0);

// raycasting for debugging
bool intersect_ray_aabb(vec2 ray_ss, vec3 aabb[2], out vec3 local_min, out vec3 local_max) {
    float aspect = float(u_res.x) / float(u_res.y);
    // set up world space ray from screen space position
    vec3 forward = normalize(camera_view);
    vec3 right = normalize(cross(forward, camera_up));
    vec3 up = cross(right, forward);

    vec3 ray_camera = normalize(tex.x * aspect * right + tex.y * up + forward);
    // intersect world space ray with aabb
    vec3 inv_dir = 1.0 / ray_camera;

    vec3 t0s = (aabb[0] - camera_pos) * inv_dir;
    vec3 t1s = (aabb[1] - camera_pos) * inv_dir;

    vec3 tsmaller = min(t0s, t1s);
    vec3 tbigger  = max(t0s, t1s);

    float t_min = max(max(tsmaller.x, tsmaller.y), tsmaller.z);
    float t_max = min(min(tbigger.x, tbigger.y), tbigger.z);
    bool hit = t_max > max(t_min, 0.0);

    if (hit) {
        vec3 hit_min = camera_pos + t_min * ray_camera;
        vec3 hit_max = camera_pos + t_max * ray_camera;

        local_min = (hit_min - aabb[0]) / (aabb[1] - aabb[0]);
        local_max = (hit_max - aabb[0]) / (aabb[1] - aabb[0]);
    }

    return hit;
}

void main() {
    vec3 texel_min;
    vec3 texel_max;
    outColor = intersect_ray_aabb(tex, u_volume_aabb, texel_min, texel_max) ? texture(u_texture, vec3(texel_min.xy, 0.5)) : vec4(0.1, 0.1, 0.1, 1);
}