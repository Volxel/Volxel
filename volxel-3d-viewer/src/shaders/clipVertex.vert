#version 300 es

precision highp float;

in vec4 a_position;

// Camera Info
uniform mat4 camera_view;
uniform mat4 camera_proj;

// AABB info
uniform vec3 u_volume_aabb[2];

void main() {
    // TODO: this is all a bit whack
    vec4 relativePos = a_position - 1.0;
    vec3 inAabbPos = u_volume_aabb[0] + relativePos.xyz * u_volume_aabb[1];
    gl_Position = camera_proj * camera_view * vec4(inAabbPos, 1);
}
