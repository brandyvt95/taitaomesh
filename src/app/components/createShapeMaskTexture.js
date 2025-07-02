import * as THREE from 'three';

/**
 * Convert a THREE.Shape into a 256x256 DataTexture mask
 * where the shape is white and background is black.
 */
export function createShapeMaskTexture(shape, size = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Clear canvas to black
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);

  // Get shape points & bounding box
  const points = shape.getPoints(200);
  const box = new THREE.Box2();
  points.forEach(p => box.expandByPoint(p));

  const shapeWidth = box.max.x - box.min.x;
  const shapeHeight = box.max.y - box.min.y;
  const scale = Math.min(size / shapeWidth, size / shapeHeight) * 0.9; // scale with padding

  const offsetX = (size - shapeWidth * scale) / 2 - box.min.x * scale;
  const offsetY = (size - shapeHeight * scale) / 2 - box.min.y * scale;

  // Begin path
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.x * scale + offsetX;
    const y = size - (p.y * scale + offsetY); // flip Y for canvas
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();

  // Fill with white
  ctx.fillStyle = 'white';
  ctx.fill();

  // Extract image data
  const imageData = ctx.getImageData(0, 0, size, size);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = imageData.data[i]; // only take red channel (grayscale)
    data[i] = alpha;
    data[i + 1] = alpha;
    data[i + 2] = alpha;
    data[i + 3] = 255;
  }

  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  texture.flipY = false;

  return texture;
}
