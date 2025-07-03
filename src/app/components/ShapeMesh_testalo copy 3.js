'use client'

import * as THREE from 'three'
import React, { useEffect, useRef, useState } from 'react'
import { Canvas, extend, useThree } from '@react-three/fiber'
import { Center, shaderMaterial, useTexture } from '@react-three/drei'
import { useControls } from 'leva'
import { LoopSubdivision } from 'three-subdivide'
import { extractAlphaDataTextureWithMipmaps, extractAlphaToDataTexture, findContourPath_ConvexHull_sm } from './utils'
import { generateNarrowBandSDFSmooth, generateSDFfromDataTexture } from './generateSDFfromDataTexture'
import { createShapeMaskTexture } from './createShapeMaskTexture'
import cdt2d from 'cdt2d'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CustomMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(0xffffff),
    uMap: null,
    uAlphaCheck: null
  },
  // vertex shader
  /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
// uv: vec2 từ 0.0 đến 1.0
// return: float từ 0.0 (đen) đến 1.0 (trắng)
float radialGradient(vec2 uv) {
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(uv, center); // max dist ~ 0.707
    float maxDist = length(vec2(0.5, 0.5)); // sqrt(0.5^2 + 0.5^2)
    return clamp(dist / maxDist, 0.0, 1.0);
}
    uniform sampler2D uMap;
uniform sampler2D uAlphaCheck;
uniform sampler2D uAlphaCheck2;
    
    void main() {
      vUv = uv;
      vNormal = normal;
      
      vec3 pos = position;
    pos.z += .05;
vec4 clr = texture2D(uMap, uv);
vec4 clr2 = texture2D(uAlphaCheck, vUv);
vec4 clr3 = texture2D(uAlphaCheck2, vUv);
float grad = radialGradient(uv); // 0.0 ở tâm -> 1.0 ở rìa

 float direction = sign(position.z); // +1 hoặc -1
    float strengths = 0.6;
   float pushedg = smoothstep(0., 1.0, 1.- clr3.r) * 1.;

    float displacement =  strengths  * (clr2.r / 1.)  ;   //// 
   // pos.z += mix(0.,(1.0 - grad) * .1 * direction ,clr2.r);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  // fragment shader
  /* glsl */`
    uniform vec3 uColor;
    uniform sampler2D uMap;
    varying vec2 vUv;
    varying vec3 vNormal;
uniform sampler2D uAlphaCheck;
    void main() {
  vec2 zoomedUV = (vUv - 0.5) * 1. + 0.5; // 0.8 = scale < 1 => zoom in
vec4 clr = texture2D(uMap, zoomedUV);
vec4 clr2 = texture2D(uAlphaCheck, vUv);
      float lighting = dot(normalize(vNormal), normalize(vec3(0.0, 0.0, 1.0)));
      //if(clr.a == 0.) clr.xyz = vec3(1.);
   vec3 baseColor = clr.rgb;
vec3 sdfMask = clr2.rgb;
sdfMask = smoothstep(.2,.5,sdfMask);
// Cách 1: Nhân vào nhưng giữ vùng đen rõ ràng
vec3 result = mix(baseColor, vec3(0.0), 1.0 - sdfMask.r);

gl_FragColor = vec4(result, 1.0);
       //  gl_FragColor = vec4(normalize(vNormal) ,1.);
    }
  `
)
extend({ CustomMaterial })
function findContourPath_ConvexHull(imageData, width, height) {
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const a = imageData[i + 3]
    return a > 128
  }

  // Tìm edge pixels
  const edgePixels = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (isWhite(x, y)) {
        let hasBlackNeighbor = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (!isWhite(x + dx, y + dy)) {
              hasBlackNeighbor = true
              break
            }
          }
          if (hasBlackNeighbor) break
        }
        if (hasBlackNeighbor) {
          edgePixels.push({ x, y })
        }
      }
    }
  }

  if (edgePixels.length < 3) return []

  // Tính convex hull bằng Graham scan
  function convexHull(points) {
    if (points.length < 3) return points

    // Tìm điểm có y nhỏ nhất (leftmost nếu tie)
    let start = points[0]
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < start.y || (points[i].y === start.y && points[i].x < start.x)) {
        start = points[i]
      }
    }

    // Sắp xếp theo góc polar
    const sorted = points.filter(p => p !== start)
    sorted.sort((a, b) => {
      const angleA = Math.atan2(a.y - start.y, a.x - start.x)
      const angleB = Math.atan2(b.y - start.y, b.x - start.x)
      return angleA - angleB
    })

    // Graham scan
    const hull = [start, sorted[0]]

    for (let i = 1; i < sorted.length; i++) {
      while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], sorted[i]) <= 0) {
        hull.pop()
      }
      hull.push(sorted[i])
    }

    return hull
  }

  function crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }

  // Lấy convex hull
  const hull = convexHull(edgePixels)

  // Thêm điểm trên các cạnh nối giữa các đỉnh
  function addPointsOnEdges(hullPoints, density = 5) {
    const result = []

    for (let i = 0; i < hullPoints.length; i++) {
      const current = hullPoints[i]
      const next = hullPoints[(i + 1) % hullPoints.length]

      result.push(current)

      // Tính khoảng cách giữa 2 điểm
      const dx = next.x - current.x
      const dy = next.y - current.y
      const distance = Math.sqrt(dx * dx + dy * dy)

      // Chỉ thêm điểm nếu khoảng cách đủ lớn
      if (distance > density) {
        const steps = Math.floor(distance / density)

        for (let j = 1; j < steps; j++) {
          const t = j / steps
          const interpolatedX = Math.round(current.x + dx * t)
          const interpolatedY = Math.round(current.y + dy * t)

          // Kiểm tra điểm interpolated có nằm trên edge không
          if (isWhite(interpolatedX, interpolatedY)) {
            // Kiểm tra có edge neighbor không
            let hasBlackNeighbor = false
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue
                if (!isWhite(interpolatedX + dx, interpolatedY + dy)) {
                  hasBlackNeighbor = true
                  break
                }
              }
              if (hasBlackNeighbor) break
            }

            if (hasBlackNeighbor) {
              result.push({ x: interpolatedX, y: interpolatedY })
            }
          }
        }
      }
    }

    return result
  }

  // Thêm điểm trên cạnh
  const finalContour = addPointsOnEdges(hull, 3)

  return finalContour
}

function findContourPath(imageData, width, height) {
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const a = imageData[i + 3] // Alpha channel
    return a > 128 // Threshold for transparency
  }

  // Tìm starting point (first white pixel from top-left)
  let startX = -1, startY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWhite(x, y)) {
        // Tìm edge pixel (có ít nhất 1 neighbor không phải white)
        let isEdge = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (!isWhite(x + dx, y + dy)) {
              isEdge = true
              break
            }
          }
          if (isEdge) break
        }
        if (isEdge) {
          startX = x
          startY = y
          break
        }
      }
    }
    if (startX !== -1) break
  }

  if (startX === -1) return []

  // Moore boundary tracing
  const contour = []
  const directions = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1]
  ]

  let currentX = startX
  let currentY = startY
  let currentDir = 0 // Start direction

  do {
    contour.push({ x: currentX, y: currentY })

    // Tìm next boundary pixel
    let found = false
    for (let i = 0; i < 8; i++) {
      const dir = (currentDir + i) % 8
      const nextX = currentX + directions[dir][0]
      const nextY = currentY + directions[dir][1]

      if (isWhite(nextX, nextY)) {
        currentX = nextX
        currentY = nextY
        currentDir = (dir + 6) % 8 // Turn left
        found = true
        break
      }
    }

    if (!found) break

    // Avoid infinite loop
    if (contour.length > width * height) break

  } while (!(currentX === startX && currentY === startY) && contour.length < 10000)

  return contour
}
function smoothGeometry(geometry, iterations = 1, lambda = 0.5) {
  // Input validation
  if (!(geometry instanceof THREE.BufferGeometry) || !geometry.attributes.position) {
    throw new Error('Input must be a THREE.BufferGeometry with a position attribute');
  }

  const positionAttribute = geometry.attributes.position;
  const indices = geometry.index ? geometry.index.array : null;
  const vertexCount = positionAttribute.count;

  // Extract vertices
  const vertices = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push(new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    ));
  }

  // Build adjacency list for vertices
  const adjacency = Array(vertexCount).fill().map(() => []);
  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      adjacency[a].push(b, c);
      adjacency[b].push(a, c);
      adjacency[c].push(a, b);
    }
  } else {
    // Assume triangles from vertex order
    for (let i = 0; i < vertexCount; i += 3) {
      const a = i;
      const b = i + 1;
      const c = i + 2;
      adjacency[a].push(b, c);
      adjacency[b].push(a, c);
      adjacency[c].push(a, b);
    }
  }

  // Laplacian smoothing
  for (let iter = 0; iter < iterations; iter++) {
    const newPositions = vertices.map(v => v.clone());

    for (let i = 0; i < vertexCount; i++) {
      const neighbors = adjacency[i];
      if (neighbors.length === 0) continue; // Skip isolated vertices

      // Compute average position of neighbors
      const avg = new THREE.Vector3();
      neighbors.forEach(n => avg.add(vertices[n]));
      avg.divideScalar(neighbors.length);

      // Update position: lerp between current position and average
      newPositions[i].lerpVectors(vertices[i], avg, lambda);
    }

    // Update vertices
    vertices.forEach((v, i) => {
      positionAttribute.setXYZ(i, v.x, v.y, v.z);
    });
    positionAttribute.needsUpdate = true;
  }

  // Recalculate normals
  geometry.computeVertexNormals();

  return geometry;
}
function smoothContour(points, segments = 100, closed = true) {
  if (points.length < 2) return points

  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(p.x, p.y, 0)),
    closed,
    'catmullrom',
    0.5 // tension, 0.5 là tiêu chuẩn
  )

  const smoothPoints = curve.getPoints(segments)

  // Convert lại về mảng {x, y}
  return smoothPoints.map(p => ({ x: p.x, y: p.y }))
}
function mirrorGeometry(geometry, axis = 'z', depth = 1) {
  const mirrored = geometry.clone();
  const pos = mirrored.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    if (axis === 'x') {
      pos.setX(i, -pos.getX(i));       // Lật
      pos.setX(i, pos.getX(i) - depth); // Dịch ra xa
    }
    if (axis === 'y') {
      pos.setY(i, -pos.getY(i));
      pos.setY(i, pos.getY(i) - depth);
    }
    if (axis === 'z') {
      pos.setZ(i, -pos.getZ(i));
      pos.setZ(i, pos.getZ(i) - depth);
    }
  }

  pos.needsUpdate = true;

  // Lật mặt tam giác
  if (mirrored.index) {
    const index = mirrored.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i];
      index[i] = index[i + 1];
      index[i + 1] = tmp;
    }
    mirrored.index.needsUpdate = true;
  }

  return mirrored;
}
function createBridgeGeometry(contour, depth = 1) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];

  const isArray = Array.isArray(contour[0]);
  const len = contour.length;

  for (let i = 0; i < len; i++) {
    const curr = isArray ? contour[i] : [contour[i].x, contour[i].y];
    const next = isArray ? contour[(i + 1) % len] : [contour[(i + 1) % len].x, contour[(i + 1) % len].y];

    // 4 điểm: bottom1, bottom2, top1, top2
    const [x1, y1] = curr;
    const [x2, y2] = next;

    // Đặt 2 mặt song song dọc theo trục Z
    const z0 = 0;
    const z1 = depth;

    const baseIndex = positions.length / 3;

    // Bottom face (z0)
    positions.push(x1, y1, z0); // 0
    positions.push(x2, y2, z0); // 1

    // Top face (z1)
    positions.push(x1, y1, z1); // 2
    positions.push(x2, y2, z1); // 3

    // 2 tam giác tạo mặt bên
    indices.push(baseIndex + 0, baseIndex + 2, baseIndex + 1);
    indices.push(baseIndex + 2, baseIndex + 3, baseIndex + 1);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}
function createInflatedBridgeGeometry(contour, depth = 1, segments = 10) {
  // Input validation
  if (!Array.isArray(contour) || !contour.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number'))) {
    throw new Error('Contour must be an array of [x, y] number pairs');
  }
  if (contour.length < 3) {
    throw new Error('Contour must have at least 3 points');
  }
  if (typeof depth !== 'number' || depth <= 0) {
    throw new Error('depth must be a positive number');
  }
  if (typeof segments !== 'number' || segments < 1) {
    throw new Error('segments must be at least 1');
  }

  const positions = [];
  const indices = [];
  const len = contour.length;

  // Compute centroid
  const centroid = new THREE.Vector2(0, 0);
  contour.forEach(([x, y]) => centroid.add(new THREE.Vector2(x, y)));
  centroid.divideScalar(len);

  // Calculate distance to contour
  function distanceToContour(p) {
    const v = new THREE.Vector2(p[0], p[1]);
    let minDist = Infinity;
    for (let i = 0; i < contour.length; i++) {
      const a = new THREE.Vector2(contour[i][0], contour[i][1]);
      const b = new THREE.Vector2(contour[(i + 1) % contour.length][0], contour[(i + 1) % contour.length][1]);
      const ab = b.clone().sub(a);
      const ap = v.clone().sub(a);
      const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
      const proj = a.clone().add(ab.multiplyScalar(t));
      const dist = v.distanceTo(proj);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  // Compute max distance to contour
  let maxDist = 0;
  const distances = contour.map(p => {
    const d = distanceToContour(p);
    if (d > maxDist) maxDist = d;
    return d;
  });

  // Generate vertices for each layer
  for (let s = 0; s <= segments; s++) {
    const t = s / segments; // [0, 1]
    const zBase = -depth * t; // From z=0 to z=-depth
    const inflate = (1 + Math.cos(Math.PI * t)) / 2; // Cosine bulge

    for (let i = 0; i < len; i++) {
      const [x, y] = contour[i];
      const dist = new THREE.Vector2(x, y).distanceTo(centroid);
      const tDist = Math.min(dist / maxDist, 1); // Normalized distance to centroid
      const zInflate = depth * 0.5 * (1 - tDist * tDist) * inflate; // Parabolic z-inflation
      positions.push(x, y, zBase + zInflate);
    }
  }

  // Generate side faces
  for (let s = 0; s < segments; s++) {
    const current = s * len;
    const next = (s + 1) * len;
    for (let i = 0; i < len; i++) {
      const a = current + i;
      const b = current + (i + 1) % len;
      const c = next + (i + 1) % len;
      const d = next + i;
      indices.push(a, b, d); // First triangle
      indices.push(b, c, d); // Second triangle
    }
  }

  // Create geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function createBridgeBetweenContours(contourIndices, vertices1, vertices2) {
  const positions = [];
  const indices = [];

  for (let i = 0; i < contourIndices.length; i++) {
    const curr = contourIndices[i];
    const next = contourIndices[(i + 1) % contourIndices.length];

    const v1a = vertices1[curr]; // điểm trên inflated
    const v1b = vertices1[next];
    const v2a = vertices2[curr]; // điểm đối xứng
    const v2b = vertices2[next];

    const baseIndex = positions.length / 3;

    positions.push(
      v1a.x, v1a.y, v1a.z, // 0
      v1b.x, v1b.y, v1b.z, // 1
      v2a.x, v2a.y, v2a.z, // 2
      v2b.x, v2b.y, v2b.z  // 3
    );

    indices.push(
      baseIndex, baseIndex + 2, baseIndex + 1,
      baseIndex + 1, baseIndex + 2, baseIndex + 3
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

function useShapeGeometryFromImage(url, resolution = 1) {
  const [geometry, setGeometry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [texshape, setTexShape] = useState(false)
  const { scene } = useThree()
  const [error, setError] = useState(null)
  const {
    extrude,
    depth,
    bevelEnabled,
    bevelSegments,
    bevelThickness,
  } = useControls('Extrude Settings', {
    extrude: { value: 1, min: 0, max: 5, step: 0.1 },
    depth: { value: 0.1, min: 0, max: 1, step: 0.01 },
    bevelEnabled: { value: true },
    bevelSegments: { value: 50, min: 1, max: 50, step: 1 },
    bevelThickness: { value: 0.3, min: 0, max: 1, step: 0.01 }
  })




  useEffect(() => {
    if (!url) return

    setLoading(true)
    setError(null)

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, img.width, img.height)

        // Trace contour path
        const contour = findContourPath_ConvexHull(imgData.data, img.width, img.height)

        if (contour.length < 3) {
          setError('Không tìm thấy contour hợp lệ')
          setLoading(false)
          return
        }

        // Simplify contour (Douglas-Peucker algorithm simplified)
        const simplifyContour = (points, tolerance = 2) => {
          if (points.length <= 2) return points

          const simplified = [points[0]]
          let lastAdded = 0

          for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[lastAdded].x
            const dy = points[i].y - points[lastAdded].y
            const dist = Math.sqrt(dx * dx + dy * dy)

            if (dist > tolerance || i === points.length - 1) {
              simplified.push(points[i])
              lastAdded = i
            }
          }

          return simplified
        }

        let simplifiedContour = simplifyContour(contour, resolution)

        simplifiedContour = smoothContour(simplifiedContour, 50)

        // Convert to THREE.Vector2 và normalize
        let points = simplifiedContour.map(p => new THREE.Vector2(
          (p.x / img.width - 0.5) * 2,
          -(p.y / img.height - 0.5) * 2
        ))

        // Đảm bảo polygon khép kín
        if (!points[0].equals(points[points.length - 1])) {
          points.push(points[0].clone())
        }
        // Đảm bảo winding order đúng
        if (THREE.ShapeUtils.isClockWise(points)) {
          points.reverse()
        }

        let geo, shape
        if (extrude > 0) {

          const extrudeSettings = {
            depth: 0,
            bevelEnabled: false,
            bevelSegments: 2,
            bevelThickness: .1,
            bevelOffset: 0,
            bevelSize: .15,
          }

          // LỌC CHỈ LẤY TAM GIÁC BÊN TRONG SHAPE
          function isTriangleInside(triangle, vertices, contour) {
            const [a, b, c] = triangle;
            const v1 = vertices[a], v2 = vertices[b], v3 = vertices[c];

            // Tính trọng tâm tam giác
            const centroid = {
              x: (v1.x + v2.x + v3.x) / 3,
              y: (v1.y + v2.y + v3.y) / 3
            };

            // Kiểm tra centroid có trong polygon không
            return isPointInPolygon(centroid, contour.map(p => ({ x: p[0], y: p[1] })));
          }

          function isPointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
              }
            }
            return inside;
          }
          function resample(points, step = 1) {
            const newPoints = [];
            for (let i = 0; i < points.length; i++) {
              const p1 = points[i];
              const p2 = points[(i + 1) % points.length];
              const dist = p1.distanceTo(p2);
              const segments = Math.ceil(dist / step);
              for (let j = 0; j < segments; j++) {
                const t = j / segments;
                newPoints.push(new THREE.Vector2(
                  p1.x * (1 - t) + p2.x * t,
                  p1.y * (1 - t) + p2.y * t
                ));
              }
            }
            return newPoints;
          }
          function inflateMesh(geometry, contour, maxHeight = 5) {
            // Input validation
            if (!(geometry instanceof THREE.BufferGeometry) || !geometry.attributes.position) {
              throw new Error('Input must be a THREE.BufferGeometry with a position attribute');
            }
            if (!Array.isArray(contour) || !contour.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number'))) {
              throw new Error('Contour must be an array of [x, y] number pairs');
            }
            if (contour.length < 3) {
              throw new Error('Contour must have at least 3 points to form a valid polygon');
            }
            if (typeof maxHeight !== 'number' || maxHeight <= 0) {
              throw new Error('maxHeight must be a positive number');
            }

            const contourPoints = contour.map(([x, y]) => new THREE.Vector2(x, y));

            // Compute centroid for more even inflation
            const centroid = new THREE.Vector2(0, 0);
            contourPoints.forEach(p => centroid.add(p));
            centroid.divideScalar(contourPoints.length);

            // Extract vertices
            const positionAttribute = geometry.attributes.position;
            const vertices = [];
            for (let i = 0; i < positionAttribute.count; i++) {
              vertices.push(new THREE.Vector3(
                positionAttribute.getX(i),
                positionAttribute.getY(i),
                positionAttribute.getZ(i)
              ));
            }

            // Check if point is on contour
            function isOnContour(v) {
              const p = new THREE.Vector2(v.x, v.y);
              for (let i = 0; i < contourPoints.length; i++) {
                const a = contourPoints[i];
                const b = contourPoints[(i + 1) % contourPoints.length];
                const ab = b.clone().sub(a);
                const ap = p.clone().sub(a);
                const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
                const proj = a.clone().add(ab.multiplyScalar(t));
                if (p.distanceTo(proj) < 1e-5) return true;
              }
              return false;
            }

            // Calculate distance to contour
            function distanceToContour(v) {
              const p = new THREE.Vector2(v.x, v.y);
              let minDist = Infinity;
              for (let i = 0; i < contourPoints.length; i++) {
                const a = contourPoints[i];
                const b = contourPoints[(i + 1) % contourPoints.length];
                const ab = b.clone().sub(a);
                const ap = p.clone().sub(a);
                const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
                const proj = a.clone().add(ab.multiplyScalar(t));
                const dist = p.distanceTo(proj);
                if (dist < minDist) minDist = dist;
              }
              return minDist;
            }

            // Compute distances to contour and centroid
            let maxDist = 0;
            const distances = vertices.map(v => {
              if (isOnContour(v)) return 0;
              const d = distanceToContour(v);
              if (d > maxDist) maxDist = d;
              return d;
            });

            // Handle case with no interior vertices
            if (maxDist === 0) {
              console.warn('All vertices on contour; no inflation applied.');
              return geometry.clone();
            }

            // Compute max distance to centroid for normalization
            let maxCentroidDist = 0;
            vertices.forEach(v => {
              if (!isOnContour(v)) {
                const dist = new THREE.Vector2(v.x, v.y).distanceTo(centroid);
                if (dist > maxCentroidDist) maxCentroidDist = dist;
              }
            });

            // Inflate vertices with parabolic function
            const newGeometry = geometry.clone();
            const newPositionAttribute = newGeometry.attributes.position;
            for (let i = 0; i < newPositionAttribute.count; i++) {
              if (isOnContour(vertices[i])) {
                newPositionAttribute.setZ(i, 0);
              } else {
                const d = distances[i];
                const t = Math.min(d / maxDist, 1); // Normalized distance to contour
                const centroidDist = new THREE.Vector2(vertices[i].x, vertices[i].y).distanceTo(centroid);
                const tCentroid = Math.min(centroidDist / maxCentroidDist, 1); // Normalized distance to centroid
                // Combine contour and centroid distances for even inflation
                const tCombined = Math.max(1 - t, tCentroid); // Prioritize centroid distance for interior
                const z = maxHeight * (1 - tCombined * tCombined); // Parabolic curve
                newPositionAttribute.setZ(i, z);
              }
            }
            newPositionAttribute.needsUpdate = true;

            // Recalculate normals
            newGeometry.computeVertexNormals();

            return newGeometry;
          }

          function mergeGeometries(geometries) {
            let mergedGeometry = new THREE.BufferGeometry();

            let positions = [];
            let normals = [];
            let uvs = [];
            let indices = [];

            let vertexOffset = 0;

            geometries.forEach(geometry => {
              geometry = geometry.clone();
              geometry = geometry.toNonIndexed(); // Chuyển về non-indexed để dễ merge

              const pos = geometry.attributes.position.array;
              const norm = geometry.attributes.normal ? geometry.attributes.normal.array : [];
              const uv = geometry.attributes.uv ? geometry.attributes.uv.array : [];

              for (let i = 0; i < pos.length; i += 3) {
                positions.push(pos[i], pos[i + 1], pos[i + 2]);
              }

              for (let i = 0; i < norm.length; i += 3) {
                normals.push(norm[i], norm[i + 1], norm[i + 2]);
              }

              for (let i = 0; i < uv.length; i += 2) {
                uvs.push(uv[i], uv[i + 1]);
              }

              const vertCount = pos.length / 3;
              for (let i = 0; i < vertCount; i++) {
                indices.push(vertexOffset + i);
              }

              vertexOffset += vertCount;
            });

            mergedGeometry.setAttribute(
              'position',
              new THREE.Float32BufferAttribute(positions, 3)
            );

            if (normals.length > 0) {
              mergedGeometry.setAttribute(
                'normal',
                new THREE.Float32BufferAttribute(normals, 3)
              );
            }

            if (uvs.length > 0) {
              mergedGeometry.setAttribute(
                'uv',
                new THREE.Float32BufferAttribute(uvs, 2)
              );
            }

            mergedGeometry.setIndex(indices);

            return mergedGeometry;
          }
          function laplacianSmooth(geometry, iterations = 1, boundaryVertexIndices = []) {

            const positionAttr = geometry.attributes.position;
            const vertexCount = positionAttr.count;

            // Xây dựng danh sách đỉnh kề
            const neighbors = Array.from({ length: vertexCount }, () => new Set());

            const indexAttr = geometry.index;
            for (let i = 0; i < indexAttr.count; i += 3) {
              const a = indexAttr.getX(i);
              const b = indexAttr.getX(i + 1);
              const c = indexAttr.getX(i + 2);

              neighbors[a].add(b); neighbors[a].add(c);
              neighbors[b].add(a); neighbors[b].add(c);
              neighbors[c].add(a); neighbors[c].add(b);
            }

            const positions = positionAttr.array;
            const isBoundary = new Set(boundaryVertexIndices); // Giữ nguyên các điểm biên

            for (let iter = 0; iter < iterations; iter++) {
              const newPositions = new Float32Array(positions.length);

              for (let i = 0; i < vertexCount; i++) {
                if (isBoundary.has(i)) {
                  // Giữ nguyên vị trí điểm biên
                  newPositions[i * 3 + 0] = positions[i * 3 + 0];
                  newPositions[i * 3 + 1] = positions[i * 3 + 1];
                  newPositions[i * 3 + 2] = positions[i * 3 + 2];
                  continue;
                }

                let sumX = 0, sumY = 0, sumZ = 0;
                neighbors[i].forEach(n => {
                  sumX += positions[n * 3 + 0];
                  sumY += positions[n * 3 + 1];
                  sumZ += positions[n * 3 + 2];
                });

                const nCount = neighbors[i].size;
                newPositions[i * 3 + 0] = sumX / nCount;
                newPositions[i * 3 + 1] = sumY / nCount;
                newPositions[i * 3 + 2] = sumZ / nCount;
              }

              // Cập nhật vị trí
              positionAttr.array.set(newPositions);
              positionAttr.needsUpdate = true;
            }

            geometry.computeVertexNormals();
            return geometry;
          }

          points = resample(points, 5); // bước 5 đơn vị

          shape = new THREE.Shape(points)
          const contour = points.map(p => [p.x, p.y]);
          const contourIndices = contour.map((_, i) => i);

          const edges = [];
          for (let i = 0; i < contour.length; i++) {
            edges.push([i, (i + 1) % contour.length]);
          }

          const triangles = cdt2d(contour, edges, { exterior: true });
          const vertices = contour.map(([x, y]) => new THREE.Vector3(x, y, 0));

          const insideTriangles = triangles.filter(triangle =>
            isTriangleInside(triangle, vertices, contour)
          );
          // const insideTriangles = triangles
          // THIẾT LẬP ĐỘ DÀY
          const depth = .05 // Điều chỉnh độ dày

          const positions = [];
          const indices = [];
          let vertexIndex = 0;





          // 1. MẶT TRƯỚC (z = 0)
          // for (const [a, b, c] of insideTriangles) {
          //   positions.push(...vertices[a].toArray());
          //   positions.push(...vertices[b].toArray());
          //   positions.push(...vertices[c].toArray());

          //   indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
          //   vertexIndex += 3;
          // }

          // // 2. MẶT SAU (z = -depth) - ĐẢO CHIỀU
          // for (const [a, b, c] of insideTriangles) {
          //   const v1 = [...vertices[a].toArray()];
          //   const v2 = [...vertices[b].toArray()];
          //   const v3 = [...vertices[c].toArray()];

          //   v1[2] = -depth;
          //   v2[2] = -depth;
          //   v3[2] = -depth;

          //   positions.push(...v1, ...v2, ...v3);

          //   // Đảo chiều để normal hướng ra ngoài
          //   indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex);
          //   vertexIndex += 3;
          // }

          // // // 3. MẶT BÊN (nối 2 mặt)
          // for (let i = 0; i < contour.length; i++) {
          //   const current = i;
          //   const next = (i + 1) % contour.length;

          //   // 4 đỉnh của mặt bên
          //   const v1 = [contour[current][0], contour[current][1], 0];      // trước-current
          //   const v2 = [contour[next][0], contour[next][1], 0];           // trước-next
          //   const v3 = [contour[current][0], contour[current][1], -depth]; // sau-current
          //   const v4 = [contour[next][0], contour[next][1], -depth];       // sau-next

          //   positions.push(...v1, ...v2, ...v3, ...v4);

          //   // 2 tam giác cho mặt bên
          //   indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);     // tam giác 1
          //   indices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2); // tam giác 2
          //   vertexIndex += 4;
          // }

          // TẠO GEOMETRY
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geo.setIndex(indices);
          geo.computeVertexNormals();




          const iterations = 1
          geo = LoopSubdivision.modify(geo, iterations, {
            split: true,
            uvSmooth: false,
            preserveEdges: true,
            flatOnly: true,
            maxTriangles: Infinity,
          })
          //inflateLaplacianZ(geo, 0.5,points); // chỉ cần strength
          let inflatedGeometry = inflateMesh(geo, contour, .2);


          const shapesample = new THREE.Shape(points)
          const matd = new THREE.MeshStandardMaterial({ color: 0x44aa88, wireframe: true, side: THREE.DoubleSide });


          const DEPTH_CS = .02
          let sideGeo = createBridgeGeometry(contour, -DEPTH_CS)

          geo = mergeGeometries([inflatedGeometry, mirrorGeometry(inflatedGeometry, 'z', DEPTH_CS), sideGeo]);
          geo = LoopSubdivision.modify(geo, 2, {
            split: true,
            uvSmooth: false,
            preserveEdges: true,
            flatOnly: false,
            maxTriangles: Infinity,
          })
          geo = smoothGeometry(geo, 5, 0.9);

          //geo = new THREE.ShapeGeometry(shape2)
        } else {
          geo = new THREE.ShapeGeometry(shape)
        }

        // Proper UV mapping
        const position = geo.attributes.position
        const uv = new Float32Array(position.count * 2)

        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i)
          const y = position.getY(i)

          // Map từ world space [-1,1] về UV space [0,1]
          uv[i * 2] = (x + 1) / 2
          uv[i * 2 + 1] = (y + 1) / 2
        }

        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
        geo.computeVertexNormals()
        geo.computeBoundingBox()

        const texshapes = createShapeMaskTexture(shape, 256);
        setTexShape(texshapes)

        setGeometry(geo)
        setLoading(false)

      } catch (err) {
        setError('Lỗi xử lý image: ' + err.message)
        setLoading(false)
        console.error('Shape processing error:', err)
      }
    }

    img.onerror = () => {
      setError('Không thể load image')
      setLoading(false)
    }

    img.src = url
  }, [url, resolution])

  return { geometry, loading, error, texshape }
}

export default function ShapeMesh_testalo({ url, urlImg, resolution = 1 }) {
  const { geometry, loading, error, texshape } = useShapeGeometryFromImage(url, resolution)
  const textureImg = useTexture(urlImg)
textureImg.encoding = THREE.sRGBEncoding;
textureImg.colorSpace = THREE.SRGBColorSpace
  const {
    wireframes
  } = useControls('Model Settings', {
    wireframes: { value: false },
  })


  const shaderRef = useRef()
  const al = useRef()
  const bl = useRef()
  const cl = useRef()
  const originalTexture = new THREE.TextureLoader().load(url, (tex) => {
    al.current = extractAlphaDataTextureWithMipmaps(tex);
    bl.current = generateSDFfromDataTexture(al.current);

    //cl.current = generateNarrowBandSDFSmooth(texshape);

  });
  useEffect(() => {

  }, [texshape])

  if (loading) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="gray" /></mesh>
  if (error) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="red" /></mesh>
  if (!geometry) return null

  return (
    <>
     {/*  <axesHelper args={[5]} /> */}

      <mesh geometry={geometry} castShadow receiveShadow /* material={mat} */>
        <meshStandardMaterial   roughness={0.3}
  metalness={0.0} color={'white'} toneMapped={true} map={textureImg} side={2} wireframe={wireframes} />
        {/* <meshNormalMaterial side={2}  wireframe={wireframes} /> */}
        {/*   <customMaterial side={2} wireframe={wireframes} ref={shaderRef} uColor={'white'} uAlphaCheck={generateSDFfromDataTexture(texshape)} uAlphaCheck2={cl.current} uMap={textureImg} /> */}
      </mesh>

      <mesh position={[0, 1.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={generateSDFfromDataTexture(texshape, 5)} />
      </mesh>
      <mesh position={[1, 1.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texshape} />
      </mesh>
    </>
  )
}
