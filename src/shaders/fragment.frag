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
bool intersect_ray_aabb(vec2 ray_ss, vec3 aabb[2]) {
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
    return t_max > max(t_min, 0.0);
}

void main() {
    outColor = intersect_ray_aabb(tex, u_volume_aabb) ? vec4(1, 1, 1, 1) : texture(u_texture, vec3(tex * 0.5 + 0.5, 0.5));
}