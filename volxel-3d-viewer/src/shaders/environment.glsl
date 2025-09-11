#ifndef ENVIRONMENT
#define ENVIRONMENT

// --------------------------------------------------------------
// environment helper (input vectors assumed in world space!)

uniform float env_strength;
uniform sampler2D u_envmap;
uniform sampler2D u_impmap;
uniform int u_hide_envmap;
uniform vec2 env_imp_inv_dim;
uniform int env_imp_base_mip;

vec3 lookup_environment(const vec3 dir) {
    vec3 idir = dir;
    float u = atan(idir.z, idir.x) / (2.0 * M_PI) + 0.5f;
    float v = 1.f - acos(idir.y) / M_PI;
    return texture(u_envmap, vec2(u, v)).rgb;
}

vec3 get_background_color(Ray ray) {
    if (u_hide_envmap == 0) return lookup_environment(-ray.direction);
    float angleHorizontal = dot(vec3(0, 0, 1), normalize(vec3(ray.direction.x, 0, ray.direction.z))) * 0.5 + 0.5;
    angleHorizontal = int(round(angleHorizontal * 8.0)) % 2 == 0 ? 1.0 : 0.0;
    float angleVertical = dot(normalize(ray.direction), normalize(vec3(ray.direction.x, 0, ray.direction.z)));
    angleVertical = int(round(angleVertical * 8.0)) % 2 == 0 ? 0.0 : 1.0;
    return vec3(abs(angleHorizontal - angleVertical) * 0.05); // vec3(clamp(pow(dot(ray.direction, -light_dir), 30.0), 0.0, 1.0)); //clamp(ray.direction, vec3(0.2), vec3(1.0));
}

vec4 sample_environment(vec2 rng, out vec3 w_i) {
    ivec2 pos = ivec2(0);   // pixel position
    vec2 p = rng;           // sub-pixel position
    // warp sample over mip hierarchy
    for (int mip = env_imp_base_mip - 1; mip >= 0; mip--) {
        pos *= 2; // scale to mip
        float w[4]; // four relevant texels
        w[0] = texelFetch(u_impmap, pos + ivec2(0, 0), mip).r;
        w[1] = texelFetch(u_impmap, pos + ivec2(1, 0), mip).r;
        w[2] = texelFetch(u_impmap, pos + ivec2(0, 1), mip).r;
        w[3] = texelFetch(u_impmap, pos + ivec2(1, 1), mip).r;
        float q[2]; // bottom / top
        q[0] = w[0] + w[2];
        q[1] = w[1] + w[3];
        // horizontal
        int off_x;
        float d = q[0] / max(1e-8f, q[0] + q[1]);
        if (p.x < d) { // left
            off_x = 0;
            p.x = p.x / d;
        } else { // right
            off_x = 1;
            p.x = (p.x - d) / (1.f - d);
        }
        pos.x += off_x;
        // vertical
        float e = w[off_x] / q[off_x];
        if (p.y < e) { // bottom
            //pos.y += 0;
            p.y = p.y / e;
        } else { // top
            pos.y += 1;
            p.y = (p.y - e) / (1.f - e);
        }
    }
    // compute sample uv coordinate and (world-space) direction
    vec2 uv = (vec2(pos) + p) * env_imp_inv_dim;
    float theta = saturate(1.f - uv.y) * M_PI;
    float phi   = (saturate(uv.x) * 2.f - 1.f) * M_PI;
    float sin_t = sin(theta);
    w_i = vec3(sin_t * cos(phi), cos(theta), sin_t * sin(phi));
    // sample envmap and compute pdf
    vec3 Le = env_strength * texture(u_envmap, uv).rgb;
    float avg_w = texelFetch(u_impmap, ivec2(0, 0), env_imp_base_mip).r;
    float pdf = texelFetch(u_impmap, pos, 0).r / avg_w;
    return vec4(Le, pdf * inv_4PI);
}

float pdf_environment(vec3 dir) {
    float avg_w = texelFetch(u_impmap, ivec2(0, 0), env_imp_base_mip).r;
    float pdf = luma(lookup_environment(dir)) / avg_w;
    return pdf * inv_4PI;
}

#endif
