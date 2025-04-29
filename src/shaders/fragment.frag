#version 300 es

precision highp float;
precision mediump sampler3D;

out vec4 outColor;

in vec2 tex;

uniform sampler3D u_texture;
uniform vec3 u_volume_aabb[2];
uniform ivec2 u_res;

// Camera Info
uniform vec3 camera_pos;
uniform vec3 camera_view;
const vec3 camera_up = vec3(0, 1, 0);

// Shows ray intersection with AABB instead of volume
uniform bool u_debugHits;

struct Ray {
    vec3 origin;
    vec3 direction;
};

Ray setup_world_ray(vec2 ss_position) {
    float aspect = float(u_res.x) / float(u_res.y);

    vec3 forward = normalize(camera_view);
    vec3 right = normalize(cross(forward, camera_up));
    vec3 up = normalize(cross(right, forward));

    vec3 dir = normalize(ss_position.x * aspect * right + ss_position.y * up + forward);
    return Ray(camera_pos, dir);
}

vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
    vec3 amin = abs(p - bmin);
    vec3 amax = abs(p - bmax);

    float normalEpsilon = 0.0001;

    return normalize(vec3(
    (amin.x < normalEpsilon) ? -1.0 : ((amax.x < normalEpsilon) ? 1.0 : 0.0),
    (amin.y < normalEpsilon) ? -1.0 : ((amax.y < normalEpsilon) ? 1.0 : 0.0),
    (amin.z < normalEpsilon) ? -1.0 : ((amax.z < normalEpsilon) ? 1.0 : 0.0)));
}

bool intersect_ray(Ray ray, vec3 aabb[2], out vec3 hit_min, out vec3 hit_max) {
    // taken from CG Advanced Exercise 10
    vec3 id = 1.0 / ray.direction; // 1 DIV
    vec3 pid = ray.origin * id; // 1 MUL
    vec3 l = aabb[0]*id - pid; // 1 MAD
    vec3 h = aabb[1]*id - pid; // 1 MAD
    vec3 tn3 = min(l, h);
    vec3 tf3 = max(l, h);
    float tf = min(tf3.x, min(tf3.y, tf3.z));
    float tn = max(tn3.x, max(tn3.y, tn3.z));

    if(max(tn, 0.0) <= tf){
//        float t = (tn < 0.0 ? tf : tn);
//        vec3 p = ray.origin + t*ray.direction;
        if (tn < 0.0) return false;
        hit_min = ray.origin + tn * ray.direction;
        hit_max = ray.origin + tf * ray.direction;
        return true;
    } else {
        return false;
    }
}

// Converts from world space positions to interpolated positions inside AABB,
// used to sample 3D volumetric data
vec3 world_to_aabb(vec3 world, vec3 aabb[2]) {
    return (world - aabb[0]) / (aabb[1] - aabb[0]);
}

// Simple raymarch that accumulates a float value, early break if it reaches 1
const float stepsize = 0.01;

bool raymarch(vec3 from, vec3 to, vec3 aabb[2], out vec4 color) {
    vec3 diff = to - from;
    float dt = stepsize / length(diff);
    vec3 step = diff * dt;

//    return vec4(dt * 100.0, 0.0, 0.0, 1.0);

    float alpha = 0.0;

    for (uint i = 0u; i < uint(ceil(length(diff) / stepsize)); ++i) {
        vec3 pos = from + float(i) * step;
        vec3 sample_pos = world_to_aabb(pos, aabb);
        alpha += clamp(texture(u_texture, sample_pos).r, 0.0, 1.0) * stepsize;
        if (alpha >= 1.0) {
            color = vec4(1.0, 1.0, 1.0, 1.0);
            return true;
        }
    }

    if (alpha < 0.01) return false;

    color = vec4(1.0, 1.0, 1.0, alpha);
    return true;
}

void main() {
    vec3 hit_min;
    vec3 hit_max;
    if (intersect_ray(setup_world_ray(tex), u_volume_aabb, hit_min, hit_max)) {
        if(u_debugHits) {
            outColor = vec4(world_to_aabb(hit_min, u_volume_aabb), 1);
            return;
        }
        vec4 raymarchResult;
        if (raymarch(hit_min, hit_max, u_volume_aabb, raymarchResult)) {
            outColor = raymarchResult;
        }
    }

    if (outColor.a < 1.0) {
        vec4 bgColor = vec4(0.0, 0.0, 0.3, 1.0); //texture(u_texture, vec3(tex * 0.5 + 0.5, 0.5));
        outColor = outColor.a * outColor + (1.0 - outColor.a) * bgColor;
    }
}