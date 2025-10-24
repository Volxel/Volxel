#include "sampling/common.glsl"

#include "sampling/dda.glsl"
#include "sampling/normal.glsl"
#include "sampling/raymarch.glsl"

bool sample_volume(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed);
float transmittance(Ray ray, inout rand_seed seed);

// the default, no other rendering mode is selected
#ifndef NO_DDA
#ifndef RAYMARCH
float transmittance(Ray ray, inout rand_seed seed) {
    return transmittanceDDA(ray, seed);
}
bool sample_volume(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    return sample_volumeDDA(ray, t, throughput, Le, seed);
}
#endif
#endif

// Raymarch
#ifndef NO_DDA
#ifdef RAYMARCH
float transmittance(Ray ray, inout rand_seed seed) {
    return transmittance_raymarch(ray, seed);
}
bool sample_volume(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    return sample_volume_raymarch(ray, t, throughput, Le, seed);
}
#endif
#endif

// Simple
#ifdef NO_DDA
#ifndef RAYMARCH
float transmittance(Ray ray, inout rand_seed seed) {
    return transmittance_simple(ray, seed);
}
bool sample_volume(Ray ray, out float t, inout vec3 throughput, inout vec3 Le, inout rand_seed seed) {
    return sample_volume_simple(ray, t, throughput, Le, seed);
}
#endif
#endif