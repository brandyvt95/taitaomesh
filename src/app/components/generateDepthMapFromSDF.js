import * as THREE from 'three';

/**
 * Generate a depth map from an SDF texture (grayscale in R channel)
 * @param {THREE.DataTexture} sdfTexture - input DataTexture with R channel = SDF (0 to 1)
 * @param {Object} [options]
 * @param {number} [options.power=2.0] - curve shaping, higher = sharper dropoff at edge
 * @param {number} [options.maxDepth=1.0] - max depth value
 * @returns {THREE.DataTexture}
 */
export function generateDepthMapFromSDF(sdfTexture, options = {}) {
  const { power = 2.0, maxDepth = 1.0 } = options;

  const { width, height } = sdfTexture.image;
  const sdfData = sdfTexture.image.data;
  const depthData = new Float32Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const sdfValue = sdfData[i * 4]; // only use R channel

    // Convert SDF (0 at edge, 1 inside) to depth (deepest at center)
    const dist = 1.0 - sdfValue;
    const depth = Math.pow(dist, power) * maxDepth;

    depthData[i * 4 + 0] = depth; // R
    depthData[i * 4 + 1] = depth; // G (optional)
    depthData[i * 4 + 2] = depth; // B (optional)
    depthData[i * 4 + 3] = 1.0;   // A
  }

  const depthTexture = new THREE.DataTexture(
    depthData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  depthTexture.flipY = true
  depthTexture.needsUpdate = true;

  return depthTexture;
}
