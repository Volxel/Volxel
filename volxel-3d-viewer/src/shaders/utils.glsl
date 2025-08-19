#define M_PI float(3.14159265358979323846)
#define inv_PI (1.f / M_PI)
#define inv_2PI (1.f / (2 * M_PI))
#define inv_4PI (1.f / (4 * M_PI))
#define FLT_MAX float(3.402823466e+38)

vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
    vec3 amin = abs(p - bmin);
    vec3 amax = abs(p - bmax);

    float normalEpsilon = 0.0001;

    return normalize(vec3(
    (amin.x < normalEpsilon) ? -1.0 : ((amax.x < normalEpsilon) ? 1.0 : 0.0),
    (amin.y < normalEpsilon) ? -1.0 : ((amax.y < normalEpsilon) ? 1.0 : 0.0),
    (amin.z < normalEpsilon) ? -1.0 : ((amax.z < normalEpsilon) ? 1.0 : 0.0)));
}

vec3 get_background_color(Ray ray) {
    float angleHorizontal = dot(vec3(0, 0, 1), normalize(vec3(ray.direction.x, 0, ray.direction.z))) * 0.5 + 0.5;
    angleHorizontal = int(round(angleHorizontal * 8.0)) % 2 == 0 ? 1.0 : 0.0;
    float angleVertical = dot(normalize(ray.direction), normalize(vec3(ray.direction.x, 0, ray.direction.z)));
    angleVertical = int(round(angleVertical * 8.0)) % 2 == 0 ? 0.0 : 1.0;
    return vec3(abs(angleHorizontal - angleVertical) * 0.05); // vec3(clamp(pow(dot(ray.direction, -light_dir), 30.0), 0.0, 1.0)); //clamp(ray.direction, vec3(0.2), vec3(1.0));
}
