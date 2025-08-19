#define M_PI float(3.14159265358979323846)
#define inv_PI (1.f / M_PI)
#define inv_2PI (1.f / (2 * M_PI))
#define inv_4PI (1.f / (4 * M_PI))
#define FLT_MAX float(3.402823466e+38)

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

vec3 get_background_color(Ray ray) {
    float angleHorizontal = dot(vec3(0, 0, 1), normalize(vec3(ray.direction.x, 0, ray.direction.z))) * 0.5 + 0.5;
    angleHorizontal = int(round(angleHorizontal * 8.0)) % 2 == 0 ? 1.0 : 0.0;
    float angleVertical = dot(normalize(ray.direction), normalize(vec3(ray.direction.x, 0, ray.direction.z)));
    angleVertical = int(round(angleVertical * 8.0)) % 2 == 0 ? 0.0 : 1.0;
    return vec3(abs(angleHorizontal - angleVertical) * 0.05); // vec3(clamp(pow(dot(ray.direction, -light_dir), 30.0), 0.0, 1.0)); //clamp(ray.direction, vec3(0.2), vec3(1.0));
}
