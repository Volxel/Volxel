#ifndef UTILS
#define UTILS

#define M_PI float(3.14159265358979323846)
#define inv_PI (1.f / M_PI)
#define inv_2PI (1.f / (2.0 * M_PI))
#define inv_4PI (1.f / (4.0 * M_PI))
#define FLT_MAX float(3.402823466e+38)

#include "random.glsl"

struct Ray {
    vec3 origin;
    vec3 direction;
};

// camera utils TODO: Uniforms and matrices could be optimized

// Camera Info
uniform mat4 camera_view;
uniform mat4 camera_proj;

vec3 cameraWorldPos() {
    mat4 invView = inverse(camera_view);
    vec4 camWorld = invView * vec4(0, 0, 0, 1);
    return camWorld.xyz / camWorld.w;
}
vec3 cameraWorldDir(vec2 ndcXY) {
    mat4 invProj = inverse(camera_proj);
    vec4 clipPos = vec4(ndcXY, 0, 1.0);

    vec4 viewPosH = invProj * clipPos;
    vec3 viewPos = viewPosH.xyz / viewPosH.w;

    mat4 invView = inverse(camera_view);
    vec4 worldPosH = invView * vec4(viewPos, 1.0);
    vec3 worldPos = worldPosH.xyz / worldPosH.w;

    return normalize(worldPos - cameraWorldPos());
}
// Converts from world space positions to interpolated positions inside AABB,
// used to sample 3D volumetric data
vec3 world_to_aabb(vec3 world, vec3 aabb[2]) {
    return (world - aabb[0]) / (aabb[1] - aabb[0]);
}

// ray utils

vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
    vec3 amin = abs(p - bmin);
    vec3 amax = abs(p - bmax);

    float normalEpsilon = 0.0001;

    return normalize(vec3(
    (amin.x < normalEpsilon) ? -1.0 : ((amax.x < normalEpsilon) ? 1.0 : 0.0),
    (amin.y < normalEpsilon) ? -1.0 : ((amax.y < normalEpsilon) ? 1.0 : 0.0),
    (amin.z < normalEpsilon) ? -1.0 : ((amax.z < normalEpsilon) ? 1.0 : 0.0)));
}

bool ray_box_intersection(Ray ray, vec3 aabb[2], out vec2 near_far) {
    vec3 inv_dir = 1.f / ray.direction;
    vec3 lo = (aabb[0] - ray.origin) * inv_dir;
    vec3 hi = (aabb[1] - ray.origin) * inv_dir;
    vec3 tmin = min(lo, hi), tmax = max(lo, hi);
    near_far.x = max(0.f, max(tmin.x, max(tmin.y, tmin.z)));
    near_far.y = min(tmax.x, min(tmax.y, tmax.z));
    return near_far.x <= near_far.y;
}
bool ray_box_intersection_positions(Ray ray, vec3 aabb[2], out vec3 hit_min, out vec3 hit_max) {
    vec2 near_far;
    if (!ray_box_intersection(ray, aabb, near_far)) return false;

    // If ray starts inside the box
    if (near_far.x < 0.0) {
        hit_min = ray.origin;
        hit_max = ray.origin + ray.direction * near_far.y;
    } else {
        hit_min = ray.origin + ray.direction * near_far.x;
        hit_max = ray.origin + ray.direction * near_far.y;
    }

    return true;
}

// math utils


float sqr(float x) { return x * x; }
vec3 sqr(vec3 x) { return x * x; }

float sum(const vec3 x) { return x.x + x.y + x.z; }

float mean(const vec3 x) { return sum(x) / 3.f; }

float sanitize(const float x) { return isnan(x) || isinf(x) ? 0.f : x; }
vec3 sanitize(const vec3 x) { return mix(x, vec3(0), bvec3(isnan(x.x) || isinf(x.x), isnan(x.y) || isinf(x.y), isnan(x.z) || isinf(x.z))); }
vec4 sanitize(const vec4 x) { return mix(x, vec4(0), bvec4(isnan(x.x) || isinf(x.x), isnan(x.y) || isinf(x.y), isnan(x.z) || isinf(x.z), isnan(x.w) || isinf(x.w))); }

float luma(const vec3 col) { return dot(col, vec3(0.212671f, 0.715160f, 0.072169f)); }

float saturate(const float x) { return clamp(x, 0.f, 1.f); }

float power_heuristic(const float a, const float b) { return sqr(a) / (sqr(a) + sqr(b)); }

vec3 align(const vec3 N, const vec3 v) {
    // build tangent frame
    vec3 T = abs(N.x) > abs(N.y) ?
    vec3(-N.z, 0, N.x) / sqrt(N.x * N.x + N.z * N.z) :
    vec3(0, N.z, -N.y) / sqrt(N.y * N.y + N.z * N.z);
    vec3 B = cross(N, T);
    // tangent to world
    return normalize(v.x * T + v.y * B + v.z * N);
}

// --------------------------------------------------------------
// phase function helpers

float phase_isotropic() { return inv_4PI; }

float phase_henyey_greenstein(const float cos_t, const float g) {
    float denom = 1.0 + sqr(g) + 2.0 * g * cos_t;
    return inv_4PI * (1.0 - sqr(g)) / (denom * sqrt(denom));
}

vec3 sample_phase_isotropic(const vec2 phase_sample) {
    float cos_t = 1.f - 2.f * phase_sample.x;
    float sin_t = sqrt(max(0.f, 1.f - sqr(cos_t)));
    float phi = 2.f * M_PI * phase_sample.y;
    return normalize(vec3(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}

vec3 sample_phase_henyey_greenstein(const vec3 dir, const float g, const vec2 phase_sample) {
    float cos_t = abs(g) < 1e-4f ? 1.f - 2.f * phase_sample.x :
    (1.0 + sqr(g) - sqr((1.0 - sqr(g)) / (1.0 - g + 2.0 * g * phase_sample.x))) / (2.0 * g);
    float sin_t = sqrt(max(0.f, 1.f - sqr(cos_t)));
    float phi = 2.f * M_PI * phase_sample.y;
    return align(dir, vec3(sin_t * cos(phi), sin_t * sin(phi), cos_t));
}


#endif