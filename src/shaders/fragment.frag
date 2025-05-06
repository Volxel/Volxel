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

// Light
const vec3 light_dir = vec3(0.0, -1.0, 0.0);
const vec3 light_col = vec3(20.0, 20.0, 20.0);

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

float eval_volume_world(vec3 world_pos) {
    vec3 sample_pos = world_to_aabb(world_pos, u_volume_aabb);
    return clamp(texture(u_texture, sample_pos).r, 0.0, 1.0);
}

float phase(float g, float cos_theta) {
    float denom = 1.0 + g * g - 2.0 * g * cos_theta;
    return 1.0 / (4.0 * 3.141) * (1.0 - g * g) / (denom * sqrt(denom));
}

vec3 raymarch(vec3 from, vec3 to, vec3 background) {
    vec3 diff = to - from;
    float dt = stepsize / length(diff);
    vec3 step = diff * dt;

//    return vec4(dt * 100.0, 0.0, 0.0, 1.0);

    // https://www.scratchapixel.com/lessons/3d-basic-rendering/volume-rendering-for-developers/volume-rendering-3D-density-field.html
    float sigma_a = 0.5; // absorption coefficient;
    float sigma_s = 0.5; // scattering coefficient
    float sigma_t = sigma_a + sigma_s; // extinction coefficient
    float g = 0.0; // henyey-greenstein asymmetry factor
    uint d = 2u; // russian roulette "probability"

    uint numSteps = uint(ceil(length(diff) / stepsize));

    float transmission = 1.0; // fully transmissive to start with
    vec3 result_col = vec3(0);

    for (uint i = 0u; i < numSteps; ++i) {
        vec3 pos = from + float(i) * step;

        float density = eval_volume_world(pos);
        float sample_attenuation = exp(-stepsize * density * sigma_t);
        transmission *= sample_attenuation;

        // In Scattering
        vec3 light_ray_exit;
        vec3 light_ray_entry;
        if (density > 0.0 && intersect_ray(Ray(pos, normalize(-light_dir)), u_volume_aabb, light_ray_entry, light_ray_exit)) {
            vec3 diff_inside = light_ray_exit - light_ray_entry;
            float dt_inside = stepsize / length(diff_inside);
            vec3 step_inside = diff_inside * dt_inside;
            uint numStepsInside = uint(ceil(length(diff_inside) / stepsize));

            float light_attenuation = 0.0; // tau in scratchapixel code
            // another raymarch to accumulate light attenuation
            for (uint j = 0u; j < numStepsInside; ++j) {
                vec3 pos_inside = light_ray_entry + float(i) * step_inside;
                light_attenuation += eval_volume_world(pos_inside);
            }
            float light_ray_att = exp(-light_attenuation * dt_inside * sigma_t);

            result_col += light_col *
                light_ray_att *
                phase(g, dot(normalize(diff), normalize(light_dir))) *
                sigma_s *
                transmission *
                dt *
                density;
        }

        if (transmission <= 1e-3) {
            // TODO: Random generator
        }
    }

    return background * transmission + result_col;
}

vec3 get_background_color(Ray ray) {
    return clamp(ray.direction, vec3(0.2), vec3(1.0));
}

void main() {
    vec3 hit_min;
    vec3 hit_max;
    Ray ray = setup_world_ray(tex);
    bool hit;
    if (intersect_ray(ray, u_volume_aabb, hit_min, hit_max)) {
        hit = true;
        if(u_debugHits) {
            outColor = vec4(world_to_aabb(hit_min, u_volume_aabb), 1);
            return;
        }
        outColor = vec4(raymarch(hit_min, hit_max, get_background_color(ray)), 1.0);
    } else {
        outColor = vec4(get_background_color(ray), 1.0);
    }
}