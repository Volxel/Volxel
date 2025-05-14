vec3 boxNormal(vec3 p, vec3 bmin, vec3 bmax) {
    vec3 amin = abs(p - bmin);
    vec3 amax = abs(p - bmax);

    float normalEpsilon = 0.0001;

    return normalize(vec3(
    (amin.x < normalEpsilon) ? -1.0 : ((amax.x < normalEpsilon) ? 1.0 : 0.0),
    (amin.y < normalEpsilon) ? -1.0 : ((amax.y < normalEpsilon) ? 1.0 : 0.0),
    (amin.z < normalEpsilon) ? -1.0 : ((amax.z < normalEpsilon) ? 1.0 : 0.0)));
}